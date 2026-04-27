-- Si tu proyecto creo finance_settings antes de existir selected_period, ejecuta este archivo
-- en Supabase > SQL Editor (o: supabase db push si usas CLI).

alter table public.finance_settings
  add column if not exists selected_period text not null default to_char(now(), 'YYYY-MM');
