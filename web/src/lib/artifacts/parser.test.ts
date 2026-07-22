import { describe, it, expect } from 'vitest';
import { parseArtifacts, hasArtifactMarkers } from './parser';

const block = (attrs: string, content: string) => `:::artifact{${attrs}}\n${content}\n:::`;

describe('parseArtifacts', () => {
  it('returns a single text segment when there are no artifacts', () => {
    const result = parseArtifacts('just a plain answer');
    expect(result.segments).toEqual([{ type: 'text', content: 'just a plain answer' }]);
  });

  it('extracts an explicit artifact block with attributes', () => {
    const msg = `Intro text.\n\n${block('title="My Doc" type="markdown"', '# Hello')}\n\nOutro.`;
    const result = parseArtifacts(msg);

    expect(result.segments).toHaveLength(3);
    expect(result.segments[0]).toEqual({ type: 'text', content: 'Intro text.' });
    const artifact = result.segments[1];
    expect(artifact.type).toBe('artifact');
    if (artifact.type === 'artifact') {
      expect(artifact.artifact.title).toBe('My Doc');
      expect(artifact.artifact.type).toBe('markdown');
      expect(artifact.artifact.content).toBe('# Hello');
    }
    expect(result.segments[2]).toEqual({ type: 'text', content: 'Outro.' });
  });

  it('captures the language attribute for code artifacts', () => {
    const msg = block('title="Script" type="code" language="python"', 'print(1)');
    const result = parseArtifacts(msg);
    const seg = result.segments[0];
    expect(seg.type).toBe('artifact');
    if (seg.type === 'artifact') {
      expect(seg.artifact.language).toBe('python');
      expect(seg.artifact.type).toBe('code');
    }
  });

  it('defaults unknown types to markdown and missing titles to Untitled', () => {
    const msg = block('type="nonsense"', 'body');
    const seg = parseArtifacts(msg).segments[0];
    expect(seg.type).toBe('artifact');
    if (seg.type === 'artifact') {
      expect(seg.artifact.type).toBe('markdown');
      expect(seg.artifact.title).toBe('Untitled');
    }
  });

  it('parses multiple artifact blocks with interleaved text', () => {
    const msg = [
      'First.',
      block('title="A" type="text"', 'aaa'),
      'Between.',
      block('title="B" type="html"', '<p>b</p>'),
    ].join('\n');
    const result = parseArtifacts(msg);
    const types = result.segments.map((s) => s.type);
    expect(types).toEqual(['text', 'artifact', 'text', 'artifact']);
  });

  it('treats a large lone code fence as an implicit artifact', () => {
    const codeLines = Array.from({ length: 25 }, (_, i) => `line${i}`).join('\n');
    const msg = `\`\`\`ts\n${codeLines}\n\`\`\``;
    const result = parseArtifacts(msg);
    const seg = result.segments[0];
    expect(seg.type).toBe('artifact');
    if (seg.type === 'artifact') {
      expect(seg.artifact.type).toBe('code');
      expect(seg.artifact.language).toBe('ts');
      expect(seg.artifact.content).toBe(codeLines);
    }
  });

  it('does not apply the fallback to short code fences', () => {
    const msg = '```js\nconst a = 1;\n```';
    const result = parseArtifacts(msg);
    expect(result.segments).toEqual([{ type: 'text', content: msg }]);
  });
});

describe('hasArtifactMarkers', () => {
  it('detects the artifact marker', () => {
    expect(hasArtifactMarkers(':::artifact{title="x"}')).toBe(true);
    expect(hasArtifactMarkers('plain text with ::: fences')).toBe(false);
  });
});
