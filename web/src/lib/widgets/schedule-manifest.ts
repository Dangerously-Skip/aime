/**
 * Server-side widget schedule manifest — the state the C5 scheduler runs from.
 *
 * The renderer owns widget CRUD (localStorage via widget-store), but a closed
 * window takes localStorage with it, and "works while you sleep" is the whole
 * point. So the renderer mirrors its widgets here on every change, and the
 * server ticker reads THIS file — never the renderer — to decide what is due.
 * Renders produced while the window was closed are written back here, and the
 * renderer merges them on next launch.
 *
 * Same corruption discipline as the run log: tolerate garbage, never throw.
 */
import { getDataDir } from '@/lib/app-paths';
import type { Widget } from './widget';

const MANIFEST_FILENAME = 'widget-schedule.json';

let cachedPath: string | null = null;

async function manifestPath(): Promise<string> {
  if (cachedPath) return cachedPath;
  const path = await import('path');
  const fs = await import('fs/promises');
  const userDataDir = process.env.AIME_USER_DATA_DIR;
  const dir = userDataDir ? path.join(userDataDir, 'runs') : getDataDir();
  await fs.mkdir(dir, { recursive: true });
  cachedPath = path.join(dir, MANIFEST_FILENAME);
  return cachedPath;
}

/** Reset the memoized path. Tests only. */
export function __resetManifestPath(): void {
  cachedPath = null;
}

function isWidgetLike(v: unknown): v is Widget {
  const w = v as Partial<Widget> | null;
  return Boolean(
    w && typeof w === 'object' && typeof w.id === 'string' && typeof w.recipe === 'string',
  );
}

/** Read the manifest. Missing or corrupt ⇒ empty list, never an error. */
export async function readManifest(): Promise<Widget[]> {
  try {
    const fs = await import('fs/promises');
    const raw = await fs.readFile(await manifestPath(), 'utf-8');
    const parsed = JSON.parse(raw) as { widgets?: unknown[] };
    return Array.isArray(parsed.widgets) ? parsed.widgets.filter(isWidgetLike) : [];
  } catch {
    return [];
  }
}

/** Replace the manifest wholesale (the renderer is the source of truth for CRUD). */
export async function writeManifest(widgets: Widget[]): Promise<boolean> {
  try {
    const fs = await import('fs/promises');
    await fs.writeFile(
      await manifestPath(),
      JSON.stringify({ widgets: widgets.filter(isWidgetLike) }, null, 2),
      'utf-8',
    );
    return true;
  } catch (err) {
    console.error('[widgets] failed to write schedule manifest:', err);
    return false;
  }
}

/**
 * Patch one widget in place (the scheduler stamping a render/refreshedAt).
 * Read-modify-write; last writer wins, which at minute-scale cadence is fine.
 */
export async function patchManifestWidget(id: string, patch: Partial<Widget>): Promise<boolean> {
  const widgets = await readManifest();
  const idx = widgets.findIndex((w) => w.id === id);
  if (idx === -1) return false;
  widgets[idx] = { ...widgets[idx], ...patch };
  return writeManifest(widgets);
}
