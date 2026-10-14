// Bot do Telegram "Validade WMS Humana" (@validade_wms_humana_bot): consulta manual de validades.
// O Telegram chama esta função (webhook) a cada comando; o aviso diário fica no GitHub Actions
// (avisos/avisar_validade.js) e usa as mesmas regras (lib/validade.js).
//
// Variáveis na Vercel: TELEGRAM_TOKEN, TELEGRAM_CHAT_ID (grupo autorizado), TELEGRAM_WEBHOOK_SECRET, ERP_TOKEN.
// Só atende o grupo autorizado, ou conversa privada de quem é membro dele. O resto é ignorado.
const V = require('../lib/validade');
const Seg = require('../lib/segregados');
const URL_ERP = 'https://gestao.humanaalimentar.com.br/erp/api/v1/human/crud-stock/index.php?_=1';

const tg = async (metodo, corpo) => {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/${metodo}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo)
  });
  return r.json().catch(() => ({}));
};
const enviar = (chat_id, text, extra) => tg('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

const MENU = {
  texto: '<b>Consulta de validade</b>\nToque numa opção, ou digite <b>/validade 45</b> (qualquer número de dias, até 365).',
  teclado: { inline_keyboard: [
    [{ text: 'Vencidos', callback_data: 'v' }],
    [{ text: 'Até 30 dias', callback_data: '30' }, { text: 'Até 60 dias', callback_data: '60' }, { text: 'Até 90 dias', callback_data: '90' }]
  ] }
};

async function autorizado(chat, user) {
  if (String(chat.id) === String(process.env.TELEGRAM_CHAT_ID)) return true;
  if (chat.type !== 'private' || !user) return false;
  const m = await tg('getChatMember', { chat_id: process.env.TELEGRAM_CHAT_ID, user_id: user.id });
  return !!(m.ok && ['creator', 'administrator', 'member'].includes(m.result.status));
}

// 'menu' | 'venc' | número de dias | null (ignorar)
function interpretar(texto) {
  const t = String(texto || '').trim().toLowerCase().replace(/@\w+/, '').replace(/\s+/g, ' ');
  let m;
  if (/^\/(start|menu|ajuda|help|validade)$/.test(t)) return 'menu';
  if (/^\/vencidos?$/.test(t) || t === 'vencidos') return 'venc';
  if ((m = /^\/(?:validade )?(\d{1,3})(?: dias?)?$/.exec(t)) || (m = /^(\d{1,3}) dias?$/.exec(t))) {
    const n = parseInt(m[1], 10);
    return n >= 1 && n <= 365 ? n : null;
  }
  return null;
}

async function responder(chat, acao) {
  if (acao === 'menu') return enviar(chat.id, MENU.texto, { reply_markup: MENU.teclado });
  const u = new URL(URL_ERP);
  u.searchParams.set('token', process.env.ERP_TOKEN);
  const r = await fetch(u, { headers: { Accept: 'application/json' } });
  const dados = r.ok ? await r.json().catch(() => null) : null;
  if (!Array.isArray(dados)) return enviar(chat.id, 'Não consegui consultar o ERP agora. Tente de novo em instantes.');
  const seg = await Seg.carregar();
  for (const msg of V.consulta(dados, V.hojeSP(), acao, seg)) await enviar(chat.id, msg);
}

async function tratar(up) {
  if (up.callback_query) {
    const cq = up.callback_query, chat = cq.message && cq.message.chat;
    if (!chat || !(await autorizado(chat, cq.from))) return tg('answerCallbackQuery', { callback_query_id: cq.id });
    await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Buscando no ERP...' });
    const acao = cq.data === 'v' ? 'venc' : parseInt(cq.data, 10);
    if (acao) await responder(chat, acao);
    return;
  }
  const m = up.message;
  if (!m || !m.text) return;
  const acao = interpretar(m.text);
  if (acao === null) return;
  if (!(await autorizado(m.chat, m.from))) return;
  await responder(m.chat, acao);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('ok');
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || req.headers['x-telegram-bot-api-secret-token'] !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(403).end();
  }
  try { await tratar(req.body || {}); } catch (e) { console.error('telegram:', e && e.message); }
  res.status(200).json({ ok: true });
};
