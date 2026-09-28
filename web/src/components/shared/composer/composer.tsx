"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { ArrowUp, Square } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AttachmentMenu, type AttachmentFile, type AttachmentMenuProps } from "@/components/shared/attachment-menu";
import { VoiceButton } from "@/components/shared/voice-button";
import { CommandPicker, type CommandSuggestion } from "@/components/shared/command-picker";
import { getSlashSuggestions } from "@/lib/slash-commands";
import { useAtSuggestions, getAtQuery, removeAtQuery } from "@/hooks/use-at-suggestions";
import { usePasteAttachments } from "@/hooks/use-paste-attachments";
import { AttachmentChips } from "./attachment-chips";
import { EMPTY_DRAFT, draftKey, useComposerDrafts } from "./draft-store";

const MAX_HEIGHT = 200;

export interface ComposerHandle {
  focus: () => void;
}

export interface ComposerProps {
  /** Namespaces drafts and prompt recall: 'chat', 'cowork', 'code', … */
  surface: string;
  /**
   * The conversation on screen; '' before its first message. The draft, the
   * focus and Up-arrow recall all key on it, so switching conversation swaps
   * the draft rather than carrying the text along.
   */
  conversationId: string;
  /**
   * Send. Receives the trimmed text and the draft's attachments. Return `false`
   * to keep the draft (the send was refused — no model, a goal needing a
   * folder); anything else clears it. Not awaited: a turn runs for minutes and
   * the composer must be free the moment it starts.
   */
  onSubmit: (text: string, attachments: AttachmentFile[]) => boolean | void | Promise<unknown>;
  /** This conversation's turn is running: the button becomes Stop and Esc stops. */
  isStreaming?: boolean;
  onStop?: () => void;
  placeholder?: string;
  /** 'hero' is the tall empty-state card, 'docked' the composer under a transcript. */
  variant?: "hero" | "docked";
  /** Block sending (not typing) — e.g. while a goal is being planned. */
  submitDisabled?: boolean;
  /** Accessible name and tooltip of the send button. */
  submitLabel?: string;
  /**
   * What Up-arrow in an empty composer brings back — normally the last message
   * the user sent in this conversation. Falls back to the last prompt sent from
   * this surface.
   */
  recallText?: string;
  /** Directory @-mentions resolve against. Absent ⇒ no @ suggestions. */
  mentionCwd?: string | null;
  /** Every attachment the composer adds (menu, paste, @-mention) is reported here too. */
  onAttachmentAdded?: (file: AttachmentFile) => void;
  /**
   * Attachment-menu extras (projects, web search). Leave `onWebSearchToggle`
   * out and the web-search item is not shown.
   */
  attachmentMenu?: Omit<AttachmentMenuProps, "onFileSelect">;
  /** Show the dictation button. Default true. */
  voice?: boolean;
  /** Focus on mount, on conversation switch and after sending. Default true. */
  autoFocus?: boolean;
  /** Above the card — a pending question, a banner. */
  header?: ReactNode;
  /** Inside the card, under the text — e.g. the goal budget bar. */
  belowInput?: ReactNode;
  /** Toolbar, after attach and mic — folder picker, mode toggles. */
  toolbarStart?: ReactNode;
  /** Toolbar, before the send button — the model selector. */
  toolbarEnd?: ReactNode;
  ref?: Ref<ComposerHandle>;
}

/**
 * The one composer. Chat and Cowork each used to build two by hand — one for
 * the empty state, one under the transcript — and the four had drifted: only
 * some had image icons, one had a web-search toggle wired to nothing, Enter
 * ignored Cowork's goal mode, and focus was lost after the first message
 * because the textarea you typed in was unmounted and a different one mounted.
 *
 * Keyboard contract:
 *  - Enter sends, Shift+Enter is a newline, Enter while an IME is composing is
 *    the IME's.
 *  - Enter while this conversation's turn is running does NOTHING. It used to
 *    ABORT the turn — one habitual keystroke threw away a long run. The draft
 *    stays put and can be sent when the turn ends; Esc or the Stop button stops.
 *  - Up-arrow in an empty composer recalls the last prompt for editing.
 *  - With the slash / @ picker open, arrows move, Enter/Tab pick, Esc closes.
 */
