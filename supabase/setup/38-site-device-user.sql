-- 38 — Aparelho do site: um usuário compartilhado e MEMBRO da conta, para que
-- qualquer navegador que abra o painel fique conectado sem digitar nada.
-- ATENÇÃO: a senha dele fica pública no runtime-config.js — é de propósito,
-- porque a conta já aparece no painel. Ele é apenas membro: para cortar o
-- acesso de todos os navegadores de uma vez, apague a linha dele em ec_members.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values (
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  'site@edgecontrol.app',
  extensions.crypt('ecsite_9f4c2b71d85a3e60', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"name":"Aparelho do site"}'::jsonb,
  '', '', '', ''
)
on conflict (email) do update set encrypted_password = excluded.encrypted_password;
