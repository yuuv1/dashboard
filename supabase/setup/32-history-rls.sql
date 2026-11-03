-- 32 — O histórico só existe para o servidor: nenhum aparelho lê nem apaga.
alter table public.ec_history enable row level security;
