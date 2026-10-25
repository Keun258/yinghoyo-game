import WebSocket from 'ws';
const ws = new WebSocket('ws://localhost:3000');
const t0 = Date.now();
ws.on('open', () => ws.send(JSON.stringify({ t: 'create', name: '调试' })));
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  const ts = ((Date.now() - t0) / 1000).toFixed(1);
  if (m.t === 'snap') {
    if (!ws._lastSnapLog || Date.now() - ws._lastSnapLog > 2000) {
      ws._lastSnapLog = Date.now();
      console.log(`${ts}s snap phase=${m.phase} phaseLeft=${m.phaseLeft} round=${m.round} players=${m.players.length} wins=${JSON.stringify(m.wins)}`);
    }
  } else {
    console.log(`${ts}s ${m.t}`, m.t === 'joined' ? `code=${m.code}` : m.t === 'round_end' ? `winner=${m.winner} reason=${m.reason}` : m.t === 'round_start' ? `round=${m.round}` : '');
  }
  if (m.t === 'joined') {
    setTimeout(() => ws.send(JSON.stringify({ t: 'side', side: 'monkey' })), 100);
    setTimeout(() => ws.send(JSON.stringify({ t: 'hero', hero: 'yinghao' })), 200);
    setTimeout(() => ws.send(JSON.stringify({ t: 'start' })), 400);
  }
});
setTimeout(() => process.exit(0), 22000);
