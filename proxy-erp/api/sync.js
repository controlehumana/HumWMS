// Sincronização automática ERP → Firestore, rodando no servidor (Vercel Cron).
//
// Por que existe: até 09/2026 a sincronização das 10h/17h só acontecia se um
// admin estivesse com o WMS aberto numa aba (setInterval no navegador, ver
// index.html "Auto-sync agendado"). Sem aba aberta, não sincroniza — e foi
// exatamente isso que deixou wms_items vazio por dias em 09/2026: uma
// sincronização parcial (client-side, apaga-depois-regrava) foi interrompida
// no meio e não teve chance de rodar de novo porque ninguém tinha o site
// aberto no horário seguinte. Esta função roda sozinha, sem depender de
// navegador nenhum.
//
// Gatilho: Vercel Cron (ver vercel.json), autenticado por CRON_SECRET — a
// Vercel manda esse header automaticamente quando a variável de ambiente
// CRON_SECRET está configurada no projeto. Também pode ser chamada manualmente
// (ex.: para consertar uma sincronização perdida) com o mesmo header.
//
// Diferença deliberada do fluxo do navegador (_commitImportData no
// index.html): aqui NUNCA apagamos a coleção antes de regravar. Primeiro
// grava os itens novos, só depois apaga os docs antigos que sobraram sem
// corresponder a nenhum item novo. Assim, se a função cair no meio (timeout,
// ERP fora do ar, etc.), o pior caso é ficar com dado velho misturado —
// nunca com a coleção vazia.

const admin = require('firebase-admin');

const ERP_STOCK_URL   = 'https://gestao.humanaalimentar.com.br/erp/api/v1/human/crud-stock/index.php';
const ERP_STOCK_TOKEN = process.env.ERP_TOKEN; // mesma variável do proxy (erp.js)
const CHUNK = 400; // limite de operações por batch do Firestore

function iniciarAdmin() {
  if (admin.apps.length) return admin.app();
  const bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!bruto) {
    const e = new Error('FIREBASE_SERVICE_ACCOUNT não está configurada nesta função.');
    e.semCredencial = true;
    throw e;
  }
  let conta;
  try {
    conta = JSON.parse(bruto);
  } catch (_) {
    const e = new Error('FIREBASE_SERVICE_ACCOUNT não é um JSON válido.');
    e.semCredencial = true;
    throw e;
  }
  if (conta.private_key) conta.private_key = conta.private_key.replace(/\\n/g, '\n');
  return admin.initializeApp({ credential: admin.credential.cert(conta) });
}

