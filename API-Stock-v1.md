# HUMANA ALIMENTAR · ERP / WMS

## API de Estoque e Endereçamento
**Guia de uso — como o usuário deve se comportar ao consumir a API**

*   **Tabela alvo:** `t_item_enderecamento`
*   **Operações:** GET · POST · PUT · DELETE
*   **Versão:** v1
*   **Formato:** JSON (preferencial) ou Form Data / Query Params
*   **Respostas:** Sempre em JSON

---

### Visão Geral & Fluxo Recomendado

Esta API permite o gerenciamento completo das posições de estoque por meio das quatro operações CRUD. O usuário deve sempre seguir um fluxo seguro: consultar antes de alterar ou excluir, garantindo que está operando sobre os IDs corretos.

#### Fluxo de Operação
1.  **Autentique:** Envie o token em todas as requisições.
2.  **Consulte (GET):** Confirme IDs e estado atual.
3.  **Opere:** POST / PUT / DELETE conforme o objetivo.
4.  **Valide:** Leia o JSON de retorno (sucesso/erro).

> **DICA ESSENCIAL**
> É altamente recomendável fazer um GET antes de qualquer PUT ou DELETE, para confirmar os IDs e o estado atual do estoque antes de modificar ou remover dados.

---

### URL Base

`https://gestao.humanaalimentar.com.br/erp/api/v1/human/crud-stock/index.php`

---

### Autenticação — obrigatória em toda requisição

O Token de Segurança pode ser enviado de duas formas. Escolha uma delas:

| Forma | Como enviar | Exemplo |
| :--- | :--- | :--- |
| **Header (recomendado)** | Cabeçalho HTTP | `HTTP_X_API_TOKEN: WMS-TOKEN-STOCK-2026` |
| **Query String** | Parâmetro na URL | `?token=WMS-TOKEN-STOCK-2026` |

> **ATENÇÃO À SEGURANÇA**
> Enviar o token pela URL o deixa visível em logs e histórico. Prefira sempre o Header em ambientes de produção.

---

### 1. GET — Consultar Estoque (Ler)

Retorna a listagem atualizada do estoque e das posições. É a operação segura, usada para confirmar dados antes de qualquer escrita.

#### Parâmetros da URL (opcionais)

| Parâmetro | Tipo / Formato | Descrição |
| :--- | :--- | :--- |
| `data_limite` | YYYY-MM-DD | Define a data limite de busca. Padrão: data atual. |

#### Exemplo de requisição (cURL)

```bash
# Consulta simples com token via query string
curl -X GET "https://gestao.humanaalimentar.com.br/erp/api/v1/human/crud-stock/index.php?token=WMS-TOKEN-STOCK-2026"
```

---

### 2. POST — Criar Novo Registro

Insere um novo endereço / posição de item no estoque.

#### Campos

| Campo | Tipo | Obrigatoriedade |
| :--- | :--- | :--- |
| `item_id` | inteiro | Obrigatório |
| `unidade_id` | inteiro | Obrigatório |
| `estoque` | numérico | Opcional |
| `nivel` | texto | Opcional |
| `rua` | texto | Opcional |
| `posicao` | texto | Opcional |
| `lote` | texto | Opcional |
| `data_validade` | texto | Opcional |

#### Corpo da requisição (JSON)

```json
{
    "item_id": 1050,
    "unidade_id": 1,
    "estoque": 25.5,
    "nivel": "A1",
    "rua": "05",
    "posicao": "10",
    "lote": "LOTE-XYZ",
    "data_validade": "2026-12-31"
}
```

#### Exemplo de requisição (cURL)

```bash
curl -X POST "https://gestao.humanaalimentar.com.br/erp/api/v1/human/crud-stock/index.php" \
     -H "HTTP_X_API_TOKEN: WMS-TOKEN-STOCK-2026" \
     -H "Content-Type: application/json" \
     -d '{"item_id": 1050, "unidade_id": 1, "estoque": 25.5, "rua": "05"}'
```

---

### 3. PUT — Atualizar Registro

Atualiza um ou mais campos de um registro já existente. Envie apenas os campos que deseja alterar.

