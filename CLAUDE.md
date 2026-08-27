# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**HumWMS** — Mini WMS (Warehouse Management System) para Humana Alimentar. Aplicações HTML autônomas, sem etapa de build e sem dependências locais; a única peça com deploy próprio é o proxy CORS na Vercel.

- `index.html` (~373 KB) — Aplicação WMS principal
- `coletor_v3.html` (~315 KB) — App de coleta/separação standalone (sem Firebase)
- `coletor_endereco.html` (~65 KB) — PWA de endereçamento/transferência/consulta/liberação, fala direto com a API do ERP
- `coletor_endereco2.html` (~70 KB) — mesmo PWA acima, versão com Firebase Auth e módulo restrito de alteração
- `manifest-endereco.json`, `sw-endereco.js`, `icons/endereco-*.png` — manifest, service worker e ícones do PWA acima
- `proxy-erp/` — função na Vercel que faz a ponte CORS com o ERP (ver seção própria); é o único componente com deploy fora do GitHub Pages
- `backups/` — snapshots do endereçamento tirados antes de limpezas em massa (JSON cru do GET, permite recriar registros via POST)
- `API-Stock-v1.md` / `.pdf` — documentação oficial (fornecida pelo ERP) da API `crud-stock`
- `api_crud_stock_spec.md` — spec complementar da mesma API (fornecida pelo dev do ERP em 2026-06-23), com detalhes de comportamento (ex.: POST retorna `id_item_enderecamento`, log em `api_log`)

### O coletor de endereçamento — só duas cópias desde 26/08/2026

Existe **um** app de endereçamento: `coletor_endereco.html`, em duas cópias que devem ser mantidas idênticas (`WMS/coletor_endereco.html` local e a do repo git, publicada em `controlehumana.github.io/HumWMS/coletor_endereco.html`). É o que a operação usa no dia a dia.

**Tem Firebase Auth desde 26/08/2026** (login com e-mail corporativo cadastrado em Usuários), depois que o caso do endereço B 14 mostrou que o modal de nome digitado não permitia auditar nada. Entrar exige estar em `wms_users` com `active !== false`, sem módulo específico. **Liberar posição é aberta a qualquer operador logado** (decisão do usuário: o log em `wms_mov_log` resolve a rastreabilidade sem tirar agilidade do chão de fábrica), tanto pelo botão no fluxo principal quanto tocando numa posição ocupada na aba Consultar.

**O `coletor_endereco2.html` foi removido no commit `20abc71`.** Era a cópia de teste onde o login foi homologado; com o login na produção, a produção virou superconjunto dela (a única coisa exclusiva era a aba ✏️ Alterar, um fluxo restrito a `alterar_end` que fazia transferir e liberar, ou seja, menos do que o fluxo principal já faz). Manter a quarta cópia só produzia divergência silenciosa (chegou a ~293 linhas em julho de 2026) e, depois da auditoria, movimento fora do log. Se precisar homologar algo antes de soltar para a operação, publicar uma cópia temporária a partir da produção.

**Backups do estado anterior:** `backups/coletor_endereco_PROD_pre_login_2026-08-26.html` (exatamente o que rodava em produção antes do login) e `backups/coletor_endereco_LOCAL_pre_login_2026-08-26.html` (a cópia local antiga com Firebase que nunca foi publicada). Para rollback, é copiar o primeiro por cima e publicar.

**`coletor_v3.html`** é outro app (separação/picking, com PIN de supervisor e localStorage) e não tem relação com esse fluxo.

## Como executar

Abrir diretamente no navegador — não há servidor, build ou npm. Para desenvolvimento, use Live Server (VS Code) ou similar para hot-reload. Todas as dependências são carregadas via CDN.

## Arquitetura — index.html

### Single-file SPA

CSS inline no `<style>`, JS inline em `<script>`. A separação lógica é por funções nomeadas por domínio, não por arquivos.

### Dependências (CDN)

- Firebase compat SDK v10.12.2 — Auth + Firestore
- SheetJS `xlsx.full.min.js` — leitura de Excel na importação
- Google Fonts DM Sans + DM Mono

### Estado global `S`

Objeto único que centraliza a sessão do usuário:

```js
S = {
  user,        // firebase.User
  role,        // 'admin' | 'custom' | (legacy: 'operator' | 'viewer' | 'coletor')
  modules,     // string[] — módulos habilitados para role custom
  canColetor,  // bool — acesso ao módulo Coletor
  items,       // todos os itens do Firestore (wms_items)
  addresses,   // todos os endereços (wms_addresses)
  unaddressed  // itens sem endereço (wms_unaddressed)
}
```

### Navegação por abas

`showTab(tabId)` — ativa a aba e a página correspondente (`page` + PascalCase do tabId) e chama a função de render da página. Abas são exibidas/ocultadas conforme o role do usuário em `onAuthStateChanged`.

### Coleções Firestore

