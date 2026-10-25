import WebSocket from 'ws';
const ws = new WebSocket('wss://mood-lens-ensure-adopted.trycloudflare.com');
ws.on('open', () => ws.send(JSON.stringify({ t: 'create', name: 'CF测试' })));
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.t === 'joined') { console.log('✅ Cloudflare 隧道 WebSocket 连通，房间码:', m.code); process.exit(0); }
});
ws.on('error', (e) => { console.log('❌ WS错误:', e.message); process.exit(1); });
setTimeout(() => { console.log('❌ 超时'); process.exit(1); }, 15000);
