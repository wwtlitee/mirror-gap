import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {BASE_BODY_LENGTH} from '../public/body-metrics.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'file:///C:/Users/39215/.codex/skills/develop-web-game/node_modules/playwright/index.mjs');
const root=path.resolve(import.meta.dirname,'..'),publicRoot=path.join(root,'public');
const out=path.join(root,'output/camera-depth-v8.0.3/scene');await fs.mkdir(out,{recursive:true});
const html=`<style>html,body{margin:0;width:100%;height:100%}canvas{display:block;width:100%;height:100%}</style>
<script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/"}}</script><canvas></canvas>
<script type="module">import{createHomeScene}from '/scene.mjs';window.room=await createHomeScene(document.querySelector('canvas'));function frame(){if(window.fixture)room.update(window.fixture,1/60);requestAnimationFrame(frame)}requestAnimationFrame(frame);window.ready=true;</script>`;
const types={'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.glb':'model/gltf-binary'};
const server=http.createServer(async(req,res)=>{try{
  const route=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(route==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  const vendor=route.startsWith('/vendor/three/'),base=vendor?path.join(root,'node_modules/three'):publicRoot;
  const file=path.resolve(base,vendor?route.slice(14):route.slice(1));
  if(!file.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}
  res.setHeader('Content-Type',types[path.extname(file)]??'application/octet-stream');res.end(await fs.readFile(file));
}catch(error){res.writeHead(404);res.end(error.message);}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const report={checks:[],errors:[],samples:[],scope:'Real scene update/render loop with controlled snapshots; game enter/exit and manual orbit only. No player storage.'};
let browser;
try{
  browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
  const page=await browser.newPage({viewport:{width:1400,height:900}});
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>window.ready,null,{timeout:120000});
  async function expectClip(label,mode,near){
    await page.waitForFunction(e=>{const d=room.getDiagnostics();return d.cameraClipMode===e.mode&&Math.abs(d.cameraNear-e.near)<1e-10;},{mode,near},{timeout:10000});
    const d=await page.evaluate(()=>room.getDiagnostics());
    assert.equal(d.cameraFar,100);assert.ok(d.cameraPosition.every(Number.isFinite));
    report.checks.push(label);report.samples.push({label,mode:d.cameraMode,clipMode:d.cameraClipMode,near:d.cameraNear,far:d.cameraFar,position:d.cameraPosition});
  }
  for(const [stage,bodyScale] of [['newborn',.19/30/BASE_BODY_LENGTH],['mature',.19/12/BASE_BODY_LENGTH],['legacy',1]]){
    const fixture=new EmbodiedLife().snapshot();fixture.paused=true;fixture.actor.bodyScale=bodyScale;
    Object.assign(fixture.actor,{position:[0,1.3,0],velocity:[0,0,0],heading:0,contact:false});
    fixture.living.workstation.phase='idle';
    await page.evaluate(snapshot=>{window.fixture=snapshot;room.setView('follow');},fixture);
    const small=bodyScale<.2;
    await expectClip(`${stage}: initial follow`,'follow',small?.00015:.04);
    for(const mode of ['first','follow']){
      await page.evaluate(mode=>{fixture.living.workstation.phase='idle';room.setView(mode);},mode);
      const near=mode==='first'?(small?.0001:.015):(small?.00015:.04);
      await expectClip(`${stage}: ${mode} before game`,mode,near);
      await page.evaluate(mode=>{fixture.living.workstation.phase='playing';room.setView(mode);},mode);
      await expectClip(`${stage}: ${mode} enters game`,'game',.04);
      await page.evaluate(()=>{fixture.living.workstation.phase='idle';});
      await expectClip(`${stage}: ${mode} leaves game while paused`,mode,near);
      await page.evaluate(()=>room.setView('overview'));
      await expectClip(`${stage}: game path returns to overview`,'overview',.04);
    }
  }
  await page.evaluate(bodyScale=>{fixture.actor.bodyScale=bodyScale;room.setView('follow');},.19/30/BASE_BODY_LENGTH);
  await expectClip('manual setup: newborn follow','follow',.00015);
  await page.mouse.move(700,450);await page.mouse.down();await page.mouse.move(740,465,{steps:4});await page.mouse.up();
  await expectClip('manual orbit preserves macro near','manual',.00015);
  for(let i=0;i<100;i++)await page.mouse.wheel(0,200);
  await page.waitForFunction(()=>room.getDiagnostics().cameraNear===.04,null,{timeout:10000});
  await expectClip('manual zoom-out restores room precision','manual',.04);
  await page.screenshot({path:path.join(out,'manual-zoom-out.png')});
  assert.equal(report.errors.length,0);report.checks.push('no page exceptions');
  await page.evaluate(()=>{window.fixture=null;room.dispose();});
}catch(error){report.failure=error.stack;throw error;}
finally{
  await browser?.close();await new Promise(resolve=>server.close(resolve));
  await fs.writeFile(path.join(out,'scene-camera-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({checks:report.checks.length,errors:report.errors,failure:report.failure??null,output:out}));
}
