-- 36 — Toda gravação de ajustes (capital, tema, metas) passa pelo histórico.
create or replace trigger ec_history_state after insert or update or delete on public.ec_user_state
for each row execute function public.ec_log_history();
