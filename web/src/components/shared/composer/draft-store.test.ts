import { describe, it, expect, beforeEach } from 'vitest';
import { useComposerDrafts, draftKey, addComposerAttachment, setComposerText } from './draft-store';
import { lastUserPrompt } from './recall';

const s = () => useComposerDrafts.getState();

beforeEach(() => {
  useComposerDrafts.setState({ drafts: {}, lastSent: {} });
});

describe('composer drafts', () => {
  it('keys a not-yet-created conversation as new, per surface', () => {
    expect(draftKey('chat', '')).toBe('chat:new');
    expect(draftKey('cowork', null)).toBe('cowork:new');
    expect(draftKey('chat', 'abc')).toBe('chat:abc');
  });

  it('keeps drafts apart per conversation', () => {
    setComposerText('chat', 'a', 'one');
    setComposerText('chat', 'b', 'two');
    expect(s().drafts['chat:a'].text).toBe('one');
    expect(s().drafts['chat:b'].text).toBe('two');
  });

  it('dictation appends to what was typed', () => {
    s().setText('k', 'hello');
    s().appendText('k', 'world');
    expect(s().drafts.k.text).toBe('hello world');
    s().appendText('empty', 'first');
    expect(s().drafts.empty.text).toBe('first');
  });

  it('adds, removes and clears attachments', () => {
    const f = { name: 'n', content: '', type: 't', category: 'text' as const };
    addComposerAttachment('chat', 'a', f);
    addComposerAttachment('chat', 'a', { ...f, name: 'm' });
    s().removeAttachment('chat:a', 0);
    expect(s().drafts['chat:a'].attachments.map((x) => x.name)).toEqual(['m']);
    s().clearDraft('chat:a');
    expect(s().drafts['chat:a']).toBeUndefined();
  });
});

describe('lastUserPrompt', () => {
  it('is the last typed user message, without auto-continues or extracted documents', () => {
    expect(
      lastUserPrompt([
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'summarise this\n\n<document name="a.pdf">\nbody\n</document>' },
        { role: 'user', content: 'Continue', isAutoContinue: true },
        { role: 'assistant', content: 'done' },
      ]),
    ).toBe('summarise this');
    expect(lastUserPrompt([])).toBeUndefined();
  });
});
