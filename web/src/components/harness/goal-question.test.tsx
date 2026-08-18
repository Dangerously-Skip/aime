// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { GoalQuestion } from './goal-question';

/**
 * The question belongs where the conversation is.
 *
 * The transcript announced it and told the user to go and answer in the rail —
 * a hop, and a strange one: they are already looking at the composer and the
 * thing blocking the run is a sentence away.
 */
vi.mock('./use-start-goal', () => ({
  useHarnessRoute: () => () => ({ model: 'm', providerConfig: null, apiKey: 'k' }),
}));

const parked = {
  id: 'q1', taskId: null, question: 'Which total?', options: ['gross', 'net'],
  context: 'They differ by $50.', askedAt: '', answer: null, answeredAt: null,
};

let posts: { url: string; body: Record<string, unknown> }[] = [];
function mockFetch(question: unknown) {
  posts = [];
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({ question }) };
  }) as unknown as typeof fetch;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('GoalQuestion', () => {
  it('renders nothing when the run is not waiting', async () => {
    global.fetch = mockFetch(null);
    const { container } = render(<GoalQuestion chatId="c1" folder="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('shows the question, its context, and the options as buttons', async () => {
    global.fetch = mockFetch(parked);
    render(<GoalQuestion chatId="c1" folder="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByText('Which total?')).toBeTruthy());
    expect(screen.getByText('They differ by $50.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'gross' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'net' })).toBeTruthy();
  });

  it('hides the text box behind Other, and reveals it on click', async () => {
    global.fetch = mockFetch(parked);
    render(<GoalQuestion chatId="c1" folder="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Other/i })).toBeTruthy());
    expect(screen.queryByPlaceholderText(/Answer, and it carries on/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Other/i }));
    expect(screen.getByPlaceholderText(/Answer, and it carries on/i)).toBeTruthy();
  });

  it('shows the box immediately when no options were offered', async () => {
    global.fetch = mockFetch({ ...parked, options: [] });
    render(<GoalQuestion chatId="c1" folder="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByPlaceholderText(/Answer, and it carries on/i)).toBeTruthy());
  });

  it('answers AND restarts the run, carrying credentials', async () => {
    /*
     * Both calls matter. Without the second the answer sits on disk and the run
     * never resumes; without the route on it the resumed sessions die on
     * "Not logged in" and burn the task's attempts.
     */
    global.fetch = mockFetch(parked);
    render(<GoalQuestion chatId="c1" folder="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'net' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'net' }));

    await waitFor(() => expect(posts.length).toBe(2));
    expect(posts[0].url).toContain('/api/harness/answer');
    expect(posts[0].body).toMatchObject({ id: 'q1', answer: 'net' });
    expect(posts[1].url).toBe('/api/harness');
    expect(posts[1].body).toMatchObject({ model: 'm', apiKey: 'k' });
  });
});
