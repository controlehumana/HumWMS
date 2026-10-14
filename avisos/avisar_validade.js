// Aviso diário de validade no Telegram (bot próprio do WMS, separado da Elisa).
//
//   node avisos/avisar_validade.js            -> monta a mensagem e ENVIA (precisa das variáveis abaixo)
//   node avisos/avisar_validade.js --teste    -> só imprime a mensagem, não envia nada
//
// Variáveis: TELEGRAM_TOKEN, TELEGRAM_CHAT_ID (secrets do GitHub). FORCAR=1 envia mesmo sem urgência.
// Mesmas regras da aba Validades do coletor: lote com saldo > 0, agrupado por SKU+lote+validade,
// faixas Vencidos / até 30 / 31 a 60 / 61 a 90 dias.
const URL_ERP = 'https://gestao.humanaalimentar.com.br/erp/api/v1/human/crud-stock/index.php?_=1';
const PROXY = 'https://humwms-proxy.vercel.app/api/erp?url=';
const TESTE = process.argv.includes('--teste');
const MAX_LINHAS = 25;

const num = v => Number(String(v == null ? '' : v).replace(',', '.')) || 0;
const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); // AAAA-MM-DD
const dias = (iso, hoje) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.parse(hoje + 'T00:00:00Z')) / 86400000);
};
const br = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : '-'; };

async function main() {
  const r = await fetch(PROXY + encodeURIComponent(URL_ERP), { cache: 'no-store' });
  if (!r.ok) throw new Error('ERP respondeu HTTP ' + r.status);
  const dados = await r.json();
  if (!Array.isArray(dados)) throw new Error('ERP devolveu algo que não é lista');

  const hoje = hojeSP();
  const mapa = new Map();
  for (const x of dados) {
    const d = dias(x.dt_validade, hoje);
    if (d === null || d > 90 || num(x.saldo_aberto) <= 0) continue;
    const k = [x.item_codigo, x.numero_lote, x.dt_validade].join('|');
    let g = mapa.get(k);
    if (!g) { g = { sku: String(x.item_codigo || '').trim(), desc: x.item_descricao || '', lote: x.numero_lote || '-', val: x.dt_validade, d, saldo: num(x.saldo_aberto), pos: new Set() }; mapa.set(k, g); }
    if (x.rua && x.posicao) g.pos.add(String(x.rua).toUpperCase() + String(x.posicao).trim());
  }
  const lotes = [...mapa.values()].sort((a, b) => a.d - b.d);
  const venc = lotes.filter(g => g.d < 0), ate30 = lotes.filter(g => g.d >= 0 && g.d <= 30);
  const f60 = lotes.filter(g => g.d > 30 && g.d <= 60), f90 = lotes.filter(g => g.d > 60);

  const dow = new Date(hoje + 'T12:00:00Z').getUTCDay(); // 1 = segunda
  const urgente = venc.length + ate30.length > 0;
  if (!urgente && dow !== 1 && !process.env.FORCAR && !TESTE) { console.log('Sem lotes urgentes e não é segunda: nada a enviar.'); return; }

  const linha = g => {
    const q = g.saldo.toLocaleString('pt-BR');
    const quando = g.d < 0 ? `venceu há ${-g.d} d` : g.d === 0 ? 'vence HOJE' : `vence em ${g.d} d`;
    return `• ${g.sku} ${g.desc.slice(0, 38)}\n  Lote ${g.lote} · ${br(g.val)} (${quando}) · saldo ${q} · ${[...g.pos].join(', ') || 'sem endereço'}`;
  };
  const bloco = (titulo, arr, ate) => {
    if (!arr.length) return [];
    const L = [`${titulo} (${arr.length})`];
    arr.slice(0, ate).forEach(g => L.push(linha(g)));
    if (arr.length > ate) L.push(`  ... e mais ${arr.length - ate}. Veja na aba Validades do coletor.`);
    L.push('');
    return L;
  };
  const dd = hoje.split('-').reverse().join('/');
  let linhas = [`Validades no CD - ${dd}`, ''];
  linhas = linhas.concat(bloco('VENCIDOS', venc, 12), bloco('VENCEM EM ATÉ 30 DIAS', ate30, MAX_LINHAS - Math.min(venc.length, 12)));
  linhas.push(`Em 31 a 60 dias: ${f60.length} lote(s)`, `Em 61 a 90 dias: ${f90.length} lote(s)`);
  let msg = linhas.join('\n');
  if (msg.length > 3900) msg = msg.slice(0, 3850) + '\n... (mensagem cortada, veja a aba Validades)';

  console.log(msg + '\n');
  if (TESTE) { console.log('[--teste] nada enviado.'); return; }
  const { TELEGRAM_TOKEN: t, TELEGRAM_CHAT_ID: c } = process.env;
  if (!t || !c) throw new Error('Faltam TELEGRAM_TOKEN e TELEGRAM_CHAT_ID');
  const resp = await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: c, text: msg, disable_web_page_preview: true })
  });
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok || !j.ok) throw new Error('Telegram recusou: ' + (j.description || resp.status));
  console.log('Enviado ao Telegram.');
}
main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