// Mesma lógica de parseApiData() do index.html — mantida em espelho manual.
// Se aquela função mudar (ex.: novo campo, nova regra de bomba enteral),
// replicar a mudança aqui também.
function parseApiData(data) {
  if (!Array.isArray(data) || data.length === 0) throw new Error('API retornou dados vazios.');
  const items = [], noAddr = [], addrSet = new Set();
  const seen = new Set();
  for (const r of data) {
    const dedupKey = `${r.item_id||''}_${r.numero_lote||''}_${r.rua||''}_${r.posicao||''}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    const rua = String(r.rua || '').trim().toUpperCase();
    const pos = String(r.posicao || '').trim();
    let val = '';
    if (r.dt_validade) {
      const parts = String(r.dt_validade).split('-');
      if (parts.length === 3) val = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    const desc = String(r.item_descricao || '').trim();
    const isBombaEnteral = desc.toUpperCase().includes('BOMBA ENTERAL');
    const itemRua = (rua && pos) ? rua : (isBombaEnteral ? 'P' : '');
    const itemPos = (rua && pos) ? pos : (isBombaEnteral ? '99' : '');
    const item = {
      sku:   String(r.item_codigo        || '').trim(),
      desc,
      lote:  String(r.numero_lote        || '').trim(),
      val,
      est:      r.saldo_aberto != null ? String(r.saldo_aberto).trim() : '',
      estBruto: r.estoque != null ? String(r.estoque).trim() : '',
      idEnd: String(r.id_item_enderecamento || '').trim(),
      emp:   String(r.empresa_apelido    || '').trim(),
      itemId:    String(r.item_id    || '').trim(),
      unidadeId: String(r.empresa_id || '').trim(),
      rua: itemRua, pos: itemPos
    };
    if (rua === 'SEGREGACAO') { item.rua = ''; item.pos = ''; item.segregado = true; noAddr.push(item); continue; }
    if (itemRua && itemPos) { addrSet.add(`${itemRua}|${itemPos}`); items.push(item); }
    else { noAddr.push(item); }
  }
  const addresses = Array.from(addrSet).map(k => {
    const [rua, pos] = k.split('|');
    return { rua, pos, cap: 99, active: true };
  });
  return { items, noAddr, addresses, stats: { total: items.length + noAddr.length, withAddr: items.length, noAddr: noAddr.length, addrs: addresses.length } };
}

function addrKey(rua, pos) {
  // Grade travada (WMS_RUAS/wmsPos no index.html) não é reproduzida aqui de
  // propósito: os dados já vêm normalizados pela API do ERP (rua/posicao),
  // e esta chave só precisa ser estável para o diff de itens, não validar grade.
  return `${safeIdPart(rua).toUpperCase()}_${safeIdPart(pos)}`;
}

// IDs de documento no Firestore não podem conter "/" (é separador de
// caminho) — e lote/código de item às vezes vem com "/" do ERP (ex.:
// "2745/24"). Sem isto, db.collection(x).doc(id) explode com "Value for
// argument documentPath must point to a document".
function safeIdPart(s) {
  return String(s == null ? '' : s).replace(/[/\s]+/g, '-');
}

async function commitBatched(db, colName, docs, idFn) {
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = db.batch();
    docs.slice(i, i + CHUNK).forEach(d => batch.set(db.collection(colName).doc(idFn(d)), d));
    await batch.commit();
  }
}

async function deleteBatched(db, colName, ids) {
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = db.batch();
    ids.slice(i, i + CHUNK).forEach(id => batch.delete(db.collection(colName).doc(id)));
    await batch.commit();
  }
}

// Grava os docs novos primeiro, só depois apaga os antigos que não foram
// reescritos — nunca existe um instante com a coleção vazia.
async function safeReplace(db, colName, newDocs, idFn) {
  const oldSnap = await db.collection(colName).get();
  const oldIds = new Set(oldSnap.docs.map(d => d.id));

  await commitBatched(db, colName, newDocs, idFn);

  const newIds = new Set(newDocs.map(idFn));
  const toDelete = [...oldIds].filter(id => !newIds.has(id));
  await deleteBatched(db, colName, toDelete);

  return { escritos: newDocs.length, apagados: toDelete.length };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  // Autenticação: só a Vercel (cron) ou quem tiver o segredo pode disparar.
  const segredo = process.env.CRON_SECRET;
  if (segredo) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${segredo}`) {
      return res.status(401).json({ sucesso: false, mensagem: 'Não autorizado.' });
    }
  }

  let app;
  try {
    app = iniciarAdmin();
  } catch (e) {
    if (e.semCredencial) {
      return res.status(503).json({ sucesso: false, mensagem: e.message });
    }
    return res.status(500).json({ sucesso: false, mensagem: 'Falha ao iniciar o Firebase Admin: ' + e.message });
  }

  const db = admin.firestore();
  const inicio = Date.now();

  try {
    if (!ERP_STOCK_TOKEN) {
      return res.status(503).json({ sucesso: false, mensagem: 'Falta a variável ERP_TOKEN na Vercel.' });
    }
    const today = new Date().toISOString().slice(0, 10);
    const url = `${ERP_STOCK_URL}?token=${ERP_STOCK_TOKEN}&data_limite=${today}&_=${Date.now()}`;
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`ERP respondeu HTTP ${resp.status}`);
    const data = await resp.json();

    const parsed = parseApiData(data);

    // Endereços: só cria os novos (ex.: P-99 da bomba enteral), nunca apaga —
    // a grade cadastrada é dado do admin, não do ERP.
    if (parsed.addresses.length) {
      const CHUNK_A = 400;
      for (let i = 0; i < parsed.addresses.length; i += CHUNK_A) {
        const batch = db.batch();
        parsed.addresses.slice(i, i + CHUNK_A).forEach(a => {
          batch.set(db.collection('wms_addresses').doc(addrKey(a.rua, a.pos)), a, { merge: true });
        });
        await batch.commit();
      }
    }

    const itemsResult = await safeReplace(
      db, 'wms_items', parsed.items,
      it => `${addrKey(it.rua, it.pos)}_${safeIdPart(it.itemId)}_${safeIdPart(it.lote)}`
    );
    const unaddrResult = await safeReplace(
      db, 'wms_unaddressed', parsed.noAddr.map(it => ({ ...it, pendingAddr: true })),
      it => `unaddr_${safeIdPart(it.itemId)}_${safeIdPart(it.lote)}`
    );

    const importTs = new Date().toISOString();
    await db.collection('wms_import_log').add({
      ts: importTs,
      fonte: 'api-auto-cron',
      importedBy: 'cron-vercel',
      importedByName: 'Sincronização automática (servidor)',
      totalItens: parsed.items.length,
      semEndereco: parsed.noAddr.length,
      enderecos: parsed.addresses.length
    });

    return res.status(200).json({
      sucesso: true,
      mensagem: `Sincronizado: ${itemsResult.escritos} itens endereçados, ${unaddrResult.escritos} pendentes, ${parsed.addresses.length} endereços novos/atualizados.`,
      itens: itemsResult, pendentes: unaddrResult, ms: Date.now() - inicio
    });
  } catch (e) {
    return res.status(500).json({ sucesso: false, mensagem: 'Falha na sincronização: ' + (e.message || e), ms: Date.now() - inicio });
  }
};
