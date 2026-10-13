#!/usr/bin/env node
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { pngToAscii } from './lib/png-ascii.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, '.qzone');
const F_QR = join(DATA, 'qr.png');
const F_QR_TXT = join(DATA, 'qr.txt');
const F_STATE = join(DATA, 'state.json');
const F_SESSION = join(DATA, 'session.json');

const APPID = '549000912';
const DAID = '5';
const U1 = encodeURIComponent('https://user.qzone.qq.com/');
const REF = 'https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=' + APPID;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(DATA, { recursive: true });

let jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
function absorb(res) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of list) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
async function req(url) {
  const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': UA, Referer: REF, Cookie: cookieHeader() } });
  absorb(res);
  return res;
}
const hash33 = (s) => {
  let e = 0;
  for (let i = 0; i < s.length; i++) e += (e << 5) + s.charCodeAt(i);
  return e & 0x7fffffff;
};

function loadState() {
  if (!existsSync(F_STATE)) return null;
  const o = JSON.parse(readFileSync(F_STATE, 'utf8'));
  jar = new Map(Object.entries(o.cookies || {}));
  return o;
}
const loadSession = () => (existsSync(F_SESSION) ? JSON.parse(readFileSync(F_SESSION, 'utf8')) : null);
function saveState(o) {
  writeFileSync(F_STATE, JSON.stringify({ cookies: Object.fromEntries(jar), ...o }, null, 2));
}

function toAscii(buf) {
  try {
    return pngToAscii(buf);
  } catch {
    return '';
  }
}
function writeQrArtifacts(buf) {
  const a = toAscii(buf);
  if (a) writeFileSync(F_QR_TXT, a);
  console.log(a || `(二维码已保存: ${F_QR})`);
}

