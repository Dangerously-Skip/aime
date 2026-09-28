// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FEEDBACK_ISSUES_URL, loadFeedbackWidget, openFeedback } from './feedback';

const widgetScripts = () =>
  Array.from(document.querySelectorAll('script')).filter((s) => s.src.includes('feedlybackly'));

beforeEach(() => {
  document.body.innerHTML = '';
  delete window.FeedlyBackly;
  delete window.feedlybacklySettings;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadFeedbackWidget', () => {
  it('injects no third-party script when no key is configured', () => {
    expect(loadFeedbackWidget(undefined)).toBe(false);
    expect(loadFeedbackWidget('')).toBe(false);
    expect(widgetScripts()).toHaveLength(0);
    expect(window.feedlybacklySettings).toBeUndefined();
  });

  it('injects the widget exactly once when a key is set', () => {
    expect(loadFeedbackWidget('fb_key')).toBe(true);
    expect(loadFeedbackWidget('fb_key')).toBe(true);
    expect(widgetScripts()).toHaveLength(1);
    expect(window.feedlybacklySettings?.apiKey).toBe('fb_key');
  });
});

describe('openFeedback', () => {
  it('opens GitHub Issues externally when there is no key (the normal OSS build)', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openFeedback({ apiKey: undefined })).toBe('issues');
    expect(open).toHaveBeenCalledWith(FEEDBACK_ISSUES_URL, '_blank', 'noopener,noreferrer');
    expect(FEEDBACK_ISSUES_URL).toBe('https://github.com/Dangerously-Skip/aime/issues/new');
  });

  it('falls back to Issues when the key is set but the widget never loaded', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openFeedback({ apiKey: 'fb_key' })).toBe('issues');
    expect(open).toHaveBeenCalledOnce();
  });

  it('opens the widget, with the user name, when it is loaded', () => {
    const open = vi.spyOn(window, 'open');
    const widget = { open: vi.fn(), close: vi.fn(), setUser: vi.fn(), setCustomData: vi.fn() };
    window.FeedlyBackly = widget;

    expect(openFeedback({ apiKey: 'fb_key', name: 'Ada' })).toBe('widget');
    expect(widget.setUser).toHaveBeenCalledWith({ name: 'Ada' });
    expect(widget.open).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });
});
