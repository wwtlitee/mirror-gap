import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';

// Isolated close-camera inspection of the actual scene builder. This is not an
// application/user camera acceptance test and does not touch player storage.
// Usage: node scripts/check-furniture-detail-browser.mjs [publicRoot] [output]
const root=path.resolve(import.meta.dirname,'..');
const publicRoot=path.resolve(process.argv[2]??path.join(root,'public'));
const output=path.resolve(process.argv[3]??path.join(root,'output/room-v8.1.0b/furniture-after'));
await fs.mkdir(output,{recursive:true});
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'file:///C:/Users/39215/.codex/skills/develop-web-game/node_modules/playwright/index.mjs');
const fixture=new EmbodiedLife().snapshot();
if(fixture.companion?.identity)fixture.companion.identity.seed='furniture-inspection-v1';
fixture.paused=true;fixture.clock={hour:14,daylight:.866};fixture.weather={cloud:0,rain:0};
fixture.actor.position=[0,.3,.8];fixture.actor.velocity=[0,0,0];fixture.actor.contact=true;
const html=`<style>html,body{margin:0;width:100%;height:100%;background:#15191e}canvas{display:block;width:100%;height:100%}</style><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/"}}</script><canvas></canvas><script type="module">import{createHomeScene}from'/scene.mjs';window.room=await createHomeScene(document.querySelector('canvas'));window.fixture=${JSON.stringify(fixture)};window.ready=true;</script>`;
const types={'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary'};
const server=http.createServer(async(req,res)=>{try{
 const route=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(route==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
 const vendor=route.startsWith('/vendor/three/'),base=vendor?path.join(root,'node_modules/three'):publicRoot;
 const file=path.resolve(base,vendor?route.slice(14):route.slice(1));
 if(!file.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}
 res.setHeader('Content-Type',types[path.extname(file)]??'application/octet-stream');
 if(route==='/scene.mjs'){
  const source=await fs.readFile(file,'utf8'),anchor='return { update, setView, focusZone';
  assert.ok(source.includes(anchor),'scene builder supports the explicit camera-only test hook');
  res.end(source.replace(anchor,`return { inspectCamera(position,target){mode='manual';transition=false;controls.minDistance=.1;camera.position.set(...position);controls.target.set(...target);controls.update();}, update, setView, focusZone`));return;
 }
 res.end(await fs.readFile(file));
}catch(error){res.writeHead(404);res.end(error.message);}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const report={scope:'Isolated actual scene construction; camera-only test hook. No application flow or player-storage validation.',publicRoot,fixture:{paused:true,hour:14,daylight:.866},errors:[],shots:[]};
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--ignore-gpu-blocklist','--enable-gpu']});
 const page=await browser.newPage({viewport:{width:1440,height:1080}});page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.ready,null,{timeout:120000});
 for(const [name,position,target]of [
  ['bed',[-1.8,2.9,.1],[-4.27,1.43,-2.95]],
  ['desk',[2.5,2.5,.1],[-1,1.25,-3.15]],
  ['chair',[.8,1.55,-.4],[-1.18,.58,-1.98]],
  ['bookcase',[-1,2.4,1.6],[-5.15,1.75,1.6]],
  ['dining',[-.1,2.3,4.3],[-3.43,.82,1.33]],
 ]){
  const diagnostics=await page.evaluate(({position,target})=>{room.inspectCamera(position,target);for(let i=0;i<24;i++)room.update(fixture,1/60);return room.getDiagnostics();},{position,target});
  assert.ok(diagnostics.cameraPosition.every(Number.isFinite));
  await page.screenshot({path:path.join(output,`${name}.png`)});
  report.shots.push({name,position,target,camera:diagnostics.cameraPosition,drawCalls:diagnostics.drawCalls,triangles:diagnostics.triangles,gpuName:diagnostics.gpuName});
 }
 assert.equal(report.errors.length,0);await page.evaluate(()=>room.dispose());
}catch(error){report.failure=error.stack;throw error;}
finally{
 await browser?.close();await new Promise(resolve=>server.close(resolve));
 await fs.writeFile(path.join(output,'furniture-inspection.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({output,shots:report.shots.length,errors:report.errors,failure:report.failure??null}));
}
