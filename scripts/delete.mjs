#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const F_SESSION = join(ROOT, '.qzone', 'session.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';

const args = process.argv.slice(2);
const opt = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};

const tid = opt('--tid');
if (!tid) {
  console.error('用法: node scripts/delete.mjs --tid <说说ID>');
  process.exit(1);
}
if (!existsSync(F_SESSION)) {
  console.error('未登录：请先运行 node scripts/login.mjs --login');
  process.exit(2);
}

const s = JSON.parse(readFileSync(F_SESSION, 'utf8'));
const jar = s.cookies;
const cookie = Object.entries(jar).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
const uin = s.uin;

function gtk(k) {
  let h = 5381;
  for (let i = 0; i < k.length; i++) h += (h << 5) + k.charCodeAt(i);
  return h & 0x7fffffff;
}
const g_tk = gtk(jar['p_skey'] || jar['skey'] || '');

const body = new URLSearchParams({
  topicId: tid,
  uin,
  hostuin: uin,
  format: 'json',
  qzreferrer: `https://user.qzone.qq.com/${uin}`,
});
const url = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_delete_v6?g_tk=${g_tk}`;
console.log(`删除中… tid=${tid}`);
const res = await fetch(url, {
  method: 'POST',
  headers: { 'User-Agent': UA, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', Referer: `https://user.qzone.qq.com/${uin}` },
  body,
});
const txt = await res.text();
console.log('HTTP', res.status);
console.log(txt.slice(0, 500));
