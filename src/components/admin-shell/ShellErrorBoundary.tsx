'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * A shell widget that reads its own data (the Boards section)
 * must not be able to take the whole admin down when that read throws. It
 * renders `fallback` in its place, and logs the cause so the failure is not a
 * silent blank.
 */
export class ShellErrorBoundary extends Component<
  { label: string; fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[admin-shell] ${this.props.label} failed to render`, error, info.componentStack);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
