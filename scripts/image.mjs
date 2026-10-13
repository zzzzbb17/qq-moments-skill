#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, '.qzone');
const INCOMING = join(DATA, 'incoming');
const F_CONFIG = join(DATA, 'config.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(INCOMING, { recursive: true });

const loadConfig = () => (existsSync(F_CONFIG) ? JSON.parse(readFileSync(F_CONFIG, 'utf8')) : {});
const saveConfig = (c) => writeFileSync(F_CONFIG, JSON.stringify(c, null, 2));

function outPath(ext) {
  return opt('--out', join(INCOMING, `img-${Date.now()}.${ext}`));
}

function findBrowser() {
  const cands = {
    win32: [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/microsoft-edge', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  }[process.platform] || [];
  return cands.find(existsSync);
}

async function download(url, dst, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dst, buf);
  return buf.length;
}

// ① 找现成图：有 key 用 Pexels/Unsplash/Pixabay，否则用 Wikimedia Commons（免费无 key）
async function findImage(query) {
  const c = loadConfig();
  const fp = c.findProvider;
  if (fp && fp.name && fp.key) {
    if (fp.name === 'pexels') {
      const r = await (await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`, { headers: { Authorization: fp.key } })).json();
      if (r.photos && r.photos[0]) return { url: r.photos[0].src.large2x, ext: 'jpg', from: 'pexels' };
    } else if (fp.name === 'unsplash') {
      const r = await (await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1`, { headers: { Authorization: 'Client-ID ' + fp.key } })).json();
      if (r.results && r.results[0]) return { url: r.results[0].urls.regular, ext: 'jpg', from: 'unsplash' };
    } else if (fp.name === 'pixabay') {
      const r = await (await fetch(`https://pixabay.com/api/?key=${fp.key}&q=${encodeURIComponent(query)}&per_page=3&image_type=photo`)).json();
      if (r.hits && r.hits[0]) return { url: r.hits[0].largeImageURL, ext: 'jpg', from: 'pixabay' };
    }
  }
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url|mime&iiurlwidth=1280`;
  const r = await (await fetch(api, { headers: { 'User-Agent': UA } })).json();
  const pages = r.query && r.query.pages ? Object.values(r.query.pages) : [];
  for (const p of pages) {
    const info = p.imageinfo && p.imageinfo[0];
    if (!info) continue;
    const mime = info.mime || '';
    if (!/image\/(jpeg|png|webp)/.test(mime)) continue;
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    return { url: info.thumburl || info.url, ext, from: 'wikimedia' };
  }
  return null;
}

// ② AI 生成（OpenAI 兼容 /images/generations）
async function generateImage(prompt) {
  const c = loadConfig();
  const ai = c.ai;
  if (!ai || !ai.enabled) throw new Error('AI 生图未启用（可用 --ai-enable 配置 key，或 --ai-disable 已知禁用）');
  if (!ai.apiKey) throw new Error('AI 生图缺少 apiKey');
  const base = (ai.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const body = { model: ai.model || 'gpt-image-1', prompt, n: 1, size: ai.size || '1024x1024' };
  const res = await fetch(`${base}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ai.apiKey },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (j.error) throw new Error('生图失败: ' + (j.error.message || JSON.stringify(j.error)));
  const item = (j.data || [])[0] || {};
  if (item.b64_json) return Buffer.from(item.b64_json, 'base64');
  if (item.url) return Buffer.from(await (await fetch(item.url)).arrayBuffer());
  throw new Error('生图返回无图片: ' + JSON.stringify(j).slice(0, 300));
}

// ③ 代码兜底：按意境关键词生成 SVG 插画 → 截图成 PNG
function palette(keywords = '') {
  const k = keywords;
  if (/夜|星|月|孤|寂|难|悲|泪/.test(k)) return { sky: ['#0b0e16', '#1b2230', '#3a4460', '#7d8bb0'], sun: '#cfd8ff' };
  if (/海|浪|蓝|远|梦/.test(k)) return { sky: ['#0a1620', '#123044', '#2b6b83', '#8fd3e0'], sun: '#eafcff' };
  if (/暖|阳|光|希望|前|走|变/.test(k)) return { sky: ['#151922', '#323a4b', '#c39a63', '#ffdd93'], sun: '#fff7dd' };
  return { sky: ['#141821', '#2c3242', '#8a7a5c', '#e6c98a'], sun: '#fff2cf' };
}

