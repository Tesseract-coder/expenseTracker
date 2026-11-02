-- Hand-written (drizzle-kit generate --custom): reporting view, see docs/DATA_MODEL.md §4.
-- One row per categorized amount: split parts are exploded, transfers kept (kind = 'transfer').
-- kind:         income | need | want | investment | transfer | uncategorized
-- signed_paise: +amount for money in, -amount for money out
-- spend_paise:  contribution to "spend" — needs/wants net of refunds, plus uncategorized outflow
CREATE VIEW `v_ledger` AS
SELECT
  t.user_id,
  t.id AS txn_id,
  t.account_id,
  t.txn_date,
  t.week_start,
  t.dow,
  t.direction,
  t.counterparty_id,
  c.id AS category_id,
  COALESCE(c.parent_id, c.id) AS group_id,
  COALESCE(s.amount_paise, t.amount_paise) AS amount_paise,
  CASE
    WHEN c.system_key = 'uncategorized' THEN 'uncategorized'
    WHEN c.type = 'expense_need' THEN 'need'
    WHEN c.type = 'expense_want' THEN 'want'
    ELSE c.type
  END AS kind,
  CASE t.direction WHEN 'in' THEN 1 ELSE -1 END * COALESCE(s.amount_paise, t.amount_paise) AS signed_paise,
  CASE
    WHEN c.system_key = 'uncategorized' THEN
      CASE t.direction WHEN 'out' THEN COALESCE(s.amount_paise, t.amount_paise) ELSE 0 END
    WHEN c.type IN ('expense_need', 'expense_want') THEN
      CASE t.direction WHEN 'out' THEN 1 ELSE -1 END * COALESCE(s.amount_paise, t.amount_paise)
    ELSE 0
  END AS spend_paise
FROM transactions t
LEFT JOIN transaction_splits s ON s.transaction_id = t.id AND t.is_split = 1
JOIN categories c ON c.id = COALESCE(s.category_id, t.category_id);