export function Composer({
  surface,
  conversationId,
  onSubmit,
  isStreaming = false,
  onStop,
  placeholder = "Send a message...",
  variant = "docked",
  submitDisabled = false,
  submitLabel = "Send message",
  recallText,
  mentionCwd,
  onAttachmentAdded,
  attachmentMenu,
  voice = true,
  autoFocus = true,
  header,
  belowInput,
  toolbarStart,
  toolbarEnd,
  ref,
}: ComposerProps) {
  const key = draftKey(surface, conversationId);
  const draft = useComposerDrafts((s) => s.drafts[key] ?? EMPTY_DRAFT);
  const lastSent = useComposerDrafts((s) => s.lastSent[surface]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [slashSuggestions, setSlashSuggestions] = useState<CommandSuggestion[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const { fileSuggestions, fetchAtSuggestions, clearAtSuggestions, resolveFileAsAttachment } =
    useAtSuggestions();

  const value = draft.text;
  const attachments = draft.attachments;

  const focus = useCallback(() => textareaRef.current?.focus(), []);
  useImperativeHandle(ref, () => ({ focus }), [focus]);

  // Mount, and every conversation switch: the composer is where you type next.
  useEffect(() => {
    if (autoFocus) focus();
  }, [autoFocus, focus, conversationId]);

  // Size to content, including text that arrived from outside (dictation,
  // recall, a suggestion chip) rather than from a keystroke.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const addAttachment = useCallback(
    (file: AttachmentFile) => {
      useComposerDrafts.getState().addAttachment(key, file);
      onAttachmentAdded?.(file);
    },
    [key, onAttachmentAdded],
  );
  const onPaste = usePasteAttachments(addAttachment);

  const setValue = useCallback(
    (text: string) => useComposerDrafts.getState().setText(key, text),
    [key],
  );

  const suggestions: CommandSuggestion[] =
    slashSuggestions.length > 0
      ? slashSuggestions
      : fileSuggestions.map((f) => ({
          type: "at" as const,
          value: f.path,
          label: "@" + f.name,
          meta: f.relative,
        }));

  function closePicker() {
    setSlashSuggestions([]);
    clearAtSuggestions();
    setSelectedIdx(0);
  }

  function selectSuggestion(s: CommandSuggestion) {
    if (s.type === "slash") {
      setValue(s.value + " ");
    } else {
      setValue(removeAtQuery(value));
      void resolveFileAsAttachment(s.value).then((att) => {
        if (att) addAttachment(att);
      });
    }
    closePicker();
    focus();
  }

  function submit() {
    if (submitDisabled || isStreaming) return;
    const text = value.trim();
    if (!text) return;
    const accepted = onSubmit(text, attachments);
    if (accepted === false) return;
    closePicker();
    useComposerDrafts.getState().recordSent(surface, text);
    useComposerDrafts.getState().clearDraft(key);
    focus();
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setValue(val);
    setSlashSuggestions(
      getSlashSuggestions(val).map((cmd) => ({
        type: "slash" as const,
        value: cmd.name,
        label: cmd.name,
        description: cmd.args,
        meta: cmd.description,
      })),
    );
    const atQ = getAtQuery(val);
    if (atQ !== null && mentionCwd) fetchAtSuggestions(atQ, mentionCwd);
    else clearAtSuggestions();
    setSelectedIdx(0);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // An IME confirming a candidate sends Enter too; that keystroke is the IME's.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        selectSuggestion(suggestions[Math.min(selectedIdx, suggestions.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closePicker();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }

    if (e.key === "Escape" && isStreaming && onStop) {
      e.preventDefault();
      onStop();
      return;
    }

    if (e.key === "ArrowUp" && value === "" && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      const recall = recallText ?? lastSent;
      if (!recall) return;
      e.preventDefault();
      setValue(recall);
      // Caret to the end, after React has written the value.
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) el.setSelectionRange(recall.length, recall.length);
      });
    }
  }

  const hero = variant === "hero";

  return (
    <div>
      <CommandPicker
        suggestions={suggestions}
        selectedIndex={selectedIdx}
        onSelect={selectSuggestion}
        onSelectedIndexChange={setSelectedIdx}
      />
      {header}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          aria-label={placeholder}
          rows={hero ? 3 : 2}
          className={`${hero ? "min-h-[120px]" : "min-h-[56px]"} max-h-[200px] resize-none border-0 bg-transparent dark:bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0 p-4 pb-0`}
          style={{ opacity: isStreaming ? 0.6 : 1 }}
        />
        <AttachmentChips
          attachments={attachments}
          onRemove={(i) => useComposerDrafts.getState().removeAttachment(key, i)}
        />
        {belowInput}
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-1">
            <AttachmentMenu {...attachmentMenu} onFileSelect={addAttachment} />
            {voice && (
              <VoiceButton onTranscript={(text) => useComposerDrafts.getState().appendText(key, text)} />
            )}
            {toolbarStart}
          </div>
          <div className="flex items-center gap-2">
            {toolbarEnd}
            {isStreaming ? (
              <Button
                size="icon"
                className="h-8 w-8 rounded-lg bg-destructive hover:bg-destructive/80"
                onClick={onStop}
                aria-label="Stop"
                title="Stop (Esc)"
              >
                <Square className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-8 w-8 rounded-lg bg-primary hover:bg-primary/80"
                onClick={submit}
                disabled={!value.trim() || submitDisabled}
                aria-label={submitLabel}
                title={submitLabel}
              >
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
