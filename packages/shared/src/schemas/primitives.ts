import { z } from 'zod';
import { isIsoDate } from '../dates';

/** Upper bound for a single amount: ₹1,000 crore. Guards against typos and overflow. */
export const MAX_AMOUNT_PAISE = 1_000_00_00_000_00;

export const idSchema = z.string().min(1).max(64);
export const isoDateSchema = z.string().refine(isIsoDate, 'Must be a valid date (YYYY-MM-DD)');
export const paiseSchema = z
  .number()
  .int('Amount must be in whole paise')
  .positive('Amount must be greater than zero')
  .max(MAX_AMOUNT_PAISE, 'Amount is too large');
/** Signed paise (opening balances may be negative, e.g. credit card outstanding). */
export const signedPaiseSchema = z.number().int().min(-MAX_AMOUNT_PAISE).max(MAX_AMOUNT_PAISE);
export const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color like #0f766e');
export const iconSchema = z.string().regex(/^[a-z0-9-]{1,40}$/, 'Invalid icon name');
export const nameSchema = z.string().trim().min(1, 'Required').max(80, 'Too long');
export const noteSchema = z.string().trim().max(500, 'Too long');
