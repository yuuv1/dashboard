# EdgeControl online + o mesmo backup no PC e no celular

## 1. Site (domínio GitHub)

Depois do merge / Pages ativo:

`https://yuuv1.github.io/dashboard/`

Repo **privado** no plano Free não publica Pages. Opções: tornar o repo público **só com o HTML** (sem JSON de operações no git) ou GitHub Pro.

Abra **o mesmo link** no Chrome do PC e no Chrome/Safari do celular. No celular: menu → Instalar / Adicionar à Tela de Início.

O visual do computador **não muda**. No telefone só entra o bloco `@media (max-width: 820px)` que já existia.

## 2. Sincronizar dados (obrigatório para PC = celular)

GitHub Pages **não guarda** o seu diário. Cada aparelho tem o próprio `localStorage`. A nuvem usa a **API do GitHub** e grava `cloud/edgecontrol-sync.json` no repositório.

1. GitHub → Settings → Developer settings → Personal access tokens (classic)  
   Permissão **`repo`**. Cole o token **no PC e no celular** (Configurações → Nuvem GitHub).
2. Dono `yuuv1`, repositório `dashboard`, arquivo `cloud/edgecontrol-sync.json`.
3. Marque **Sincronizar sozinho ao salvar**.
4. No PC: use o painel normalmente → ele envia. No celular: abra o app (auto puxa) ou **Trazer da nuvem**.

O token **não** entra no JSON de exportar. Não compartilhe o token.

Prints deixam o arquivo enorme. Se o envio falhar, desligue **Incluir prints**.

## 3. Conflito

Último envio ganha. Não edite os dois aparelhos ao mesmo tempo sem enviar.
