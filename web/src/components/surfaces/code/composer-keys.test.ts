import { describe, it, expect } from 'vitest';
import { composerKeyAction, isUntitledConversation } from './composer-keys';

const idle = { isStreaming: false, hasText: true };
const streaming = { isStreaming: true, hasText: true };

describe('composerKeyAction', () => {
  it('Enter submits when idle with text', () => {
    expect(composerKeyAction({ key: 'Enter' }, idle)).toBe('submit');
  });

  it('Enter while streaming does NOT abort (it used to)', () => {
    expect(composerKeyAction({ key: 'Enter' }, streaming)).toBe('none');
  });

  it('Esc stops a streaming turn, and is left alone otherwise', () => {
    expect(composerKeyAction({ key: 'Escape' }, streaming)).toBe('abort');
    expect(composerKeyAction({ key: 'Escape' }, idle)).toBe('default');
  });

  it('Enter during IME composition confirms the candidate, never sends', () => {
    expect(composerKeyAction({ key: 'Enter', isComposing: true }, idle)).toBe('default');
    expect(composerKeyAction({ key: 'Enter', keyCode: 229 }, idle)).toBe('default');
    expect(composerKeyAction({ key: 'Escape', isComposing: true }, streaming)).toBe('default');
  });

  it('Shift+Enter is a newline; Enter with no text does nothing', () => {
    expect(composerKeyAction({ key: 'Enter', shiftKey: true }, idle)).toBe('default');
    expect(composerKeyAction({ key: 'Enter' }, { isStreaming: false, hasText: false })).toBe('none');
  });
});

describe('isUntitledConversation', () => {
  it.each([undefined, null, '', '   ', 'New Chat', 'new chat'])('%j is untitled', (t) => {
    expect(isUntitledConversation(t)).toBe(true);
  });
  it('a real title is kept', () => {
    expect(isUntitledConversation('Fix the flaky login test')).toBe(false);
  });
});
