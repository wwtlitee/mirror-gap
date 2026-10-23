import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {createCompanion,adoptCompanion} from '../public/companion-identity.mjs';
import {companionCheckpoint} from '../public/companion-checkpoint.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'file:///C:/Users/39215/.codex/skills/develop-web-game/node_modules/playwright/index.mjs');
const root=path.resolve(process.env.ROOM_TEST_ROOT??'dist');
const output=path.resolve(process.env.ROOM_TEST_OUTPUT??'output/room-v8.1.0b/local');
const expected=process.env.ROOM_TEST_VERSION??'8.1.0b';
await fs.mkdir(output,{recursive:true});
let server;
let url=process.env.ROOM_TEST_URL;
if(!url){
  const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.mp3':'audio/mpeg','.glb':'model/gltf-binary'};
  server=http.createServer(async(req,res)=>{
    try{
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
      if(!file.startsWith(root+path.sep))throw Error('Outside static root');
      const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  url=`http://127.0.0.1:${server.address().port}/`;
}
const fixture=new EmbodiedLife().state;
fixture.companion=createCompanion({id:'11111111-1111-4111-8111-111111111111',seed:'0123456789abcdef0123456789abcdef',now:1000});
adoptCompanion(fixture.companion,'房间对照',2000);fixture.companion.voice.enabled=false;
fixture.companion.activeSeconds=21600;fixture.companion.growth={format:1,startedAt:0,elapsed:21600,nutrition:180,rest:600,progress:1};
const checkpoint=companionCheckpoint(fixture);
// Both deliveries use the older save schema and the same fixed identity.
// Runtime initialization timestamps can differ; the report records each hash.
// A current-version fixture would be rejected by the old app's future-save protection.
checkpoint.metadata.productVersion='8.1.0a';checkpoint.savedAt=1790812800000;
const report={url,root,expected,fixtureSha256:createHash('sha256').update(JSON.stringify(checkpoint)).digest('hex'),checks:[],errors:[],consoleErrors:[],views:{},screenshots:[],resources:{},visualReview:'Pending pixel inspection; automated results alone do not establish model quality.'};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
let browser,page;
try{
  browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
  const context=await browser.newContext({viewport:{width:1600,height:1000}});
  await context.addInitScript(cp=>{
    localStorage.setItem('mirror-gap-companion-v2',JSON.stringify(cp));
    localStorage.setItem('drosophila-language','zh');
    localStorage.setItem('mirror-gap-atmosphere-v1',JSON.stringify({mode:'clear',enabled:false,volume:.28}));
  },checkpoint);
  page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
  await page.goto(url);await page.waitForFunction(()=>document.body.dataset.scene==='ready'&&JSON.parse(window.render_game_to_text()).connected,null,{timeout:120000});
  const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
  const api=body=>page.evaluate(async body=>{const {localApi}=await import('/browser-life.mjs');await localApi('/api/command',body);},body);
  await api({type:'pause',value:true});await api({type:'daytime',value:'day'});
  check('expected deployed version',(await state()).version===expected);
  async function settle(){
    await page.waitForTimeout(2200);
    await page.evaluate(async()=>{
      let last=null,stable=0;
      for(let n=0;n<240;n++){
        await new Promise(requestAnimationFrame);
        const r=JSON.parse(window.render_game_to_text()).rendering;
        const values=[...r.cameraPosition,...r.cameraTarget];
        stable=last&&values.every((x,i)=>Math.abs(x-last[i])<.00001)?stable+1:0;
        if(stable>=8)return;
        last=values;
      }
      throw Error('Camera failed to settle');
    });
  }
  async function shot(name){
    await settle();const s=await state();report.views[name]=s.rendering;
    check(`${name} finite camera`,[...s.rendering.cameraPosition,...s.rendering.cameraTarget].every(Number.isFinite));
    const filename=path.join(output,`${name}.png`);await page.screenshot({path:filename});report.screenshots.push(filename);
  }
  await page.click('[data-view="overview"]');await shot('overview-day');
  for(const id of ['rest','work','feed','perch','entry','garden']){
    await page.click('#habitat-tools-toggle');await page.click(`[data-zone="${id}"]`);await page.click('#habitat-tools-close');await shot(`${id}-day`);
    if(['rest','work','perch'].includes(id)){
      const bounds=await page.locator('#home-canvas').boundingBox();
      await page.mouse.move(bounds.x+bounds.width*.52,bounds.y+bounds.height*.53);await page.mouse.wheel(0,-440);await shot(`${id}-close`);
    }
  }
  await api({type:'daytime',value:'night'});await page.click('[data-view="overview"]');await shot('overview-night');
  await page.setViewportSize({width:390,height:844});await shot('mobile-overview');
  check('mobile has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  check('fixture identity unchanged',(await state()).companion.identity.id===fixture.companion.identity.id);
  const manifest=await page.evaluate(async()=>{const r=await fetch('/release-manifest.json',{cache:'no-store'});return r.ok?r.json():null;});
  if(manifest){
    check('build manifest version matches',manifest.version===expected);report.build=manifest;
    for(const [file,metadata] of Object.entries(manifest.resources)){
      const sha=await page.evaluate(async file=>{
        const r=await fetch('/'+file,{cache:'no-store',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`HTTP ${r.status}: ${file}`);
        const digest=await crypto.subtle.digest('SHA-256',await r.arrayBuffer());return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
      },file);
      check(`manifest matches ${file}`,sha===metadata.sha256);report.resources[file]=sha;
    }
  }
  check('no uncaught page errors',report.errors.length===0);check('no console errors',report.consoleErrors.length===0);
}catch(error){report.failure=error.stack;throw error;}
finally{
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify({expected,checks:report.checks.length,screenshots:report.screenshots.length,output,errors:report.errors}));