async function fetchQR() {
  const res = await req(`https://ssl.ptlogin2.qq.com/ptqrshow?appid=${APPID}&e=2&l=M&s=3&d=72&v=4&t=${Math.random()}&daid=${DAID}&pt_3rd_aid=0`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(F_QR, buf);
  const qrsig = jar.get('qrsig') || '';
  if (!qrsig) throw new Error('未获取到 qrsig cookie');
  const token = hash33(qrsig);
  saveState({ qrsig, token, phase: 'waiting', ts: Date.now() });
  return { qrsig, token, buf };
}

async function pollOnce(token) {
  const res = await req(`https://ssl.ptlogin2.qq.com/ptqrlogin?u1=${U1}&ptqrtoken=${token}&ptredirect=1&h=1&t=1&g=1&from_ui=1&ptlang=2052&action=0-0-${Date.now()}&js_ver=10233&js_type=1&login_sig=&pt_uistyle=40&aid=${APPID}&daid=${DAID}&`);
  const txt = await res.text();
  const c = txt.match(/ptuiCB\(\s*'(-?\d+)'/);
  if (!c) return { code: '?', raw: txt.slice(0, 200) };
  const u = txt.match(/ptuiCB\(\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'([^']*)'/);
  return { code: c[1], redirect: u ? u[1] : '' };
}

function findBrowser() {
  if (process.env.QZONE_BROWSER && existsSync(process.env.QZONE_BROWSER)) return process.env.QZONE_BROWSER;
  const cands = {
    win32: [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/microsoft-edge', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  }[process.platform] || [];
  return cands.find(existsSync) || null;
}

async function complete(url) {
  const bin = findBrowser();
  if (!bin) throw new Error('未找到 Edge/Chrome，请安装或用 QZONE_BROWSER 指定可执行文件');
  const browser = await chromium.launch({ executablePath: bin, headless: true });
  try {
    const ctx = await browser.newContext({ userAgent: UA });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    let cookies = await ctx.cookies();
    const uin = ((cookies.find((c) => c.name === 'uin') || {}).value || '').replace(/^o/, '');
    if (uin) {
      await page.goto(`https://user.qzone.qq.com/${uin}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(4000);
      cookies = await ctx.cookies();
    }
    const map = Object.fromEntries(cookies.map((c) => [c.name, c.value]));
    const expires = Object.fromEntries(cookies.map((c) => [c.name, c.expires]));
    const finalUrl = page.url();
    writeFileSync(F_SESSION, JSON.stringify({ uin, cookies: map, expires, finalUrl, ts: Date.now() }, null, 2));
    return { uin, finalUrl, loggedIn: /user\.qzone\.qq\.com/.test(finalUrl) };
  } finally {
    await browser.close();
  }
}

async function checkSession(s) {
  if (!s || !s.cookies) return false;
  const cookie = Object.entries(s.cookies).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
  try {
    const res = await fetch(`https://user.qzone.qq.com/${s.uin}`, { redirect: 'manual', headers: { 'User-Agent': UA, Cookie: cookie } });
    const loc = res.headers.get('location') || '';
    return res.status === 200 && !/i\.qq\.com|ptlogin/.test(loc);
  } catch {
    return false;
  }
}

async function pollLoop({ qrsig, token, seconds, stopOnRenew }) {
  const end = Date.now() + seconds * 1000;
  let last = '';
  while (Date.now() < end) {
    let r;
    try {
      r = await pollOnce(token);
    } catch {
      await sleep(2500);
      continue;
    }
    if (r.code !== last) {
      last = r.code;
      if (r.code === '66') {
        saveState({ qrsig, token, phase: 'waiting', ts: Date.now() });
        console.log('等待扫码…');
      } else if (r.code === '67') {
        saveState({ qrsig, token, phase: 'scanned', ts: Date.now() });
        console.log('已扫描，请在手机上确认');
      } else if (r.code === '65') {
        const g = await fetchQR();
        qrsig = g.qrsig;
        token = g.token;
        last = '';
        console.log('二维码已过期，已自动更换：');
        writeQrArtifacts(g.buf);
        if (stopOnRenew) return { result: 'renew', qrsig, token };
      } else if (r.code === '53') {
        saveState({ qrsig, token, phase: 'cancelled', ts: Date.now() });
        console.log('已取消登录');
        return { result: 'cancel' };
      } else if (r.code === '0') {
        saveState({ qrsig, token, phase: 'success', ts: Date.now() });
        console.log('扫码成功，正在完成登录…');
        const done = await complete(r.redirect);
        console.log(done.loggedIn ? `登录成功 uin=${done.uin}` : `登录已确认，但未进入空间 uin=${done.uin || '?'}`);
        return { result: 'success', done };
      }
    }
    await sleep(2500);
  }
  console.log('轮询超时');
  return { result: 'timeout' };
}

async function cmdGet() {
  const { buf } = await fetchQR();
  console.log('二维码已生成，请用手机 QQ 扫码：');
  writeQrArtifacts(buf);
  return 0;
}

async function cmdQr() {
  if (existsSync(F_QR_TXT)) {
    console.log(readFileSync(F_QR_TXT, 'utf8'));
    return 0;
  }
  if (!existsSync(F_QR)) throw new Error('还没有二维码，请先执行 --login 或 --get');
  console.log(toAscii(readFileSync(F_QR)) || `(二维码已保存: ${F_QR})`);
  return 0;
}

async function cmdPoll() {
  const st = loadState();
  if (!st) throw new Error('没有进行中的二维码，请先执行 --login 或 --get');
  const r = await pollLoop({ qrsig: st.qrsig, token: st.token, seconds: Number(opt('--seconds', '150')), stopOnRenew: has('--stop-on-renew') });
  return r.result === 'success' ? 0 : r.result === 'timeout' ? 2 : r.result === 'cancel' ? 3 : 0;
}

async function cmdLogin() {
  const s = loadSession();
  if (s && (await checkSession(s))) {
    console.log(`已登录 uin=${s.uin}，无需重新登录`);
    return 0;
  }
  const { buf, qrsig, token } = await fetchQR();
  console.log('未登录（或登录态已失效），请用手机 QQ 扫码：');
  writeQrArtifacts(buf);
  const r = await pollLoop({ qrsig, token, seconds: Number(opt('--seconds', '300')), stopOnRenew: has('--stop-on-renew') });
  return r.result === 'success' ? 0 : r.result === 'timeout' ? 2 : r.result === 'cancel' ? 3 : 0;
}

async function cmdStatus() {
  const s = loadSession();
  if (!s) {
    console.log('未登录（没有 .qzone/session.json）');
    return 2;
  }
  const loggedIn = await checkSession(s);
  const ageH = ((Date.now() - s.ts) / 3600000).toFixed(1);
  console.log(`${loggedIn ? '✅ 已登录' : '⚠️ 登录态可能已失效'} uin=${s.uin}`);
  console.log(`  保存于 ${new Date(s.ts).toLocaleString()}（${ageH} 小时前）`);
  if (s.expires) {
    const info = ['skey', 'p_skey', 'p_uin'].filter((k) => s.expires[k]).map((k) => `${k}=${s.expires[k] < 0 ? '会话级' : new Date(s.expires[k] * 1000).toLocaleString()}`);
    if (info.length) console.log('  有效期: ' + info.join(' | '));
  }
  return loggedIn ? 0 : 1;
}

function cmdLogout() {
  for (const f of [F_SESSION, F_STATE, F_QR, F_QR_TXT]) {
    try {
      rmSync(f, { force: true });
    } catch {}
  }
  console.log('已清除本地登录数据');
  return 0;
}

function usage() {
  console.log(`qq-moments 登录模块
  node scripts/login.mjs --login [--seconds N] [--stop-on-renew]   登录（自动探状态→取码→轮询→落地）
  node scripts/login.mjs --status                     检查登录态
  node scripts/login.mjs --qr                         打印当前二维码
  node scripts/login.mjs --logout                     清除本地登录数据

内部/调试:
  node scripts/login.mjs --get                        仅取一张二维码
  node scripts/login.mjs --poll [--seconds N] [--stop-on-renew]

环境变量:
  QZONE_BROWSER   指定 Edge/Chrome 可执行文件（默认自动查找）`);
}

const run = async () => {
  if (has('--login')) process.exitCode = await cmdLogin();
  else if (has('--status')) process.exitCode = await cmdStatus();
  else if (has('--qr')) process.exitCode = await cmdQr();
  else if (has('--get')) process.exitCode = await cmdGet();
  else if (has('--poll')) process.exitCode = await cmdPoll();
  else if (has('--logout')) process.exitCode = cmdLogout();
  else usage();
};
run().catch((e) => {
  console.error('❌ ' + e.message);
  process.exit(1);
});
