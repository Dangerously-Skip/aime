import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  waitForConnector,
  resolveConnectorRequest,
  pendingConnectorCount,
  CONNECTOR_REQUEST_TIMEOUT_MS,
} from './pending-connectors';

/**
 * This bridge is what lets the agent pause mid-task while the user connects a
 * service, then carry on in the same turn. The behaviour that matters is that a
 * timeout resolves rather than rejects — a rejection would surface to the model
 * as a tool error, when the truthful answer is simply "not connected".
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('waitForConnector / resolveConnectorRequest', () => {
  it('resolves with the outcome when the user connects', async () => {
    const promise = waitForConnector('t1');
    expect(resolveConnectorRequest('t1', { connected: true })).toBe(true);
    await expect(promise).resolves.toEqual({ connected: true });
  });

  it('resolves with a reason when the user declines', async () => {
    const promise = waitForConnector('t2');
    resolveConnectorRequest('t2', { connected: false, reason: 'The user declined to connect it.' });
    await expect(promise).resolves.toEqual({
      connected: false,
      reason: 'The user declined to connect it.',
    });
  });

  it('resolves as not-connected on timeout rather than rejecting', async () => {
    const promise = waitForConnector('t3');
    vi.advanceTimersByTime(CONNECTOR_REQUEST_TIMEOUT_MS + 1);
    // A rejection here would reach the model as a tool failure; "not connected"
    // is both true and actionable.
    await expect(promise).resolves.toMatchObject({ connected: false });
  });

  it('allows a longer wait than the question bridge — OAuth is human-paced', () => {
    expect(CONNECTOR_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(300_000);
  });

  it('returns false for an unknown id so the route can 404', () => {
    expect(resolveConnectorRequest('never-registered', { connected: true })).toBe(false);
  });

  it('does not resolve twice', async () => {
    const promise = waitForConnector('t4');
    expect(resolveConnectorRequest('t4', { connected: true })).toBe(true);
    expect(resolveConnectorRequest('t4', { connected: false })).toBe(false);
    await expect(promise).resolves.toEqual({ connected: true });
  });

  it('clears the timer on resolve, so a late tick cannot fire', async () => {
    const promise = waitForConnector('t5');
    resolveConnectorRequest('t5', { connected: true });
    await promise;
    vi.advanceTimersByTime(CONNECTOR_REQUEST_TIMEOUT_MS + 1);
    expect(pendingConnectorCount()).toBe(0);
  });

  it('keeps concurrent requests independent', async () => {
    const a = waitForConnector('a');
    const b = waitForConnector('b');
    expect(pendingConnectorCount()).toBe(2);

    resolveConnectorRequest('b', { connected: false, reason: 'nope' });
    await expect(b).resolves.toMatchObject({ connected: false });
    expect(pendingConnectorCount()).toBe(1);

    resolveConnectorRequest('a', { connected: true });
    await expect(a).resolves.toEqual({ connected: true });
    expect(pendingConnectorCount()).toBe(0);
  });

  it('frees the entry after a timeout', async () => {
    const promise = waitForConnector('t6');
    vi.advanceTimersByTime(CONNECTOR_REQUEST_TIMEOUT_MS + 1);
    await promise;
    expect(pendingConnectorCount()).toBe(0);
    // and a late answer is refused rather than resolving a dead promise
    expect(resolveConnectorRequest('t6', { connected: true })).toBe(false);
  });
});
