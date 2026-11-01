import { z } from 'zod';

// Single source of truth for enum values: used by Zod, Drizzle CHECK constraints and the UI.

export const DIRECTIONS = ['in', 'out'] as const;
export const ACCOUNT_TYPES = [
  'savings',
  'current',
  'credit_card',
  'cash',
  'wallet',
  'investment',
] as const;
export const BANKS = ['hdfc', 'icici', 'sbi', 'axis', 'kotak', 'other'] as const;
export const CATEGORY_TYPES = [
  'income',
  'expense_need',
  'expense_want',
  'investment',
  'transfer',
] as const;
export const SYSTEM_CATEGORY_KEYS = [
  'self_transfer',
  'cc_bill_payment',
  'opening_adjustment',
  'uncategorized',
  'atm_cash',
] as const;
export const CATEGORIZED_BY = ['manual', 'rule', 'learned', 'keyword', 'ai', 'none'] as const;
export const TXN_STATUSES = ['confirmed', 'needs_review'] as const;
export const TXN_SOURCES = ['manual', 'import', 'sms', 'email', 'restore'] as const;
export const CHANNELS = [
  'upi',
  'neft',
  'imps',
  'rtgs',
  'pos',
  'atm',
  'ach',
  'nach',
  'ecs',
  'card',
  'interest',
  'charges',
  'cash',
  'other',
] as const;
export const IMPORT_STATUSES = [
  'uploaded',
  'previewed',
  'committing',
  'committed',
  'failed',
  'reverted',
] as const;
export const IMPORT_SOURCES = ['file', 'sms', 'email'] as const;
export const RECURRING_CADENCES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const;
export const RECURRING_STATUSES = ['active', 'new', 'price_changed', 'stopped'] as const;

export const directionSchema = z.enum(DIRECTIONS);
export const accountTypeSchema = z.enum(ACCOUNT_TYPES);
export const bankSchema = z.enum(BANKS);
export const categoryTypeSchema = z.enum(CATEGORY_TYPES);
export const systemCategoryKeySchema = z.enum(SYSTEM_CATEGORY_KEYS);
export const categorizedBySchema = z.enum(CATEGORIZED_BY);
export const txnStatusSchema = z.enum(TXN_STATUSES);
export const txnSourceSchema = z.enum(TXN_SOURCES);
export const channelSchema = z.enum(CHANNELS);

export type AccountType = z.infer<typeof accountTypeSchema>;
export type Bank = z.infer<typeof bankSchema>;
export type CategoryType = z.infer<typeof categoryTypeSchema>;
export type SystemCategoryKey = z.infer<typeof systemCategoryKeySchema>;
export type CategorizedBy = z.infer<typeof categorizedBySchema>;
export type TxnStatus = z.infer<typeof txnStatusSchema>;
export type TxnSource = z.infer<typeof txnSourceSchema>;
export type Channel = z.infer<typeof channelSchema>;
