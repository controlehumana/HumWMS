// Aviso diário de validade no Telegram (bot próprio do WMS, separado da Elisa).
//
//   node avisos/avisar_validade.js            -> monta as mensagens e ENVIA (precisa das variáveis abaixo)
//   node avisos/avisar_validade.js --teste    -> só imprime, não envia nada
//
// Variáveis: TELEGRAM_TOKEN, TELEGRAM_CHAT_ID (secrets do GitHub). FORCAR=1 envia mesmo sem urgência.
// As regras e o texto ficam em proxy-erp/lib/validade.js (as mesmas do bot de consulta manual).
const V = require('../proxy-erp/lib/validade.js');
const URL_ERP = 'https://gestao.humanaalimentar.com.br/erp/api/v1/human/crud-stock/index.php?_=1';
const PROXY = 'https://humwms-proxy.vercel.app/api/erp?url=';
const TESTE = process.argv.includes('--teste');

async function main() {
  const r = await fetch(PROXY + encodeURIComponent(URL_ERP), { cache: 'no-store' });
  if (!r.ok) throw new Error('ERP respondeu HTTP ' + r.status);
  const dados = await r.json();
  if (!Array.isArray(dados)) throw new Error('ERP devolveu algo que não é lista');

  const hoje = V.hojeSP();
  // MODO=vencidos (rodada das 14h): só lembra o que já venceu com saldo e fica quieto se não houver nada.
  if (process.env.MODO === 'vencidos') {
    const m = V.vencidos(dados, hoje);
    if (!m.length) { console.log('Nenhum vencido com saldo: nada a enviar.'); return; }
    return enviar(m);
  }
  const { urgente, mensagens } = V.diaria(dados, hoje);
  const segunda = new Date(hoje + 'T12:00:00Z').getUTCDay() === 1;
  if (!urgente && !segunda && !process.env.FORCAR && !TESTE) { console.log('Sem lotes urgentes e não é segunda: nada a enviar.'); return; }

  return enviar(mensagens);
}

async function enviar(mensagens) {
  console.log(mensagens.join('\n\n--- próxima mensagem ---\n\n') + '\n');
  if (TESTE) { console.log('[--teste] nada enviado.'); return; }
  const { TELEGRAM_TOKEN: t, TELEGRAM_CHAT_ID: c } = process.env;
  if (!t || !c) throw new Error('Faltam TELEGRAM_TOKEN e TELEGRAM_CHAT_ID');
  for (const text of mensagens) {
    const resp = await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: c, text, parse_mode: 'HTML', disable_web_page_preview: true })
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok || !j.ok) throw new Error('Telegram recusou: ' + (j.description || resp.status));
  }
  console.log('Enviado ao Telegram (' + mensagens.length + ' mensagem/ns).');
}
main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
