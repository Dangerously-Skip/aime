import { describe, it, expect } from 'vitest';
import { widgetSystemPrompt, extractWidgetJson } from './prompt';
import { KNOWN_ACTIONS } from './actions';
import { parseWidget } from './catalog';
import { isGrounded, widgetToGoal, type Widget } from './widget';

describe('widgetSystemPrompt', () => {
  it('advertises the catalogue and the real action list', () => {
    const p = widgetSystemPrompt({ grounded: true });
    for (const type of ['statGrid', 'keyValue', 'timeline', 'actionButton', 'card']) {
      expect(p, type).toContain(type);
    }
    // The prompt must not advertise actions the host cannot service.
    for (const action of KNOWN_ACTIONS) expect(p).toContain(action);
  });

  it('carries the chart-misuse guardrail', () => {
    const p = widgetSystemPrompt({ grounded: true });
    expect(p).toMatch(/NEVER for clock times/i);
    expect(p).toMatch(/magnitudes/i);
  });

  // An ungrounded tile confidently reporting yesterday's build status is worse
  // than an empty one, because it looks authoritative.
  it('switches to a hard no-invention rule when ungrounded', () => {
    const grounded = widgetSystemPrompt({ grounded: true });
    const ungrounded = widgetSystemPrompt({ grounded: false });

    expect(ungrounded).toMatch(/MUST NOT invent/i);
    expect(ungrounded).toMatch(/NO connected data source/i);
    expect(grounded).not.toMatch(/MUST NOT invent/i);
    expect(grounded).toMatch(/Gather the data FIRST/i);
  });

  it('says so when web search is unavailable', () => {
    expect(widgetSystemPrompt({ grounded: true, webUnconfigured: true })).toMatch(
      /not configured|do not claim to have searched/i,
    );
    expect(widgetSystemPrompt({ grounded: true })).not.toMatch(/do not claim to have searched/i);
  });
});

describe('extractWidgetJson', () => {
  const node = { type: 'card', children: [{ type: 'text', text: 'hi' }] };

  it('reads a bare JSON reply', () => {
    expect(extractWidgetJson(JSON.stringify(node))).toEqual(node);
  });

  // Models fence and preamble despite instructions; losing a whole refresh over
  // formatting would be a bad trade.
  it('reads a fenced reply, with or without a language tag', () => {
    expect(extractWidgetJson('```json\n' + JSON.stringify(node) + '\n```')).toEqual(node);
    expect(extractWidgetJson('```\n' + JSON.stringify(node) + '\n```')).toEqual(node);
  });

  it('reads JSON surrounded by prose', () => {
    expect(extractWidgetJson(`Here you go:\n${JSON.stringify(node)}\nHope that helps!`)).toEqual(node);
  });

  it('returns null rather than throwing on unusable replies', () => {
    for (const bad of ['', 'no json here', '{broken', '```json\nnope\n```']) {
      expect(extractWidgetJson(bad), bad).toBeNull();
    }
  });

  it('composes with the coercer end to end', () => {
    const reply = '```json\n' + JSON.stringify({
      type: 'card',
      title: 'Builds',
      children: [
        { type: 'metric', label: 'Failures', value: '2' },
        { type: 'image', src: 'https://tracker.test/p.png' }, // must be dropped
      ],
    }) + '\n```';
    const widget = parseWidget(extractWidgetJson(reply));
    expect(widget).toMatchObject({ type: 'card', title: 'Builds' });
    // the remote image never survives to the renderer
    expect(JSON.stringify(widget)).not.toContain('tracker.test');
  });
});

const widget = (over: Partial<Widget> = {}): Widget => ({
  id: 'w1',
  title: 'Build health',
  recipe: 'Show overnight build failures',
  render: null,
  enabled: true,
  createdAt: 0,
  ...over,
});

describe('isGrounded', () => {
  it('is true when there is any real source to read', () => {
    expect(isGrounded(widget({ allowWeb: true }))).toBe(true);
    expect(isGrounded(widget({ scopeProjectId: 'p1' }))).toBe(true);
    expect(isGrounded(widget({ scopeConversationId: 'c1' }))).toBe(true);
  });

  it('is false for a widget with no source at all', () => {
    expect(isGrounded(widget())).toBe(false);
  });
});

describe('widgetToGoal', () => {
  it('projects a widget onto the Goal it already is', () => {
    const g = widgetToGoal(widget({ refreshEverySeconds: 3_600, refreshedAt: 5_000 }));
    expect(g).toMatchObject({
      id: 'widget:w1',
      sourceId: 'w1',
      objective: 'Show overnight build failures',
      schedule: { everySeconds: 3_600 },
      lastRunAt: 5_000,
      enabled: true,
    });
  });

  it('pins refreshes to the cheap tier — a tile is not worth a reasoning budget', () => {
    expect(widgetToGoal(widget())).toMatchObject({ capability: 'chat', tier: 'cheap' });
  });

  it('needs no approval — generation is read-only', () => {
    expect(widgetToGoal(widget()).approvalPolicy).toBe('never');
  });

  it('has no schedule when refresh is manual', () => {
    expect(widgetToGoal(widget()).schedule).toBeUndefined();
  });

  // Widget runs and standing-order runs must not collide in the run log.
  it('namespaces its goal id away from standing orders', () => {
    expect(widgetToGoal(widget({ id: 'x' })).id).toBe('widget:x');
    expect(widgetToGoal(widget({ id: 'x' })).id).not.toBe('so:x');
  });
});