| Coleção | Chave | Conteúdo |
|---|---|---|
| `wms_users` | email | role, modules, canColetor, active |
| `wms_addresses` | `{RUA}_{pos}` | rua, pos, cap, active |
| `wms_items` | `{RUA}_{pos}_{i}` | sku, desc, lote, val, est, idEnd |
| `wms_unaddressed` | auto | sku, desc, lote, val, pendingAddr:true |
| `wms_import_log` | auto | timestamp, contagens da importação |
| `wms_limpeza_log` | auto | auditoria da limpeza de endereçamento (quem, escopo, registros apagados) |
| `coletor_lotes` | auto | ordens de separação |
| `coletor_pedidos` | auto | pedidos dentro de um lote |
| `coletor_logs` | auto | log de atividade por pedido |
| `coletor_divergencias` | auto | divergências registradas durante separação |

### Layout do armazém

- Ruas: `A` a `G`, `M`, `P` (`WMS_RUAS`) — grade fixa, não é mais só A-G desde 2026-07-06
- Posições: `1` a `40` (`WMS_POSES`)
- Chave de endereço: `addrKey(rua, pos)` → `"A_1"`, `"B_15"`, etc.

### Roles e permissões

- `admin` — acesso total a todas as abas e ações
- `custom` — acesso controlado pelo array `modules[]` gravado no documento do usuário
- Legado: `operator`, `viewer`, `coletor` — ainda suportados para compatibilidade

### Importação de estoque

Dois modos:
1. **Excel** (drag-and-drop) via SheetJS — recria endereços e itens
2. **API ERP** (`crud-stock/index.php`, ver abaixo) através do proxy próprio na Vercel — merge nos itens existentes. Auto-sync agendado para 10:00 e 17:00 (apenas admin).

Writes ao Firestore usam `db.batch()` em chunks de 400 (limite do Firestore).

### Integração com o ERP — API `crud-stock` (v1)

API CRUD completa sobre a tabela `t_item_enderecamento`. Documentação completa em `API-Stock-v1.md`/`.pdf`.

```
GET / POST / PUT / DELETE
https://gestao.humanaalimentar.com.br/erp/api/v1/human/crud-stock/index.php?token=WMS-TOKEN-STOCK-2026
```

Todas as chamadas passam por um proxy próprio na Vercel (CORS não configurado no servidor do ERP) — ver a seção do proxy abaixo. Até 2026-08-24 esse papel era do `corsproxy.io`, que desligou as URLs anônimas. Respostas de escrita (POST/PUT/DELETE) sempre trazem `{ sucesso, mensagem }`; GET retorna o array de itens (mesmos campos de antes: `item_id`, `item_codigo`, `item_descricao`, `numero_lote`, `dt_validade`, `saldo_aberto`, `estoque`, `rua`, `posicao`, `id_item_enderecamento`, `empresa_id`, `empresa_apelido`...).

**Helpers compartilhados** (em `index.html`, antes do módulo de Transferência): `_erpUrl()`, `_erpWrite(method, body)`, `_erpCreateEndereco(payload)` (POST), `_erpUpdateEndereco(payload)` (PUT), `_erpDeleteEndereco(idEnd)` (DELETE), `_brDateToIso(val)`.

- **Leitura (GET):** usada na sincronização manual (botão "Sincronizar") e automática (10h/17h). `parseApiData()` também captura `itemId`/`unidadeId` (= `item_id`/`empresa_id` da resposta) e grava nos itens do Firestore — são necessários para criar novos endereçamentos via POST.
- **Transferência (PUT):** botão "→ Transferir" nos cards do Mapa → modal de 2 passos com seletor de ação (`_transferAcao`, ver abaixo) → `_doTransfer()` envia `{ id_item_enderecamento, rua, posicao }` (apenas o destino) via PUT quando a ação é "transferir". Substituiu o antigo `transfer.php` (removido do projeto) — o PUT genérico do crud-stock já faz a mesma atualização sem precisar de endpoint customizado no ERP.
- **Adicionar novo endereço / split de lote (POST):** mesmo modal de Transferência, ação `_transferAcao = 'adicionar'` — cria um **novo** registro (`_erpCreateEndereco`) para o mesmo `item_id`+`lote`+`data_validade` numa posição diferente, **sem enviar `estoque`**, preservando o endereço original intacto. Usado quando o mesmo SKU+lote está fisicamente espalhado em mais de uma posição (pallets divididos). Mesma lógica espelhada em `coletor_endereco.html`/`coletor_endereco2.html` (variável `acaoDestino`, valores `'enderecar' | 'transferir' | 'adicionar'`, dentro do fluxo de busca por SKU). Ver "Múltiplas posições por SKU+lote" abaixo para a implicação no saldo exibido.
- **Cadastrar item pendente direto no card (POST):** botão "+ Cadastrar" em qualquer card do Mapa (livre ou ocupado) abre o modal `editAddrModal` → busca item na aba Pendências (`S.unaddressed`) por SKU/descrição → ao selecionar, cria o registro no ERP e grava em `wms_items`, removendo o doc de `wms_unaddressed` — mesma lógica do "Vincular" da aba Pendências (`assignConfirmBtn`), só que disparada a partir do próprio endereço no Mapa. Esse botão **substituiu** o antigo modal "Editar" (campos de texto livre pra sku/desc/lote/val/est): aquele só gravava no Firestore, nunca no ERP, e era sobrescrito silenciosamente a cada sincronização — ver `renderEditItemList`/`_cadastrarPendente`/`_showCadastroMsg`.
- **Excluir registro (DELETE):** dentro do mesmo modal `editAddrModal` ("Cadastrar"), cada item já endereçado com `idEnd` ganha um botão 🗑 que chama `_erpDeleteEndereco(idEnd)` (com confirmação, operação irreversível) e remove o doc correspondente no Firestore.

