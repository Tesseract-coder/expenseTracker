import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreferencesProvider } from '@/lib/preferences';
import { PasteAlertsPage } from './PasteAlertsPage';

const account = (id: string, name: string, last4: string | null, type = 'savings') => ({
  id,
  name,
  type,
  bank: 'hdfc',
  last4,
  openingBalancePaise: 0,
  openingBalanceDate: '2026-01-01',
  color: '#16a34a',
  active: true,
  sortOrder: 0,
  balancePaise: 0,
  txnCount: 0,
  parserProfileId: null,
});

function renderPage() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        accounts: [account('a1', 'HDFC Savings', '1234'), account('a2', 'Wallet', null, 'wallet')],
      }),
    ),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <PreferencesProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <PasteAlertsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </PreferencesProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('PasteAlertsPage', () => {
  it('reads pasted messages, matches accounts by last digits and lists ignored ones', async () => {
    renderPage();
    const box = await screen.findByLabelText('Bank messages');
    fireEvent.change(box, {
      target: {
        value: [
          'Sent Rs.420.00 From HDFC Bank A/C *1234 To SWIGGY On 01/10/26 Ref 427512340001',
          '',
          'Your OTP is 123456',
          '',
          'Rs 99 debited from A/c XX9999 to CHAI on 02-10-26',
        ].join('\n'),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Read messages' }));

    expect(await screen.findByText('2 transactions found')).toBeInTheDocument();
    expect(screen.getByLabelText<HTMLSelectElement>('Account for message 1').value).toBe('a1');
    expect(screen.getByLabelText<HTMLSelectElement>('Account for message 3').value).toBe('');
    expect(screen.getByRole('button', { name: 'Choose an account for 1' })).toBeDisabled();
    expect(screen.getByText('Ignored messages (1)')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Account for all unmatched messages'), {
      target: { value: 'a2' },
    });
    expect(screen.getByLabelText<HTMLSelectElement>('Account for message 3').value).toBe('a2');
    expect(screen.getByRole('button', { name: 'Check for duplicates' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove message 1' }));
    expect(screen.getByText('1 transaction found')).toBeInTheDocument();
  });

  it('explains when nothing looks like a transaction', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('Bank messages'), {
      target: { value: 'Your OTP is 123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Read messages' }));
    expect(screen.queryByText(/transactions? found/)).not.toBeInTheDocument();
  });
});
