# EdgeControl — PWA

Diário de trade e gestão de risco para **opções binárias**, com canvas visual de setups.
Funciona **100% offline**, instala como aplicativo e guarda tudo no seu dispositivo.

---

## ⚠️ Importante: precisa de um servidor

PWA **não funciona** abrindo o `index.html` com duplo clique (`file://`).
Service Worker e módulos ES exigem `http://` ou `https://`. É simples resolver:

### Testar no computador (1 comando)

```bash
cd edgecontrol
python3 -m http.server 8080
```

Abra **http://localhost:8080** — pronto, já instala.

### Publicar de graça (para usar no celular)

Qualquer um destes serve, todos com HTTPS grátis:

| Serviço | Como |
|---|---|
| **Netlify Drop** | Arraste a pasta em [app.netlify.com/drop](https://app.netlify.com/drop) — 30 segundos, sem cadastro |
| **GitHub Pages** | Suba a pasta num repositório → Settings → Pages |
| **Cloudflare Pages** | Conecte o repositório, build vazio |
| **Vercel** | `npx vercel` dentro da pasta |

> Precisa ser **HTTPS** (ou localhost). Em `http://` puro o navegador bloqueia a instalação.

---

## 📲 Instalar como aplicativo

- **Android/Chrome** — aparece o banner "Instalar", ou menu ⋮ → *Adicionar à tela inicial*
- **iPhone/Safari** — botão Compartilhar → *Adicionar à Tela de Início*
  (no iOS só funciona pelo Safari, não pelo Chrome)
- **Desktop Chrome/Edge** — ícone de instalação na barra de endereço

Depois de instalado abre em janela própria, sem barra de navegador, e **funciona sem internet**.

---

## 📁 Estrutura

```
edgecontrol/
├── index.html              App completo
├── manifest.webmanifest    Identidade do PWA
├── sw.js                   Service Worker (offline)
├── css/
│   ├── app.css             Interface principal
│   ├── canvas.css          Quadro visual
│   └── pwa.css             Banners de instalação/atualização
├── js/
│   ├── db.js               IndexedDB (dados + imagens)
│   └── canvas.js           Motor do canvas
└── assets/
    ├── chart.umd.min.js    Chart.js local (sem CDN)
    ├── fonts.css + fonts/  Inter + Space Grotesk locais
    └── icons/              Ícones do app
```

Nada vem de CDN: abre offline no primeiro carregamento.

---

## 💾 Onde ficam os dados

Tudo em **IndexedDB**, no seu dispositivo. Nada sai do aparelho, não há servidor nem conta.

| Store | Conteúdo |
|---|---|
| `kv` | Perfil, configurações, operações |
| `boards` | Quadros do canvas |
| `blobs` | Imagens (prints) em formato binário |

**Migração automática:** se você já usava a versão antiga, os dados do `localStorage` são
importados sozinhos no primeiro acesso (o original fica guardado como `ec7_backup`).

**Faça backup.** Configurações → *Exportar Dados (JSON)*. O arquivo inclui operações,
quadros **e as imagens**. Desinstalar o app ou limpar os dados do site apaga tudo.

---

## 🗺️ Canvas — como usar

| Ação | Como |
|---|---|
| Adicionar print | Arraste a imagem para o quadro, ou **Ctrl+V** para colar |
| Nota | Botão 📝 ou tecla **N** |
| Vincular operação | Botão 📊 → escolha da sua lista real |
| Conectar dois nós | Arraste a **bolinha** na lateral direita até o outro nó |
| Rotular uma seta | Clique na seta ("causou", "confirmou"…) |
| Mover a tela | **Espaço + arrastar**, ou botão do meio do mouse |
| Zoom | Roda do mouse |
| Selecionar vários | Arraste no vazio, ou **Ctrl+A** |
| Desfazer / Refazer | **Ctrl+Z** / **Ctrl+Y** |
| Enquadrar tudo | Tecla **F** |
| Excluir | **Delete** |

### O nó de Setup se calcula sozinho

Crie um nó 🎯 **Setup**, conecte operações a ele, e o card passa a mostrar
**nº de ops, win rate e profit factor** daquele setup específico. É a forma de descobrir,
com dados, qual padrão realmente funciona pra você.

---

## 🔧 O que mudou nesta versão

### Correções na lógica financeira
- **Capital recalculado a partir das operações** — editar ou excluir uma op agora corrige o saldo (antes ficava dessincronizado para sempre)
- **Payout configurável**, global e por operação — não está mais travado em 80%
- **Ordenação cronológica real** — o gráfico não distorce mais ao registrar op retroativa
- **"Encerrar Dia" funciona** — arquiva o dia no histórico e zera as barras de risco (antes o botão só redesenhava a tela)
- Gráficos e números agora saem da mesma fonte de verdade

### Plataforma
- IndexedDB no lugar do localStorage (limite de ~5MB → centenas de MB)
- Offline completo, sem dependências externas
- Backup agora inclui quadros e imagens
- Responsivo de 360px a ultrawide; no celular a tabela vira cards e o menu vira gaveta

---

## ❓ Problemas comuns

**Não aparece "Instalar"** — precisa ser HTTPS ou localhost. No iOS, use o Safari.

**Atualizei os arquivos e não mudou nada** — o Service Worker guarda a versão antiga.
Altere `VERSION` no topo do `sw.js` (ex.: `v1.0.1`) e recarregue: aparece o aviso "Nova versão".

**Perdi meus dados** — se ainda não limpou o navegador, o backup da versão antiga pode estar
em `localStorage.ec7_backup`. Sempre exporte o JSON antes de trocar de aparelho.
