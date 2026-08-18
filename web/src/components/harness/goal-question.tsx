'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHarnessRoute } from './use-start-goal';
import type { ParkedQuestion } from '@/lib/harness/question';

/**
 * The run's question, where the conversation is.
 *
 * The transcript announced a parked question and then told you to go and answer
 * it in the rail — which is a hop, and a strange one: you are already looking at
 * the composer, and the thing blocking the run is a sentence away. A question is
 * part of the conversation, not part of a dashboard.
 *
 * So this sits directly above the composer while the run is waiting, and
 * disappears the moment it is answered. The rail keeps its copy for reference;
 * this is the one you act on.
 */
export function GoalQuestion({
  chatId,
  folder,
  surfaceId,
  onAnswered,
}: {
  chatId: string;
  folder: string | null;
  surfaceId: 'cowork' | 'code';
  onAnswered?: () => void;
}) {
  const [question, setQuestion] = useState<ParkedQuestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [other, setOther] = useState(false);
  const [text, setText] = useState('');
  const harnessRoute = useHarnessRoute(null);

  const poll = useCallback(async () => {
    if (!chatId || !folder) return;
    try {
      const res = await fetch(
        `/api/harness?conversationId=${encodeURIComponent(chatId)}&workingDir=${encodeURIComponent(folder)}`,
      );
      if (!res.ok) return;
      const s = (await res.json()) as { question?: ParkedQuestion | null };
      setQuestion(s.question ?? null);
    } catch {
      // A failed poll is not worth surfacing; the next one is 2s away.
    }
  }, [chatId, folder]);

  useEffect(() => {
    void poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [poll]);

  const send = async (answer: string) => {
    if (!question || !answer.trim() || !folder) return;
    setBusy(true);
    try {
      await fetch('/api/harness/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingDir: folder, conversationId: chatId, id: question.id, answer }),
      });
      // Restart the loop — WITH credentials, or the resumed sessions die on
      // "Not logged in" and burn the task's attempts.
      await fetch('/api/harness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: chatId, workingDir: folder, surfaceId, ...harnessRoute() }),
      }).catch(() => {});
      setQuestion(null);
      setText('');
      setOther(false);
      onAnswered?.();
      await poll();
    } finally {
      setBusy(false);
    }
  };

  if (!question) return null;

  return (
    <div className="mx-auto mb-2 w-full max-w-[672px] rounded-xl border border-primary/40 bg-primary/5 px-4 py-3">
      <p className="text-xs font-medium">The goal needs a decision from you</p>
      <p className="mt-1 text-sm">{question.question}</p>
      {question.context && (
        <p className="mt-1 text-[11px] text-muted-foreground">{question.context}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {question.options.map((o) => (
          <Button key={o} size="sm" variant="outline" disabled={busy} onClick={() => void send(o)}>
            {o}
          </Button>
        ))}
        {question.options.length > 0 && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOther((v) => !v)}>
            Other…
          </Button>
        )}
      </div>

      {(other || question.options.length === 0) && (
        <div className="mt-2 flex items-center gap-1.5">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void send(text); }}
            placeholder="Answer, and it carries on"
            disabled={busy}
            className="h-7 text-xs"
          />
          <Button size="sm" disabled={busy || !text.trim()} onClick={() => void send(text)}>
            Send
          </Button>
        </div>
      )}
    </div>
  );
}
