import { stripDocumentBlocks } from "@/components/shared/user-message";

interface RecallableMessage {
  role: string;
  content: string;
  isAutoContinue?: boolean;
}

/**
 * The last thing the user typed in a conversation — what Up-arrow in an empty
 * composer brings back. An auto-continue was not typed by anyone, and the
 * `<document>` blocks extraction appends to a message are not what was typed
 * either.
 */
export function lastUserPrompt(messages: readonly RecallableMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && !m.isAutoContinue) return stripDocumentBlocks(m.content);
  }
  return undefined;
}
