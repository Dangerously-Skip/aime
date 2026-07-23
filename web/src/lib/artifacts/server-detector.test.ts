import { describe, it, expect } from 'vitest';
import { detectServerUrl, mightContainServerUrl, isWebAsset } from './server-detector';

describe('detectServerUrl', () => {
  it('returns null for empty or URL-free output', () => {
    expect(detectServerUrl('')).toBeNull();
    expect(detectServerUrl('build finished in 3.2s')).toBeNull();
  });

  it('detects explicit localhost URLs', () => {
    expect(detectServerUrl('Server at http://localhost:3000 started')?.url).toBe('http://localhost:3000');
    expect(detectServerUrl('listening http://127.0.0.1:8080')?.url).toBe('http://127.0.0.1:8080');
  });

  it('normalizes 0.0.0.0 to localhost', () => {
    expect(detectServerUrl('http://0.0.0.0:5173 ready')?.url).toBe('http://localhost:5173');
  });

  it('constructs a URL from port-only announcements', () => {
    const result = detectServerUrl('server ready on port 3001');
    expect(result?.url).toBe('http://localhost:3001');
    expect(result?.raw).toContain('ready on port 3001');

    expect(detectServerUrl('now listening on port 8080')?.url).toBe('http://localhost:8080');
  });

  it('detects "Server running at" announcements', () => {
    expect(detectServerUrl('Server running at http://192.168.1.5:4000/')?.url).toBe('http://192.168.1.5:4000/');
  });

  it('is not stateful across calls (global regex reset)', () => {
    const output = 'Local: http://localhost:3000';
    expect(detectServerUrl(output)?.url).toBe('http://localhost:3000');
    expect(detectServerUrl(output)?.url).toBe('http://localhost:3000');
  });
});

describe('mightContainServerUrl', () => {
  it('matches the cheap pre-filter patterns', () => {
    expect(mightContainServerUrl('http://localhost:3000')).toBe(true);
    expect(mightContainServerUrl('ready on port 3001')).toBe(true);
    expect(mightContainServerUrl('Server running')).toBe(true);
    expect(mightContainServerUrl('compiled successfully')).toBe(false);
  });
});

describe('isWebAsset', () => {
  it('recognizes common web asset extensions', () => {
    expect(isWebAsset('/app/styles.css')).toBe(true);
    expect(isWebAsset('/app/main.TSX')).toBe(true);
    expect(isWebAsset('/app/font.woff2')).toBe(true);
  });

  it('rejects non-web extensions', () => {
    expect(isWebAsset('/app/report.pdf')).toBe(false);
    expect(isWebAsset('/app/script.sh')).toBe(false);
  });
});
