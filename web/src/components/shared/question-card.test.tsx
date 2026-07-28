// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QuestionCard } from './question-card';

/**
 * The card the user actually clicks at the MCP approval gate.
 *
 * It had no test at all, which left the last two links of the chain unproven:
 * the options reaching the screen, and the POST that unblocks the parked turn.
 * `approval-gate.integration.test.ts` covers everything from `canUseTool` to
 * `/api/chat/answer`; this covers the human end of the same loop.
 *
 * `fetch` is the only thing stubbed — the request body is the contract with that
 * route, so it is asserted verbatim rather than through a wrapper.
 */

const APPROVAL = [
  {
    question: 'Allow deleteIssue on acme?',
    header: 'Approval',
    options: [
      { label: 'Allow once', description: 'Run it this time' },
      { label: 'Always allow', description: 'Stop asking for this tool' },
      { label: 'Deny', description: 'Do not run it' },
    ],
  },
];

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The body POSTed to /api/chat/answer. */
function sentBody() {
  const call = fetchMock.mock.calls.at(-1)!;
  return JSON.parse((call[1] as RequestInit).body as string);
}

describe('QuestionCard', () => {
  it('renders every option the gate offered', () => {
    render(<QuestionCard toolUseId="handle-1" questions={APPROVAL} />);
    expect(screen.getByText('Allow deleteIssue on acme?')).toBeTruthy();
    for (const label of ['Allow once', 'Always allow', 'Deny']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('will not submit until something is chosen — a blank answer is not consent', () => {
    render(<QuestionCard toolUseId="handle-1" questions={APPROVAL} />);
    const submit = screen.getByRole('button', { name: /Submit/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByText('Deny'));
    expect(submit.disabled).toBe(false);
  });

  it('POSTs the handle and the chosen label, keyed by the question text', async () => {
    const onAnswer = vi.fn();
    render(<QuestionCard toolUseId="handle-abc" questions={APPROVAL} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByText('Allow once'));
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/chat/answer');
    // The shape /api/chat/answer parses, and the shape readApprovalAnswer reads.
    expect(sentBody()).toEqual({
      toolUseId: 'handle-abc',
      answers: { 'Allow deleteIssue on acme?': 'Allow once' },
    });
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith('handle-abc', expect.any(Object)));
  });

  it('locks after a successful answer — one card, one decision', async () => {
    render(<QuestionCard toolUseId="handle-1" questions={APPROVAL} />);
    fireEvent.click(screen.getByText('Deny'));
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));

    await waitFor(() => expect(screen.getByText(/Claude is continuing/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Submit/ })).toBeNull();

    // Clicking a different option after the fact must not send a second verdict.
    fireEvent.click(screen.getByText('Allow once'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renders an already-answered card read-only', () => {
    render(<QuestionCard toolUseId="handle-1" questions={APPROVAL} answered />);
    expect(screen.queryByRole('button', { name: /Submit/ })).toBeNull();
    fireEvent.click(screen.getByText('Allow once'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces an expired card (404) and allows a retry rather than silently losing the answer', async () => {
    // The turn's rendezvous times out server-side; the stale card must say so.
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'No pending question' }, { status: 404 }));
    render(<QuestionCard toolUseId="handle-stale" questions={APPROVAL} />);

    fireEvent.click(screen.getByText('Deny'));
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));

    await waitFor(() => expect(screen.getByText(/Failed to submit \(404\)/)).toBeTruthy());
    // Not locked: the user's choice is still on screen and still sendable.
    const retry = screen.getByRole('button', { name: /Retry/ }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);

    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText(/Claude is continuing/)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces a network failure the same way', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    render(<QuestionCard toolUseId="handle-1" questions={APPROVAL} />);

    fireEvent.click(screen.getByText('Deny'));
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));

    await waitFor(() => expect(screen.getByText(/Network error: offline/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /Retry/ })).toBeTruthy();
  });

  it('answers every question of a multi-question card', async () => {
    render(
      <QuestionCard
        toolUseId="handle-multi"
        questions={[
          { question: 'Q1?', options: [{ label: 'A' }, { label: 'B' }] },
          { question: 'Q2?', options: [{ label: 'C' }, { label: 'D' }] },
        ]}
      />,
    );
    const submit = () => screen.getByRole('button', { name: /Submit/ }) as HTMLButtonElement;

    fireEvent.click(screen.getByText('A'));
    expect(submit().disabled).toBe(true); // Q2 still unanswered
    fireEvent.click(screen.getByText('D'));
    fireEvent.click(submit());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody().answers).toEqual({ 'Q1?': 'A', 'Q2?': 'D' });
  });

  it('joins multi-select choices into one answer', async () => {
    render(
      <QuestionCard
        toolUseId="handle-ms"
        questions={[{ question: 'Which?', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }] }]}
      />,
    );
    fireEvent.click(screen.getByText('A'));
    fireEvent.click(screen.getByText('B'));
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody().answers).toEqual({ 'Which?': 'A, B' });
  });
});
