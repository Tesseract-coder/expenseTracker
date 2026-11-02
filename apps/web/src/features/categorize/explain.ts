import type { TransactionDto } from '@kharcha/shared';

/** Plain-language "why is this categorized as X?" from categorized_by + categorization_reason. */
export function explainCategorization(
  t: Pick<TransactionDto, 'categorizedBy' | 'categorizationReason'>,
): string | null {
  const reason = t.categorizationReason ?? '';
  if (reason.startsWith('transfer:')) return 'Linked as a transfer between your accounts';
  switch (t.categorizedBy) {
    case 'manual':
      return 'Set by you';
    case 'rule':
      return `Your rule “${reason.replace(/^rule:/, '')}”`;
    case 'learned':
      return 'You categorized this payee before';
    case 'keyword': {
      const kw = reason.replace(/^keyword:/, '');
      if (kw.startsWith('channel:')) {
        const ch = kw.slice('channel:'.length);
        return ch === 'atm'
          ? 'ATM withdrawal'
          : ch === 'interest'
            ? 'Interest credit'
            : 'Bank charges';
      }
      return `Matched the keyword “${kw}”`;
    }
    case 'ai':
      return 'AI suggestion';
    default:
      return null;
  }
}
