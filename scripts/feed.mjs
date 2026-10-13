#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const F_SESSION = join(ROOT, '.qzone', 'session.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};

if (!existsSync(F_SESSION)) {
  console.error('未登录：请先运行 node scripts/login.mjs --login');
  process.exit(2);
}

const S = JSON.parse(readFileSync(F_SESSION, 'utf8'));
const uin = S.uin;
const cookie = Object.entries(S.cookies).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
const gtk = (k) => {
  let h = 5381;
  for (let i = 0; i < k.length; i++) h += (h << 5) + k.charCodeAt(i);
  return h & 0x7fffffff;
};
const g_tk = gtk(S.cookies['p_skey'] || S.cookies['skey'] || '');
const H = { 'User-Agent': UA, Cookie: cookie, Referer: `https://user.qzone.qq.com/${uin}` };
const parse = (t) => JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
const clean = (s) => (s || '').replace(/\[em\]e\d+\[\/em\]/g, '').replace(/\s+/g, ' ').trim();

async function listFriends() {
  const url = `https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/tfriend/friend_mngfrd_get.cgi?uin=${uin}&fupdate=1&scene=21&g_tk=${g_tk}`;
  const j = parse(await (await fetch(url, { headers: H })).text());
  return (j.data.items || []).filter((x) => x.uin !== uin);
}

async function friendPosts(f, count) {
  const url = `https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6?uin=${f}&ftype=0&sort=0&pos=0&num=${count}&replynum=0&g_tk=${g_tk}&code_version=1&format=jsonp&need_private_comment=1`;
  const j = parse(await (await fetch(url, { headers: { ...H, Referer: `https://user.qzone.qq.com/${f}` } })).text());
  return (j.msglist || []).map((x) => ({ time: new Date((x.created_time || 0) * 1000).toLocaleString(), content: clean(x.content) })).filter((x) => x.content);
}

async function addComment(friend, tid, content) {
  const url = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds?g_tk=${g_tk}`;
  const body = new URLSearchParams({
    topicId: tid,
    feedsType: '311',
    hostUin: friend,
    uin,
    format: 'fs',
    ref: 'feeds',
    content,
    inCharset: 'utf-8',
    outCharset: 'utf-8',
    plat: 'qzone',
    source: 'ic',
  });
  const t = await (await fetch(url, { method: 'POST', headers: { ...H, 'Content-Type': 'application/x-www-form-urlencoded', Referer: `https://user.qzone.qq.com/${friend}` }, body })).text();
  return t;
}

function findBrowser() {
  const cands = {
    win32: [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/microsoft-edge', '/usr/bin/chromium'],
  }[process.platform] || [];
  return cands.find(existsSync);
}

async function tabFeed(tab, count) {
  const cookies = Object.entries(S.cookies).filter(([, v]) => v).map(([name, value]) => ({ name, value, domain: '.qq.com', path: '/' }));
  const b = await chromium.launch({ executablePath: findBrowser(), headless: true });
  try {
    const ctx = await b.newContext({ userAgent: UA, viewport: { width: 1400, height: 1200 } });
    await ctx.addCookies(cookies);
    const p = await ctx.newPage();
    await p.goto(`https://user.qzone.qq.com/${uin}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForTimeout(6000);
    await p.evaluate((t) => {
      const el = [...document.querySelectorAll('a,span,li,div')].find((e) => (e.textContent || '').trim() === t && e.offsetParent !== null);
      if (el) el.click();
    }, tab);
    await p.waitForTimeout(6000);
    for (let i = 0; i < 6; i++) {
      await p.evaluate(() => window.scrollBy(0, 2200));
      await p.waitForTimeout(1500);
    }
    const items = await p.evaluate(() => {
      const out = [];
      document.querySelectorAll('.f-single-content').forEach((el) => {
        let item = el;
        for (let i = 0; i < 8 && item.parentElement; i++) {
          item = item.parentElement;
          if (item.querySelector && item.querySelector('.f-nick')) break;
        }
        const nickEl = item.querySelector ? item.querySelector('.f-nick') : null;
        const timeEl = item.querySelector ? item.querySelector('.state, .info-detail') : null;
        const content = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (content) out.push({ nick: nickEl ? nickEl.textContent.trim() : '', time: timeEl ? timeEl.textContent.trim() : '', content });
      });
      return out;
    });
    const latest = Object.fromEntries((await ctx.cookies()).map((c) => [c.name, c.value]));
    S.cookies = { ...S.cookies, ...latest };
    S.ts = Date.now();
    writeFileSync(F_SESSION, JSON.stringify(S, null, 2));
    return items.filter((it) => it.nick && !/查看详情|广告|下载|游戏/.test(it.content)).slice(0, count);
  } finally {
    await b.close();
  }
}

const count = Number(opt('--count', '20'));

if (has('--friends')) {
  const fr = await listFriends();
  console.log('好友 ' + fr.length + ' 位:');
  fr.forEach((f) => console.log(`  ${f.name}  uin=${f.uin}`));
} else if (has('--friend')) {
  const f = opt('--friend');
  const posts = await friendPosts(f, count);
  console.log(`好友 ${f} 的说说（最近 ${posts.length} 条）:`);
  posts.forEach((x, i) => console.log(`${i + 1}. [${x.time}] ${x.content}`));
  console.log('\n---JSON---');
  console.log(JSON.stringify(posts.map((x) => x.content)));
} else if (has('--comment')) {
  const friend = opt('--comment');
  const tid = opt('--tid');
  const content = opt('--content');
  if (!friend || !tid || !content) {
    console.error('用法: node scripts/feed.mjs --comment <好友uin> --tid <tid> --content "评论内容"');
    process.exit(1);
  }
  const t = await addComment(friend, tid, content);
  console.log('评论返回:', t.slice(0, 400));
} else {
  const tab = opt('--tab', '好友动态');
  const items = await tabFeed(tab, count);
  console.log('TAB=' + tab + ' 共 ' + items.length + ' 条');
  items.forEach((it, i) => console.log(`${i + 1}. [${it.nick}] ${it.time}\n   ${it.content}`));
  console.log('\n---JSON---');
  console.log(JSON.stringify(items));
}
