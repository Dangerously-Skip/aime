"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageCircleQuestion, Check, CircleDot, Square, CheckSquare } from "lucide-react";

interface QuestionOption {
  label: string;
  description?: string;
}

interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

interface QuestionCardProps {
  /**
   * The handle the server issued for this question, echoed back with the answers.
   * It is a CAPABILITY, not just an identifier: /api/chat/answer authenticates
   * nothing else, so presenting this is the only proof that the answers — which at
   * the MCP approval gate include "Allow" — came from the card the user was shown
   * (see lib/rendezvous → issueHandle). Not to be logged or put in a URL.
   */
  toolUseId: string;
  questions: Question[];
  answered?: boolean;
  onAnswer?: (toolUseId: string, answers: Record<string, string>) => void;
}

export function QuestionCard({
  toolUseId,
  questions,
  answered = false,
  onAnswer,
}: QuestionCardProps) {
  // Track selections: { questionIndex: selectedOptionLabel(s) }
  const [selections, setSelections] = useState<Record<number, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(answered);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = useCallback(
    (qIndex: number, label: string, multiSelect: boolean) => {
      setSelections((prev) => {
        const current = prev[qIndex] || [];
        if (multiSelect) {
          // Toggle
          const next = current.includes(label)
            ? current.filter((l) => l !== label)
            : [...current, label];
          return { ...prev, [qIndex]: next };
        }
        return { ...prev, [qIndex]: [label] };
      });
    },
    []
  );

  const handleSubmit = useCallback(async () => {
    if (submitting || submitted) return;
    setSubmitting(true);
    setError(null);

    // Build answers: { questionText: selected option label(s) }
    const answers: Record<string, string> = {};
    questions.forEach((q, i) => {
      const selected = selections[i] || [];
      answers[q.question] = selected.join(", ");
    });

    try {
      const res = await fetch("/api/chat/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolUseId, answers }),
      });
      if (res.ok) {
        setSubmitted(true);
        setError(null);
        onAnswer?.(toolUseId, answers);
      } else {
        setError(`Failed to submit (${res.status}). Click Submit to retry.`);
      }
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : 'Unknown'}. Click Submit to retry.`);
    } finally {
      setSubmitting(false);
    }
  }, [submitting, submitted, questions, selections, toolUseId, onAnswer]);

  const allAnswered = questions.every((_, i) => (selections[i]?.length ?? 0) > 0);

  return (
    <div className="my-3 rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-4 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center gap-2">
        <MessageCircleQuestion className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium text-foreground">
          Claude has a question
        </span>
      </div>

      {/* Questions */}
      {questions.map((q, qIndex) => (
        <div key={qIndex} className="space-y-2">
          {q.header && (
            <Badge variant="outline" className="text-[10px]">
              {q.header}
            </Badge>
          )}
          <p className="text-sm text-foreground">{q.question}</p>

          {/* Options */}
          <div className="space-y-1.5">
            {q.options.map((opt) => {
              const isSelected = (selections[qIndex] || []).includes(opt.label);
              const isMulti = q.multiSelect ?? false;

              return (
                <button
                  key={opt.label}
                  type="button"
                  disabled={submitted}
                  onClick={() => handleSelect(qIndex, opt.label, isMulti)}
                  className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    submitted
                      ? isSelected
                        ? "border-primary/40 bg-primary/10"
                        : "border-border/30 bg-muted/20 opacity-50"
                      : isSelected
                        ? "border-primary bg-primary/10 hover:bg-primary/15"
                        : "border-border hover:border-primary/40 hover:bg-muted/40"
                  }`}
                >
                  <span className="mt-0.5 shrink-0">
                    {submitted && isSelected ? (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    ) : isMulti ? (
                      isSelected ? (
                        <CheckSquare className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <Square className="h-3.5 w-3.5 text-muted-foreground" />
                      )
                    ) : isSelected ? (
                      <CircleDot className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <span className="inline-block h-3.5 w-3.5 rounded-full border border-muted-foreground" />
                    )}
                  </span>
                  <div>
                    <span className="font-medium">{opt.label}</span>
                    {opt.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {opt.description}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Submit */}
      {!submitted && (
        <>
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!allAnswered || submitting}
            className="w-full"
            title={!allAnswered ? "Select an option for each question" : undefined}
          >
            {submitting ? "Submitting..." : error ? "Retry" : "Submit"}
          </Button>
        </>
      )}
      {submitted && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Check className="h-3 w-3 text-primary" />
          Answered — Claude is continuing...
        </p>
      )}
    </div>
  );
}
