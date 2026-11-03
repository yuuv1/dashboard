# Preparar o projeto Supabase

O editor deste projeto aceita **uma instrução SQL por execução** e não aceita blocos `DO`. Por isso, execute os arquivos abaixo um por vez, na ordem. Não cole todos juntos.

## Como executar

1. Abra [SQL Editor do projeto](https://supabase.com/dashboard/project/muktpljlzzavcvhqdxco/sql/new).
2. Abra o arquivo `01-create-user-state.sql` pelo índice no GitHub, copie o SQL e cole no editor.
3. Clique em **Run**. Quando terminar sem erro, apague o conteúdo do editor e repita com o próximo arquivo.
4. Continue em ordem até `30-grant-device-functions.sql`.
5. Se algum passo der erro, pare e anote o número do arquivo e a mensagem. Não repita os passos que já terminaram com sucesso.

## Ordem

1. `setup/01-create-user-state.sql`
2. `setup/02-create-operations.sql`
3. `setup/03-create-shots.sql`
4. `setup/04-enable-rls-user-state.sql`
5. `setup/05-enable-rls-operations.sql`
6. `setup/06-enable-rls-shots.sql`
7. `setup/07-policy-user-state.sql`
8. `setup/08-policy-operations.sql`
9. `setup/09-policy-shots.sql`
10. `setup/10-grant-schema-access.sql`
11. `setup/11-grant-table-access.sql`
12. `setup/12-create-private-print-bucket.sql`
13. `setup/13-policy-private-prints.sql`
14. `setup/14-revoke-anon-grants.sql`
15. `setup/15-create-accounts.sql`
16. `setup/16-create-members.sql`
17. `setup/17-create-pair-tries.sql`
18. `setup/18-enable-rls-accounts.sql`
19. `setup/19-enable-rls-members.sql`
20. `setup/20-enable-rls-pair-tries.sql`
21. `setup/21-policy-members-own-read.sql`
22. `setup/22-function-ec_home.sql`
23. `setup/23-function-ec_pair.sql`
24. `setup/24-function-ec_new_account.sql`
25. `setup/25-function-ec_code.sql`
26. `setup/26-policy-user-state-device.sql`
27. `setup/27-policy-operations-device.sql`
28. `setup/28-policy-shots-device.sql`
29. `setup/29-policy-prints-device.sql`
30. `setup/30-grant-device-functions.sql`

O setup só cria a estrutura vazia e as permissões privadas. Não importa, apaga nem altera os dados atualmente salvos no navegador.

## Estado do projeto publicado

Projeto: **`dashboard`** — ref `muktpljlzzavcvhqdxco`, região `us-east-1`.

| Item | Situação |
|---|---|
| `ec_user_state`, `ec_operations`, `ec_shots` | criadas, RLS ligada |
| Políticas | uma por tabela (`select auth.uid()`), só para `authenticated` |
| `anon` | sem nenhum privilégio nas tabelas (passo 14) |
| Bucket `edgecontrol-prints` | privado, 50 MB, só imagens |
| Login | e-mail (magic link) habilitado, confirmação de e-mail na primeira entrada |
| Site URL | `https://yuuv1.github.io/dashboard/` |
| Redirects permitidos | `https://yuuv1.github.io/dashboard/**`, `http://localhost:8080/**`, `http://localhost:3000/**` |

O app envia `emailRedirectTo` igual à página onde o link foi pedido, então o login volta
para o mesmo endereço (Pages, Netlify ou servidor local). **Ao trocar de domínio,
atualize a Site URL e a lista de redirects** em *Authentication → URL Configuration*,
senão o link do e-mail cai em `localhost`.

## Integração do app

O app usa `runtime-config.js` com a Project URL e a publishable key (chave pública, própria para frontend). Nunca coloque `service_role` neste arquivo. `app-sync.js` usa a biblioteca oficial Supabase JS local em `vendor/`, para que o shell do PWA continue abrindo sem depender de um CDN.

No app publicado, abra **Configurações → Supabase — sincronização online**, informe seu e-mail e solicite o link de acesso.

### Entrar em cada aparelho: código + PIN (sem e-mail)

Não é necessário e-mail, link nem senha. O modelo é:

1. **Conta:** existe um **código público** (`EC-XXXX-XXXX`) que identifica a conta em
   todos os aparelhos. Ele vive em `runtime-config.js` e pode ser lido por qualquer um —
   não é segredo.
2. **Aparelho:** cada navegador cria uma conta técnica própria (e-mail interno aleatório,
   `mailer_autoconfirm` ligado) — o usuário nunca vê isso.
3. **Pareamento:** o aparelho chama `ec_pair(código, PIN)`. Se o PIN bater com o hash em
   `ec_accounts`, entra uma linha em `ec_members` ligando aparelho → dono. A partir daí o
   RLS libera (e só então) as operações, o estado e os prints daquele dono.
4. **Da segunda vez em diante:** o app lembra o aparelho e sincroniza sozinho ao abrir.

No app: *Configurações → ☁️ Nuvem* → **código** (já vem preenchido) + **PIN de 6 números**
→ *Entrar neste aparelho*. O dono pode trocar o PIN em *“Trocar o PIN da conta”*.

### E-mail (opcional, só para o dono)

Quem é dono ainda pode entrar com **e-mail + senha** ou **link no e-mail** para criar/trocar
o PIN. No iPhone o link abre no Safari (sessão separada do app instalado) — por isso o
caminho recomendado em todo aparelho é **código + PIN**.

### Segurança do modelo

- `anon` não tem acesso a nada: tabelas, funções e bucket são fechados.
- O PIN é guardado com `crypt()` (bfcrypt) e **10 tentativas erradas em 15 min bloqueiam**
  o aparelho (`ec_pair_tries`).
- `ec_members` só é legível pelo próprio aparelho; as funções são `security definer` e
  `revoke` de `anon`.
- Trocar o PIN invalida novos pareamentos com o PIN antigo, mas **não** desliga aparelhos
  já pareados (para revogar, apague a linha em `ec_members`).

Depois de entrar, o app baixa as operações e os prints da nuvem e envia o que só existe nele. Ao abrir o link no mesmo aparelho, o app sincroniza o estado, operações e arquivos dos prints. A sincronização também tenta novamente ao salvar, ao voltar à internet, ao retornar para a aba e periodicamente enquanto o app está aberto. Falhas mantêm os dados locais e aparecem no status.

Na primeira conexão, se a conta estiver vazia, os dados locais são enviados. Se já houver dados na nuvem, operações diferentes são mescladas por ID; edições e exclusões locais pendentes usam timestamps para resolver o conflito, e prints ausentes são transferidos. O bucket de prints permanece privado por usuário.

Antes de sincronizar pela primeira vez, mantenha o backup JSON completo exportado do app até verificar operações e prints no segundo aparelho. A integração ainda não substitui esse backup de segurança.
