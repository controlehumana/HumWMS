// Regras de validade compartilhadas: aviso diário (GitHub Actions) e consultas do bot (api/telegram.js).
// Mesmas regras da aba Validades do coletor: só lote com saldo > 0, agrupado por SKU+lote+validade
// (o saldo_aberto é do lote inteiro, não se soma entre posições). Saída em HTML do Telegram.
const num = v => Number(String(v == null ? '' : v).replace(',', '.')) || 0;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); // AAAA-MM-DD
const dias = (iso, hoje) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.parse(hoje + 'T00:00:00Z')) / 86400000);
};
const br = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : '-'; };

// Lotes com saldo que vencem em até maxDias (inclui vencidos), do mais urgente ao menos.
function agrupar(dados, hoje, maxDias) {
  const mapa = new Map();
  for (const x of dados) {
    const d = dias(x.dt_validade, hoje);
    if (d === null || d > maxDias || num(x.saldo_aberto) <= 0) continue;
    const k = [x.item_codigo, x.numero_lote, x.dt_validade].join('|');
    let g = mapa.get(k);
    if (!g) { g = { sku: String(x.item_codigo || '').trim(), desc: x.item_descricao || '', lote: x.numero_lote || '-', val: x.dt_validade, d, saldo: num(x.saldo_aberto), pos: new Set() }; mapa.set(k, g); }
    if (x.rua && x.posicao) g.pos.add(String(x.rua).toUpperCase() + String(x.posicao).trim());
  }
  return [...mapa.values()].sort((a, b) => a.d - b.d);
}

// Cartão de um lote, em 3 linhas:
//   2290 · LINHAHUM DIATROFI SACHE 52G
//   📍 F38   📦 Lote 2DS3325A   Saldo 3
//   📅 11/08/2026 · venceu há 64 dias
const linha = g => {
  const quando = g.d < 0 ? `venceu há ${-g.d} ${-g.d === 1 ? 'dia' : 'dias'}`
    : g.d === 0 ? 'vence HOJE' : `vence em ${g.d} ${g.d === 1 ? 'dia' : 'dias'}`;
  const end = [...g.pos].join(', ');
  return `<b>${esc(g.sku)}</b> · ${esc(g.desc.slice(0, 60))}\n` +
    `📍 ${end ? '<b>' + esc(end) + '</b>' : 'sem endereço'}   📦 Lote ${esc(g.lote)}   Saldo ${g.saldo.toLocaleString('pt-BR')}\n` +
    `📅 ${br(g.val)} · ${quando}\n`;
};
const cab = hoje => `📋 <b>Validades no CD</b> · ${hoje.split('-').reverse().join('/')}`;
const LINHA = '━━━━━━━━━━━━━━━━━━';

// Junta os itens em mensagens de até ~3800 caracteres (limite do Telegram: 4096),
// quebrando só entre itens (um lote nunca é cortado no meio).
function dividir(itens) {
  const out = []; let atual = '';
  for (const it of itens) {
    if (atual && (atual + '\n' + it).length > 3800) { out.push(atual); atual = it; }
    else atual = atual ? atual + '\n' + it : it;
  }
  if (atual) out.push(atual);
  return out;
}

// Faixas de vencimento (dias a partir de hoje). Cada uma vira um bloco com título e seus lotes.
const FAIXAS = [
  { de: 0,   ate: 30,  icone: '🟠' },
  { de: 31,  ate: 60,  icone: '🟡' },
  { de: 61,  ate: 90,  icone: '🟢' },
  { de: 91,  ate: 180, icone: '🔵' },
  { de: 181, ate: 365, icone: '🔵' }
];
const tituloFaixa = (f, limite) => {
  const fim = Math.min(f.ate, limite);
  return f.de === 0 ? `Até ${fim} dias` : `De ${f.de} a ${fim} dias`;
};
// O título vai colado no primeiro lote, para uma quebra de mensagem nunca deixar o título sozinho no fim.
const bloco = (titulo, arr) => [`${LINHA}\n${titulo} · ${arr.length} ${arr.length === 1 ? 'lote' : 'lotes'}\n${LINHA}\n\n${linha(arr[0])}`, ...arr.slice(1).map(linha)];
const blocoVencidos = arr => bloco('🔴 <b>VENCIDOS</b>', arr);
const blocoFaixa = (f, arr, limite) => bloco(`${f.icone} <b>${tituloFaixa(f, limite).toUpperCase()}</b>`, arr);

// Monta os blocos de hoje até `limite` dias; com vencidos = true começa pelos já vencidos.
function blocos(lotes, limite, vencidos) {
  const itens = [];
  const v = lotes.filter(g => g.d < 0);
  if (vencidos && v.length) itens.push(...blocoVencidos(v));
  for (const f of FAIXAS) {
    if (f.de > limite) break;
    const a = lotes.filter(g => g.d >= f.de && g.d <= Math.min(f.ate, limite));
    if (a.length) itens.push(...blocoFaixa(f, a, limite));
  }
  return itens;
}

// Aviso diário: vencidos + tudo até 90 dias. Devolve { urgente, mensagens[] }.
function diaria(dados, hoje) {
  const l = agrupar(dados, hoje, 90);
  const itens = blocos(l, 90, true);
  const resumo = `🔴 ${l.filter(g => g.d < 0).length} vencidos · 🟠 ${l.filter(g => g.d >= 0 && g.d <= 30).length} até 30 dias · 🟡 ${l.filter(g => g.d > 30 && g.d <= 60).length} de 31 a 60 · 🟢 ${l.filter(g => g.d > 60).length} de 61 a 90`;
  const topo = [cab(hoje), resumo, ''];
  return {
    urgente: l.some(g => g.d <= 30),
    mensagens: dividir(itens.length ? [...topo, ...itens] : [...topo, 'Nenhum lote com saldo vence nos próximos 90 dias.'])
  };
}

// Consulta manual: modo 'venc' (só vencidos) ou N dias (o que vence de hoje até N dias).
function consulta(dados, hoje, modo) {
  if (modo === 'venc') {
    const a = agrupar(dados, hoje, 0).filter(g => g.d < 0);
    return a.length ? dividir([cab(hoje), '', ...blocoVencidos(a)]) : ['Nenhum lote vencido com saldo.'];
  }
  const l = agrupar(dados, hoje, modo).filter(g => g.d >= 0);
  if (!l.length) return [`Nenhum lote com saldo vence em até ${modo} dias.`];
  const topo = [cab(hoje), `Vencem em até <b>${modo} dias</b>: ${l.length} ${l.length === 1 ? 'lote' : 'lotes'}`, ''];
  return dividir([...topo, ...blocos(l, modo, false)]);
}

// Lembrete só dos vencidos com saldo: lista vazia quando não há nenhum.
function vencidos(dados, hoje) {
  const a = agrupar(dados, hoje, 0).filter(g => g.d < 0);
  return a.length ? dividir([cab(hoje), '', ...blocoVencidos(a)]) : [];
}

module.exports = { hojeSP, diaria, consulta, vencidos, esc };
