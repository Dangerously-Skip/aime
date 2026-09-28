import { describe, it, expect } from 'vitest';
import { rememberTurnAttachments, resendPayload } from './turn-attachments';
import { isUntitled } from '@/stores/conversation-store';

const doc = '\n\n<document name="a.pdf">\nextracted body\n</document>';
const file = { name: 'a.pdf', content: 'base64', type: 'application/pdf', category: 'document' as const };

describe('resendPayload', () => {
  it('resends the original files, and drops the extracted text the server will re-extract', () => {
    rememberTurnAttachments('m1', [file]);
    expect(resendPayload({ id: 'm1', content: 'summarise' + doc })).toEqual({ text: 'summarise', attachments: [file] });
  });

  it('without the files (after a restart) the extracted text is the only copy, so it stays', () => {
    expect(resendPayload({ id: 'gone', content: 'summarise' + doc })).toEqual({
      text: 'summarise' + doc,
      attachments: [],
    });
  });

  it('an edit replaces the typed text but keeps the document', () => {
    expect(resendPayload({ id: 'gone', content: 'summarise' + doc }, 'summarise in French').text).toBe(
      'summarise in French' + doc,
    );
  });
});

describe('isUntitled', () => {
  it('treats placeholder names as untitled and anything else as a real name', () => {
    for (const t of ['', undefined, 'New Chat', 'new chat', 'New conversation', '  ']) expect(isUntitled(t)).toBe(true);
    for (const t of ['Plan a trip', 'New chat about Lisbon']) expect(isUntitled(t)).toBe(false);
  });
});
