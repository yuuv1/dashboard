# App online + dados iguais no PC e no celular

## Site oficial (já publicado)

**https://yuuv1.github.io/dashboard/** — GitHub Pages, com PWA instalável e Supabase ligado.

### Alternativa: Netlify Drop

1. Rode `npm run build:public` (refaz `_public/` a partir do app atual).
2. Abra https://app.netlify.com/drop
3. Arraste a pasta `_public`
4. Use o link `https://….netlify.app` no PC e no celular

Detalhe: `_public/LEIA-ME.txt`

## Dados (nuvem)

Recomendado hoje: **Configurações → ☁️ Supabase** (login por e-mail, prints em Storage privado).
Veja `supabase/README.md`.

Alternativa antiga (GitHub): o site só hospeda o programa. O diário vai para `cloud/edgecontrol-sync.json` neste repositório.

No app: **Configurações → Nuvem GitHub** → token `repo` nos dois aparelhos → **Enviar** no PC → **Trazer** no celular.

Último envio ganha. Se falhar por tamanho, desligue “Incluir prints”.

## Backup por e-mail (opcional)

Além da nuvem, o app envia o backup do **período completo** (com os prints)
para o seu e-mail, num cartão próprio em Configurações.
Montagem: **ferramentas/email-backup/LEIA-ME.md** · projeto: **EMAIL-BACKUP.md** (esta pasta `docs/`).