#### Filtro obrigatório — escolha um dos dois modos

| Modo | Campo(s) | Abrangência |
| :--- | :--- | :--- |
| **Por Primary Key** | `id_item_enderecamento` | Afeta apenas um registro |
| **Por item + unidade** | `item_id + unidade_id` | Afeta todos os registros desse item e unidade |

> **CUIDADO**
> Usar `item_id + unidade_id` altera todos os registros correspondentes de uma só vez. Para mudar um único registro, prefira o `id_item_enderecamento`.

**Campos que podem ser atualizados:** `estoque`, `nivel`, `rua`, `posicao`, `lote`, `data_validade`.

#### Corpo usando Primary Key (JSON)

```json
{
    "id_item_enderecamento": 45,
    "estoque": 100,
    "nivel": "B2"
}
```

#### Corpo usando item_id e unidade_id (JSON)

```json
{
    "item_id": 1050,
    "unidade_id": 1,
    "estoque": 100
}
```

#### Exemplo de requisição (cURL)

```bash
curl -X PUT "https://gestao.humanaalimentar.com.br/erp/api/v1/human/crud-stock/index.php" \
     -H "HTTP_X_API_TOKEN: WMS-TOKEN-STOCK-2026" \
     -H "Content-Type: application/json" \
     -d '{"id_item_enderecamento": 45, "estoque": 100}'
```

---

### 4. DELETE — Excluir Registro

Exclui permanentemente registros do estoque.

> **OPERAÇÃO IRREVERSÍVEL**
> A exclusão é permanente. Faça sempre um GET antes para confirmar exatamente qual registro será removido. Não há como desfazer.

#### Filtro obrigatório — escolha um dos dois modos

| Modo | Campo(s) | Abrangência |
| :--- | :--- | :--- |
| **Por Primary Key** | `id_item_enderecamento` | Exclui apenas um registro |
| **Por item + unidade** | `item_id + unidade_id` | Exclui todos os registros desse item e unidade |

#### Corpo usando Primary Key (JSON)

```json
{
    "id_item_enderecamento": 45
}
```

#### Corpo usando item_id e unidade_id (JSON)

```json
{
    "item_id": 1050,
    "unidade_id": 1
}
```

#### Exemplo de requisição (cURL)

```bash
curl -X DELETE "https://gestao.humanaalimentar.com.br/erp/api/v1/human/crud-stock/index.php" \
     -H "HTTP_X_API_TOKEN: WMS-TOKEN-STOCK-2026" \
     -H "Content-Type: application/json" \
     -d '{"id_item_enderecamento": 45}'
```

---

### Tratamento de Erros & Respostas

Todas as respostas voltam em JSON com o campo `sucesso` (booleano) e uma mensagem descritiva. Verifique sempre esse campo antes de prosseguir.

#### Resposta de sucesso (ex.: 200 OK / 201 Created)

```json
{
    "sucesso": true,
    "mensagem": "Registro(s) excluído(s) com sucesso."
}
```

#### Resposta de erro (ex.: 400 Bad Request / 401 Unauthorized)

```json
{
    "sucesso": false,
    "mensagem": "Informe o id_item_enderecamento ou a combinação de item_id e unidade_id."
}
```

#### Códigos de status mais comuns

| Código | Significado | O que fazer |
| :--- | :--- | :--- |
| **200 OK** | Operação concluída | Seguir o fluxo normalmente. |
| **201 Created** | Registro criado (POST) | Guardar o ID retornado, se houver. |
| **400 Bad Request** | Dados/filtro ausentes ou inválidos | Revisar os campos obrigatórios do corpo. |
| **401 Unauthorized** | Token ausente ou inválido | Conferir o `HTTP_X_API_TOKEN`. |

---

### BOAS PRÁTICAS — RESUMO
1. Autentique toda requisição.
2. Consulte (GET) antes de alterar/excluir.
3. Para um único registro, use o `id_item_enderecamento`.
4. No PUT, envie só os campos a alterar.
5. Confira o campo `sucesso` em toda resposta.

---
*Humana Alimentar · API de Estoque e Endereçamento (v1) · Documento de orientação ao usuário*
