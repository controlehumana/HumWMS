// Lista dos lotes que estão na Segregação (coleção wms_segregados do Firestore).
// O coletor marca e desmarca; aqui só lemos, para o aviso e o bot de validade mostrarem
// "Segregação" no lugar de "sem endereço". A chave é a mesma do coletor (segKey).
const admin = require('firebase-admin');

function iniciarAdmin() {
  if (admin.apps.length) return admin.app();
  const bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!bruto) throw new Error('FIREBASE_SERVICE_ACCOUNT não está configurada nesta função.');
  const conta = JSON.parse(bruto);
  if (conta.private_key) conta.private_key = conta.private_key.replace(/\\n/g, '\n');
  return admin.initializeApp({ credential: admin.credential.cert(conta) });
}

// Devolve um Set com as chaves (SKU__lote__validade, "/" trocado por "~").
// Se o Firebase falhar, devolve Set vazio: o aviso de validade nunca deve parar por causa disso.
async function carregar() {
  try {
    iniciarAdmin();
    const s = await admin.firestore().collection('wms_segregados').get();
    return new Set(s.docs.map(d => d.id));
  } catch (e) {
    console.error('segregados:', e && e.message);
    return new Set();
  }
}

module.exports = { carregar };