**Funções:** `openTransferModal(rua, pos)`, `_fillTransferPos()`, `_doTransfer()`, `_showTransferMsg(type, text)`, `_setTransferAcao(acao)`, `openEditModal(rua, pos)`, `_cadastrarPendente(it)`

### Proxy CORS próprio na Vercel (desde 2026-08-24) — substituiu o corsproxy.io

O servidor do ERP **não envia cabeçalhos CORS e responde 405 ao preflight OPTIONS**, então nenhuma chamada do navegador chega nele direto: sempre houve uma ponte no caminho. Em 2026-08-24 o `corsproxy.io` desligou as URLs anônimas e passou a responder `HTTP 403 {"error":"keyless_legacy_url"}`, derrubando de uma vez a sincronização, a limpeza de endereçamento e **todas as escritas dos coletores** (endereçar, transferir, liberar posição). O ERP em si estava intacto o tempo todo (GET direto responde 200).

Substituto: função própria em `proxy-erp/api/erp.js`, publicada na Vercel (conta `supportsolucoes`).

```
ERP_PROXY = 'https://humwms-proxy.vercel.app/api/erp?url='
```

O formato de chamada continua idêntico ao antigo (`ERP_PROXY + encodeURIComponent(urlDoErp)`), por isso a troca foi só a constante em `index.html`, `coletor_endereco.html` e `coletor_endereco2.html`, mais as dicas de `preconnect`/`dns-prefetch` nos dois coletores.

O que a função faz: repassa método, corpo e resposta sem alterar nada; acrescenta `Access-Control-Allow-Origin: *`, os métodos e o `Content-Type`/`X-API-TOKEN` permitidos; responde `204` ao preflight; manda `Cache-Control: no-store` (o corsproxy guardava GET por 1h e servia estoque velho, origem do `&_=${Date.now()}` que continua nas URLs de sync); e recusa qualquer destino fora de `gestao.humanaalimentar.com.br`, para não virar proxy aberto. Erro de rede vira `502 {sucesso:false, mensagem}`, formato que o app já sabe exibir.

`sw-endereco.js`: o handler genérico de `fetch` era stale-while-revalidate para todo GET, o que passaria a cachear também as respostas do proxy. Agora ele ignora `humwms-proxy.vercel.app` (saldo e posição têm que vir frescos) e o `CACHE_NAME` subiu para `coletor-endereco-v3`, descartando o que sobrou do proxy antigo.

**Para republicar o proxy:** `cd WMS/proxy-erp && npx vercel deploy --prod`. O código também está versionado em `proxy-erp/` no repositório.

**Melhoria em aberto:** hoje o token do ERP viaja dentro da URL montada pelo cliente, ou seja, continua visível no HTML público (era assim antes também, não é regressão). Como o proxy agora é nosso, dá para guardar o token numa variável de ambiente da Vercel e injetá-lo no servidor, tirando-o do HTML. Exige mexer em `_erpUrl()`/`erpUrl()` nos 3 arquivos.

**Alternativa definitiva:** se o dev do ERP habilitar CORS (`Access-Control-Allow-Origin` + resposta ao `OPTIONS`), o proxy pode sair do caminho por completo.

### Múltiplas posições por SKU+lote — `saldo_aberto` não é dividido por posição

Um mesmo `item_id`+`lote`+`data_validade` pode ter **várias linhas** em `t_item_enderecamento` (uma por posição física), cada uma com seu próprio `id_item_enderecamento` — confirmado em produção (ex.: itens de Bomba Enteral em várias posições da rua `P`).

**Armadilha:** o campo `saldo_aberto` retornado pelo GET é o **saldo total do lote**, calculado pelo ERP de forma independente e **replicado igual em toda linha** daquele item+lote — não é a quantidade daquela posição específica, e não soma entre posições. Quem é de fato por-posição é o campo bruto `estoque` (o que a gente escreve no POST/PUT). Ao criar um endereço extra pro mesmo lote (ação "adicionar", acima), **não enviamos `estoque`** — o ERP grava `0`/`null` nessa linha nova, enquanto a linha original mantém o valor real.

Isso significa que exibir `saldo_aberto` direto em cada posição de um lote dividido daria a falsa impressão de estoque multiplicado (ex.: 1792 em 3 posições parecendo 5376). A correção:
- **`index.html`**: `parseApiData()` também captura `estBruto` (= campo bruto `estoque` da API, separado de `est` = `saldo_aberto`). `renderCard()` só exibe o número na posição cujo `estBruto > 0` (a "principal"); as demais mostram `—` com um apontamento pra onde está o saldo real.
- **`coletor_endereco.html`/`coletor_endereco2.html`**: `estoqueAtual` já guarda a linha bruta da API (contém `estoque` nativamente), então `renderPosList()` aplica a mesma lógica direto em cima de `it.estoque`.

Ao adicionar qualquer exibição nova de saldo por posição, sempre checar se há "irmãos" (mesmo sku+lote+val em outra rua/pos) antes de mostrar o número cru.

