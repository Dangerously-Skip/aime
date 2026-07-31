import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NextRequest } from 'next/server';
import { EVAL_BRIEFS } from './eval-briefs';
import { findSlopTells, summariseTells, type Finding } from './slop-tells';

/**
 * P7.0 — capture the BEFORE.
 *
 * Not part of `npm test`: the suite's `include` covers `*.test.ts` only, so this
 * runs solely via `npm run eval:baseline`. It makes real model calls and costs
 * real money, so it also refuses to start without `AIME_EVAL=1` — an eval that
 * can be triggered by a stray test run is one that surprises someone's bill.
 *
 * ## Why it drives the real route
 *
 * The thing being measured is the prompt the CODE SURFACE actually assembles —
 * preset + append + identity + memory + security rules, plus the tool loop that
 * writes files. Reconstructing that here would measure a reconstruction, and the
 * first P7 change would then be compared against a baseline of something else.
 * So it posts to the genuine `POST /api/chat/[surfaceId]` handler, exactly as the
 * surface does.
 *
 * The system prompt is OBSERVED, not substituted: `query` is wrapped to record
 * what it was handed and then delegates to the real implementation. Recording
 * the prompt bytes matters because "the prompt changed" is the independent
 * variable of every later comparison — without them a diff in output cannot be
 * attributed.
 *
 * ## What is pinned, and why
 *
 * Model and effort are fixed (Opus 5, chosen 2026-08-01). If they float, a later
 * run measures the model change and the prompt change together and can separate
 * neither. The same applies to the brief set — see `eval-briefs.ts`.
 */

const OUT_ROOT = path.resolve(__dirname, '../../../../.planning/evals');
const MODEL = 'claude-opus-5';
const ENABLED = process.env.AIME_EVAL === '1';

/** Files an artifact could plausibly be. */
const ARTIFACT_EXT = /\.(html?|tsx?|jsx?|css|svelte|vue)$/i;

interface BriefResult {
  id: string;
  shape: string;
  files: string[];
  findings: Finding[];
  durationMs: number;
  error?: string;
}

function collectFiles(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
    if (e.isDirectory()) return collectFiles(full, base);
    return ARTIFACT_EXT.test(e.name) ? [path.relative(base, full)] : [];
  });
}

describe.skipIf(!ENABLED)('P7.0 baseline — today’s code surface, unmodified', () => {
  let runDir: string;
  const results: BriefResult[] = [];
  const prompts = new Map<string, string>();

  beforeAll(() => {
    // A timestamped directory, so a re-run never silently overwrites the
    // baseline it is supposed to be compared against.
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    runDir = path.join(OUT_ROOT, `baseline-${stamp}`);
    fs.mkdirSync(runDir, { recursive: true });
  });

  it.each(EVAL_BRIEFS.map((b) => [b.id, b] as const))(
    '%s',
    async (id, brief) => {
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `aime-eval-${id}-`));
      const started = Date.now();
      let error: string | undefined;

      // Observe the assembled prompt without replacing the provider.
      const providers = await import('@/lib/providers');
      const realGetProvider = providers.getProvider;
      const spy = ((name: string) => {
        const provider = realGetProvider(name as never);
        const realQuery = provider.query.bind(provider);
        return {
          ...provider,
          query: (params: Record<string, unknown>) => {
            if (typeof params.systemPrompt === 'string') prompts.set(id, params.systemPrompt);
            else if (params.systemPrompt) prompts.set(id, JSON.stringify(params.systemPrompt, null, 2));
            return realQuery(params as never);
          },
        };
      }) as unknown as typeof providers.getProvider;
      (providers as { getProvider: typeof providers.getProvider }).getProvider = spy;

      try {
        const { POST } = await import('@/app/api/chat/[surfaceId]/route');
        const res = await POST(
          new NextRequest('http://localhost/api/chat/code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: brief.prompt,
              chatId: `eval-${id}`,
              cwd: workspace,
              model: MODEL,
            }),
          }),
          { params: Promise.resolve({ surfaceId: 'code' }) },
        );
        // Drain the stream — the turn is not finished until it closes.
        await res.text();
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      } finally {
        (providers as { getProvider: typeof providers.getProvider }).getProvider = realGetProvider;
      }

      const files = collectFiles(workspace);
      const briefDir = path.join(runDir, id);
      fs.mkdirSync(briefDir, { recursive: true });

      const findings: Finding[] = [];
      for (const rel of files) {
        const source = fs.readFileSync(path.join(workspace, rel), 'utf-8');
        fs.mkdirSync(path.dirname(path.join(briefDir, rel)), { recursive: true });
        fs.writeFileSync(path.join(briefDir, rel), source);
        findings.push(...findSlopTells(source).map((f) => ({ ...f, detail: `${rel}: ${f.detail}` })));
      }

      const prompt = prompts.get(id);
      if (prompt) fs.writeFileSync(path.join(briefDir, '_system-prompt.txt'), prompt);
      fs.writeFileSync(
        path.join(briefDir, '_brief.json'),
        JSON.stringify({ ...brief, model: MODEL, error }, null, 2),
      );

      results.push({
        id,
        shape: brief.shape,
        files,
        findings,
        durationMs: Date.now() - started,
        error,
      });

      fs.rmSync(workspace, { recursive: true, force: true });

      // A brief that produced nothing is a result worth seeing, not a pass.
      expect(files.length, `${id} produced no artifact (${error ?? 'no error reported'})`).toBeGreaterThan(0);
    },
    900_000,
  );

  it('writes the summary', () => {
    const lines = [
      '# P7.0 craft baseline',
      '',
      `Model: \`${MODEL}\` (pinned — see baseline.eval.ts).`,
      `Captured: ${new Date().toISOString()}`,
      '',
      'The BEFORE for every P7 change. Measured with `slop-tells.ts`; the same',
      'instrument must be used for the after, or the comparison means nothing.',
      '',
      '| brief | shape | files | tells | duration |',
      '|---|---|---|---|---|',
      ...results.map(
        (r) =>
          `| ${r.id} | ${r.shape} | ${r.files.length} | ${summariseTells(r.findings)} | ${(r.durationMs / 1000).toFixed(0)}s |`,
      ),
      '',
      '## Findings',
      '',
      ...results.flatMap((r) => [
        `### ${r.id}`,
        '',
        ...(r.findings.length
          ? r.findings.map((f) => `- **${f.severity.toUpperCase()} ${f.rule}** — ${f.detail}`)
          : ['- none']),
        '',
      ]),
      '## What this cannot tell you',
      '',
      'Only the checkable tells. Hierarchy, restraint, and whether the thing looks',
      'like the brand are judgement calls and are deliberately not scored here — a',
      'number for those would be false confidence.',
    ];
    fs.writeFileSync(path.join(runDir, 'README.md'), lines.join('\n'));
    expect(results.length).toBe(EVAL_BRIEFS.length);
  });
});

describe.skipIf(ENABLED)('P7.0 baseline (not run)', () => {
  it('needs AIME_EVAL=1 and a configured provider', () => {
    // Present so a normal run reports "skipped" rather than "0 tests", which
    // reads as the file being broken.
    expect(ENABLED).toBe(false);
  });
});
