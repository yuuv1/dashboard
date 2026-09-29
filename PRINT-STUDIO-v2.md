# 🎨 EdgeControl v2 — Estúdio de Prints

**Arquivo novo:** `edgecontrol-glass-v2.html`
**Arquivo antigo:** `edgecontrol-glass.html` — **não foi alterado em nada**. As duas versões
convivem na mesma pasta e compartilham os mesmos dados (mesmo `localStorage` e o mesmo
IndexedDB `edgecontrol_media`), então seus prints, operações e anotações aparecem nas duas.

> Digite `EC_BUILD` no console para saber qual versão está aberta.
> A v2 também mostra um selo **v2** na marca lateral e no breadcrumb.

---

## O que mudou no jeito de ver prints

Na v1, clicar num print abria um visor simples (imagem + nota + anterior/próximo).
Na v2 o mesmo clique abre o **Estúdio de Prints**: um palco escuro, em tela cheia,
com **um print isolado por vez**, ferramentas de marcação no estilo Lightshot e
zoom de verdade.

### Zoom e navegação
- Roda do mouse dá zoom **no ponto onde o cursor está** (5% a 800%).
- Pinça com dois dedos no toque; barra de espaço + arrastar (ou ferramenta ✥) para panorâmica.
- `⤢` ajusta à tela, `1:1` volta ao tamanho real, `0` e `1` nos atalhos.
- Duplo clique amplia no ponto; `+` / `−` em passos.

### Ferramentas (trilho à esquerda)
| Tecla | Ferramenta | Tecla | Ferramenta |
|---|---|---|---|
| V | Selecionar / mover / redimensionar | P | Lápis (desenho livre) |
| H | Mover a imagem | M | Marca-texto |
| C | Recortar (reversível) | T | Texto (clique e digite) |
| R | Retângulo (Shift = quadrado) | B | Desfoque (esconder dados) |
| O | Elipse | N | Marcador numerado (1, 2, 3…) |
| A | Seta | X | Apagar a anotação clicada |
| L | Linha | G / 👁 | Mostrar só o original |

Painel à direita: cor (10 cores + seletor livre), espessura, opacidade, preenchimento,
tamanho/negrito/contorno do texto, **lista de anotações** (clique para selecionar e
centralizar; ✕ apaga) e a **nota do print**.

Edição: `Ctrl+Z` desfaz, `Ctrl+Shift+Z` refaz, `Delete` apaga a seleção,
`Ctrl+D` duplica, `Ctrl+S` baixa o PNG anotado, `?` abre a lista completa de atalhos.

### Prints separados, um cartão cada
Embaixo do palco fica a **tira de prints**: cada print é um cartão próprio, numerado,
com a nota e os selos `✎ n` (anotações) e `✂` (recorte). As miniaturas já mostram o
desenho aplicado. Clicar num cartão troca de print sem perder o que foi feito no outro.

---

## 🔒 Nada é destrutivo

As anotações e o recorte ficam como **camadas** no registro do print
(`marks` e `crop` no IndexedDB). O arquivo original **nunca é regravado**:

- `👁` mostra a imagem limpa a qualquer momento; `↺ Limpar` remove tudo (e `Ctrl+Z` volta).
- `⬇ Baixar` oferece PNG anotado, JPG anotado ou o **original sem anotações**.
- ` Copiar` põe a imagem anotada na área de transferência.
- `🧩 Novo print` cria **um registro separado**, já achatado, ligado ao original por
  `parentId` — entra no mesmo lugar do original (formulário, operação ou galeria).

Backups (`⬆ Exportar` / `⬇ Importar`) carregam as camadas junto. Um backup da v2
aberto na v1 continua funcionando (a v1 simplesmente ignora `marks`/`crop`).

## Onde as anotações aparecem
- Miniaturas do formulário, do detalhe da operação e da **Galeria de Prints**
  (com selo e contorno âmbar); filtro novo “Com desenho/recorte (v2)”.
- **PDF do relatório**: prints anotados entram já com o desenho aplicado.
- **⬇ Baixar todos** (zip): cada print anotado sai como `_anotado.jpg`, e o
  `_indice.txt` lista quantas camadas cada um tem.
- Configurações → Galeria de Prints → botão **🎨 Estúdio de prints** abre direto
  no print mais recente.

## Testes
`npm run test:studio` (ou `npm test`, que roda tudo) cobre:
geometria/validação/zoom do núcleo puro, a garantia de que a v1 ficou intacta,
e uma integração em jsdom que abre o estúdio, desenha, desfaz, recorta, salva,
exporta, reimporta e duplica prints.
