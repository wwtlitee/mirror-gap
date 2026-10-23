import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {BASE_BODY_LENGTH} from '../public/body-metrics.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'file:///C:/Users/39215/.codex/skills/develop-web-game/node_modules/playwright/index.mjs');
const root=path.resolve(import.meta.dirname,'..');
const delivered=path.resolve(root,'../pdoc/material/MAT_自然写实交付_v8.1.0a_20261001_100456Z/dist');
const out=path.resolve(process.env.STREET_DEPTH_OUTPUT??path.join(root,'output/window-v8.1.0b/scene-depth'));
await fs.mkdir(out,{recursive:true});
const fixture=new EmbodiedLife().snapshot();fixture.paused=true;fixture.actor.bodyScale=.19/12/BASE_BODY_LENGTH;
Object.assign(fixture.actor,{position:[3,3.2,-3.9],velocity:[0,0,0],heading:Math.PI,contact:false});
fixture.living.workstation.phase='idle';
const report={checks:[],errors:[],variants:{},scope:'Isolated exact delivered scene versus same delivered scene with logarithmic depth, MSAA then current source. Same fixed snapshot and camera inputs; no player storage.'};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
const servers=[];let browser;
const shaderFix=await fs.readFile(path.join(root,'public/water-surfaces.mjs'),'utf8');
async function serve(variant){
 const source=variant==='current';
 const base=source?path.join(root,'public'):delivered;
 const html=`<style>html,body{margin:0;width:100%;height:100%}canvas{display:block;width:100%;height:100%}</style><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/"}}</script><canvas></canvas><script type="module">import{createHomeScene}from '/scene.mjs';window.room=await createHomeScene(document.querySelector('canvas'));window.fixture=${JSON.stringify(fixture)};window.render_game_to_text=()=>JSON.stringify(room.getDiagnostics());window.advanceTime=async ms=>{for(let i=0;i<Math.ceil(ms/(1000/60));i++)room.update(fixture,1/60)};function frame(){if(!window.hold)room.update(fixture,1/60);requestAnimationFrame(frame)}requestAnimationFrame(frame);window.ready=true;</script>`;
 const server=http.createServer(async(req,res)=>{try{
  const route=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(route==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  if(route==='/favicon.ico'){res.writeHead(204);res.end();return;}
  const vendor=source&&route.startsWith('/vendor/three/'),dir=vendor?path.join(root,'node_modules/three'):base;
  const file=path.resolve(dir,vendor?route.slice(14):route.slice(1));if(!file.startsWith(dir+path.sep))throw Error('Outside root');
  let data=await fs.readFile(file);
  if(route==='/scene.mjs'&&['depth-only','depth-aa'].includes(variant))data=Buffer.from(data.toString().replace('antialias: false, alpha:',`antialias: ${variant==='depth-aa'}, logarithmicDepthBuffer: true, alpha:`));
  if(route==='/water-surfaces.mjs'&&['depth-only','depth-aa'].includes(variant))data=Buffer.from(shaderFix.replaceAll("'three'","'/vendor/three/build/three.module.js'").replaceAll("'three/addons/","'/vendor/three/examples/jsm/"));
  res.setHeader('Content-Type',({'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'})[path.extname(file)]??'application/octet-stream');res.end(data);
 }catch(error){res.writeHead(404);res.end(error.message);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);return `http://127.0.0.1:${server.address().port}/`;
}
try{
 browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
 let currentUrl;
 for(const variant of (process.env.STREET_DEPTH_VARIANTS??'delivered,depth-only,depth-aa,current').split(',')){
  const url=await serve(variant);if(variant==='current')currentUrl=url;
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),entry=report.variants[variant]={views:{}};
  page.on('pageerror',e=>report.errors.push(`${variant}: ${e.message}`));page.on('console',m=>{if(m.type()==='error')report.errors.push(`${variant}: ${m.text()}`);});
  await page.goto(url);await page.waitForFunction(()=>window.ready,null,{timeout:120000});
  entry.context=await page.evaluate(()=>document.querySelector('canvas').getContext('webgl2').getContextAttributes());
  for(const [name,mode]of [['overview','overview'],['garden','garden'],['macro-window','first'],['water-bowl','feed'],['wetland','entry'],['toilet','toilet']]){
   await page.evaluate(mode=>{if(['overview','first'].includes(mode))room.setView(mode);else room.focusZone(mode);},mode);
   await page.waitForTimeout(1700);
   entry.views[name]=await page.evaluate(()=>room.getDiagnostics());
   check(`${variant} ${name}: finite camera`,entry.views[name].cameraPosition.every(Number.isFinite));
   await page.screenshot({path:path.join(out,`${variant}-${name}.png`)});
  }
  // Timings use the same archived geometry across the first three variants.
  await page.evaluate(()=>room.focusZone('garden'));await page.waitForTimeout(1700);
  entry.frameSample=await page.evaluate(async()=>{const samples=[];let previous=performance.now();for(let i=0;i<120;i++){await new Promise(requestAnimationFrame);const now=performance.now();samples.push(now-previous);previous=now;}samples.sort((a,b)=>a-b);return{frames:samples.length,medianMs:samples[60],p95Ms:samples[114],diagnostics:room.getDiagnostics()};});
  check(`${variant}: all three water surfaces render`,entry.views.toilet.water.surfaces.length===3);
  if(variant!=='delivered')check(`${variant}: water reflection active`,entry.views.toilet.water.surfaces.some(s=>s.reflection));
  if(variant==='current')check('current renderer uses logarithmic depth',entry.views.overview.logarithmicDepthBuffer===true);
  await page.evaluate(()=>{window.hold=true;room.dispose();});await page.close();
 }
 check('MSAA available in fixed scene',report.variants.current.context.antialias===true);
 check('no page or shader errors',report.errors.length===0);
 if(process.env.STREET_DEPTH_SKILL_CLIENT!=='0'){
  const client='C:/Users/39215/.codex/skills/develop-web-game/scripts/web_game_playwright_client.js';
  const clientOutput=path.join(out,`skill-client-${Date.now()}`);report.skillClientOutput=clientOutput;
  const args=[client,'--url',currentUrl,'--actions-json',JSON.stringify({steps:[{buttons:[],frames:60},{buttons:['left_mouse_button'],frames:2,mouse_x:900,mouse_y:420},{buttons:[],frames:30}]}),'--iterations','1','--pause-ms','1200','--screenshot-dir',clientOutput];
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`Skill client exit ${code}`)));});
  const files=await fs.readdir(clientOutput);check('skill client no console errors',!files.some(f=>f.startsWith('errors-')));
 }
}catch(error){report.failure=error.stack;throw error;}
finally{await browser?.close();await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({checks:report.checks.length,errors:report.errors,output:out,frames:Object.fromEntries(Object.entries(report.variants).map(([k,v])=>[k,{medianMs:v.frameSample?.medianMs,p95Ms:v.frameSample?.p95Ms}]))}));
