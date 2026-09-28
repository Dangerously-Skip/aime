import { describe, it, expect } from 'vitest';
import { pasteWantsFiles } from './use-paste-attachments';

const file = (name: string) => ({ name }) as File;

describe('pasteWantsFiles', () => {
  it('no files: ordinary text paste', () => {
    expect(pasteWantsFiles([], 'hello')).toBe(false);
  });

  it('a screenshot (files, no text) becomes an attachment', () => {
    expect(pasteWantsFiles([file('image.png')], '')).toBe(true);
  });

  it('a file copied in Finder (text is just its name) becomes an attachment', () => {
    expect(pasteWantsFiles([file('report.pdf')], 'report.pdf')).toBe(true);
    expect(pasteWantsFiles([file('a.txt'), file('b.txt')], 'a.txt\nb.txt')).toBe(true);
  });

  it('text from an Office app that brought a rendered image along stays text', () => {
    expect(pasteWantsFiles([file('image.png')], 'Quarterly numbers are up 4%')).toBe(false);
  });
});
