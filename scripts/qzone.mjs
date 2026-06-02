#!/usr/bin/env node
import { chromium } from 'playwright-core';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';

const QID='3027307483', QURL=`https://user.qzone.qq.com/${QID}`;
const LOGIN_URL=`https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=549000912&s_url=${encodeURIComponent(QURL)}`;
const PORT=9310, EDGE='C:\\Temp\\edge-qzone-live';
const slp=t=>new Promise(r=>setTimeout(r,t));
const BIN='/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PS='/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';

function gw(){
  try{const r=readFileSync('/proc/net/route','utf8');for(const l of r.split('\n'))
    if((l.startsWith('eth0')||l.startsWith('ens'))&&l.includes('\t00000000\t')){
      const g=parseInt(l.split('\t')[2],16);return[(g)&255,(g>>8)&255,(g>>16)&255,(g>>24)&255].join('.');}
  }catch{}return'172.22.0.1';
}

async function ensureEdge(){
  const{execSync,spawn}=await import('child_process');
  execSync(`${PS} -Command "netsh interface portproxy reset;Remove-Item -Path '${EDGE}' -Recurse -Force -ErrorAction SilentlyContinue;Start-Sleep -Seconds 1"`,{shell:'/bin/bash',timeout:8000});
  await slp(2000);
  spawn(BIN,[`--remote-debugging-port=${PORT}`,'--no-first-run','--disable-sync',`--user-data-dir=${EDGE}`,`https://user.qzone.qq.com/${QID}`],{detached:true,stdio:'ignore',windowsHide:false}).unref();
  await slp(8000);
  execSync(`${PS} -Command "netsh interface portproxy add v4tov4 listenport=${PORT} listenaddress=0.0.0.0 connectport=${PORT} connectaddress=127.0.0.1;netsh advfirewall firewall add rule name='WSL${PORT}' dir=in action=allow protocol=TCP localport=${PORT} remoteip=172.22.0.0/16 2>&1 | Out-Null"`,{shell:'/bin/bash',timeout:5000});
}

async function conn(){
  const g=gw();
  for(let i=0;i<20;i++){
    for(const u of[`http://${g}:${PORT}`,`http://127.0.0.1:${PORT}`])
      try{const b=await chromium.connectOverCDP(u,{timeout:3000}),ctx=b.contexts()[0];if(ctx)return{b,ctx};await b.close()}catch{}
    await slp(2000);
  }
  return null;
}

async function login(p){
  await p.goto(QURL,{waitUntil:'commit',timeout:30000});await slp(3000);
  const hasLoginDiv=await p.evaluate(()=>!!document.querySelector('#login_div'));
  if(!hasLoginDiv){
    const hasEd=await p.evaluate(()=>!!document.querySelector('[contenteditable=true]'));
    if(hasEd){console.log('✅ 已登录');return}
    const url=await p.evaluate(()=>location.href);
    if(!url.includes('i.qq.com')&&!url.includes('login')){console.log('✅ 已登录');return}
  }
  console.log('  → 需要登录');
  await p.goto(LOGIN_URL,{waitUntil:'commit',timeout:20000});await slp(2000);
  const lf=p.frames().find(f=>f.url().includes('ptlogin'));
  if(!lf)throw Error('登录页未加载');
  const h=await lf.evaluate(()=>[...document.querySelectorAll('span,div')].some(e=>e.textContent.trim()==='诗柒'));
  if(!h)throw Error('未检测到QQ，请登录电脑QQ');
  await lf.evaluate(()=>{const e=[...document.querySelectorAll('span,div')].find(e=>e.textContent.trim()==='诗柒');if(e)e.click()});
  console.log('📱 手机确认...');const s=Date.now();
  while(Date.now()-s<120000){
    await slp(2000);
    try{const url=await p.evaluate(()=>location.href);
      if(url.includes('user.qzone.qq.com')){
        const still=await p.evaluate(()=>!!document.querySelector('#login_div'));
        if(!still){console.log('✅ 已登录');return}
      }
    }catch{}
  }
  throw Error('登录超时');
}

async function post(text,img,vis){
  let c=await conn();
  if(!c){console.log('🚀 Edge...');await ensureEdge();c=await conn();if(!c){console.error('❌ Edge失败');return false}}
  console.log('✅ 连上');
  const{b,ctx}=c;
  const ps=ctx.pages().filter(p=>p.url().includes('qzone')||p.url().includes('ptlogin')||p.url().includes('i.qq'));
  for(let i=1;i<ps.length;i++)try{await ps[i].close()}catch{}
  let p=ps[0]||await ctx.newPage();
  await p.bringToFront();
  await login(p);
  if(!p.url().includes('user.qzone.qq.com')){await p.goto(QURL,{waitUntil:'commit',timeout:30000});await slp(2000)}
  
  const edState=await p.evaluate(()=>{
    const ed=document.querySelector('[contenteditable=true]');if(!ed)return'no';
    const t=(ed.innerText||'').trim();return(!t||t==='说点什么吧...'||t==='说点儿什么吧')?'empty':'has';
  });
  if(edState!=='empty'){console.log('⚠️ 跳过');return true}
  
  // 填文案
  await p.evaluate(t=>{
    const ed=document.querySelector('[contenteditable=true]');if(!ed)return;
    ed.focus();ed.innerHTML='';ed.innerText=t;
    ['input','change','keyup','keydown','focus'].forEach(e=>ed.dispatchEvent(new Event(e,{bubbles:true})))
  },text);
  console.log('✅ 文案');await slp(3000);
  
  // 设 route 拦截 ugc_right
  let routeTriggered=false;
  if(vis){
    const ugcMap={'公开':'1','好友':'2','私密':'64','仅自己':'64'};
    const ugcVal=ugcMap[vis];
    if(ugcVal){
      console.log('👁 权限:'+vis);
      await p.route('**/emotion_cgi_publish_v6*',async route=>{
        try{if(routeTriggered){await route.continue();return}
        routeTriggered=true;
        const pd=route.request().postData()||'';
        if(pd){const mod=pd.replace(/ugc_right=\d+/g,'ugc_right='+ugcVal);
          if(mod!==pd){console.log('  ✅');await route.continue({postData:mod});return}}
        }catch(e){}await route.continue();
      });
    }
  }
  
  // 发表
  await p.evaluate(()=>{const ta=document.querySelectorAll('a');for(const a of ta)if(a.textContent.trim()==='发表'){a.click();break}});
  console.log('🚀 发表');await slp(8000);
  return routeTriggered;
}

const args=process.argv.slice(2);
if(args.includes('--post')){
  const ti=args.indexOf('--text'),ii=args.indexOf('--image'),vi=args.indexOf('--visibility');
  const text=ti>=0?args[ti+1]:'',img=ii>=0?args[ii+1]:null,vis=vi>=0?args[vi+1]:null;
  if(!text){console.error('❌ 用法');process.exit(1)}
  const r=await post(text,img,vis);
  console.log(r?'\n✅✅✅ 成功！':'\n⚠️ 未完成');
}
