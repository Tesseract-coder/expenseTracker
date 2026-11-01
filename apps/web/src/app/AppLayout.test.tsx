import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesProvider } from '@/lib/preferences';
import { routes } from './router';

function renderAt(path: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ id: 'u1', email: 'me@example.com' }))),
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

  it('renders the five bottom-nav destinations', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    for (const label of ['Home', 'Transactions', 'Add', 'Reports', 'More']) {
      expect(nav.querySelector(`[aria-label="${label}"]`)).toBeInTheDocument();
    }
  });

  it('shows the route title and navigates', async () => {
    renderAt('/');
    fireEvent.click(screen.getByRole('link', { name: 'Reports' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Reports' })).toBeInTheDocument();
  });

  it('toggles privacy blur on the document', () => {
    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: 'Hide amounts' }));
    expect(document.documentElement).toHaveClass('privacy-blur');
    expect(screen.getAllByText('₹0.00')[0]).toHaveAttribute('data-money');
  });

  it('applies dark theme from More page', async () => {
    renderAt('/more');
    fireEvent.click(await screen.findByRole('radio', { name: 'Dark' }));
    expect(document.documentElement).toHaveClass('dark');
  });
});
