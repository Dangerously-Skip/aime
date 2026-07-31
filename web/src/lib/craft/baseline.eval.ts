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

/**
 * Pinned so a later run measures the PROMPT change and not the model change.
 *
 * Overridable because the same model is spelled differently per provider —
 * `claude-opus-5` direct, `anthropic/claude-opus-5` on OpenRouter (anything
 * without that prefix is routed to the openai-compat shim by
 * `transportForModel`), `anthropic.claude-opus-5` on Bedrock. The override
 * exists for the spelling, not to change models between runs.
 *
 * Whatever is used is RECORDED in every artifact and in the summary. That is the
 * part that matters: a comparison across two different models is not invalid so
 * long as you can see that is what it was.
 */
const MODEL = process.env.AIME_EVAL_MODEL || 'claude-opus-5';

/** Run a single brief by id — proves the harness before paying for all eight. */
const ONLY = process.env.AIME_EVAL_BRIEF;

/**
 * A BYOK provider to run through, as `providerConfig` on the request rather than
 * as raw environment.
 *
 * Setting `ANTHROPIC_BASE_URL` directly looks equivalent and is not: the SDK
 * appends `/v1/messages`, so a base of `https://openrouter.ai/api/v1` becomes
 * `/api/v1/v1/messages` and 404s. The app already solves this in
 * `baseUrlForSdk`, and going through `providerConfig` means the eval exercises
 * the same resolution a real user's setup does instead of a parallel one.
 *
 * (The SDK reports that 404 as "the selected model may not exist or you may not
 * have access to it", which reads as a catalogue problem and sends the search
 * somewhere else entirely — it is documented in execution.ts for that reason.)
 */
const PROVIDER_BASE_URL = process.env.AIME_EVAL_PROVIDER_BASE_URL;
const ENABLED = process.env.AIME_EVAL === '1';

/** Files an artifact could plausibly be. */
const ARTIFACT_EXT = /\.(html?|tsx?|jsx?|css|svelte|vue)$/i;

interface BriefResult {
  id: string;
  shape: string;
  files: string[];
  /** Length of the inline reply — an artifact pasted into chat still counts. */
  replyChars: number;
  toolCalls: number;
  /** From the `done` event. Real when the provider reported it. */
  costUsd?: number;
  estimatedCost: boolean;
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

  const briefs = ONLY ? EVAL_BRIEFS.filter((b) => b.id === ONLY) : EVAL_BRIEFS;

  it('resolves the requested briefs', () => {
    // A typo'd id would otherwise run nothing and report success.
    expect(briefs.length, `no brief matches AIME_EVAL_BRIEF=${ONLY}`).toBeGreaterThan(0);
  });

  it.each(briefs.map((b) => [b.id, b] as const))(
    '%s',
    async (id, brief) => {
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `aime-eval-${id}-`));
      const started = Date.now();
      let error: string | undefined;
      let sse = '';

