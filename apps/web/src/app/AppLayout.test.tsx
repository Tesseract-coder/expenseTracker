import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesProvider } from '@/lib/preferences';
import { routes } from './router';

const RESPONSES: Record<string, unknown> = {
  '/api/me': { id: 'u1', email: 'me@example.com' },
  '/api/accounts': {
    accounts: [
      {
        id: 'a1',
        name: 'Cash',
        type: 'cash',
        bank: null,
        last4: null,
        openingBalancePaise: 0,
        openingBalanceDate: '2026-01-01',
        color: '#16a34a',
        active: true,
        sortOrder: 0,
        balancePaise: 123456,
        txnCount: 0,
      },
    ],
  },
  '/api/categories': { categories: [] },
  '/api/transactions': { transactions: [], nextCursor: null },
  '/api/tags': { tags: [] },
  '/api/counterparties': { counterparties: [] },
};

function renderAt(path: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const key = Object.keys(RESPONSES).find((k) => url.split('?')[0] === k);
      return new Response(JSON.stringify(key ? RESPONSES[key] : {}), { status: key ? 200 : 404 });
    }),
  );
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <PreferencesProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </PreferencesProvider>,
  );
}

describe('app shell', () => {
  beforeEach(() => localStorage.clear());

  it('renders the bottom-nav destinations and the add button', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    for (const label of ['Home', 'Transactions', 'Reports', 'More']) {
      expect(nav.querySelector(`a[aria-label="${label}"]`)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Add transaction' })).toBeInTheDocument();
  });

  it('shows the route title and navigates', async () => {
    renderAt('/');
    fireEvent.click(screen.getByRole('link', { name: 'Reports' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Reports' })).toBeInTheDocument();
  });

  it('shows account balances in Indian format and blurs them in privacy mode', async () => {
    renderAt('/');
    const amounts = await screen.findAllByText('₹1,234.56');
    fireEvent.click(screen.getByRole('button', { name: 'Hide amounts' }));
    expect(document.documentElement).toHaveClass('privacy-blur');
    expect(amounts[0]).toHaveAttribute('data-money');
  });

  it('applies dark theme from More page', async () => {
    renderAt('/more');
    fireEvent.click(await screen.findByRole('radio', { name: 'Dark' }));
    expect(document.documentElement).toHaveClass('dark');
  });
});
