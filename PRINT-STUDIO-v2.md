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
`Ctrl+D` duplica, `Ctrl+S` baixa o PNG anotado, `Ctrl+Shift+S` **salva a análise**,
`?` abre a lista completa de atalhos.

### Prints separados, um cartão cada
Embaixo do palco fica a **tira de prints**: cada print é um cartão próprio, numerado,
com a nota e os selos `✎ n` (anotações), `✂` (recorte) e `ANÁLISE` (imagem editada
salva). As miniaturas já mostram o desenho aplicado. Clicar num cartão troca de print
sem perder o que foi feito no outro.

---

## 🔒 Nada é destrutivo

As anotações e o recorte ficam como **camadas** no registro do print
(`marks` e `crop` no IndexedDB). O arquivo original **nunca é regravado**:

- `👁` mostra a imagem limpa a qualquer momento; `↺ Limpar` remove tudo (e `Ctrl+Z` volta).
- `⬇ Baixar` oferece PNG anotado, JPG anotado ou o **original sem anotações**.
- ` Copiar` põe a imagem anotada na área de transferência.
- `💾 Salvar análise` cria **um registro separado** com a imagem editada
  (detalhes na seção abaixo) — o original fica como está.

Backups (`⬆ Exportar` / `⬇ Importar`) carregam as camadas junto. Um backup da v2
aberto na v1 continua funcionando (a v1 simplesmente ignora `marks`/`crop`).

## 💾 Salvar análise (a imagem editada vira um print separado)

Quando você termina de desenhar/recortar e quer guardar aquele resultado como imagem
de verdade, clique em **💾 Salvar análise** (ou `Ctrl+Shift+S`). O que acontece:

1. As camadas são **achatadas** num JPEG novo (qualidade 0,92), já com o recorte aplicado.
2. Esse JPEG é gravado como **outro print**, com `kind:'analise'`, nome
   `…_analise.jpg` e `parentId` apontando para o print de origem.
3. A análise entra **no mesmo lugar do original**: se o print veio do formulário,
   vai para o rascunho aberto; se veio de uma operação, é anexada a ela; se veio da
   galeria, aparece no topo da galeria. O estúdio já abre a análise salva.
4. **O original não é tocado** — continua com o arquivo dele e com as camadas
   reversíveis (`👁` mostra limpo, `↺ Limpar` desfaz tudo).

Como saber qual é qual:

| Onde | Original | Análise |
|---|---|---|
| Tira de prints | selo `✎ n` / `✂` | selo roxo **ANÁLISE** + contorno roxo |
| Cartão na galeria / formulário | contorno âmbar | selo roxo **ANÁLISE** + contorno roxo, convite “Editar análise” |
| Filtro da galeria | “Com desenho/recorte (v2)” | **“💾 Análises salvas”** |
| Painel de informações | — | “💾 **ANÁLISE** — imagem editada salva separada em <data>” |
| Botão do estúdio | 💾 Salvar análise | 💾 **Atualizar análise** |

Editou de novo uma análise? O botão passa a **Atualizar análise**: ele **regrava o
mesmo registro** (as camadas viram pixels do arquivo dela), então você não acumula
uma pilha de cópias a cada ajuste. Se quiser uma cópia nova em vez de atualizar,
abra o print original e salve de novo — cada análise é um registro independente.

A categoria viaja no **backup** (`kind` no JSON dos prints) e o **zip** de
“Baixar todos” marca no `_indice.txt` quais arquivos são análises e de qual print
elas vieram.

## Onde as anotações aparecem
- Miniaturas do formulário, do detalhe da operação e da **Galeria de Prints**
  (com selo e contorno âmbar); filtros novos “Com desenho/recorte (v2)” e
  “💾 Análises salvas”.
- **PDF do relatório**: prints anotados entram já com o desenho aplicado.
- **⬇ Baixar todos** (zip): cada print anotado sai como `_anotado.jpg`, e o
  `_indice.txt` lista quantas camadas cada um tem.
- Configurações → Galeria de Prints → botão **🎨 Estúdio de prints** abre direto
  no print mais recente.

## Testes
`npm run test:studio` (ou `npm test`, que roda tudo) cobre:
geometria/validação/zoom do núcleo puro, a garantia de que a v1 ficou intacta,
e uma integração em jsdom que abre o estúdio, desenha, desfaz, recorta, salva,
exporta, reimporta, **salva a análise como print separado** (categoria, selo, filtro,
backup e atualização no lugar sem criar cópia extra) e exclui prints.
