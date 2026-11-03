-- 37 — Toda gravação de print (registro, não o arquivo) passa pelo histórico.
create or replace trigger ec_history_shots after insert or update or delete on public.ec_shots
for each row execute function public.ec_log_history();
