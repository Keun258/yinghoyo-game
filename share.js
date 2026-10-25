// 一键分享：游戏服务器 + 公网隧道（优先 Cloudflare，备用 localtunnel）
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const server = spawn(process.execPath, ['server.js'], { stdio: 'inherit' });
console.log('🐵 游戏服务器启动中（端口 3000）...\n');

function printBox(url) {
  console.log('🌐 ================================================');
  console.log('   公网链接（发给同学，浏览器打开就能玩）：');
  console.log('   ' + url);
  console.log('🌐 ================================================');
  console.log('   提示：关闭本窗口即停止分享\n');
}

if (fs.existsSync('cloudflared.exe')) {
  const cf = spawn('cloudflared.exe', ['tunnel', '--url', 'http://localhost:3000', '--no-autoupdate']);
  let printed = false;
  cf.stderr.on('data', (chunk) => {
    const m = String(chunk).match(/https:\/\/[\w-]+\.trycloudflare\.com/);
    if (m && !printed) { printed = true; printBox(m[0]); }
  });
  cf.on('exit', () => { console.log('隧道已断开'); process.exit(1); });
} else {
  const { localtunnel } = await import('localtunnel');
  const tunnel = await localtunnel({ port: 3000 });
  printBox(tunnel.url);
  console.log('   localtunnel 模式：同学首次打开若要求 Tunnel Password，输入你的公网 IP');
  tunnel.on('close', () => process.exit(1));
}
process.on('SIGINT', () => { server.kill(); process.exit(0); });
