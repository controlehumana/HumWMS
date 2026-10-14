// Lista as chaves dos lotes na Segregação, para o aviso diário (GitHub Actions) saber quais são.
// Só devolve as chaves (SKU__lote__validade), nada de nome nem de quantidade.
const { carregar } = require('../lib/segregados');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const chaves = [...(await carregar())];
  res.status(200).json({ chaves });
};
