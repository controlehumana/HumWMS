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

const linha = g => {
  const quando = g.d < 0 ? `venceu há ${-g.d} d` : g.d === 0 ? 'vence HOJE' : `vence em ${g.d} d`;
  const end = [...g.pos].join(', ');
  return `• ${esc(g.sku)} ${esc(g.desc.slice(0, 38))}\n  Lote ${esc(g.lote)} · ${br(g.val)} (${quando}) · saldo ${g.saldo.toLocaleString('pt-BR')} · ${end ? '<b>' + esc(end) + '</b>' : 'sem endereço'}`;
};
const cab = hoje => `<b>Validades no CD - ${hoje.split('-').reverse().join('/')}</b>`;

// Junta as linhas em mensagens de até ~3800 caracteres (limite do Telegram: 4096),
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
// Cada "item" é um título, um lote (2 linhas) ou uma linha em branco.
const blocoItens = (titulo, arr) => [`<b>${titulo} (${arr.length})</b>`, ...arr.map(linha), ''];

// Aviso diário: todas as faixas em lista. Devolve { urgente, mensagens[] }.
function diaria(dados, hoje) {
  const l = agrupar(dados, hoje, 90);
  const faixas = [
    ['VENCIDOS', l.filter(g => g.d < 0)],
    ['VENCEM EM ATÉ 30 DIAS', l.filter(g => g.d >= 0 && g.d <= 30)],
    ['VENCEM EM 31 A 60 DIAS', l.filter(g => g.d > 30 && g.d <= 60)],
    ['VENCEM EM 61 A 90 DIAS', l.filter(g => g.d > 60)]
  ];
  const itens = [cab(hoje), ''];
  faixas.forEach(([t, a]) => { if (a.length) itens.push(...blocoItens(t, a)); });
  if (faixas.every(([, a]) => !a.length)) itens.push('Nenhum lote com saldo vence nos próximos 90 dias.');
  return { urgente: faixas[0][1].length + faixas[1][1].length > 0, mensagens: dividir(itens) };
}

// Consulta manual: modo 'venc' (só vencidos) ou N dias (o que vence de hoje até N dias).
function consulta(dados, hoje, modo) {
  if (modo === 'venc') {
    const a = agrupar(dados, hoje, 0).filter(g => g.d < 0);
    return a.length ? dividir([cab(hoje), '', ...blocoItens('VENCIDOS', a)]) : ['Nenhum lote vencido com saldo.'];
  }
  const a = agrupar(dados, hoje, modo).filter(g => g.d >= 0);
  return a.length ? dividir([cab(hoje), '', ...blocoItens(`VENCEM EM ATÉ ${modo} DIAS`, a)]) : [`Nenhum lote com saldo vence em até ${modo} dias.`];
}

module.exports = { hojeSP, diaria, consulta, esc };
