#!/usr/bin/env node
/**
 * Test script for PDF attachment extraction pipeline.
 * Simulates what the API route does: encode a PDF to base64, decode it, extract text.
 *
 * Usage: node scripts/test-pdf-extraction.js [path-to-pdf]
 *        Defaults to ~/Downloads/Claude.pdf if no path given.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

async function main() {
  const pdfPath = process.argv[2] || path.join(os.homedir(), 'Downloads', 'Claude.pdf');

  if (!fs.existsSync(pdfPath)) {
    console.error('❌ PDF not found:', pdfPath);
    process.exit(1);
  }

  console.log('=== PDF Extraction Test ===\n');

  // Step 1: Read and base64 encode (simulates client-side attachment-menu.tsx)
  console.log('1. Reading PDF:', pdfPath);
  const rawBuffer = fs.readFileSync(pdfPath);
  console.log('   Size:', rawBuffer.length, 'bytes');

  const base64Content = rawBuffer.toString('base64');
  console.log('   Base64 length:', base64Content.length, 'chars');

  // Step 2: Decode base64 (simulates server-side extractors/index.ts)
  console.log('\n2. Decoding base64 back to buffer...');
  const decodedBuffer = Buffer.from(base64Content, 'base64');
  console.log('   Decoded size:', decodedBuffer.length, 'bytes');
  console.log('   Matches original:', rawBuffer.equals(decodedBuffer) ? '✅ YES' : '❌ NO');

  // Step 3: Save to scratch dir (simulates route.ts saving to disk)
  const scratchDir = path.join(os.homedir(), '.quarry', 'scratch', 'test-extraction', 'uploads');
  fs.mkdirSync(scratchDir, { recursive: true });
  const savedPath = path.join(scratchDir, 'test.pdf');
  fs.writeFileSync(savedPath, decodedBuffer);
  console.log('\n3. Saved to scratch:', savedPath);
  console.log('   Readable:', fs.accessSync(savedPath, fs.constants.R_OK) === undefined ? '✅ YES' : '❌ NO');

  // Step 4: Extract with pdfjs (simulates extractors/pdf.ts)
  console.log('\n4. Extracting text with pdfjs-dist...');

  // Install polyfills
  class DOMMatrixStub {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    constructor() {}
    multiply() { return new DOMMatrixStub(); }
    inverse() { return new DOMMatrixStub(); }
    translate() { return new DOMMatrixStub(); }
    scale() { return new DOMMatrixStub(); }
    rotate() { return new DOMMatrixStub(); }
    transformPoint(p = {}) { return { x: p.x || 0, y: p.y || 0 }; }
    static fromMatrix() { return new DOMMatrixStub(); }
    static fromFloat32Array() { return new DOMMatrixStub(); }
    static fromFloat64Array() { return new DOMMatrixStub(); }
  }
  class Path2DStub { moveTo(){} lineTo(){} bezierCurveTo(){} rect(){} closePath(){} arc(){} arcTo(){} ellipse(){} quadraticCurveTo(){} }
  globalThis.DOMMatrix = DOMMatrixStub;
  globalThis.DOMMatrixReadOnly = DOMMatrixStub;
  globalThis.Path2D = Path2DStub;
  globalThis.ImageData = class { constructor(w,h) { this.width=w; this.height=h; this.data=new Uint8ClampedArray(w*h*4); } };

  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

    // Point to actual worker file (same fix as in pdf.ts)
    pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

    const data = new Uint8Array(decodedBuffer);
    const doc = await pdfjsLib.getDocument({
      data,
      useSystemFonts: true,
      isEvalSupported: false,
      disableAutoFetch: true,
    }).promise;

    console.log('   Pages:', doc.numPages);

    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str || '').join(' ').trim();
      if (pageText) {
        pages.push(`--- Page ${i} ---\n${pageText}`);
      }
    }

    const fullText = pages.join('\n\n');
    console.log('   Total text length:', fullText.length, 'chars');
    console.log('   First 300 chars:\n');
    console.log('   ', fullText.substring(0, 300));
    console.log('\n✅ PDF extraction PASSED');
  } catch (err) {
    console.error('\n❌ PDF extraction FAILED:', err.message);
    console.error('   Stack:', err.stack?.split('\n').slice(0, 5).join('\n'));
    process.exit(1);
  }

  // Step 5: Test reading from scratch path (simulates what the model does)
  console.log('\n5. Testing file access from scratch path...');
  try {
    const readBack = fs.readFileSync(savedPath);
    console.log('   Read', readBack.length, 'bytes from scratch path');
    console.log('   ✅ Scratch file is readable');
  } catch (err) {
    console.error('   ❌ Cannot read scratch file:', err.message);
  }

  // Cleanup
  fs.rmSync(path.join(os.homedir(), '.quarry', 'scratch', 'test-extraction'), { recursive: true });
  console.log('\n=== Test complete ===');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
