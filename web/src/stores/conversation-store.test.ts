import { describe, it, expect, beforeEach } from 'vitest';
import { useConversationStore, type Conversation } from './conversation-store';

let seq = 0;
const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: `c${++seq}`,
  title: 'A chat',
  surface: 'chat',
  lastMessage: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

beforeEach(() => {
  useConversationStore.setState({
    conversations: [],
    activeId: null,
    navigationHistory: [],
    navigationIndex: -1,
  });
});

const store = () => useConversationStore.getState();

describe('conversation CRUD', () => {
  it('prepends new conversations', () => {
    const first = conversation();
    const second = conversation();
    store().addConversation(first);
    store().addConversation(second);
    expect(store().conversations.map((c) => c.id)).toEqual([second.id, first.id]);
  });

  it('removing the active conversation clears activeId', () => {
    const conv = conversation();
    store().addConversation(conv);
    store().setActiveConversation(conv.id);
    store().removeConversation(conv.id);
    expect(store().activeId).toBeNull();
    expect(store().conversations).toHaveLength(0);
  });

  it('removing an inactive conversation keeps activeId', () => {
    const keep = conversation();
    const drop = conversation();
    store().addConversation(keep);
    store().addConversation(drop);
    store().setActiveConversation(keep.id);
    store().removeConversation(drop.id);
    expect(store().activeId).toBe(keep.id);
  });

  it('updateConversation merges fields and bumps updatedAt', () => {
    const conv = conversation({ updatedAt: 1 });
    store().addConversation(conv);
    store().updateConversation(conv.id, { title: 'Renamed' });
    const updated = store().conversations[0];
    expect(updated.title).toBe('Renamed');
    expect(updated.updatedAt).toBeGreaterThan(1);
  });

  it('filters conversations by surface', () => {
    store().addConversation(conversation({ surface: 'chat' }));
    store().addConversation(conversation({ surface: 'cowork' }));
    expect(store().getConversationsForSurface('cowork')).toHaveLength(1);
  });

  it('assignToProject sets and clears projectId', () => {
    const conv = conversation();
    store().addConversation(conv);
    store().assignToProject(conv.id, 'proj1');
    expect(store().conversations[0].projectId).toBe('proj1');
    store().assignToProject(conv.id, null);
    expect(store().conversations[0].projectId).toBeNull();
  });
});

describe('updateConversationMetrics', () => {
  it('merges sessionStats instead of replacing them', () => {
    const conv = conversation();
    store().addConversation(conv);

    store().updateConversationMetrics(conv.id, {
      sessionStats: { toolCallCount: 3, aborted: false },
    });
    store().updateConversationMetrics(conv.id, {
      sessionStats: { artifactCount: 2 },
    });

    expect(store().conversations[0].sessionStats).toMatchObject({
      toolCallCount: 3,
      artifactCount: 2,
      aborted: false,
    });
  });

  it('only touches provided metric groups', () => {
    const conv = conversation();
    store().addConversation(conv);
    store().updateConversationMetrics(conv.id, {
      roi: { multiplier: 4, dollarsSaved: 100 },
    });
    const updated = store().conversations[0];
    expect(updated.roi).toEqual({ multiplier: 4, dollarsSaved: 100 });
    expect(updated.tokenUsage).toBeUndefined();
    expect(updated.effortEstimate).toBeUndefined();
  });

  it('records user ratings including thumbs-down', () => {
    const conv = conversation();
    store().addConversation(conv);
    store().updateConversationMetrics(conv.id, { userRating: -1 });
    expect(store().conversations[0].userRating).toBe(-1);
  });
});

describe('navigation history', () => {
  it('navigateTo pushes history and sets active', () => {
    store().navigateTo('a');
    store().navigateTo('b');
    expect(store().activeId).toBe('b');
    expect(store().navigationHistory).toEqual(['a', 'b']);
    expect(store().canGoBack()).toBe(true);
    expect(store().canGoForward()).toBe(false);
  });

  it('does not duplicate the current entry', () => {
    store().navigateTo('a');
    store().navigateTo('a');
    expect(store().navigationHistory).toEqual(['a']);
  });

  it('goBack and goForward walk the history', () => {
    store().navigateTo('a');
    store().navigateTo('b');
    store().navigateTo('c');

    store().goBack();
    expect(store().activeId).toBe('b');
    store().goBack();
    expect(store().activeId).toBe('a');
    expect(store().canGoBack()).toBe(false);

    store().goForward();
    expect(store().activeId).toBe('b');
    expect(store().canGoForward()).toBe(true);
  });

  it('navigating after goBack truncates the forward branch', () => {
    store().navigateTo('a');
    store().navigateTo('b');
    store().goBack();
    store().navigateTo('c');
    expect(store().navigationHistory).toEqual(['a', 'c']);
    expect(store().canGoForward()).toBe(false);
  });

  it('goBack at the start and goForward at the end are no-ops', () => {
    store().navigateTo('a');
    store().goBack();
    expect(store().activeId).toBe('a');
    store().goForward();
    expect(store().activeId).toBe('a');
  });

  it('caps history at 50 entries', () => {
    for (let i = 0; i < 60; i++) store().navigateTo(`c${i}`);
    expect(store().navigationHistory).toHaveLength(50);
    expect(store().navigationHistory[49]).toBe('c59');
  });

  // Regression: after the 50-entry cap kicked in, navigationIndex was set to
  // truncated.length (one past the end of the sliced array), so goBack()
  // landed on the current entry instead of the previous one.
  it('goBack still reaches the previous entry once history is capped', () => {
    for (let i = 0; i < 60; i++) store().navigateTo(`c${i}`);
    store().goBack();
    expect(store().activeId).toBe('c58');
    store().goBack();
    expect(store().activeId).toBe('c57');
  });
});
