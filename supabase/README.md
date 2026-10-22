# Preparar o projeto Supabase

O editor deste projeto aceita **uma instrução SQL por execução** e não aceita blocos `DO`. Por isso, execute os arquivos abaixo um por vez, na ordem. Não cole todos juntos.

## Como executar

1. Abra [SQL Editor do projeto](https://supabase.com/dashboard/project/muktpljlzzavcvhqdxco/sql/new).
2. Abra o arquivo `01-create-user-state.sql` pelo índice no GitHub, copie o SQL e cole no editor.
3. Clique em **Run**. Quando terminar sem erro, apague o conteúdo do editor e repita com o próximo arquivo.
4. Continue em ordem até `13-policy-private-prints.sql`.
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

O setup só cria a estrutura vazia e as permissões privadas. Não importa, apaga nem altera os dados atualmente salvos no navegador.

## Integração do app

O app usa `runtime-config.js` com a Project URL e a publishable key (chave pública, própria para frontend). Nunca coloque `service_role` neste arquivo. `app-sync.js` usa a biblioteca oficial Supabase JS local em `vendor/`, para que o shell do PWA continue abrindo sem depender de um CDN.

No app publicado, abra **Configurações → Supabase — sincronização online**, informe seu e-mail e solicite o link de acesso. Ao abrir o link no mesmo aparelho, o app sincroniza o estado, operações e arquivos dos prints. A sincronização também tenta novamente ao salvar, ao voltar à internet, ao retornar para a aba e periodicamente enquanto o app está aberto. Falhas mantêm os dados locais e aparecem no status.

Na primeira conexão, se a conta estiver vazia, os dados locais são enviados. Se já houver dados na nuvem, operações diferentes são mescladas por ID; edições e exclusões locais pendentes usam timestamps para resolver o conflito, e prints ausentes são transferidos. O bucket de prints permanece privado por usuário.

Antes de sincronizar pela primeira vez, mantenha o backup JSON completo exportado do app até verificar operações e prints no segundo aparelho. A integração ainda não substitui esse backup de segurança.
