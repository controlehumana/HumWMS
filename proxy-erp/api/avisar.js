// Aviso de validade no Telegram, disparado por um cron externo (cron-job.org) com hora certa.
// Substitui o agendamento do GitHub Actions, que atrasava 3 a 5 horas e às vezes pulava a rodada.
// As regras e o texto são os de lib/validade.js (as mesmas do bot de consulta e de avisos/avisar_validade.js).
//
//   GET /api/avisar                -> aviso completo (7h): vencidos + até 90 dias
//   GET /api/avisar?modo=vencidos  -> lembrete (14h): só vencidos com saldo, quieto se não houver
//   &forcar=1                      -> envia o completo mesmo sem lote urgente
//   &teste=1                       -> não envia, devolve as mensagens no JSON
//
// Exige o cabeçalho Authorization: Bearer <CRON_SECRET>. Sem a variável configurada, recusa tudo.
// Variáveis na Vercel: CRON_SECRET, TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, ERP_TOKEN.
const V = require('../lib/validade');
const URL_ERP = 'https://gestao.humanaalimentar.com.br/erp/api/v1/human/crud-stock/index.php?_=1';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const segredo = process.env.CRON_SECRET;
  if (!segredo) return res.status(503).json({ sucesso: false, mensagem: 'Faltou configurar CRON_SECRET.' });
  if ((req.headers.authorization || '') !== `Bearer ${segredo}`) return res.status(401).json({ sucesso: false, mensagem: 'Não autorizado.' });

  const { TELEGRAM_TOKEN: t, TELEGRAM_CHAT_ID: c, ERP_TOKEN: erp } = process.env;
  const q = req.query || {};
  const teste = q.teste === '1';
  if (!teste && (!t || !c)) return res.status(503).json({ sucesso: false, mensagem: 'Faltam TELEGRAM_TOKEN e TELEGRAM_CHAT_ID.' });
  if (!erp) return res.status(503).json({ sucesso: false, mensagem: 'Faltou ERP_TOKEN.' });

  try {
    const u = new URL(URL_ERP);
    u.searchParams.set('token', erp);
    const r = await fetch(u, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!r.ok) throw new Error('ERP respondeu HTTP ' + r.status);
    const dados = await r.json();
    if (!Array.isArray(dados)) throw new Error('ERP devolveu algo que não é lista');

    const hoje = V.hojeSP();
    const dow = new Date(hoje + 'T12:00:00Z').getUTCDay(); // 0 domingo, 6 sábado
    if ((dow === 0 || dow === 6) && !teste && q.forcar !== '1') return res.status(200).json({ sucesso: true, enviadas: 0, motivo: 'fim de semana' });

    let mensagens;
    if (q.modo === 'vencidos') {
      mensagens = V.vencidos(dados, hoje);
      if (!mensagens.length) return res.status(200).json({ sucesso: true, enviadas: 0, motivo: 'nenhum vencido com saldo' });
    } else {
      const d = V.diaria(dados, hoje);
      if (!d.urgente && dow !== 1 && q.forcar !== '1' && !teste) return res.status(200).json({ sucesso: true, enviadas: 0, motivo: 'sem lotes urgentes e não é segunda' });
      mensagens = d.mensagens;
    }

    if (teste) return res.status(200).json({ sucesso: true, teste: true, enviadas: 0, mensagens });

    for (const text of mensagens) {
      const resp = await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: c, text, parse_mode: 'HTML', disable_web_page_preview: true })
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || !j.ok) throw new Error('Telegram recusou: ' + (j.description || resp.status));
    }
    return res.status(200).json({ sucesso: true, enviadas: mensagens.length });
  } catch (e) {
    return res.status(502).json({ sucesso: false, mensagem: e.message });
  }
};
