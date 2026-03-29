/**
 * PDF text extraction using pdfjs-dist.
 * Polyfills browser globals (DOMMatrix, Path2D) that pdfjs-dist expects in Node.
 */
import type { ExtractionResult } from './types';

/** Minimal DOMMatrix stub — pdfjs-dist checks for it but text extraction doesn't use transforms. */
class DOMMatrixStub {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  is2D = true; isIdentity = true;
  m11 = 1; m12 = 0; m13 = 0; m14 = 0;
  m21 = 0; m22 = 1; m23 = 0; m24 = 0;
  m31 = 0; m32 = 0; m33 = 1; m34 = 0;
  m41 = 0; m42 = 0; m43 = 0; m44 = 1;
  constructor(init?: number[] | string) {
    if (Array.isArray(init) && init.length >= 6) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      this.m11 = this.a; this.m12 = this.b;
      this.m21 = this.c; this.m22 = this.d;
      this.m41 = this.e; this.m42 = this.f;
    }
  }
  multiply() { return new DOMMatrixStub(); }
  inverse() { return new DOMMatrixStub(); }
  translate() { return new DOMMatrixStub(); }
  scale() { return new DOMMatrixStub(); }
  rotate() { return new DOMMatrixStub(); }
  transformPoint(p: { x?: number; y?: number } = {}) { return { x: p.x ?? 0, y: p.y ?? 0 }; }
  toFloat32Array() { return new Float32Array(6); }
  toFloat64Array() { return new Float64Array(6); }
  toString() { return 'matrix(1, 0, 0, 1, 0, 0)'; }
  static fromMatrix() { return new DOMMatrixStub(); }
  static fromFloat32Array() { return new DOMMatrixStub(); }
  static fromFloat64Array() { return new DOMMatrixStub(); }
}

class Path2DStub {
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  quadraticCurveTo() {}
  arc() {}
  arcTo() {}
  ellipse() {}
  rect() {}
  closePath() {}
}

function installPolyfills() {
  const g = globalThis as Record<string, unknown>;
  if (!g.DOMMatrix) g.DOMMatrix = DOMMatrixStub as unknown;
  if (!g.DOMMatrixReadOnly) g.DOMMatrixReadOnly = DOMMatrixStub as unknown;
  if (!g.Path2D) g.Path2D = Path2DStub as unknown;
  if (!g.ImageData) {
    g.ImageData = class ImageData {
      width: number; height: number; data: Uint8ClampedArray;
      constructor(w: number, h: number) {
        this.width = w; this.height = h;
        this.data = new Uint8ClampedArray(w * h * 4);
      }
    } as unknown;
  }
}

export async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  installPolyfills();

  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

  // Set worker path — try require.resolve first, fall back to relative path
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  } catch {
    // In packaged Electron, require.resolve may fail — try common locations
    const path = await import('path');
    const fs = await import('fs');
    const candidates = [
      path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs'),
      path.join(__dirname, '..', '..', '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs'),
    ];
    // If process.resourcesPath is set (Electron), check there too
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, '.next', 'standalone', 'web', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs'));
      candidates.push(path.join(process.resourcesPath, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs'));
    }
    const found = candidates.find(c => { try { fs.accessSync(c); return true; } catch { return false; } });
    if (found) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = found;
    }
    // If none found, pdfjs will try to run without a worker (slower but works)
  }

  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  const pageCount = doc.numPages;
  const pages: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: { str?: string }) => item.str ?? '')
      .join(' ')
      .trim();
    if (pageText) {
      pages.push(`--- Page ${i} ---\n${pageText}`);
    }
  }

  return {
    text: pages.join('\n\n'),
    pageCount,
    metadata: { type: 'pdf' },
  };
}