**Cuidados conhecidos:**
- PUT/DELETE na API do ERP retornam `sucesso:true` mesmo quando o `id_item_enderecamento` não existe (não validam linhas afetadas) — não usar `sucesso` como prova de que algo de fato mudou.
- O proxy próprio manda `Cache-Control: no-store`; o `&_=${Date.now()}` das URLs de sync continua ali por garantia (herança do corsproxy.io, que cacheava GET por 1h).
- Toda chamada de escrita (POST/PUT/DELETE) é registrada pelo ERP na tabela `api_log` — útil para o dev do ERP investigar requisições perdidas ou divergências, caso algo pareça não ter persistido.
- PUT/DELETE por `item_id`+`unidade_id` (sem `id_item_enderecamento`) afeta **todas** as linhas daquele item+unidade de uma vez — perigoso quando o item tem múltiplas posições (ver acima). Preferir sempre `id_item_enderecamento` quando ele existir.

### Limpeza de endereçamento (reset em massa) — aba Importação, admin

Módulo para zerar o endereçamento quando a operação remaneja muitas posições de uma vez e os dados do ERP ficam sem relação com o físico. Fica no fim da página `pageImport` (aba **Importação**, que já é admin-only e sempre oculta para usuários de módulo).

**O que ele apaga e o que não apaga:** cada linha selecionada vira um `DELETE` em `t_item_enderecamento` (via `_erpDeleteEndereco`), o que remove o vínculo item↔posição **e** o campo `estoque` daquela linha. O `saldo_aberto` do ERP não é tocado (é calculado pelo ERP a partir das movimentações reais e não pertence a essa tabela), então o item volta a aparecer como **pendente de endereçamento** com o saldo intacto. Prova disso nos próprios dados: itens sem endereço vêm no GET com `saldo_aberto` cheio e `id_item_enderecamento` nulo.

**Escopo:** um `<select>` com cada rua individualmente ou `__ALL__` ("TODAS as ruas · limpeza geral"). A lista de ruas é montada de `WMS_RUAS` + ruas presentes em `S.items` + ruas presentes na resposta do GET (por isso ruas fora da grade fixa, como a `Q`, aparecem depois do "Analisar"). Só entram no escopo linhas **com** `id_item_enderecamento` — pendentes não têm o que apagar.

**Fluxo (3 travas antes de apagar):**
1. **Analisar** — GET ao vivo no ERP (nunca o Firestore, que pode estar defasado), monta KPIs (registros, posições, SKUs) e a tabela do que será apagado.
2. **Baixar backup** — gera `.xlsx` (legível, com aba Info) e `.json` cru com todos os campos, inclusive `id_item_enderecamento`/`item_id`/`empresa_id`, o que permite recriar tudo via POST se precisar voltar atrás. O botão de execução só destrava depois desse download.
3. **Palavra de confirmação** — digitar `LIMPAR <rua>` ou `LIMPAR TUDO` (case-insensitive). Só com backup **e** palavra certa o botão vermelho habilita.

Uma linha de dica abaixo do campo diz o que ainda falta (backup não baixado, palavra diferente) ou avisa que o botão está liberado. Ela existe porque na primeira vez em produção o operador digitou a palavra certa sem ter baixado o backup, o botão continuou morto e pareceu bug. A geração do backup também está em `try/catch`: se o Excel falhar, aparece a mensagem em vez de silêncio.

**Execução:** laço sequencial de DELETE com `sleep(120ms)` entre chamadas (não afogar o ERP), barra de progresso item a item, falhas coletadas sem interromper o laço. No fim:
- **Conferência por GET** — como PUT/DELETE do crud-stock retornam `sucesso:true` mesmo sem apagar nada, o número que vale é quantos registros ainda restam no escopo depois de tudo. Aparece no resultado.
- **Log de auditoria** em `wms_limpeza_log` (nova coleção): timestamp, e-mail do admin, escopo, contagens e o array `registros` com os dados de cada linha apagada (base para reconstrução manual).
- **`window._runAutoSync()`** para realinhar o Firestore (recria `wms_items`/`wms_unaddressed`, preserva `wms_addresses`, ou seja, a grade de endereços cadastrados sobrevive).

**Recomendação operacional:** rodar rua a rua, não `TODAS` de uma vez. Enquanto a rua limpa é reendereçada pelo coletor, as demais continuam válidas no mapa. Com `TODAS`, o armazém fica sem mapa até o último item ser reescaneado.

**Testado** (2026-08-24) com harness isolado que injeta o HTML e o JS reais do `index.html` com `fetch`/`_erpDeleteEndereco` stubados: caminho feliz (23/23, conferência 0 restantes), travas (palavra sem backup, palavra errada, minúscula), escopo `__ALL__` cruzando ruas e caminho de falha (23/30 com 7 erros listados por endereço/SKU, alerta amarelo, conferência batendo com as falhas). Nenhum DELETE real foi disparado.

### Impressão de cartazes de prateleira

Todos os fluxos de impressão montam folhas A4 paisagem (uma página por item) e compartilham dois helpers:
- `_cartazBlock(sku, desc, lote, val, rua, pos)` — monta o HTML de uma folha (`val` já formatado, ex. `formatDate(it.val)`).
- `_openCartazWindow(blocks)` — abre uma nova janela (`window.open`), injeta o CSS único do cartaz + os blocos, gera os códigos de barra via JsBarcode (CDN) e chama `window.print()` no `onload`.

