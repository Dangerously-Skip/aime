"use client";

import { useVoiceInput } from "@/hooks/use-voice-input";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Loader2 } from "lucide-react";

interface VoiceButtonProps {
  onTranscript: (text: string) => void;
}

/**
 * The mic in a composer.
 *
 * It reads the app's single recording session rather than owning one, so it
 * shows "Stop recording" for a take the global hotkey started and can stop it —
 * previously the two were separate recorders and this button sat there saying
 * "Voice input" while the mic was live.
 *
 * `onTranscript` is registered as this surface's destination for finished text;
 * whether a given transcript arrives here depends on which surface is on screen
 * (see lib/voice/voice-scope), not on which control started the recording.
 */
export function VoiceButton({ onTranscript }: VoiceButtonProps) {
  const { isListening, isTranscribing, isSupported, startListening, stopListening } =
    useVoiceInput({ onTranscript });

  if (!isSupported) return null;

  // Transcribing: show spinner, disabled
  if (isTranscribing) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-primary"
        disabled
        title="Transcribing..."
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className={`h-7 w-7 shrink-0 ${
        isListening
          ? "text-red-500 ring-2 ring-red-500/30 animate-pulse"
          : "text-muted-foreground hover:text-foreground"
      }`}
      onClick={isListening ? stopListening : startListening}
      title={isListening ? "Stop recording" : "Voice input"}
    >
      {isListening ? (
        <MicOff className="h-3.5 w-3.5" />
      ) : (
        <Mic className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}
