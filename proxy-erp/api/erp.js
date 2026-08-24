// Proxy CORS para a API crud-stock do ERP da Humana Alimentar.
//
// Por que existe: o servidor do ERP não envia cabeçalhos CORS e responde 405 a
// preflight OPTIONS, então o navegador bloqueia qualquer chamada feita direto
// pelo WMS (GitHub Pages) e pelos coletores. Até 08/2026 essa ponte era o
// corsproxy.io, que desligou as URLs anônimas ("keyless_legacy_url", HTTP 403)
// e derrubou o endereçamento inteiro. Esta função substitui aquele serviço.
//
// Uso: /api/erp?url=<URL do ERP codificada com encodeURIComponent>
// Repassa método, corpo e resposta sem alterar nada; só acrescenta o CORS.

const HOST_PERMITIDO = 'gestao.humanaalimentar.com.br';
const METODOS = 'GET,POST,PUT,DELETE,OPTIONS';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', METODOS);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-TOKEN');
  res.setHeader('Access-Control-Max-Age', '86400');
  // Nunca cachear: o corsproxy.io guardava GET por 1h e servia estoque velho.
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const alvo = req.query && req.query.url;
  if (!alvo) {
    return res.status(400).json({ sucesso: false, mensagem: 'Faltou o parâmetro url.' });
  }

  let destino;
  try {
    destino = new URL(alvo);
  } catch (_) {
    return res.status(400).json({ sucesso: false, mensagem: 'URL inválida.' });
  }

  // Allowlist: esta função só serve para falar com o ERP, não é proxy aberto.
  if (destino.hostname !== HOST_PERMITIDO) {
    return res.status(403).json({ sucesso: false, mensagem: 'Destino não permitido.' });
  }

  const opcoes = {
    method: req.method,
    headers: { 'Accept': 'application/json' }
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const tipo = req.headers['content-type'] || 'application/json';
    opcoes.headers['Content-Type'] = tipo;
    // O runtime da Vercel já entrega req.body parseado quando é JSON.
    opcoes.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  }
  if (req.headers['x-api-token']) {
    opcoes.headers['X-API-TOKEN'] = req.headers['x-api-token'];
  }

  try {
    const resposta = await fetch(destino.toString(), opcoes);
    const corpo = await resposta.text();
    res.status(resposta.status);
    res.setHeader('Content-Type', resposta.headers.get('content-type') || 'application/json');
    return res.send(corpo);
  } catch (e) {
    // Timeout, DNS, ERP fora do ar: devolve no formato que o app já sabe ler.
    return res.status(502).json({ sucesso: false, mensagem: 'Falha ao falar com o ERP: ' + (e.message || e) });
  }
};
