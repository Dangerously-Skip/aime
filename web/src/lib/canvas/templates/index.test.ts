import { describe, it, expect } from 'vitest';
import {
  CANVAS_TEMPLATES,
  getCanvasTemplate,
  getCanvasTemplatesForSurface,
  expandCanvasTemplate,
  buildCanvasTemplatesPrompt,
} from './index';

describe('template registry integrity', () => {
  it('every template has the required metadata', () => {
    for (const t of CANVAS_TEMPLATES) {
      expect(t.id, 'id').toBeTruthy();
      expect(t.name, `${t.id} name`).toBeTruthy();
      expect(t.description, `${t.id} description`).toBeTruthy();
      expect(t.whenToUse, `${t.id} whenToUse`).toBeTruthy();
      expect(t.inputShape, `${t.id} inputShape`).toBeTruthy();
      expect(typeof t.render, `${t.id} render`).toBe('function');
    }
  });

  it('template ids are unique', () => {
    const ids = CANVAS_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getCanvasTemplate finds by id', () => {
    expect(getCanvasTemplate('architecture')?.name).toBe('Architecture diagram');
    expect(getCanvasTemplate('nope')).toBeUndefined();
  });
});

describe('expandCanvasTemplate', () => {
  it('returns null for raw documents and non-objects (caller falls back to raw A2UI)', () => {
    expect(expandCanvasTemplate(null)).toBeNull();
    expect(expandCanvasTemplate('string')).toBeNull();
    expect(expandCanvasTemplate({ version: '1', components: [] })).toBeNull();
  });

  it('renders the architecture template', () => {
    const doc = expandCanvasTemplate({
      templateId: 'architecture',
      input: { title: 'System overview', mermaid: 'graph TD; A-->B', notes: 'Two services.' },
    });

    expect(doc).not.toBeNull();
    expect(doc!.title).toBe('System overview');
    expect(doc!.components[0]).toMatchObject({ type: 'mermaid', code: 'graph TD; A-->B' });
    expect(doc!.components.at(-1)).toMatchObject({ type: 'markdown', content: 'Two services.' });
  });

  it('returns a visible error doc (not null) for unknown template ids', () => {
    const doc = expandCanvasTemplate({ templateId: 'does-not-exist', input: {} });
    expect(doc).not.toBeNull();
    expect(doc!.title).toContain('Unknown canvas template');
    const body = (doc!.components[0] as { content: string }).content;
    expect(body).toContain('architecture'); // lists available ids
  });

  it('never throws and never returns null for any registered template, even with empty input', () => {
    for (const t of CANVAS_TEMPLATES) {
      const doc = expandCanvasTemplate({ templateId: t.id, input: {} });
      expect(doc, `template ${t.id}`).not.toBeNull();
      expect(Array.isArray(doc!.components), `template ${t.id} components`).toBe(true);
    }
  });
});

describe('surface filtering and prompt', () => {
  it('offers unrestricted templates on every surface and respects surface restrictions', () => {
    const cowork = getCanvasTemplatesForSurface('cowork');
    const chat = getCanvasTemplatesForSurface('chat');

    for (const t of cowork) {
      expect(!t.surfaces || t.surfaces.length === 0 || t.surfaces.includes('cowork')).toBe(true);
    }
    // Unrestricted templates appear everywhere
    const unrestricted = CANVAS_TEMPLATES.filter((t) => !t.surfaces || t.surfaces.length === 0);
    for (const t of unrestricted) {
      expect(chat.map((x) => x.id)).toContain(t.id);
    }
  });

  it('buildCanvasTemplatesPrompt lists every offered template id', () => {
    const prompt = buildCanvasTemplatesPrompt('cowork');
    expect(prompt).toContain('templateId');
    for (const t of getCanvasTemplatesForSurface('cowork')) {
      expect(prompt).toContain(`**${t.id}**`);
    }
  });
});
