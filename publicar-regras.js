// Publica o firestore.rules deste diretório nas regras do Firestore do projeto.
//
// Por que existe: as regras são uma allowlist de coleções — o que não está listado
// é negado. Toda coleção nova (foi o caso de wms_mov_log, em 26/08/2026) precisa
// entrar aqui, senão a tela que a lê mostra "Missing or insufficient permissions".
//
// Uso:
//   set FIREBASE_SA=C:\caminho\para\service-account.json
//   node publicar-regras.js
//
// A chave de conta de serviço NÃO fica no repositório. Ela é a mesma usada pela
// função de senha na Vercel (variável FIREBASE_SERVICE_ACCOUNT lá).
//
// O que o script faz: salva em backups/ o ruleset que está no ar, cria o ruleset
// novo a partir do arquivo local e aponta o release para ele. Para voltar atrás,
// basta republicar o conteúdo do backup.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CHAVE = process.env.FIREBASE_SA;
const PROJETO = 'mapaestoque-1c121';
const ORIGEM = path.join(__dirname, 'firestore.rules');

if (!CHAVE || !fs.existsSync(CHAVE)) {
  console.error('Defina FIREBASE_SA apontando para o JSON da conta de serviço do Firebase.');
  console.error('Ex.: set FIREBASE_SA=C:\\Users\\voce\\Downloads\\mapaestoque-...json');
  process.exit(1);
}

function b64url(x) {
  return Buffer.from(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function token(scope) {
  const sa = JSON.parse(fs.readFileSync(CHAVE, 'utf8'));
  const agora = Math.floor(Date.now() / 1000);
  const cab = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = b64url(JSON.stringify({
    iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token',
    iat: agora, exp: agora + 3600
  }));
  const ass = crypto.createSign('RSA-SHA256').update(cab + '.' + corpo)
    .sign(sa.private_key.replace(/\\n/g, '\n'));
  const jwt = cab + '.' + corpo + '.' + ass.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('token: ' + JSON.stringify(d));
  return d.access_token;
}

(async () => {
  const t = await token('https://www.googleapis.com/auth/firebase');
  const h = { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };

  const rel = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJETO}/releases`, { headers: h }).then(r => r.json());
  const atual = (rel.releases || []).find(r => r.name.includes('firestore'));
  if (atual) {
    const rs = await fetch(`https://firebaserules.googleapis.com/v1/${atual.rulesetName}`, { headers: h }).then(r => r.json());
    const dir = path.join(__dirname, 'backups');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    const carimbo = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const destino = path.join(dir, `firestore_rules_${carimbo}.rules`);
    fs.writeFileSync(destino, rs.source.files.map(f => f.content).join('\n'));
    console.log('backup do que estava no ar: ' + destino);
  }

  const conteudo = fs.readFileSync(ORIGEM, 'utf8');
  const novo = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJETO}/rulesets`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: conteudo }] } })
  }).then(r => r.json());
  if (novo.error) { console.error('erro ao criar ruleset: ' + JSON.stringify(novo.error, null, 2)); process.exit(1); }

  const pub = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJETO}/releases/cloud.firestore`, {
    method: 'PATCH', headers: h,
    body: JSON.stringify({ release: { name: `projects/${PROJETO}/releases/cloud.firestore`, rulesetName: novo.name } })
  }).then(r => r.json());
  if (pub.error) { console.error('erro ao publicar: ' + JSON.stringify(pub.error, null, 2)); process.exit(1); }

  console.log('publicado: ' + pub.rulesetName);
})();
