// Mostra os chats em que o bot já recebeu mensagem (para achar o chat id do grupo).
//   node avisos/descobrir_chat.js     -> pede o token no terminal (não fica gravado em lugar nenhum)
const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
rl.question('Cole o token do bot e tecle Enter: ', async t => {
  rl.close();
  try {
    const r = await fetch(`https://api.telegram.org/bot${t.trim()}/getUpdates`);
    const j = await r.json();
    if (!j.ok) return console.log('Telegram recusou:', j.description);
    const chats = new Map();
    for (const u of j.result) { const c = (u.message || u.my_chat_member || u.channel_post || {}).chat; if (c) chats.set(c.id, c); }
    if (!chats.size) return console.log('Nenhum chat ainda. Mande uma mensagem no grupo (com o bot dentro) e rode de novo.');
    for (const c of chats.values()) console.log(`chat id: ${c.id}   (${c.type}: ${c.title || c.first_name || ''})`);
  } catch (e) { console.log('ERRO:', e.message); }
});
