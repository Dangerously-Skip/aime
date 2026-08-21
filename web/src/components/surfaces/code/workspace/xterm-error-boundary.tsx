"use client";

import { Component, type ReactNode } from "react";

/**
 * Swallows the known-harmless "Cannot read properties of undefined
 * (reading 'dimensions')" that xterm's RenderService throws on first
 * render / HMR remount. xterm recovers on the next frame; we just don't
 * want it bubbling up to the Next.js dev overlay.
 *
 * Re-throws every other error so real bugs still surface.
 */
interface State {
  swallowed: number;
}

export class XtermErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { swallowed: 0 };

  static getDerivedStateFromError(error: unknown): State | null {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("'dimensions'") || msg.includes("dimensions")) {
      return { swallowed: 1 };
    }
    return null;
  }

  componentDidCatch(error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("'dimensions'") || msg.includes("dimensions")) {
      // Reset so the children can re-render on the next frame.
      requestAnimationFrame(() => this.setState({ swallowed: 0 }));
      return;
    }
    throw error;
  }

  render() {
    return this.props.children;
  }
}

/**
 * The half a React boundary CANNOT catch.
 *
 * xterm schedules `Viewport._innerRefresh` through `requestAnimationFrame`. When
 * a resize or a dispose lands between scheduling and firing, that frame reads
 * `this._renderService.dimensions` on a service that has gone, and throws —
 * asynchronously. React error boundaries only see errors thrown during render
 * and commit, so `XtermErrorBoundary` above, whose comment claims it stops this
 * reaching the dev overlay, structurally cannot: by the time the frame runs
 * there is no React stack to catch it in.
 *
 * The symptom is a full-screen Next.js error overlay for something xterm has
 * already recovered from on the next frame. Dev-only — the overlay does not
 * exist in a packaged build — but it hides whatever you were actually doing.
 *
 * NARROW ON PURPOSE. It matches this one message from this one library, in
 * development only, and re-dispatches anything else untouched. A broad
 * `window.onerror` filter is how a real crash becomes invisible.
 */
export function installXtermFrameErrorFilter(): () => void {
  if (typeof window === 'undefined' || process.env.NODE_ENV === 'production') {
    return () => {};
  }

  const isXtermDimensions = (message: unknown, error: unknown): boolean => {
    const text =
      (error instanceof Error ? error.message : '') || (typeof message === 'string' ? message : '');
    // Both spellings: the property access and the wrapped form.
    return /reading '?dimensions'?/.test(text) || /_renderService/.test(text);
  };

  const onError = (event: ErrorEvent) => {
    if (isXtermDimensions(event.message, event.error)) {
      // Stop it reaching the overlay. xterm recovers on the next frame.
      event.preventDefault();
      event.stopImmediatePropagation();
      console.debug('[xterm] swallowed a post-dispose refresh frame');
    }
  };

  window.addEventListener('error', onError, true);
  return () => window.removeEventListener('error', onError, true);
}
