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

O setup só cria a estrutura vazia e as permissões privadas. Não importa, apaga nem altera os dados atualmente salvos no navegador. O app ainda precisará receber a integração Supabase antes de sincronizar operações e prints.