function makeSvg(keywords, pal) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600">
  <defs>
    <linearGradient id="sky" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="${pal.sky[0]}"/>
      <stop offset="42%" stop-color="${pal.sky[1]}"/>
      <stop offset="76%" stop-color="${pal.sky[2]}"/>
      <stop offset="100%" stop-color="${pal.sky[3]}"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${pal.sun}"/>
      <stop offset="45%" stop-color="${pal.sun}" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="${pal.sun}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="900" height="600" fill="url(#sky)"/>
  <circle cx="815" cy="290" r="250" fill="url(#sun)"/>
  <circle cx="815" cy="290" r="62" fill="${pal.sun}"/>
  <path d="M0,468 C300,438 600,438 900,468 L900,600 L0,600 Z" fill="#111319"/>
  <path d="M330,600 L462,468 L618,468 L792,600 Z" fill="#7d6a48" opacity="0.35"/>
  <ellipse cx="372" cy="490" rx="48" ry="9" fill="#000" opacity="0.35"/>
  <g fill="none" stroke="#090a0e" stroke-width="13" stroke-linecap="round">
    <path d="M372,432 L344,488"/><path d="M372,432 L400,480"/>
    <path d="M362,398 L342,430"/><path d="M368,398 L392,424"/>
  </g>
  <rect x="360" y="344" width="24" height="62" rx="12" fill="#090a0e"/>
  <circle cx="372" cy="324" r="20" fill="#090a0e"/>
</svg>`;
}

async function svgToPng(svg, dst) {
  const bin = findBrowser();
  if (!bin) throw new Error('未找到 Edge/Chrome 用于渲染 SVG');
  const b = await chromium.launch({ executablePath: bin, headless: true });
  const p = await b.newPage({ viewport: { width: 900, height: 600 } });
  await p.setContent(`<body style="margin:0">${svg}</body>`);
  const el = await p.$('svg');
  await el.screenshot({ path: dst });
  await b.close();
}

const cmd = has('--find') ? 'find' : has('--generate') ? 'generate' : has('--svg') ? 'svg' : has('--ai-status') ? 'aiStatus' : has('--ai-enable') ? 'aiEnable' : has('--ai-disable') ? 'aiDisable' : has('--set-find') ? 'setFind' : 'usage';

if (cmd === 'find') {
  const q = opt('--find');
  const r = await findImage(q);
  if (!r) {
    console.error('没找到合适的现成图');
    process.exit(2);
  }
  const dst = outPath(r.ext);
  const n = await download(r.url, dst);
  console.log(`已找到并下载（${r.from}）: ${dst} (${n} bytes)`);
  console.log(`   源: ${r.url}`);
} else if (cmd === 'generate') {
  const dst = outPath('png');
  const buf = await generateImage(opt('--generate'));
  writeFileSync(dst, buf);
  console.log(`已 AI 生成: ${dst} (${buf.length} bytes)`);
} else if (cmd === 'svg') {
  const kw = opt('--svg', '');
  const dst = outPath('png');
  await svgToPng(makeSvg(kw, palette(kw)), dst);
  console.log(`已生成插画（本地兜底）: ${dst}`);
} else if (cmd === 'aiStatus') {
  const ai = loadConfig().ai;
  console.log(ai ? JSON.stringify(ai) : '未配置 AI 生图');
} else if (cmd === 'aiEnable') {
  const c = loadConfig();
  c.ai = { enabled: true, provider: opt('--provider', 'openai'), apiKey: opt('--key', ''), baseUrl: opt('--base', 'https://api.openai.com/v1'), model: opt('--model', 'gpt-image-1'), size: opt('--size', '1024x1024') };
  if (!c.ai.apiKey) {
    console.error('缺少 --key');
    process.exit(1);
  }
  saveConfig(c);
  console.log('已启用 AI 生图: provider=' + c.ai.provider + ' baseUrl=' + c.ai.baseUrl + ' model=' + c.ai.model);
} else if (cmd === 'aiDisable') {
  const c = loadConfig();
  c.ai = { enabled: false };
  saveConfig(c);
  console.log('AI 生图已禁用');
} else if (cmd === 'setFind') {
  const c = loadConfig();
  c.findProvider = { name: opt('--name', 'pexels'), key: opt('--key', '') };
  saveConfig(c);
  console.log('已设置找图来源: ' + c.findProvider.name);
} else {
  console.log(`图片管线
  node scripts/image.mjs --find "<关键词>"            找现成图（Pexels/Unsplash/Pixabay 有 key 优先，否则 Wikimedia）
  node scripts/image.mjs --generate "<提示词>"         AI 生图（需先 --ai-enable）
  node scripts/image.mjs --svg "<意境关键词>"          本地兜底插画（无需 key）
  node scripts/image.mjs --ai-status | --ai-disable   查看/禁用 AI 生图
  node scripts/image.mjs --ai-enable --key <K> [--provider openai] [--base <URL>] [--model <M>]
  node scripts/image.mjs --set-find --name pexels --key <K>    配置找图来源
  通用: [--out <path>]`);
}
