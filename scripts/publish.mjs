#!/usr/bin/env node
import { readFileSync, existsSync, unlinkSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const F_SESSION = join(ROOT, '.qzone', 'session.json');
const INCOMING = join(ROOT, '.qzone', 'incoming');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
const UPLOAD_BACKURLS = 'http://upbak.photo.qzone.qq.com/cgi-bin/upload/cgi_upload_image,http://119.147.64.75/cgi-bin/upload/cgi_upload_image';

const args = process.argv.slice(2);
function opt(f, d) {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
}
function optAll(f) {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === f && args[i + 1] && !args[i + 1].startsWith('--')) out.push(args[i + 1]);
  return out;
}

const VIS = { 公开: 1, 所有人可见: 1, 好友: 2, 私密: 64, 仅自己可见: 64 };
const textFile = opt('--text-file');
let text = opt('--text');
if (textFile) {
  if (!existsSync(textFile)) {
    console.error('文案文件不存在: ' + textFile);
    process.exit(1);
  }
  text = readFileSync(textFile, 'utf8').replace(/\r\n/g, '\n').trim();
}
const vis = opt('--visibility', '所有人可见');
const ugc = VIS[vis];
const images = optAll('--image');

if (args.includes('--cleanup')) {
  mkdirSync(INCOMING, { recursive: true });
  let n = 0;
  for (const f of readdirSync(INCOMING)) {
    try {
      unlinkSync(join(INCOMING, f));
      n++;
    } catch {}
  }
  console.log('已清理临时图片 ' + n + ' 张');
  process.exit(0);
}

if (text === undefined && images.length === 0) {
  console.error('需要 --text 和/或 --image');
  process.exit(1);
}
if (ugc === undefined) {
  console.error('未知权限: ' + vis);
  process.exit(1);
}
for (const img of images) if (!existsSync(img)) {
  console.error('图片不存在: ' + img);
  process.exit(1);
}
const dryRun = args.includes('--dry-run');

if (!dryRun && !existsSync(F_SESSION)) {
  console.error('未登录：没有 .qzone/session.json，请先运行 node scripts/login.mjs --login');
  process.exit(2);
}
if (dryRun) {
  console.log('【预览】将发布说说：');
  console.log('  文案:', JSON.stringify(text || ''));
  console.log('  图片:', images.length ? images.join(' , ') : '无');
  console.log('  权限:', vis, `(ugc_right=${ugc})`);
  console.log('  （dry-run 预览，未实际发布）');
  process.exit(0);
}

const s = JSON.parse(readFileSync(F_SESSION, 'utf8'));
const jar = s.cookies;
const cookie = Object.entries(jar).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
const uin = s.uin;
const skey = jar['skey'] || '';
const p_skey = jar['p_skey'] || '';

function gtk(k) {
  let h = 5381;
  for (let i = 0; i < k.length; i++) h += (h << 5) + k.charCodeAt(i);
  return h & 0x7fffffff;
}
const g_tk = gtk(p_skey || skey);

async function uploadImage(file) {
  const b64 = readFileSync(file).toString('base64');
  const body = new URLSearchParams({
    filename: 'filename',
    uin,
    skey,
    zzpaneluin: uin,
    zzpanelkey: '',
    p_uin: uin,
    p_skey,
    qzonetoken: '',
    uploadtype: '1',
    albumtype: '7',
    exttype: '0',
    refer: 'shuoshuo',
    output_type: 'jsonhtml',
    charset: 'utf-8',
    output_charset: 'utf-8',
    upload_hd: '1',
    hd_width: '2048',
    hd_height: '10000',
    hd_quality: '96',
    backUrls: UPLOAD_BACKURLS,
    url: `https://up.qzone.qq.com/cgi-bin/upload/cgi_upload_image?g_tk=${g_tk}`,
    base64: '1',
    jsonhtml_callback: 'callback',
    picfile: b64,
    qzreferrer: `https://user.qzone.qq.com/${uin}`,
  });
  const res = await fetch(`https://up.qzone.qq.com/cgi-bin/upload/cgi_upload_image?g_tk=${g_tk}&`, {
    method: 'POST',
    headers: { 'User-Agent': UA, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Referer: `https://user.qzone.qq.com/${uin}` },
    body,
  });
  const t = await res.text();
  const m = t.match(/callback\((\{[\s\S]*\})\)/);
  if (!m) throw new Error('上传响应异常: ' + t.slice(0, 400));
  const j = JSON.parse(m[1]);
  if (!j.data || !j.data.url) throw new Error('上传失败: ' + JSON.stringify(j.data || j).slice(0, 300));
  const d = j.data;
  const bo = (d.url.match(/bo=([^&]+)/) || [])[1] || '';
  console.log(`  图片已上传: albumid=${d.albumid} type=${d.type} ${d.width}x${d.height} bo=${bo}`);
  return { albumid: d.albumid, lloc: d.lloc, sloc: d.sloc, type: d.type, width: d.width, height: d.height, bo };
}

let ok = false;
try {
  const pics = [];
  for (const img of images) pics.push(await uploadImage(img));

  const body = new URLSearchParams({
    con: text || '',
    feedversion: '1',
    ver: '1',
    ugc_right: String(ugc),
    to_sign: '0',
    hostuin: uin,
    code_version: '1',
    format: 'json',
    qzreferrer: `https://user.qzone.qq.com/${uin}`,
  });
  if (pics.length) {
    body.set('syn_tweet_verson', '1');
    body.set('paramstr', '1');
    body.set('pic_template', pics.length > 1 ? `tpl-${pics.length}-1` : '');
    body.set('richtype', '1');
    body.set('subrichtype', '1');
    const groups = pics.map((p) => `,${p.albumid},${p.lloc},${p.sloc},${p.type},${p.height},${p.width},,${p.height},${p.width}`);
    body.set('richval', groups.join('\t'));
    const bos = pics.map((p) => p.bo).join(',');
    body.set('pic_bo', Array(pics.length).fill(bos).join('\t'));
    body.set('special_url', '');
    body.set('who', '1');
  }

  const url = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6?g_tk=${g_tk}`;
  console.log(`发布中… uin=${uin} 权限=${vis}(${ugc}) 图片=${pics.length}张 g_tk=${g_tk}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', Referer: `https://user.qzone.qq.com/${uin}` },
    body,
  });
  const txt = await res.text();
  console.log('HTTP', res.status);
  try {
    const j = JSON.parse(txt);
    ok = j.code === 0;
    if (ok) {
      const tid = j.t1_tid || j.tid || '';
      console.log(`✅ 已发布 | 权限=${vis}(${ugc}) | 图片=${pics.length}张 | tid=${tid}`);
      console.log(`   链接: https://user.qzone.qq.com/${uin}/mood/${tid}`);
      let cleaned = 0;
      for (const img of images) {
        try {
          const rp = resolve(img);
          if (rp.startsWith(INCOMING + sep)) {
            unlinkSync(rp);
            cleaned++;
          }
        } catch {}
      }
      if (cleaned) console.log(`   （已自动清理临时图片 ${cleaned} 张）`);
    } else {
      console.log(`❌ 发布失败 | code=${j.code} subcode=${j.subcode} msg=${j.message || ''}`);
    }
  } catch {
    console.log('返回:', txt.slice(0, 500));
  }
} catch (e) {
  console.error('❌ ' + e.message);
}
process.exitCode = ok ? 0 : 1;
