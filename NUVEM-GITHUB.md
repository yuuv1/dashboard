# App online + dados iguais no PC e no celular

## Site (grátis, 2 minutos)

Pasta pronta: **`_public/`**

1. https://app.netlify.com/drop
2. Arraste `_public`
3. Use o link `https://….netlify.app` no PC e no celular

Detalhe: `_public/LEIA-ME.txt`

## Dados (nuvem)

O Netlify só hospeda o programa. O diário vai para `cloud/edgecontrol-sync.json` neste repositório.

No app: **Configurações → Nuvem GitHub** → token `repo` nos dois aparelhos → **Enviar** no PC → **Trazer** no celular.

Último envio ganha. Se falhar por tamanho, desligue “Incluir prints”.

## Backup por e-mail (opcional)

Além da nuvem, o app envia o backup do **período completo** (com os prints)
para o seu e-mail, num cartão próprio em Configurações.
Montagem: **ferramentas/email-backup/LEIA-ME.md** · projeto: **EMAIL-BACKUP.md**.
