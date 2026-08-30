'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHarnessRoute } from './use-start-goal';
import type { ParkedQuestion } from '@/lib/harness/question';
import { formatFieldAnswers, allAnswered, type QuestionField } from '@/lib/harness/question-fields';
import { Textarea } from '@/components/ui/textarea';

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
  /** Per-field answers, keyed by field id. Arrays so multi-select is not special. */
  const [values, setValues] = useState<Record<string, string[]>>({});
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

  const fields = question.fields ?? [];

  const setOne = (id: string, v: string[]) => setValues((prev) => ({ ...prev, [id]: v }));
  const toggle = (id: string, option: string) =>
    setValues((prev) => {
      const cur = prev[id] ?? [];
      return { ...prev, [id]: cur.includes(option) ? cur.filter((o) => o !== option) : [...cur, option] };
    });

  /*
   * ONE CONTROL PER QUESTION.
   *
   * The protocol used to allow one question and five flat options, so a session
   * needing five answers wrote them all into the text and offered "I'll type my
   * answers in chat". The user then retyped, in prose, what the model had just
   * enumerated — and the run had to parse it back out.
   *
   * A choice is buttons, a multi-choice is toggles, a long answer is a textarea,
   * anything else is a line of text. Nothing here invents a control the session
   * did not ask for: the shape comes from what it wrote.
   */
  const renderField = (f: QuestionField) => {
    const v = values[f.id] ?? [];
    return (
      <div key={f.id} className="mt-2.5">
        <p className="text-xs font-medium text-foreground/90">{f.label}</p>

        {f.kind === 'choice' && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {f.options.map((o) => (
              <Button
                key={o}
                size="sm"
                variant={v[0] === o ? 'default' : 'outline'}
                disabled={busy}
                onClick={() => setOne(f.id, [o])}
              >
                {o}
              </Button>
            ))}
          </div>
        )}

        {f.kind === 'multi' && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {f.options.map((o) => (
              <Button
                key={o}
                size="sm"
                variant={v.includes(o) ? 'default' : 'outline'}
                disabled={busy}
                aria-pressed={v.includes(o)}
                onClick={() => toggle(f.id, o)}
              >
                {o}
              </Button>
            ))}
          </div>
        )}

        {f.kind === 'longtext' && (
          <Textarea
            value={v[0] ?? ''}
            onChange={(e) => setOne(f.id, [e.target.value])}
            disabled={busy}
            rows={3}
            className="mt-1 text-xs"
          />
        )}

        {f.kind === 'text' && (
          <Input
            value={v[0] ?? ''}
            onChange={(e) => setOne(f.id, [e.target.value])}
            disabled={busy}
            className="mt-1 h-7 text-xs"
          />
        )}
      </div>
    );
  };

  if (fields.length > 0) {
    const answered = allAnswered(fields, values);
    return (
      <div className="mx-auto mb-2 w-full max-w-[672px] rounded-xl border border-primary/40 bg-primary/5 px-4 py-3">
        <p className="text-xs font-medium">The goal needs a decision from you</p>
        {question.question && <p className="mt-1 text-sm">{question.question}</p>}
        {question.context && (
          <p className="mt-1 text-[11px] text-muted-foreground">{question.context}</p>
        )}

        {fields.map(renderField)}

        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            disabled={busy || !Object.values(values).some((v) => v.some((x) => x.trim()))}
            onClick={() => void send(formatFieldAnswers(fields, values))}
          >
            Send
          </Button>
          {/*
            * Partial answers are allowed to go. The run asked five things and
            * may well be able to start with three; refusing to send until every
            * box is full would make the user invent answers to get moving.
            */}
          {!answered && (
            <span className="text-[11px] text-muted-foreground">
              Unanswered questions are left out.
            </span>
          )}
        </div>
      </div>
    );
  }

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
