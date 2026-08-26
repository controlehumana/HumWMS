// Redefinição de senha de qualquer usuário do WMS, por um administrador.
//
// Por que existe: o Firebase no navegador só deixa alguém mexer na própria senha.
// Definir a senha de outra pessoa exige o Admin SDK, que precisa de credencial de
// servidor e por isso não pode viver no HTML público do WMS. Esta função roda na
// Vercel, ao lado do proxy do ERP, e é o único lugar do sistema com esse poder.
//
// Uso: POST /api/senha  { idToken, email, novaSenha }
//   idToken   — token do admin que está pedindo (auth.currentUser.getIdToken())
//   email     — de quem terá a senha trocada
//   novaSenha — a nova senha (mínimo 6, exigência do Firebase)
//
// Quem pode: só quem o próprio Firestore reconhece como role 'admin' e ativo. O
// e-mail do solicitante vem do token verificado, nunca do corpo da requisição,
// então não adianta forjar o campo.

const admin = require('firebase-admin');

const ORIGENS = [
  'https://controlehumana.github.io',
  'http://localhost:8790'
];

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
  // A chave privada costuma chegar com \n escapado quando colada numa env var.
  if (conta.private_key) conta.private_key = conta.private_key.replace(/\\n/g, '\n');
  return admin.initializeApp({ credential: admin.credential.cert(conta) });
}

module.exports = async (req, res) => {
  const origem = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', ORIGENS.includes(origem) ? origem : ORIGENS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ sucesso: false, mensagem: 'Use POST.' });
  }

  const corpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { idToken, email, novaSenha } = corpo;

  if (!idToken)   return res.status(401).json({ sucesso: false, mensagem: 'Sessão não identificada. Entre de novo no WMS.' });
  if (!email)     return res.status(400).json({ sucesso: false, mensagem: 'Faltou o e-mail do usuário.' });
  if (!novaSenha || String(novaSenha).length < 6) {
    return res.status(400).json({ sucesso: false, mensagem: 'A senha precisa ter ao menos 6 caracteres.' });
  }

  let app;
  try {
    app = iniciarAdmin();
  } catch (e) {
    if (e.semCredencial) {
      return res.status(503).json({
        sucesso: false,
        mensagem: 'A função ainda não tem a chave de administrador do Firebase. Configure a variável FIREBASE_SERVICE_ACCOUNT no projeto da Vercel.'
      });
    }
    return res.status(500).json({ sucesso: false, mensagem: 'Falha ao iniciar o Firebase Admin: ' + e.message });
  }

  const alvo = String(email).trim().toLowerCase();

  try {
    // 1. Quem está pedindo, segundo o token (não segundo o que veio no corpo).
    const token = await admin.auth().verifyIdToken(idToken);
    const solicitante = String(token.email || '').toLowerCase();
    if (!solicitante) {
      return res.status(401).json({ sucesso: false, mensagem: 'Token sem e-mail.' });
    }

    // 2. Esse e-mail é admin ativo no WMS?
    const doc = await admin.firestore().collection('wms_users').doc(solicitante).get();
    const dados = doc.exists ? doc.data() : null;
    if (!dados || dados.active === false || dados.role !== 'admin') {
      return res.status(403).json({ sucesso: false, mensagem: 'Só um administrador do WMS pode trocar a senha de outra pessoa.' });
    }

    // 3. Grava a senha. Se a conta ainda não existe no Auth (por exemplo, cadastro
    //    que só chegou ao Firestore), cria com essa senha em vez de falhar.
    let uid;
    try {
      const usuario = await admin.auth().getUserByEmail(alvo);
      await admin.auth().updateUser(usuario.uid, { password: String(novaSenha) });
      uid = usuario.uid;
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        const criado = await admin.auth().createUser({ email: alvo, password: String(novaSenha) });
        uid = criado.uid;
      } else {
        throw e;
      }
    }

    // 4. Senha definida por terceiro é senha conhecida por terceiro: o coletor
    //    obriga a troca no próximo acesso.
    await admin.firestore().collection('wms_users').doc(alvo).set({
      mustChangePassword: true,
      senhaRedefinidaPor: solicitante,
      senhaRedefinidaEm: new Date().toISOString()
    }, { merge: true });

    return res.status(200).json({
      sucesso: true,
      mensagem: `Senha de ${alvo} gravada. Ela será obrigada a trocar no próximo acesso ao coletor.`,
      uid
    });
  } catch (e) {
    const codigo = e.code || '';
    if (codigo === 'auth/id-token-expired' || codigo === 'auth/argument-error') {
      return res.status(401).json({ sucesso: false, mensagem: 'Sua sessão expirou. Recarregue o WMS e tente de novo.' });
    }
    return res.status(500).json({ sucesso: false, mensagem: 'Falha ao gravar a senha: ' + (e.message || e) });
  }
};
