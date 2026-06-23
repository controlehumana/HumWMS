# SPEC & Workflow: API de Gerenciamento de Estoque (CRUD-Stock)

Esta documentação tem como objetivo orientar agentes de IA (como o Claude Code) a se integrarem à API de Estoque e Posições do ERP. O guia cobre as especificações técnicas (SPEC), habilidades necessárias (SKILLs) e o fluxo de trabalho (Workflow) para consumir e alimentar os dados corretamente.

---

## 1. SPECIFICATION (SPEC)

A API é um endpoint RESTful simples localizado em `/api/v1/human/crud-stock/index.php`. Ela realiza o CRUD completo da tabela `t_item_enderecamento`, que controla a posição física e os saldos de estoque por lote e validade.

### 1.1 Autenticação
Todas as requisições devem possuir o token de segurança.
- **Header:** `X-API-TOKEN: WMS-TOKEN-STOCK-2026`
- **Query Params (opcional):** `?token=WMS-TOKEN-STOCK-2026`

### 1.2 Métodos Disponíveis

#### `GET` - Consultar Estoque
Retorna a listagem de saldo de estoque otimizada até uma data limite.
- **Parâmetros de Query:** 
  - `data_limite` (Opcional, Default: `date('Y-m-d')`): Formato `YYYY-MM-DD`.
- **Retorno:** JSON contendo array de itens com código, descrição, lote, validade, posição física (rua, nivel, posicao) e saldo aberto.

#### `POST` - Inserir Endereçamento (Create)
Insere uma nova posição de estoque ou lote.
- **Payload (JSON ou Form-Data):**
  - `item_id` (Obrigatório, INT)
  - `unidade_id` (Obrigatório, INT)
  - `estoque` (Opcional, FLOAT)
  - `nivel` (Opcional, STRING)
  - `rua` (Opcional, STRING)
  - `posicao` (Opcional, STRING)
  - `lote` (Opcional, STRING)
  - `data_validade` (Opcional, DATE - `YYYY-MM-DD`)
- **Comportamento:** Retorna `HTTP 201 Created` e o `id_item_enderecamento` gerado. Registra o payload de inserção no banco (`api_log`).

#### `PUT` - Atualizar Endereçamento (Update)
Atualiza um registro existente.
- **Payload (JSON):**
  - **Identificador (Pelo menos UM é obrigatório):** `id_item_enderecamento` OU a combinação de `item_id` + `unidade_id`.
  - **Campos Atualizáveis (Enviar apenas os que vão mudar):** `estoque`, `nivel`, `rua`, `posicao`, `lote`, `data_validade`.
- **Comportamento:** Retorna `HTTP 200 OK`. Registra o payload de atualização no banco (`api_log`).

#### `DELETE` - Excluir Endereçamento (Delete)
Deleta uma posição de estoque física.
- **Payload (JSON):**
  - **Identificador (Obrigatório):** `id_item_enderecamento` OU a combinação de `item_id` + `unidade_id`.
- **Comportamento:** Retorna `HTTP 200 OK`. Registra o payload deletado no banco (`api_log`).

---

## 2. SKILLs Requeridas

Para o agente externo (Claude Code) trabalhar adequadamente com esta API, ele deve dominar:
1. **Comunicação HTTP/REST:** Habilidade para formatar requisições com headers personalizados (X-API-TOKEN) e payloads JSON.
2. **Data Mapping:** Mapeamento do modelo de dados de uma aplicação externa para as chaves nativas do ERP (`item_id`, `unidade_id`, `estoque`, `lote`).
3. **Tratamento de Exceções:** Lidar com respostas `HTTP 400 Bad Request` (quando faltam parâmetros), `HTTP 401 Unauthorized` (erro de token) e `HTTP 500` (erro de banco).
4. **Sincronização Bidirecional:** Habilidade de fazer um `GET` para comparar as posições de estoque (Conciliação) e realizar sequências de `POST`, `PUT` ou `DELETE` para alinhar as tabelas de destino com a origem.

---

## 3. WORKFLOW (Guia de Ação para o Agente)

Instruções diretas para o Agente de IA que assumirá o lado cliente:

### Fase 1: Setup e Validação de Conectividade
1. Configure as credenciais no seu arquivo `.env` (ou similar) com a URL base da API e o Token (`WMS-TOKEN-STOCK-2026`).
2. Execute uma requisição `GET` com o parâmetro `?data_limite=HOJE` para assegurar conectividade e mapear os tipos de dados do JSON de resposta.

### Fase 2: Adaptação do Sistema Fonte
1. Analise o banco de dados/sistema onde você está rodando (Aplicação Externa).
2. Escreva um Script ou Job de sincronização (`sync_estoque.php/js/py`) que:
   - Leia os dados de movimentação física do estoque do sistema atual.
   - Formate essas movimentações no formato JSON esperado pela nossa API (chaves como `item_id`, `unidade_id`, `rua`, etc).

### Fase 3: Operação (Alimentando os Dados)
1. **Para Adicionar Novos Estoques/Lotes no ERP:** 
   - Monte a requisição `POST` para criar as novas localizações. Se a sua resposta de sucesso retornar o `id_item_enderecamento`, grave-o no seu sistema fonte para futura referência (Tracking).
2. **Para Atualizações (Movimentações ou Inventário):**
   - Execute o método `PUT`. Se você salvou o `id_item_enderecamento` na Fase anterior, use-o; senão, atualize utilizando a chave combinada (`item_id` + `unidade_id`).
3. **Para Zeramento/Exclusão de Posição Vazia:**
   - Ao retirar o último item de um pallet/rua, envie um `DELETE` com os mesmos IDs, garantindo a limpeza dos endereços lógicos.

> [!TIP]
> **Logs Integrados:** Lembre-se que cada `POST`, `PUT` e `DELETE` que você disparar registrará o body JSON enviado na tabela `api_log` do ERP. Utilize isso a seu favor para investigar requisições perdidas ou erros de sincronia de inventário durante a homologação.
