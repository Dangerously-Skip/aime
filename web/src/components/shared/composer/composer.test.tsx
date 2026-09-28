// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { Composer, type ComposerProps } from './composer';
import { useComposerDrafts, draftKey } from './draft-store';
import { AttachmentMenu } from '@/components/shared/attachment-menu';

function renderComposer(overrides: Partial<ComposerProps> = {}) {
  const props: ComposerProps = {
    surface: 'chat',
    conversationId: 'c1',
    onSubmit: vi.fn(),
    onStop: vi.fn(),
    placeholder: 'Reply...',
    voice: false,
    ...overrides,
  };
  const utils = render(<Composer {...props} />);
  const box = () => screen.getByPlaceholderText('Reply...') as HTMLTextAreaElement;
  return { ...utils, props, box };
}

function type(box: HTMLTextAreaElement, text: string) {
  fireEvent.change(box, { target: { value: text } });
}

beforeEach(() => {
  useComposerDrafts.setState({ drafts: {}, lastSent: {} });
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Composer — sending', () => {
  it('Enter sends the trimmed text and clears the draft; Shift+Enter does not send', () => {
    const { props, box } = renderComposer();
    type(box(), '  hello  ');
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true });
    expect(props.onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(props.onSubmit).toHaveBeenCalledWith('hello', []);
    expect(box().value).toBe('');
  });

  it('the send button and Enter are the same submit', () => {
    const { props, box } = renderComposer();
    type(box(), 'via button');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(props.onSubmit).toHaveBeenCalledWith('via button', []);
  });

  it('keeps the draft when the send is refused', () => {
    const { box } = renderComposer({ onSubmit: () => false });
    type(box(), 'not yet');
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(box().value).toBe('not yet');
  });

  it('ignores Enter while an IME is composing', () => {
    const { props, box } = renderComposer();
    type(box(), 'にほん');
    fireEvent.keyDown(box(), { key: 'Enter', isComposing: true });
    fireEvent.keyDown(box(), { key: 'Enter', keyCode: 229 });
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(box().value).toBe('にほん');
  });

  it('keeps focus in the composer after sending', () => {
    const { box } = renderComposer();
    type(box(), 'first');
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(document.activeElement).toBe(box());
  });
});

describe('Composer — while the turn is running', () => {
  it('Enter neither aborts the turn nor sends; the draft is kept', () => {
    const { props, box } = renderComposer({ isStreaming: true });
    type(box(), 'follow-up');
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(props.onStop).not.toHaveBeenCalled();
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(box().value).toBe('follow-up');
  });

  it('Esc stops the turn', () => {
    const { props, box } = renderComposer({ isStreaming: true });
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(props.onStop).toHaveBeenCalledTimes(1);
  });

  it('the button becomes Stop, and stops', () => {
    const { props } = renderComposer({ isStreaming: true });
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(props.onStop).toHaveBeenCalledTimes(1);
  });

  it('Esc does nothing when no turn is running', () => {
    const { props, box } = renderComposer();
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(props.onStop).not.toHaveBeenCalled();
  });
});

describe('Composer — drafts, recall and focus', () => {
  it('each conversation keeps its own draft across a switch', () => {
    const { box, rerender, props } = renderComposer();
    type(box(), 'draft for c1');
    rerender(<Composer {...props} conversationId="c2" />);
    expect(box().value).toBe('');
    type(box(), 'draft for c2');
    rerender(<Composer {...props} conversationId="c1" />);
    expect(box().value).toBe('draft for c1');
  });

  it('focuses on mount and again on a conversation switch', () => {
    const { box, rerender, props } = renderComposer();
    expect(document.activeElement).toBe(box());
    box().blur();
    rerender(<Composer {...props} conversationId="c2" />);
    expect(document.activeElement).toBe(box());
  });

  it('Up-arrow in an empty composer recalls the last prompt', () => {
    const { box } = renderComposer({ recallText: 'what I asked before' });
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    expect(box().value).toBe('what I asked before');
  });

  it('Up-arrow in a non-empty composer leaves the text alone', () => {
    const { box } = renderComposer({ recallText: 'old' });
    type(box(), 'typing');
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    expect(box().value).toBe('typing');
  });

  it('without a conversation prompt, recalls the last one sent from this surface', () => {
    const { box } = renderComposer();
    type(box(), 'sent earlier');
    fireEvent.keyDown(box(), { key: 'Enter' });
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    expect(box().value).toBe('sent earlier');
  });
});

describe('Composer — attachments', () => {
  function pngFile(name = 'shot.png') {
    return new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
  }

  it('pasting an image adds it as an attachment and shows a thumbnail', async () => {
    const { props, box } = renderComposer();
    const file = pngFile();
    fireEvent.paste(box(), {
      clipboardData: { files: [file], getData: () => '' },
    });
    await waitFor(() => expect(screen.getByAltText('shot.png')).toBeTruthy());

    type(box(), 'what is this?');
    fireEvent.keyDown(box(), { key: 'Enter' });
    const [, attachments] = (props.onSubmit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ name: 'shot.png', category: 'image' });
    expect(attachments[0].content).toMatch(/^data:image\/png/);
  });

  it('pasting text that came with a rendered image pastes the text, not the image', () => {
    const onAttachmentAdded = vi.fn();
    const { box } = renderComposer({ onAttachmentAdded });
    const evt = fireEvent.paste(box(), {
      clipboardData: { files: [pngFile('image.png')], getData: () => 'A paragraph from Word' },
    });
    // Not prevented: the browser inserts the text as usual.
    expect(evt).toBe(true);
    expect(useComposerDrafts.getState().drafts[draftKey('chat', 'c1')]?.attachments ?? []).toHaveLength(0);
  });

  it('attachments can be removed with a labelled button', async () => {
    renderComposer();
    act(() => {
      useComposerDrafts.getState().addAttachment(draftKey('chat', 'c1'), {
        name: 'notes.txt', content: 'x', type: 'text/plain', category: 'text',
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove notes.txt' }));
    expect(screen.queryByText('notes.txt')).toBeNull();
  });
});

describe('Composer — slash commands', () => {
  it('typing / opens the picker and Enter picks rather than sends', () => {
    const { props, box } = renderComposer();
    type(box(), '/thi');
    expect(screen.getByText('/think')).toBeTruthy();
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(box().value).toBe('/think ');
  });
});

describe('AttachmentMenu — no handler, no toggle', () => {
  it('renders the web-search item only when something handles it', async () => {
    const { unmount } = render(<AttachmentMenu onFileSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }));
    await waitFor(() => expect(screen.getByText('Add files or photos')).toBeTruthy());
    expect(screen.queryByText('Web search')).toBeNull();
    unmount();

    render(<AttachmentMenu onFileSelect={() => {}} onWebSearchToggle={() => {}} webSearchEnabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }));
    await waitFor(() => expect(screen.getByText('Web search')).toBeTruthy());
  });
});