Três pontos de entrada:
- `printCartaz(rua, pos)` — todos os itens de um endereço (botão "🖨 Cartaz" nos cards do Mapa).
- `printCartazManual(sku, desc, lote, val, rua, pos)` — cartaz avulso com dados digitados (modal "Novo Cartaz" na aba Pendentes), endereço opcional.
- `printCartazLote()` → `printCartazEnderecos(addrList)` — impressão em lote: pega os endereços já filtrados por `getFilteredAddresses()` (respeita Rua/Posição/Status/busca do Mapa), gera um cartaz por item de cada endereço ocupado. Acima de 60 folhas pede confirmação antes de abrir a janela de impressão. Botão "Imprimir cartazes" na barra de filtros do Mapa.

### Relatório "Lotes Divididos"

Aba dedicada (`data-tab="fragmentados"` / `pageFragmentados`) que lista todo SKU+lote+validade endereçado em mais de uma posição ao mesmo tempo — consequência direta do recurso "Adicionar novo endereço" (ver seção anterior). Objetivo: dar visibilidade pra decidir quando vale a pena consolidar o estoque fisicamente numa única posição (o sistema não faz a consolidação sozinho, só sinaliza).

- `getFragmentedGroups()` — agrupa `S.items` por `sku+lote+val`, retorna só grupos com >1 item. O saldo exibido (`g.items[0].est`) já é o total do lote (não somamos entre posições — ver a armadilha do `saldo_aberto` documentada acima).
- `renderFragmentados()` — desenha a tabela + KPIs (nº de lotes divididos, nº de posições extras).
- **Exportar Excel** (`btnExportFragExcel`) — mesmo padrão SheetJS das outras abas de relatório (Validades, Pendentes).
- **Exportar PDF** (`btnExportFragPdf`) — abre janela nova com tabela HTML simples e chama `window.print()` (usuário salva como PDF pelo diálogo do navegador) — mesmo padrão de `_openCartazWindow`, sem nova dependência.

## Arquitetura — coletor_v3.html

App standalone de coleta para separadores, **sem Firebase**. Projetado para uso em celular/coletor de código de barras.

### Persistência

localStorage com chave `coletor_sep_v2`. Estado sobrevive a reload; `hasMemory()` detecta sessão ativa.

### Segurança

PIN de supervisor com hash SHA-256 via Web Crypto API. Ações destrutivas (reset, divergência) exigem verificação do PIN.

### Fluxo de 3 etapas

1. Upload do arquivo de pedidos (Excel via SheetJS)
2. Separação item a item com leitura de código de barras
3. Conclusão e exportação do log

### Backup opcional

Endpoint configurável (`coletor_server_endpoint` no localStorage) para POST JSON do registro ao concluir. Falha silenciosa com timeout de 5s.

## Arquitetura — coletor_endereco.html / coletor_endereco2.html

App standalone mobile-first para endereçar/transferir/consultar/liberar posições, fala direto com a API `crud-stock` do ERP (mesma URL/token de `index.html`, helpers próprios `erpGetEstoque()`, `erpWrite()`/`erpCreateEndereco()`/`erpUpdateEndereco()`/`erpDeleteEndereco()`). Não há intermediário Firestore: o estado vive só em memória (`estoqueAtual`) durante a sessão, recarregado via botão "Atualizar". Os dois arquivos compartilham ~95% do código; a diferença é que `coletor_endereco2.html` tem **Firebase Auth** (login por e-mail/senha) e um módulo extra ✏️ Alterar restrito por permissão (`canAlterarEnd`), enquanto `coletor_endereco.html` (produção) é aberto, sem login nem permissões.

### Views (tabs), alternadas por `switchView(viewId)`

1. **📦 Endereçar / Transferir** — fluxo de 3 steps:
   - Step 1: busca por SKU ou EAN (`buscarSku()`) em **todo o estoque** (`estoqueAtual`), não só pendentes. Campo aceita digitação, leitor físico (Enter automático) ou câmera (botão `scanBtn`).
   - Step 2: `selecionarItem(item)` monta o resumo e, se o item já tem `rua`/`posicao` (`modoTransferencia=true`), mostra o seletor de ação (`acaoDestino`) e o botão "🗑 Liberar posição". `acaoDestino` pode ser `'transferir'` (**PUT** via `erpUpdateEndereco`, move o endereço existente), `'adicionar'` (**POST** sem `estoque`, cria posição extra pro mesmo lote — ver "Múltiplas posições por SKU+lote" na seção do `index.html`) ou `'enderecar'` (item pendente, sem endereço ainda → **POST** com o saldo cheio).
   - Step 3: `confirmarEnvio()` executa a ação escolhida e trata os 4 casos (inclusive `'remover'`, ver "Liberar posição" abaixo).
2. **📍 Consultar endereço** — dashboard vertical: chips de rua (`renderRuaChips()`) + lista das 40 posições (`renderPosList()`), livre/ocupado à primeira vista, com filtro por SKU/descrição/posição. Posições ocupadas são clicáveis (ver "Liberar posição" abaixo). A lista de ruas (`RUAS`) começa em `RUAS_BASE` (desde 2026-07-06: `A-G, M, P` — antes só `A-G`) e é recalculada (`atualizarListaRuas()`) a cada carga incluindo qualquer rua extra presente nos dados reais além da grade fixa (ex.: `Q`/`Z` ou outras que venham a surgir) — **não hardcodear só A-G**, o estoque real usa ruas fora da grade padrão original.
3. **✏️ Alterar** (só `coletor_endereco2.html`, permissão `alterar_end`) — módulo equivalente ao Step 2/3 acima (busca por SKU → transferir ou liberar), mas isolado numa aba própria e restrito por Firebase Auth. Fluxo paralelo com nomes prefixados `alt*` (`altBuscarSku`, `altSelecionarItem`, `irParaAltConfirmacao`, `altAcao`).

