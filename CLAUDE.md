# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**HumWMS** — Mini WMS (Warehouse Management System) para Humana Alimentar. Dois arquivos HTML completamente autônomos, sem etapa de build, sem dependências locais.

- `index.html` (~367 KB) — Aplicação WMS principal
- `coletor_v3.html` (~316 KB) — App de coleta/separação standalone (sem Firebase)
- `API-Stock-v1.md` / `.pdf` — documentação oficial (fornecida pelo ERP) da API `crud-stock`
- `api_crud_stock_spec.md` — spec complementar da mesma API (fornecida pelo dev do ERP em 2026-06-23), com detalhes de comportamento (ex.: POST retorna `id_item_enderecamento`, log em `api_log`)

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
| `coletor_lotes` | auto | ordens de separação |
| `coletor_pedidos` | auto | pedidos dentro de um lote |
| `coletor_logs` | auto | log de atividade por pedido |
| `coletor_divergencias` | auto | divergências registradas durante separação |

### Layout do armazém

- Ruas: `A` a `G` (`WMS_RUAS`)
- Posições: `1` a `40` (`WMS_POSES`)
- Chave de endereço: `addrKey(rua, pos)` → `"A_1"`, `"B_15"`, etc.

### Roles e permissões

- `admin` — acesso total a todas as abas e ações
- `custom` — acesso controlado pelo array `modules[]` gravado no documento do usuário
- Legado: `operator`, `viewer`, `coletor` — ainda suportados para compatibilidade

### Importação de estoque

Dois modos:
1. **Excel** (drag-and-drop) via SheetJS — recria endereços e itens
2. **API ERP** (`crud-stock/index.php`, ver abaixo) via `corsproxy.io` — merge nos itens existentes. Auto-sync agendado para 10:00 e 17:00 (apenas admin).

Writes ao Firestore usam `db.batch()` em chunks de 400 (limite do Firestore).

### Integração com o ERP — API `crud-stock` (v1)

API CRUD completa sobre a tabela `t_item_enderecamento`. Documentação completa em `API-Stock-v1.md`/`.pdf`.

```
GET / POST / PUT / DELETE
https://gestao.humanaalimentar.com.br/erp/api/v1/human/crud-stock/index.php?token=WMS-TOKEN-STOCK-2026
```

Todas as chamadas passam pelo proxy `corsproxy.io` (CORS não configurado no servidor do ERP). Respostas de escrita (POST/PUT/DELETE) sempre trazem `{ sucesso, mensagem }`; GET retorna o array de itens (mesmos campos de antes: `item_id`, `item_codigo`, `item_descricao`, `numero_lote`, `dt_validade`, `saldo_aberto`, `estoque`, `rua`, `posicao`, `id_item_enderecamento`, `empresa_id`, `empresa_apelido`...).

**Helpers compartilhados** (em `index.html`, antes do módulo de Transferência): `_erpUrl()`, `_erpWrite(method, body)`, `_erpCreateEndereco(payload)` (POST), `_erpUpdateEndereco(payload)` (PUT), `_erpDeleteEndereco(idEnd)` (DELETE), `_brDateToIso(val)`.

- **Leitura (GET):** usada na sincronização manual (botão "Sincronizar") e automática (10h/17h). `parseApiData()` também captura `itemId`/`unidadeId` (= `item_id`/`empresa_id` da resposta) e grava nos itens do Firestore — são necessários para criar novos endereçamentos via POST.
- **Transferência (PUT):** botão "→ Transferir" nos cards do Mapa → `_doTransfer()` envia `{ id_item_enderecamento, rua, posicao }` (apenas o destino) via PUT. Substituiu o antigo `transfer.php` (removido do projeto) — o PUT genérico do crud-stock já faz a mesma atualização sem precisar de endpoint customizado no ERP.
- **Atribuir endereço a item pendente (POST):** na aba "Pendentes" → modal de atribuição → se o item tiver `itemId`/`unidadeId` (veio da API, não do Excel), `_erpCreateEndereco()` cria o registro no ERP antes de gravar no Firestore, usando o `id_item_enderecamento` retornado na resposta do POST (confirmado em produção que a API devolve esse campo). Sem `itemId`/`unidadeId`, a atribuição seria só local e revertida na próxima sincronização (sync limpa e recria `wms_items`/`wms_unaddressed` a partir do ERP).
- **Excluir registro (DELETE):** no modal "Editar" do Mapa, cada item com `idEnd` ganha um botão 🗑 que chama `_erpDeleteEndereco(idEnd)` (com confirmação, operação irreversível) e remove o doc correspondente no Firestore.

**Funções:** `openTransferModal(rua, pos)`, `_fillTransferPos()`, `_doTransfer()`, `_showTransferMsg(type, text)`

**Cuidados conhecidos:**
- PUT/DELETE na API do ERP retornam `sucesso:true` mesmo quando o `id_item_enderecamento` não existe (não validam linhas afetadas) — não usar `sucesso` como prova de que algo de fato mudou.
- `corsproxy.io` cacheia respostas de GET por 1h por padrão; todas as chamadas de sincronização incluem `&_=${Date.now()}` na URL alvo para evitar servir dados desatualizados. Ocasionalmente também retorna 403 "Server-side requests are not allowed" para requisições sem cabeçalhos de navegador — não afeta chamadas reais do app, só testes via curl/servidor.
- Toda chamada de escrita (POST/PUT/DELETE) é registrada pelo ERP na tabela `api_log` — útil para o dev do ERP investigar requisições perdidas ou divergências, caso algo pareça não ter persistido.

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

## Padrões de código

- `$('id')` é alias para `document.getElementById`
- Escrita no Firestore sempre via `batch.set/update/delete` nunca diretamente
- CSS usa variáveis CSS (`--accent`, `--border`, etc.) definidas em `:root` — manter consistência ao adicionar estilos
- Responsivo: breakpoint em `640px` com media queries ao final do `<style>`
- Funções de render são idempotentes — redesenham o DOM inteiro da seção a cada chamada
