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
