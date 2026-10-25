// 视觉 QA v2：双浏览器同房，截图 + 快照断言 + 控制台零报错
import { chromium } from 'playwright';
import fs from 'node:fs';

fs.mkdirSync('test/shots', { recursive: true });
const errors = [];
let fails = 0;
const check = (cond, label) => { console.log((cond ? '✅' : '❌') + ' ' + label); if (!cond) fails++; };

const browser = await chromium.launch({ channel: 'msedge', headless: true });

async function mkPage(tag) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${tag}] PAGEERROR: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`[${tag}] REQFAIL: ${r.url()}`));
  return page;
}

const pa = await mkPage('A');
await pa.goto('http://localhost:3000');
await pa.screenshot({ path: 'test/shots/1-title.png' });
await pa.fill('#name-input', '测试甲');
await pa.click('#btn-create');
await pa.waitForSelector('#screen-lobby.on', { timeout: 5000 });
const code = await pa.textContent('#room-code');
check(code && code.trim().length === 4, `房间码=${code}`);
await pa.click('#btn-side-monkey');
await pa.waitForTimeout(300);

const pb = await mkPage('B');
await pb.goto('http://localhost:3000');
await pb.fill('#name-input', '测试乙');
await pb.fill('#code-input', code.trim());
await pb.click('#btn-join');
await pb.waitForSelector('#screen-lobby.on', { timeout: 5000 });
await pb.click('#btn-side-timor');
await pb.waitForTimeout(300);

const heroCards = await pa.$$('.hero-card');
check(heroCards.length === 4, `猴子方可选英雄数=${heroCards.length}（2专属+2中立）`);
if (heroCards[0]) await heroCards[0].click(); // 应豪
const heroCardsB = await pb.$$('.hero-card');
if (heroCardsB[2]) await heroCardsB[2].click(); // 中立英雄
await pa.waitForTimeout(300);
await pa.screenshot({ path: 'test/shots/3-lobby-heroes.png' });

await pa.click('#btn-start');
await pa.waitForSelector('#screen-game.on', { timeout: 5000 });
await pb.waitForSelector('#screen-game.on', { timeout: 5000 });
check(true, '双方进入游戏画面');
await pa.waitForTimeout(2600);
await pa.screenshot({ path: 'test/shots/4-game-prep.png' });

await pa.keyboard.down('KeyW');
await pa.waitForTimeout(2500);
await pa.keyboard.up('KeyW');
await pa.waitForTimeout(400);
await pa.screenshot({ path: 'test/shots/5-game-move.png' });
await pb.screenshot({ path: 'test/shots/6-game-defender.png' });

// Q 技能（应豪冲刺）
await pa.keyboard.press('KeyQ');
await pa.waitForTimeout(600);
await pa.screenshot({ path: 'test/shots/8-skill.png' });

await pa.keyboard.down('Tab');
await pa.waitForTimeout(300);
await pa.screenshot({ path: 'test/shots/7-scoreboard.png' });
await pa.keyboard.up('Tab');

const state = await pa.evaluate(() => {
  const c = document.querySelector('#screen-game canvas');
  const s = window.__snap;
  return { ok: !!c && c.width > 100 && !!s, phase: s?.phase, players: s?.players?.length, phaseLeft: s?.phaseLeft };
});
check(state.ok, `WebGL渲染+快照流入（phase=${state.phase} players=${state.players} 剩余${state.phaseLeft}s）`);

// 等第一回合结束 banner
await pa.waitForTimeout(16000);
const re = await pa.evaluate(() => document.getElementById('banner').textContent);
check(re.length > 0, `回合结束横幅: ${re}`);
await pa.screenshot({ path: 'test/shots/9-round2.png' });

check(errors.length === 0, `控制台零报错（实际 ${errors.length} 条）`);
errors.slice(0, 8).forEach(e => console.log('  ⚠️', e.slice(0, 200)));

await browser.close();
console.log(fails === 0 ? '\n🎉 视觉QA通过' : `\n💥 ${fails} 项失败`);
process.exit(fails ? 1 : 0);
