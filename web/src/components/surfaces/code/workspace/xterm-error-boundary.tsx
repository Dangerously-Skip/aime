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