### Liberar posição (remover endereço no ERP)

Permite ao operador desvincular um item de uma posição no ERP (`erpDeleteEndereco(idEnd)` → DELETE em `t_item_enderecamento`) quando o produto acabou fisicamente — sem senha, só uma tela de confirmação com aviso de irreversibilidade (`acaoDestino`/`altAcao = 'remover'`). Ao confirmar, o item é removido de `estoqueAtual` (`splice`) e logado no histórico como ação "Liberação" (badge vermelho `.logBadge.del`).

Duas formas de chegar na liberação:
- **Pelo SKU** (fluxo normal): `prepararLiberacao()`/`prepararLiberacaoAlt()`, disparada pelo botão "🗑 Liberar posição" depois de buscar o item.
- **Pelo endereço** (2026-07-13, aba Consultar): o operador nem sempre lembra qual SKU ocupava a posição — só sabe que ela esvaziou. Tocar numa posição ocupada (`.posRow.occ`) chama `liberarPorEndereco(rua, pos)` / `liberarPorEnderecoAlt(rua, pos)`, que filtram `estoqueAtual` por rua+posição: com 1 item só, pula direto pra confirmação; com mais de um (lote dividido na mesma posição), mostra uma lista (`matchCard`) pra escolher qual liberar.

Em `coletor_endereco.html` (produção, sem permissões) tudo isso é aberto a qualquer operador. Em `coletor_endereco2.html`, tanto o botão quanto o clique na posição só ficam disponíveis pra quem tem `alterar_end` — sem a permissão, as posições da aba Consultar continuam só informativas (sem `cursor:pointer`/classe `.actionable`).

### Tratamento de erros

`erpWrite()` usa `timeoutSignal(ms)` em vez de `AbortSignal.timeout()` direto — alguns webviews/navegadores antigos usados em coletores de código de barras não implementam esse método nativo, e isso quebrava o envio com "AbortSignal.timeout is not a function". `mensagemErroAmigavel(e)` traduz erros técnicos (fetch/rede, HTTP 401/403/404/5xx, timeout) para mensagens em português que o operador do armazém entende, usada em todos os `catch` que exibem erro na UI (login, carregar estoque, confirmar envio, transferência).

### Scanner de câmera

Mesmo padrão de `index.html`: tenta `BarcodeDetector` nativo (Chrome Android) primeiro, com fallback para `html5-qrcode` carregado sob demanda via CDN. Busca aceita tanto `item_codigo` (SKU interno) quanto `item_ean13` (código real impresso/escaneado).

### Bomba Enteral sem endereço → posição guarda-chuva P/99

`normalizarBombaEnteral(lista)`, chamada logo após `erpGetEstoque()` em `carregarEstoque()`: qualquer item pendente (sem `rua`/`posicao`) cuja descrição contenha "BOMBA ENTERAL" recebe `rua='P'`/`posicao='99'` artificialmente. Mantém consistência com a mesma regra em `index.html` e evita que esses itens apareçam como pendentes de endereçamento (fisicamente já ficam soltos na rua P).

### PWA (instalável na tela inicial)

`manifest-endereco.json` + `sw-endereco.js` (cache stale-while-revalidate) + ícones em `icons/`. Linkado no `<head>` via `<link rel="manifest">` e `apple-touch-icon`/meta tags para iOS. **Cuidado:** por causa do service worker, depois de publicar uma mudança o celular pode mostrar a versão antiga na primeira abertura (atualiza em segundo plano) — só reflete de fato na abertura seguinte.

Em `sw-endereco.js`, sempre que um handler `fetch` faz `caches.put(request, resp.clone())`, o `.clone()` precisa ser chamado de forma síncrona **antes** de `return resp` (guardar em `const respClone = resp.clone()` fora do `.then()` de `caches.open`). Chamar `.clone()` dentro do `.then()` adiado causa `TypeError: Response body is already used` se a página já tiver começado a ler o body da resposta original.

### Camada visual apple-design (2026-07-20)

Aplicada nas **4 cópias** do coletor de endereçamento (não em `coletor_v3.html`, que é um app separado — ver seção própria acima). Padrão CSS puro, sem lib de animação JS (decisão deliberada: app de scanner de código de barras, sem gestos de arrastar, confiabilidade > efeito visual):

