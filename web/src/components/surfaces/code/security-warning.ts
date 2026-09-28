import { classifyCommand } from "@/lib/security/destructive-commands";

/**
 * The "Risky" chip on a Bash tool card in Code.
 *
 * This used to run its own eight-regex `DANGEROUS_PATTERNS` list, separate from
 * `classifyCommand` — the classifier the server's approval gate actually uses.
 * Two lists drift: the chip flagged `git commit -m "drop sudo"` (no quote
 * blanking) and missed everything the classifier learned since (`git push
 * --force`, `find -delete`, …), and it honoured `blockNetworkCommands` by
 * scanning the DESTRUCTIVE list. Now the chip is exactly the gate's verdict,
 * per toggle.
 *
 * Returns the input unchanged when nothing matches, or a copy tagged with
 * `__securityWarning: <reason>` (the card renders it when truthy).
 */
export function tagSecurityWarning(
  toolName: string,
  input: Record<string, unknown>,
  toggles: { blockDangerousCommands: boolean; blockNetworkCommands: boolean },
): Record<string, unknown> {
  if (toolName !== "Bash") return input;
  const verdict = classifyCommand(input.command, {
    destructive: toggles.blockDangerousCommands,
    network: toggles.blockNetworkCommands,
  });
  return verdict.ask ? { ...input, __securityWarning: verdict.reason } : input;
}
