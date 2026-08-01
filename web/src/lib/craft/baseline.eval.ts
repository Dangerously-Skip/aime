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

/**
 * Run a subset by id, comma-separated. Proves the harness before paying for the
 * full set, and re-runs the ones a provider outage killed without re-paying for
 * the ones that already succeeded.
 */
const ONLY = process.env.AIME_EVAL_BRIEF?.split(',').map((s) => s.trim()).filter(Boolean);

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

/**
 * Samples per brief. One is not a measurement: the same brief has produced a
 * 12-second reply and a 321-second tool-using turn on identical input, so a
 * single run cannot tell a prompt effect from ordinary variance. Three gives a
 * spread to read a later comparison against.
 */
const SAMPLES = Number(process.env.AIME_EVAL_SAMPLES ?? 3);

/**
 * What to say when the agent asks a clarifying question.
 *
 * The code surface asks via the real AskUserQuestion tool, which BLOCKS on a
 * rendezvous. With nobody answering it waits out its ~300s timeout and the brief
 * produces nothing — so the baseline would measure "the agent asked" and never
 * see any generated UI at all. Answering is also what a user does.
 *
 * That the question was asked is recorded separately, because it IS the finding
 * for the underspecified brief: the surface already implements the turn-1
 * question gate that P7.5 proposed to add.
 */
const AUTO_ANSWER =
  'Produce ONE self-contained file that answers the brief as stated. Do not ' +
  'expand the scope, do not add features beyond it, and do not ask again.';

/**
 * Hard ceiling on tool calls per sample, clamped by the route (a caller may
 * lower the surface's limit, never raise it).
 *
 * The code surface allows 200 turns, which is right for a person working
 * interactively and catastrophic for an unattended eval: one sample ran 124 tool
 * calls over 66 minutes and cost $6.58 on its own — 10.1M input tokens — because
 * the auto-answer said "use your best judgement" and nothing bounded what
 * followed. That answer traded a bounded 300-second stall for an unbounded run.
 *
 * A baseline sample is one focused attempt. If a brief cannot be answered in
 * this many turns, that IS the result and should be recorded as such rather than
 * bought at any price.
 */
const MAX_TURNS = Number(process.env.AIME_EVAL_MAX_TURNS ?? 30);

/** Refuse to start a run that could plausibly cost more than this. */
const COST_CEILING_USD = Number(process.env.AIME_EVAL_COST_CEILING ?? 15);

/**
 * Per-sample USD ceiling, enforced by the SDK mid-run.
 *
 * The run-level accumulator above can only check BETWEEN samples, so it cannot
 * stop the one that is currently burning — which is exactly how a single sample
 * reached $6.58 while the total was still under its limit. Set from the observed
 * median (~$0.45) with headroom, per the practice of capping at 2-3x median
 * rather than at the worst case.
 */
const MAX_BUDGET_USD = Number(process.env.AIME_EVAL_MAX_BUDGET_USD ?? 1.5);

/** Files an artifact could plausibly be. */
const ARTIFACT_EXT = /\.(html?|tsx?|jsx?|css|svelte|vue)$/i;

interface BriefResult {
  id: string;
  sample: number;
  /** The agent asked a clarifying question; the harness answered it. */
  askedQuestion: boolean;
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
  /** Running spend, so the ceiling can stop the run rather than explain it after. */
  let spentUsd = 0;

  beforeAll(() => {
    // A timestamped directory, so a re-run never silently overwrites the
    // baseline it is supposed to be compared against.
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    runDir = path.join(OUT_ROOT, `baseline-${stamp}`);
    fs.mkdirSync(runDir, { recursive: true });
  });

  const briefs = ONLY?.length ? EVAL_BRIEFS.filter((b) => ONLY.includes(b.id)) : EVAL_BRIEFS;

  it('resolves the requested briefs', () => {
    // A typo'd id would otherwise run nothing and report success.
    expect(briefs.length, `no brief matches AIME_EVAL_BRIEF=${ONLY?.join(',')}`).toBeGreaterThan(0);
  });

  /**
   * Each brief N times. The pairs are flattened rather than looped inside one
   * test so a single sample failing does not lose the other two — and so the
   * spread is visible in the runner output as it goes.
   */
  const runs = briefs.flatMap((b) =>
    Array.from({ length: SAMPLES }, (_, i) => [`${b.id} #${i + 1}`, b, i + 1] as const),
  );