- **Feedback tátil instantâneo**: `button,.ruaChip,.matchCard{transition:transform .1s...}` + `:active{transform:scale(.96)}`, no toque e não na soltura. Na produção (`coletor_endereco.html`, sem Firebase) o seletor também inclui `.posRow.occ`, porque lá as posições ocupadas são clicáveis (fluxo "Liberar posição pelo endereço"); nas 2 cópias com Firebase essa mesma posição não é clicável ainda, então `.posRow` fica de fora do seletor nelas — se essa feature for portada pra lá, adicionar `.posRow.occ` ao CSS de feedback tátil também.
- **Transições materializadas**: `@keyframes materialIn` (fade + leve subida) em `.step.active`/`.view.active`, substituindo o corte seco de `display:none/block`.
- **Materiais translúcidos**: overlays (scanner nos 4 arquivos; login + info de usuário só nos 2 com Firebase) ganharam `backdrop-filter:blur()` no scrim + entrada com `materialIn`.
- **Tipografia**: tracking negativo no nome do app/contador de sessão, `font-variant-numeric:tabular-nums` em números (saldo, posição, contador de sessão).
- **Acessibilidade**: `@media (prefers-reduced-motion: reduce)` desliga as animações/transições novas; `@media (prefers-reduced-transparency: reduce)` troca o blur por fundo sólido nos overlays.

## Auditoria de endereçamento — `wms_mov_log` (26/08/2026)

**Origem:** pedido de rastrear quem liberou o endereço B 14 entre 24 e 26/08. Não deu para responder: o coletor de produção não tinha login (nome digitado, autodeclarado) e o histórico só existia em `localStorage` (`hum_log`), preso ao aparelho. O ERP loga toda escrita em `api_log`, mas sem identidade e sem acesso nosso.

**Coleção nova:** `wms_mov_log`, um documento por escrita bem-sucedida no ERP. Campos: `ts` (ISO UTC), `acao` (Endereçamento | Endereçamento adicional | Transferência | Liberação | Limpeza geral), `op`/`operador`, `email`, `origem` (`coletor` | `wms`), `sku`, `desc`, `lote`, `val`, `rua`/`pos` (destino), `de_rua`/`de_pos` (origem, só em transferência), `idEnd`, e no WMS também `metodo` e `payload`.

**Onde é alimentada:**
- `coletor_endereco.html` — em `appendLog()`, que já era o funil único do histórico local; agora chama `registrarMovFirestore()`.
- `index.html` — em `_erpWrite()`, o funil único de POST/PUT/DELETE, via `_registrarMov()`. Os wrappers (`_erpCreateEndereco`/`_erpUpdateEndereco`/`_erpDeleteEndereco`) ganharam um 2º parâmetro `ctx` com o contexto legível (SKU, descrição, lote, de/para), passado nos 6 pontos de escrita, inclusive na limpeza geral.

**Regra de ouro:** o log **nunca** bloqueia nem derruba a operação. É `add()` sem `await`, com `.catch()` que só avisa no console. Se o Firestore recusar, a gravação no ERP já aconteceu e o operador não é interrompido.

**Cuidado com `undefined`:** o Firestore recusa campos `undefined` e os payloads do ERP usam `|| undefined` para omitir lote/validade — por isso `_semUndefined()` limpa o payload antes de gravar. Ao adicionar campos novos ao log, manter esse cuidado.

**Onde se consulta:** aba **Auditoria** no `index.html` (módulo `auditoria` em `WMS_MODULES`; admin vê sempre). Filtros por período, rua, posição, ação, operador e SKU, com export CSV. Rua e posição casam **tanto na origem quanto no destino** — procurando B 14, aparece o que entrou lá e o que saiu de lá, que é justamente o que a pergunta original exigia.

**Fuso:** `ts` é gravado em UTC, mas o filtro de data pensa em dia de Brasília — `_audLimite()` monta o intervalo a partir da meia-noite local, não da string de data crua. Não trocar por concatenação de `T00:00:00Z`.

**Regras do Firestore:** `wms_mov_log` precisa aceitar `create` de usuário autenticado e `read` para quem consulta a aba. Se as regras do projeto forem do tipo `allow read, write: if request.auth != null`, já funciona sem mexer em nada; se forem por coleção, adicionar a nova. Sintoma de regra faltando: nada aparece na aba Auditoria e o console mostra `[WMS] log central falhou: Missing or insufficient permissions`.

**Cobertura:** só vale para o que acontecer a partir da publicação. Para o que veio antes, o que existe é `wms_limpeza_log` (limpeza geral de 24/08), sem tela no `index.html` — foi criada a página avulsa `consulta_log_limpeza.html` para ler essa coleção com login.

## Regras do Firestore — allowlist por coleção (`firestore.rules`)

**A armadilha:** as regras deste projeto não têm um `match /{document=**}` genérico. Cada coleção é listada uma a uma, e **o que não está listado é negado**. Criar uma coleção nova no código não basta: sem entrar nas regras, a tela que a lê mostra `Missing or insufficient permissions` e a gravação falha calada. Foi exatamente o que aconteceu com `wms_mov_log` em 26/08/2026, entre publicar a aba Auditoria e ela funcionar.

**Onde vive:** `WMS/firestore.rules`, versionado. O que está no ar antes de cada publicação é salvo em `WMS/backups/firestore_rules_*.rules`.

**Como publicar:**
```
set FIREBASE_SA=C:\caminho\para\service-account.json
node publicar-regras.js
```
O script guarda o backup, cria o ruleset novo e aponta o release `cloud.firestore` para ele. Para voltar atrás, republicar o conteúdo do backup. Não existe dependência de npm: o JWT é assinado com o `crypto` do Node.

