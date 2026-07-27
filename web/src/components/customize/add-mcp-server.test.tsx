// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { AddMcpServer } from './add-mcp-server';

/**
 * The DCR flow itself is stubbed (it opens a browser window); the URL guard and
 * name derivation run for real, because refusing a hostile URL before the flow
 * starts is the behaviour worth asserting.
 */

const runMcpOAuthFlow = vi.fn();
vi.mock('@/lib/mcp/oauth-flow', () => ({
  runMcpOAuthFlow: (...a: unknown[]) => runMcpOAuthFlow(...a),
}));

const onAdded = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  runMcpOAuthFlow.mockResolvedValue({ accessToken: 'at', expiresIn: 3600 });
});
afterEach(cleanup);

const openForm = () => {
  render(<AddMcpServer onAdded={onAdded} />);
  fireEvent.click(screen.getByText('Add MCP server'));
  return screen.getByLabelText('MCP server URL');
};

const type = (input: HTMLElement, value: string) =>
  fireEvent.change(input, { target: { value } });

describe('AddMcpServer — the happy path', () => {
  it('connects a vendor endpoint via DCR and reports the name used', async () => {
    const input = openForm();
    type(input, 'https://mcp.acme.com/mcp');

    expect(screen.getByText(/Will be added as/)).toBeTruthy();
    expect(screen.getByText('acme')).toBeTruthy();

    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(runMcpOAuthFlow).toHaveBeenCalledWith('acme', 'https://mcp.acme.com/mcp', {}));
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('acme'));
    expect(await screen.findByText(/Connected acme/)).toBeTruthy();
  });

  it('labels a local server so the user knows plaintext was intentional', async () => {
    const input = openForm();
    type(input, 'http://localhost:3000/mcp');
    expect(screen.getByText(/local server/)).toBeTruthy();
    expect((screen.getByText('Connect') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('AddMcpServer — refuses bad URLs before starting a flow', () => {
  const bad: Array<[string, RegExp]> = [
    ['http://169.254.169.254/latest/meta-data/', /link-local/i],
    ['http://10.0.0.5/mcp', /Use https/i],
    ['http://mcp.example.com/mcp', /Use https/i],
    ['file:///etc/passwd', /https/i],
    ['https://user:pw@mcp.example.com/mcp', /Remove the username/i],
    ['not a url', /not a valid URL/i],
  ];

  it.each(bad)('refuses %s and never calls the flow', async (url, message) => {
    const input = openForm();
    type(input, url);

    expect(screen.getByText(message)).toBeTruthy();
    expect((screen.getByText('Connect') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText('Connect'));
    await waitFor(() => expect(runMcpOAuthFlow).not.toHaveBeenCalled());
  });

  it('says nothing while the field is still empty', () => {
    openForm();
    expect(screen.queryByText(/not a valid URL/i)).toBeNull();
    expect((screen.getByText('Connect') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('AddMcpServer — failures', () => {
  it('explains a server without DCR in plain terms', async () => {
    runMcpOAuthFlow.mockRejectedValue(
      new Error('Server does not support Dynamic Client Registration'),
    );
    const input = openForm();
    type(input, 'https://mcp.acme.com/mcp');
    fireEvent.click(screen.getByText('Connect'));

    expect(await screen.findByText(/does not support automatic registration/)).toBeTruthy();
    expect(onAdded).not.toHaveBeenCalled();
  });

  it('surfaces any other failure and allows a retry', async () => {
    runMcpOAuthFlow.mockRejectedValue(new Error('Discovery failed: 404'));
    const input = openForm();
    type(input, 'https://mcp.acme.com/mcp');
    fireEvent.click(screen.getByText('Connect'));

    expect(await screen.findByText(/Discovery failed: 404/)).toBeTruthy();
    // still usable
    expect((screen.getByText('Connect') as HTMLButtonElement).disabled).toBe(false);
  });

  it('cancelling closes the form without connecting', async () => {
    const input = openForm();
    type(input, 'https://mcp.acme.com/mcp');
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.getByText('Add MCP server')).toBeTruthy();
    expect(runMcpOAuthFlow).not.toHaveBeenCalled();
  });
});

/**
 * The name shown here becomes the config key that the chat prompt and the
 * Connectors page read back as a connector identity, so a hostname that merely
 * *contains* a vendor's name must not be offered that vendor's name.
 */
describe('AddMcpServer — a lookalike host cannot borrow a built-in name', () => {
  const lookalikes: Array<[string, string]> = [
    ['https://mcp.github.evil.com/mcp', 'mcp-github-evil-com'],
    ['https://api.slack.attacker.net/mcp', 'api-slack-attacker-net'],
    ['https://mcp.notion.com.evil.io/mcp', 'mcp-notion-com-evil-io'],
    ['https://www.atlassian.badguy.dev/mcp', 'www-atlassian-badguy-dev'],
  ];

  it.each(lookalikes)('adds %s as %s', async (url, expected) => {
    const input = openForm();
    type(input, url);

    // the preview must show the honest name…
    expect(screen.getByText(expected)).toBeTruthy();
    fireEvent.click(screen.getByText('Connect'));
    // …and that is the name the flow is run under
    await waitFor(() => expect(runMcpOAuthFlow).toHaveBeenCalledWith(expected, url, {}));
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(expected));
  });

  it('still uses the canonical name for the vendor’s real endpoint', async () => {
    const input = openForm();
    type(input, 'https://mcp.atlassian.com/v1/mcp');
    expect(screen.getByText('atlassian')).toBeTruthy();
    fireEvent.click(screen.getByText('Connect'));
    await waitFor(() =>
      expect(runMcpOAuthFlow).toHaveBeenCalledWith('atlassian', 'https://mcp.atlassian.com/v1/mcp', {}),
    );
  });
});

describe('AddMcpServer — a name already taken by another origin', () => {
  it('retries under a host-specific name instead of joining someone else’s server', async () => {
    // Setup refuses the friendly name because `acme` already points at
    // https://mcp.acme.com. Silently reusing it would show the user vendor A's
    // consent screen for a URL they never typed, so we re-run under a name that
    // is unique to this origin.
    runMcpOAuthFlow.mockRejectedValueOnce(
      new Error(
        '“acme” is already connected to a different server (https://mcp.acme.com). Disconnect it first, or add this one under another name.',
      ),
    );
    const input = openForm();
    type(input, 'https://acme.io/mcp');
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(runMcpOAuthFlow).toHaveBeenCalledTimes(2));
    expect(runMcpOAuthFlow).toHaveBeenNthCalledWith(1, 'acme', 'https://acme.io/mcp', {});
    expect(runMcpOAuthFlow).toHaveBeenNthCalledWith(2, 'acme-io', 'https://acme.io/mcp', {});
    expect(await screen.findByText(/Connected acme-io/)).toBeTruthy();
    expect(onAdded).toHaveBeenCalledWith('acme-io');
  });

  it('reports the conflict when even the host-specific name is taken', async () => {
    runMcpOAuthFlow.mockRejectedValue(
      new Error('“acme” is already connected to a different server (https://mcp.acme.com).'),
    );
    const input = openForm();
    type(input, 'https://acme.io/mcp');
    fireEvent.click(screen.getByText('Connect'));

    expect(await screen.findByText(/already connected to a different server/)).toBeTruthy();
    expect(onAdded).not.toHaveBeenCalled();
  });

  it('does not retry an unrelated failure', async () => {
    runMcpOAuthFlow.mockRejectedValue(new Error('Discovery failed: 404'));
    const input = openForm();
    type(input, 'https://acme.io/mcp');
    fireEvent.click(screen.getByText('Connect'));

    expect(await screen.findByText(/Discovery failed: 404/)).toBeTruthy();
    expect(runMcpOAuthFlow).toHaveBeenCalledTimes(1);
  });
});
