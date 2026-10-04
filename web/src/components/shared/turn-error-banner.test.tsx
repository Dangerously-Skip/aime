// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TurnErrorBanner } from './turn-error-banner';
import { AssistantMessage } from './assistant-message';
import { useAppStore } from '@/stores/app-store';

afterEach(() => {
  cleanup();
  useAppStore.setState({ settingsOpen: false } as never);
});

describe('TurnErrorBanner', () => {
  it('says what went wrong in plain words, not the raw provider text', () => {
    render(<TurnErrorBanner code="auth" message="Invalid API key · Please run /login" />);
    expect(screen.getByRole('alert').textContent).toMatch(/rejected your credentials/);
    expect(screen.queryByText(/run \/login/)).toBeNull();
  });

  it('the action opens Settings on the section that fixes it', () => {
    const openSettings = vi.fn();
    useAppStore.setState({ openSettings } as never);
    render(<TurnErrorBanner code="no_model" />);
    fireEvent.click(screen.getByRole('button', { name: /Connect a model/ }));
    expect(openSettings).toHaveBeenCalledWith('connectors');
  });

  it('offers Try again only when the error is retryable and there is a retry', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<TurnErrorBanner code="overloaded" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<TurnErrorBanner code="context_length" onRetry={onRetry} />);
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();

    rerender(<TurnErrorBanner code="overloaded" />);
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
  });
});

describe('AssistantMessage — errors and retries', () => {
  it('renders a failed turn as a banner beside the partial reply', () => {
    render(
      <AssistantMessage
        content="Here is the start"
        error={{ code: 'rate_limit', message: '429' }}
        isLastAssistantMessage
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText('Here is the start')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/Rate limited/);
    // One Try again, on the banner — not a second one in the hover actions.
    expect(screen.getAllByRole('button', { name: /Try again|Regenerate/ })).toHaveLength(1);
  });

  it('shows a quiet retry status while the provider backs off', () => {
    render(<AssistantMessage content="" isStreaming isLoading retrying={{ attempt: 2, delayMs: 3000 }} />);
    expect(screen.getByRole('status').textContent).toMatch(/Retrying \(attempt 2\)/);
  });
});
