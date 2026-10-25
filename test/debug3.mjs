import WebSocket from 'ws';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const a = { ws: new WebSocket('ws://localhost:3000'), msgs: [], id: null, code: null };
a.ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.t !== 'snap') a.msgs.push(m); if (m.t === 'joined') { a.id = m.id; a.code = m.code; } });
await new Promise(r => a.ws.on('open', r));
a.ws.send(JSON.stringify({ t: 'create', name: '房主' })); await sleep(300);
a.ws.send(JSON.stringify({ t: 'side', side: 'monkey' })); await sleep(150);
a.ws.send(JSON.stringify({ t: 'hero', hero: 'yinghao' })); await sleep(150);
a.ws.send(JSON.stringify({ t: 'start' }));
for (let i = 0; i < 20; i++) {
  await sleep(4000);
  console.log(`t=${(i + 1) * 4}s 事件:`, a.msgs.map(m => m.t + (m.t === 'round_end' ? `(${m.winner}/${m.reason})` : '') + (m.t === 'round_start' ? `(第${m.round}回合)` : '')).join(' '));
}
process.exit(0);
