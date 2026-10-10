import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { AuthSettings } from './AuthSettings';
import type { AuthStatus } from '../hooks/useAuthStatus';

const STATUS: AuthStatus = {
  ui_auth_enabled: true,
  ui_auth_forced_off: false,
  configured: true,
  authenticated: true,
  user: 'admin',
  mcp_token_required: false,
  mcp_token_env: false,
  api_token_required: false,
  api_token_env: false,
};

const mockFetch = (token: string) => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => (init?.method === 'POST' ? { token } : { users: ['admin'] }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

/** The settings block that belongs to one token, found by its title. */
const section = (title: string) => screen.getByText(title).parentElement!.parentElement!;

afterEach(() => vi.unstubAllGlobals());

test('generates an API token and shows it once (#156)', async () => {
  const fetchMock = mockFetch('secret-api-token');
  const onChanged = vi.fn();
  render(<AuthSettings status={STATUS} onChanged={onChanged} />);

  fireEvent.click(within(section('API token:')).getByText('Generate'));

  await waitFor(() => expect(screen.getByText('secret-api-token')).toBeInTheDocument());
  expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/api/auth/api-token') && init?.method === 'POST')).toBe(true);
  expect(onChanged).toHaveBeenCalled();
  // The MCP token has its own block and is untouched.
  expect(within(section('MCP token:')).queryByText('secret-api-token')).not.toBeInTheDocument();
});

test('an API token from the environment cannot be managed here', () => {
  mockFetch('unused');
  render(<AuthSettings status={{ ...STATUS, api_token_required: true, api_token_env: true }} onChanged={vi.fn()} />);

  const api = within(section('API token:'));
  expect(api.getByText('● From AUTH_API_TOKEN')).toBeInTheDocument();
  expect(api.queryByText('Generate')).not.toBeInTheDocument();
  expect(api.queryByText('Regenerate')).not.toBeInTheDocument();
});

test('an existing API token can be regenerated or removed', async () => {
  const fetchMock = mockFetch('unused');
  render(<AuthSettings status={{ ...STATUS, api_token_required: true }} onChanged={vi.fn()} />);

  const api = within(section('API token:'));
  expect(api.getByText('Regenerate')).toBeInTheDocument();
  fireEvent.click(api.getByText('Remove'));
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/api/auth/api-token') && init?.method === 'DELETE')).toBe(true));
});
