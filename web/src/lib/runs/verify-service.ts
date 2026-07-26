/**
 * The verification pass as a service — shared by the /api/runs/verify route and
 * the server-side standing-order executor (C5b), so completion checks with the
 * window closed use exactly the same judge as everything else.
 *
 * Fails closed everywhere: an unreachable or confused verifier returns
 * passed:false, never a silent pass.
 */
import { buildVerificationPrompt, parseVerdict, type Verdict } from './verification';
import type { Goal, Run } from './types';

/** A verification pass is a short judgement — never worth a premium model. */
export const VERIFIER_MODEL = 'haiku';
export const VERIFY_TIMEOUT_MS = 60_000;

export async function verifyRunAgainstGoal(
  goal: Goal,
  run: Run,
  outputSummary: string,
): Promise<Verdict> {
  const prompt = buildVerificationPrompt(goal, run, outputSummary);
  try {
    const { getProvider } = await import('@/lib/providers');
    const { getServerAnthropicKey } = await import('@/lib/models/credentials');
    const provider = getProvider('claude');
    const apiKey = await getServerAnthropicKey();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    let text = '';
    try {
      for await (const chunk of provider.query({
        prompt,
        chatId: `verify-${run.id}`,
        surfaceId: 'assistant',
        systemPrompt:
          'You are a strict verifier. Answer only with the requested one-line JSON. Never explain outside it.',
        model: VERIFIER_MODEL,
        apiKey,
        // A judgement, not an investigation — no tool loop.
        maxTurns: 1,
      })) {
        if (chunk.type === 'text') text += (chunk.content as string) ?? '';
      }
    } finally {
      clearTimeout(timer);
    }
    return parseVerdict(text);
  } catch (err) {
    return {
      passed: false,
      note: `Verification could not be completed (${err instanceof Error ? err.message : 'unknown error'}).`,
    };
  }
}
