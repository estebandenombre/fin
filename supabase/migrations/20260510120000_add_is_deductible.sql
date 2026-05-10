-- Marcar gastos como deducibles (fiscal / negocio)
alter table public.finance_transactions
  add column if not exists is_deductible boolean not null default false;
