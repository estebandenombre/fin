-- Permite editar movimientos propios (RLS). Ejecutar en Supabase SQL si la BD ya existía.
drop policy if exists "Users can update own transactions" on public.finance_transactions;

create policy "Users can update own transactions"
  on public.finance_transactions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
