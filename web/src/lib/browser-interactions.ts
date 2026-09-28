/**
 * Browser page interaction tools — inspector, selection, screenshots.
 *
 * These scripts are injected into the webview via executeJavaScript().
 */

import type { WebviewRef } from './browser-tools';

// ── Types ────────────────────────────────────────────────────────────────────

export interface InspectorResult {
  tag: string;
  id: string;
  classes: string[];
  text: string;
  html: string;
  attributes: Record<string, string>;
}

export interface PendingContextItem {
  id: string;
  type: 'screenshot' | 'element' | 'selection' | 'document';
  label: string;
  preview?: string; // data URL for screenshots
  content: string;  // text content or base64 data
  timestamp: number;
}

// ── Inspector scripts ────────────────────────────────────────────────────────

export function getInspectorInjectionScript(): string {
  return `
(function() {
  if (window.__agentInspectorActive) return;
  window.__agentInspectorActive = true;
  window.__agentInspectorResult = null;

  let highlighted = null;

  function onMouseOver(e) {
    if (highlighted) highlighted.style.outline = highlighted.__prevOutline || '';
    highlighted = e.target;
    highlighted.__prevOutline = highlighted.style.outline;
    highlighted.style.outline = '2px solid #3b82f6';
    e.stopPropagation();
  }

  function onMouseOut(e) {
    if (e.target === highlighted) {
      e.target.style.outline = e.target.__prevOutline || '';
    }
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    const attrs = {};
    for (const attr of el.attributes) {
      attrs[attr.name] = attr.value;
    }
    window.__agentInspectorResult = {
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      classes: Array.from(el.classList),
      text: (el.textContent || '').trim().substring(0, 200),
      html: el.outerHTML.substring(0, 500),
      attributes: attrs,
    };
    cleanup();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      cleanup();
    }
  }

  function cleanup() {
    if (highlighted) highlighted.style.outline = highlighted.__prevOutline || '';
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.__agentInspectorActive = false;
  }

  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout', onMouseOut, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
})()`;
}

export function getInspectorCleanupScript(): string {
  return `
(function() {
  if (window.__agentInspectorActive) {
    document.querySelectorAll('*').forEach(function(el) {
      if (el.__prevOutline !== undefined) {
        el.style.outline = el.__prevOutline;
        delete el.__prevOutline;
      }
    });
    document.removeEventListener('mouseover', function(){}, true);
    document.removeEventListener('mouseout', function(){}, true);
    document.removeEventListener('click', function(){}, true);
    document.removeEventListener('keydown', function(){}, true);
    window.__agentInspectorActive = false;
  }
  window.__agentInspectorResult = null;
})()`;
}

export function getInspectorPollScript(): string {
  return `window.__agentInspectorResult`;
}

export function getSelectionScript(): string {
  return `window.getSelection().toString()`;
}

// ── Selection listener (injected into webview) ───────────────────────────────

/** The console line the page emits when a selection is cleared. */
export const SELECTION_CLEAR_MESSAGE = '__AIME_SELECTION_CLEAR__';
/** The pre-rename spelling, still accepted from a page injected by an older build. */
export const LEGACY_SELECTION_CLEAR_MESSAGE = '__QUARRY_SELECTION_CLEAR__';

export function isSelectionClearMessage(msg: string): boolean {
  return msg === SELECTION_CLEAR_MESSAGE || msg === LEGACY_SELECTION_CLEAR_MESSAGE;
}

export function getSelectionListenerScript(): string {
  // A page still holding the pre-rename listener (__quarrySelection*) retires
  // it first, so one page never runs two listeners.
  return `
(function() {
  if (window.__quarrySelectionCleanup) window.__quarrySelectionCleanup();
  if (window.__aimeSelectionActive) return;
  window.__aimeSelectionActive = true;

  function onMouseUp() {
    setTimeout(function() {
      var sel = window.getSelection();
      var text = sel ? sel.toString().trim() : '';
      if (text.length > 0) {
        var range = sel.getRangeAt(0);
        var rect = range.getBoundingClientRect();
        console.log('__AIME_SELECTION__:' + JSON.stringify({
          text: text,
          x: rect.x,
          y: rect.y,
          bottom: rect.bottom
        }));
      }
    }, 10);
  }

  function onMouseDown() {
    console.log('${SELECTION_CLEAR_MESSAGE}');
  }

  window.__aimeSelectionCleanup = function() {
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('mousedown', onMouseDown);
    window.__aimeSelectionActive = false;
    delete window.__aimeSelectionCleanup;
  };

  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('mousedown', onMouseDown);
})()`;
}

export function getSelectionCleanupScript(): string {
  return `
(function() {
  if (window.__aimeSelectionCleanup) window.__aimeSelectionCleanup();
  if (window.__quarrySelectionCleanup) window.__quarrySelectionCleanup();
})()`;
}

// ── Screenshot ───────────────────────────────────────────────────────────────

export async function captureScreenshot(webview: WebviewRef): Promise<string> {
  const image = await webview.capturePage();
  return image.toDataURL();
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatElementContext(result: InspectorResult): string {
  const lines = [
    `Element: <${result.tag}>`,
    result.id ? `ID: ${result.id}` : null,
    result.classes.length > 0 ? `Classes: ${result.classes.join(', ')}` : null,
    result.text ? `Text: "${result.text}"` : null,
    `HTML: ${result.html}`,
  ].filter(Boolean);
  return lines.join('\n');
}