  it.each(runs)(
    '%s',
    async (_label, brief, sample) => {
      const id = brief.id;
      /**
       * Check BEFORE starting, not after. The previous run discovered it had
       * spent $13.76 only once every sample had finished — by which point the
       * money was gone and four briefs had failed on an exhausted balance.
       */
      if (spentUsd >= COST_CEILING_USD) {
        throw new Error(
          `Cost ceiling reached: $${spentUsd.toFixed(2)} of $${COST_CEILING_USD}. ` +
            `Remaining samples skipped. Raise AIME_EVAL_COST_CEILING to continue.`,
        );
      }

      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `aime-eval-${id}-${sample}-`));
      const started = Date.now();
      let error: string | undefined;
      let sse = '';
      let askedQuestion = false;

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
              // Distinct per sample: a shared chatId resumes the previous
              // session, so samples 2 and 3 would answer with the first one's
              // context and stop being independent observations.
              chatId: `eval-${id}-${sample}`,
              cwd: workspace,
              model: MODEL,
              maxTurns: MAX_TURNS,
              maxBudgetUsd: MAX_BUDGET_USD,
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
        /**
         * Read INCREMENTALLY rather than `await res.text()`.
         *
         * Two reasons. The stream has to be kept — draining and discarding it
         * threw away the reply (which IS the artifact when the model answers
         * inline) and the `done` event with the real cost. And a question has to
         * be answered WHILE the stream is open: `text()` does not resolve until
         * the turn ends, and the turn does not end until the question is
         * answered. Waiting for the body is a deadlock that only breaks on the
         * rendezvous timeout.
         */
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          sse += text;
          pending += text;

          // Answer any question as soon as it appears on the wire.
          const lines = pending.split('\n');
          pending = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            let evt: Record<string, unknown>;
            try {
              evt = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }
            if (evt.type !== 'input_request' || !evt.toolUseId) continue;
            askedQuestion = true;
            const questions = (evt.questions as { key?: string; id?: string }[]) ?? [];
            const answers: Record<string, string> = {};
            for (const q of questions) {
              const key = q.key ?? q.id;
              if (key) answers[key] = AUTO_ANSWER;
            }
            const { POST: ANSWER } = await import('@/app/api/chat/answer/route');
            await ANSWER(
              new NextRequest('http://localhost/api/chat/answer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toolUseId: evt.toolUseId, answers }),
              }),
            );
          }
        }
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
      /**
       * An `error` event means the turn failed, whatever else came back.
       *
       * This is the case that slipped through: a 402 from the provider was
       * STREAMED AS ASSISTANT TEXT, so the harness captured 1,627 characters of
       * error message, saw a non-empty reply, and reported the brief as having
       * produced something with zero tells found. Six briefs read as clean
       * results when they had never run.
       *
       * Length cannot distinguish a reply from an error. The explicit event can,
       * and it was on the wire the whole time.
       */
      const streamError = events.find((e) => e.type === 'error')?.message as string | undefined;
      if (streamError && !error) error = streamError;

      const replyText = streamError
        ? '' // not a reply — do not scan it, do not count it as output
        : events
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
      const briefDir = path.join(runDir, id, `sample-${sample}`);
      fs.mkdirSync(briefDir, { recursive: true });

      // The reply is an artifact in its own right: an "artifact" the model
      // pasted into chat is still the thing being judged, and scanning only
      // files would score it as producing nothing.
      if (replyText.trim()) {
        fs.writeFileSync(path.join(briefDir, '_reply.md'), replyText);
      }
      if (streamError) {
        fs.writeFileSync(path.join(briefDir, '_ERROR.txt'), streamError);
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

      if (typeof usage?.cost === 'number') spentUsd += usage.cost;

      results.push({
        id,
        sample,
        askedQuestion,
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
      ONLY?.length ? `Partial run: ${ONLY.join(', ')}. Not a full baseline.` : 'Full brief set.',
      `Captured: ${new Date().toISOString()}`,
      '',
      'The BEFORE for every P7 change. Measured with `slop-tells.ts`; the same',
      'instrument must be used for the after, or the comparison means nothing.',
      '',
      `Samples per brief: ${SAMPLES}. The tells column shows every sample, because`,
      'the spread IS the result — one number would hide whether a later change beat',
      'the variance or got lucky.',
      '',
      '| brief | shape | tells per sample | asked? | cost | median duration |',
      '|---|---|---|---|---|---|',
      ...briefs.map((b) => {
        const rs = results.filter((r) => r.id === b.id).sort((x, y) => x.sample - y.sample);
        const tells = rs
          .map((r) => (r.files.length || r.replyChars ? String(r.findings.length) : 'FAIL'))
          .join(' / ');
        const cost = rs.reduce((n, r) => n + (r.costUsd ?? 0), 0);
        const durations = rs.map((r) => r.durationMs).sort((x, y) => x - y);
        const median = durations[Math.floor(durations.length / 2)] ?? 0;
        const asked = rs.filter((r) => r.askedQuestion).length;
        return `| ${b.id} | ${b.shape} | ${tells} | ${asked}/${rs.length} | $${cost.toFixed(3)} | ${(median / 1000).toFixed(0)}s |`;
      }),
      '',
      `**Total cost: $${results.reduce((n, r) => n + (r.costUsd ?? 0), 0).toFixed(2)}**`,
      '',
      '## Findings',
      '',
      ...results.flatMap((r) => [
        `### ${r.id} — sample ${r.sample}${r.askedQuestion ? ' (asked a question; auto-answered)' : ''}`,
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
    expect(results.length).toBe(briefs.length * SAMPLES);
  });
});

describe.skipIf(ENABLED)('P7.0 baseline (not run)', () => {
  it('needs AIME_EVAL=1 and a configured provider', () => {
    // Present so a normal run reports "skipped" rather than "0 tests", which
    // reads as the file being broken.
    expect(ENABLED).toBe(false);
  });
});
