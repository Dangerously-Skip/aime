import { useConversationStore, type Conversation } from "@/stores/conversation-store";
import { useChatStore } from "@/stores/chat-store";
import { useCoworkStore } from "@/stores/cowork-store";
import { useCodeStore } from "@/stores/code-store";
import { streamRegistry } from "@/lib/stream-registry";

/** The message store that owns a surface's transcripts. */
function storeFor(surface: string) {
  if (surface === "chat") return useChatStore;
  if (surface === "cowork") return useCoworkStore;
  if (surface === "code") return useCodeStore;
  return null;
}

interface MessageStoreSlice {
  messages: Record<string, unknown[]>;
  currentChatId: string | null;
  clearMessages: (id: string) => void;
  setCurrentChat: (id: string) => void;
}

/** Everything needed to put a deleted conversation back. */
export interface DeletedConversation {
  conversation: Conversation;
  messages: unknown[] | undefined;
  wasActive: boolean;
  wasCurrent: boolean;
}

/**
 * Delete a conversation and its transcript, from the store that actually holds
 * it.
 *
 * The sidebar used to remove only the list entry: the messages stayed in
 * localStorage for ever unless the conversation happened to be open, and the
 * keyboard path cleared CHAT's current conversation even when the one deleted
 * was a Cowork or Code conversation. A turn still running for it is stopped.
 */
export function deleteConversation(id: string): DeletedConversation | null {
  const convStore = useConversationStore.getState();
  const conversation = convStore.conversations.find((c) => c.id === id);
  if (!conversation) return null;
  const store = storeFor(conversation.surface);
  const state = store?.getState() as MessageStoreSlice | undefined;
  const snapshot: DeletedConversation = {
    conversation,
    messages: state?.messages[id],
    wasActive: convStore.activeId === id,
    wasCurrent: state?.currentChatId === id,
  };
  streamRegistry.abort(id, "user");
  convStore.removeConversation(id);
  if (state) {
    state.clearMessages(id);
    if (snapshot.wasCurrent) state.setCurrentChat("");
  }
  return snapshot;
}

/** Undo: the conversation, its transcript and — if it was open — the selection. */
export function restoreConversation(deleted: DeletedConversation): void {
  const { conversation, messages, wasActive, wasCurrent } = deleted;
  const convStore = useConversationStore.getState();
  if (!convStore.conversations.some((c) => c.id === conversation.id)) {
    useConversationStore.setState((s) => ({ conversations: [conversation, ...s.conversations] }));
  }
  const store = storeFor(conversation.surface);
  if (store && messages) {
    (store as typeof useChatStore).setState((s) => ({
      messages: { ...s.messages, [conversation.id]: messages as never },
    }));
  }
  if (wasCurrent) (store?.getState() as MessageStoreSlice | undefined)?.setCurrentChat(conversation.id);
  if (wasActive) convStore.setActiveConversation(conversation.id);
}

/**
 * Does a conversation match a sidebar search? Titles alone missed the common
 * case — you remember what was SAID, not what the chat was auto-named.
 */
export function conversationMatches(conversation: Conversation, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (conversation.title.toLowerCase().includes(q)) return true;
  if (conversation.lastMessage?.toLowerCase().includes(q)) return true;
  const msgs = (storeFor(conversation.surface)?.getState() as MessageStoreSlice | undefined)?.messages[conversation.id] as
    | Array<{ content?: unknown }>
    | undefined;
  return !!msgs?.some((m) => typeof m.content === "string" && m.content.toLowerCase().includes(q));
}