**Papéis:** `isWhitelisted()` (existe em `wms_users`), `isOperator()` (não é viewer), `isAdmin()` (`role == 'admin'`) e `podeAuditar()` (admin ou módulo `auditoria`).

**Regra dos logs:** `wms_mov_log` e `wms_limpeza_log` aceitam `create`, nunca `update` nem `delete`. Não trocar por `allow write`: um log que o próprio operador pode alterar ou apagar não prova nada, e a coleção existe justamente para provar quem mexeu em cada posição.

## Redefinição de senha por administrador — `proxy-erp/api/senha.js`

**Por que no servidor:** o Firebase no navegador só deixa alguém mexer na própria senha. Definir a senha de outra pessoa exige o Admin SDK, cuja credencial não pode viver no `index.html` (a página é pública no GitHub Pages). A função roda na Vercel, no mesmo projeto `humwms-proxy` do proxy do ERP.

**Contrato:** `POST /api/senha` com `{ idToken, email, novaSenha }`. O e-mail de quem pede sai do `idToken` verificado no servidor, **nunca** do corpo da requisição, e o Firestore precisa reconhecer esse e-mail como `role: 'admin'` e ativo. Se a conta alvo não existir no Auth, é criada com a senha informada.

**Efeito colateral proposital:** toda senha definida por terceiro grava `mustChangePassword: true`, e o coletor bloqueia o app numa tela de troca até a pessoa criar a dela. Senha entregue por outra pessoa não identifica ninguém no log.

**Credencial:** variável `FIREBASE_SERVICE_ACCOUNT` no projeto da Vercel, com o JSON da conta de serviço em uma linha. Sem ela a função responde 503 dizendo o que falta, em vez de estourar erro técnico. Ela **não** está no repositório e é a mesma chave que o `publicar-regras.js` usa. Republicar a função: `cd proxy-erp && npx vercel deploy --prod --yes --scope support-solucoes` (sem `--scope` o CLI desta máquina devolve `Not authorized`).

**Três provedores de login convivem no projeto:** o `index.html` entra só com Google (`signInWithPopup`), o coletor entra só com e-mail e senha, e a conta de quem sempre usou Google **não tem senha nenhuma** — daí o `linkWithCredential` no botão "Minha senha do coletor". O projeto também tem proteção contra enumeração de e-mail ligada, então `sendPasswordResetEmail` responde sucesso mesmo quando não há conta com senha para redefinir, e `fetchSignInMethodsForEmail`/`createAuthUri` não revelam provedores. Não confiar nessas respostas para diagnosticar conta.

## Publicação

O diretório `WMS/` local **não é um repositório git**. Repositório: `https://github.com/controlehumana/HumWMS` — publicado via GitHub Pages em `https://controlehumana.github.io/HumWMS/`.

**Fluxo:** clonar pra pasta temporária (`C:\Users\caio.zinsly\Documents\HumWMS_git`) → copiar o(s) arquivo(s) modificado(s) → configurar identidade git local do clone (`git config user.name "Caio Zinsly"` / `user.email "hu14997204703@gmail.com"`, não é a config global) → commit → `push origin main` → remover a pasta temporária (se falhar com "device or resource busy", não é problema — só clonar de novo na próxima vez, o `git pull` implícito do clone atualiza).


**Autenticação do push (descoberto em 2026-08-24):** o `gh` desta máquina está logado como `supportsolucoes`, que **não tem permissão de escrita** neste repositório — o push devolve `403 Permission denied`. Quem tem acesso é a conta `controlehumana`, cuja credencial está guardada no Git Credential Manager do Windows. Por isso clonar com o usuário embutido na URL: `git clone https://controlehumana@github.com/controlehumana/HumWMS.git`. Não configurar `credential.helper "!gh auth git-credential"` neste clone, que força a conta errada. Se o push ficar pendurado sem saída nem erro, é o Credential Manager esperando um prompt gráfico na tela do usuário: encerrar `git-credential-manager.exe` e refazer o push com a URL acima.

**Cuidado com o coletor de endereçamento**: ver seção "O coletor de endereçamento" no topo. Desde 26/08/2026 é uma cópia só (local + git da mesma versão), então publicar é copiar e commitar; o que exigia replicar a mesma mudança em 4 arquivos deixou de existir com a remoção do `coletor_endereco2.html`.

**GitHub Pages falha às vezes de forma transitória:** o job "pages build and deployment" no Actions pode terminar com `conclusion: failure` mesmo com o build (Jekyll) OK — a etapa "Deploy to GitHub Pages" retorna erro genérico `Deployment failed, try again later`, não relacionado ao conteúdo publicado. Verificar com `gh api repos/controlehumana/HumWMS/actions/runs?per_page=3`; se a run mais recente falhou, o fix é um novo commit (pode ser vazio: `git commit --allow-empty`) pra forçar novo build+deploy. Não há permissão de admin no repo pra usar `gh run rerun` diretamente.

## Padrões de código

- `$('id')` é alias para `document.getElementById`
- Escrita no Firestore sempre via `batch.set/update/delete` nunca diretamente
- CSS usa variáveis CSS (`--accent`, `--border`, etc.) definidas em `:root` — manter consistência ao adicionar estilos
- Responsivo: breakpoint em `640px` com media queries ao final do `<style>`
- Funções de render são idempotentes — redesenham o DOM inteiro da seção a cada chamada