      /**
       * Observe the assembled prompt without replacing the provider.
       *
       * Patched on the PROTOTYPE, not on the module export: ES module exports
       * are read-only getters, so assigning `providers.getProvider = spy` throws
       * "Cannot set property getProvider of [object Module] which has only a
       * getter". The prototype method is an ordinary property and is the seam
       * that actually exists.
       *
       * It delegates to the real implementation — this records what the route
       * assembled, it does not substitute for it. The prompt bytes are the
       * independent variable of every later comparison.
       */
      const { ClaudeProvider } = await import('@/lib/providers/claude-provider');
      const realQuery = ClaudeProvider.prototype.query;
      ClaudeProvider.prototype.query = function (this: unknown, params: Record<string, unknown>) {
        const sp = params.systemPrompt;
        if (typeof sp === 'string') prompts.set(id, sp);
        else if (sp) prompts.set(id, JSON.stringify(sp, null, 2));
        return (realQuery as (p: unknown) => unknown).call(this, params);
      } as unknown as typeof ClaudeProvider.prototype.query;

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
              ...(PROVIDER_BASE_URL
                ? {
                    providerConfig: {
                      providerId: 'eval-provider',
                      transport: 'anthropic-native',
                      baseUrl: PROVIDER_BASE_URL,
                    },
                    apiKey: process.env.ANTHROPIC_API_KEY,
                  }
                : {}),
            }),
          }),
          { params: Promise.resolve({ surfaceId: 'code' }) },
        );
        // KEEP the stream. Draining it with `await res.text()` and discarding
        // the result threw away two things that turned out to matter: the
        // assistant's reply — which IS the artifact when the model answers with
        // markup inline rather than writing a file — and the `done` event
        // carrying the turn's real cost. A five-minute Opus run produced neither
        // a file nor an explanation of why, because both had been dropped.
        sse = await res.text();
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      } finally {
        ClaudeProvider.prototype.query = realQuery;
      }

      /** Reassemble what the model actually said, and what the turn cost. */
      const events = sse
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .filter((l) => l && l !== '[DONE]')
        .flatMap((l) => {
          try {
            return [JSON.parse(l) as Record<string, unknown>];
          } catch {
            return [];
          }
        });
      const replyText = events
        .filter((e) => e.type === 'text')
        .map((e) => (e.content as string) ?? '')
        .join('');
      /**
       * TWO events carry `type: 'done'` — one from the provider as it finishes,
       * one from the route with the usage attached. `.find()` returned the
       * provider's, which has no `usage`, so every run reported cost as unknown
       * while the real number was three lines further down the same stream.
       *
       * Select on the field that is actually wanted rather than on the type.
       */
      const usage = events
        .filter((e) => e.type === 'done' && e.usage)
        .map((e) => e.usage as Record<string, unknown>)
        .pop();
      const toolNames = events
        .filter((e) => e.type === 'tool_use')
        .map((e) => e.name as string);

      const files = collectFiles(workspace);
      const briefDir = path.join(runDir, id);
      fs.mkdirSync(briefDir, { recursive: true });

      // The reply is an artifact in its own right: an "artifact" the model
      // pasted into chat is still the thing being judged, and scanning only
      // files would score it as producing nothing.
      if (replyText.trim()) {
        fs.writeFileSync(path.join(briefDir, '_reply.md'), replyText);
      }
      // The raw stream, always. The first attempt at cost capture failed and
      // there was nothing left to diagnose it from — the same mistake as
      // deleting the workspace. It is a few KB.
      fs.writeFileSync(path.join(briefDir, '_stream.sse'), sse);
      fs.writeFileSync(
        path.join(briefDir, '_usage.json'),
        JSON.stringify({ usage, toolCalls: toolNames, durationMs: Date.now() - started }, null, 2),
      );

      const findings: Finding[] = [];
      for (const rel of files) {
        const source = fs.readFileSync(path.join(workspace, rel), 'utf-8');
        fs.mkdirSync(path.dirname(path.join(briefDir, rel)), { recursive: true });
        fs.writeFileSync(path.join(briefDir, rel), source);
        findings.push(...findSlopTells(source).map((f) => ({ ...f, detail: `${rel}: ${f.detail}` })));
      }

      if (replyText.trim()) {
        findings.push(
          ...findSlopTells(replyText).map((f) => ({ ...f, detail: `reply: ${f.detail}` })),
        );
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
        replyChars: replyText.length,
        toolCalls: toolNames.length,
        costUsd: typeof usage?.cost === 'number' ? usage.cost : undefined,
        estimatedCost: usage?.estimated === true,
        findings,
        durationMs: Date.now() - started,
        error,
      });

      if (files.length) {
        fs.rmSync(workspace, { recursive: true, force: true });
      } else {
        // Preserve it for inspection. Deleting the evidence of a failure is how
        // the first three attempts each cost a full run to diagnose.
        console.warn(`[eval] ${id} wrote no files; workspace kept at ${workspace}`);
      }

      // Producing NOTHING is a failure; producing a reply instead of a file is a
      // finding about the surface, not about the harness.
      expect(
        files.length + (replyText.trim() ? 1 : 0),
        `${id} produced neither files nor a reply (${error ?? 'no error reported'}); tools used: ${toolNames.join(', ') || 'none'}`,
      ).toBeGreaterThan(0);
    },
    900_000,
  );

  it('writes the summary', () => {
    const lines = [
      '# P7.0 craft baseline',
      '',
      `Model: \`${MODEL}\` (pinned — see baseline.eval.ts).`,
      ONLY ? `Partial run: only \`${ONLY}\`. Not a full baseline.` : 'Full brief set.',
      `Captured: ${new Date().toISOString()}`,
      '',
      'The BEFORE for every P7 change. Measured with `slop-tells.ts`; the same',
      'instrument must be used for the after, or the comparison means nothing.',
      '',
      '| brief | shape | files | reply | tools | tells | cost | duration |',
      '|---|---|---|---|---|---|---|---|',
      ...results.map((r) => {
        const produced = r.files.length > 0 || r.replyChars > 0;
        const cost =
          r.costUsd === undefined ? '?' : `$${r.costUsd.toFixed(4)}${r.estimatedCost ? ' (est)' : ''}`;
        return `| ${r.id} | ${r.shape} | ${r.files.length} | ${r.replyChars ? `${r.replyChars}c` : '—'} | ${r.toolCalls} | ${produced ? summariseTells(r.findings) : 'FAILED'} | ${cost} | ${(r.durationMs / 1000).toFixed(0)}s |`;
      }),
      '',
      '## Findings',
      '',
      ...results.flatMap((r) => [
        `### ${r.id}`,
        '',
        // "no artifact" and "no tells" must not render the same. A failed brief
        // showing "none" reads as a clean result, which is the worst possible
        // way to be wrong about a measurement.
        ...(r.files.length === 0 && r.replyChars === 0
          ? [`- **PRODUCED NOTHING** — ${r.error ?? 'no error reported'}. Not a result.`]
          : r.findings.length
            ? r.findings.map((f) => `- **${f.severity.toUpperCase()} ${f.rule}** — ${f.detail}`)
            : ['- no tells found']),
        '',
      ]),
      '## What this cannot tell you',
      '',
      'Only the checkable tells. Hierarchy, restraint, and whether the thing looks',
      'like the brand are judgement calls and are deliberately not scored here — a',
      'number for those would be false confidence.',
    ];
    fs.writeFileSync(path.join(runDir, 'README.md'), lines.join('\n'));
    expect(results.length).toBe(briefs.length);
  });
});

describe.skipIf(ENABLED)('P7.0 baseline (not run)', () => {
  it('needs AIME_EVAL=1 and a configured provider', () => {
    // Present so a normal run reports "skipped" rather than "0 tests", which
    // reads as the file being broken.
    expect(ENABLED).toBe(false);
  });
});
