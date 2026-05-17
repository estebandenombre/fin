-- Banco por defecto para preseleccionar en el formulario de gastos
alter table public.finance_settings
  add column if not exists default_bank_id bigint references public.finance_banks(id) on delete set null;
