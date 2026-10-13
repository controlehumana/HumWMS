# Proxy CORS do HumWMS

Ponte entre o WMS (GitHub Pages, coletores) e a API `crud-stock` do ERP.

O servidor do ERP não envia cabeçalhos CORS e recusa preflight `OPTIONS` com 405,
então o navegador bloqueia chamadas diretas. Até agosto de 2026 o app usava o
`corsproxy.io`, que desligou as URLs anônimas (`keyless_legacy_url`, HTTP 403) e
derrubou endereçamento, sincronização e limpeza de uma vez. Esta função ocupa o
lugar dele, sob controle da própria Humana.

## Uso

```
/api/erp?url=<URL do ERP codificada com encodeURIComponent>
```

Repassa método, corpo e resposta sem alterar nada, acrescenta os cabeçalhos CORS
e proíbe cache (o corsproxy guardava GET por 1 hora e servia estoque velho).

Só aceita destino em `gestao.humanaalimentar.com.br`: não é proxy aberto.

## Token do ERP

O token da API não fica no HTML. O proxy acrescenta `token=` na URL quando o cliente não manda um, lendo a variável de ambiente **`ERP_TOKEN`** (a mesma que o `api/sync.js` usa). Sem ela o proxy responde 503. Para criar ou trocar o valor (sem repassar pelo PowerShell, que corrompe segredos em pipe):

```
printf '%s' "<token>" | npx vercel env add ERP_TOKEN production --scope support-solucoes
npx vercel deploy --prod --yes --scope support-solucoes
```

Trocar o token = mudar essa variável e republicar o proxy; não precisa mexer no WMS nem nos coletores.

## Onde isso é consumido

Constante `ERP_PROXY` em `index.html`, `coletor_endereco.html` e
`coletor_endereco2.html` do repositório `controlehumana/HumWMS`.
