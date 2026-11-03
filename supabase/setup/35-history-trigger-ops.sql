-- 35 — Toda gravação de operação passa pelo histórico.
create or replace trigger ec_history_ops after insert or update or delete on public.ec_operations
for each row execute function public.ec_log_history();
