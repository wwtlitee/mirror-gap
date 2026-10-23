import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {createCompanion,adoptCompanion} from '../public/companion-identity.mjs';
import {companionCheckpoint} from '../public/companion-checkpoint.mjs';
import {VERSION} from '../public/world-spec.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'file:///C:/Users/39215/.codex/skills/develop-web-game/node_modules/playwright/index.mjs');
const url=process.env.CAMERA_TEST_URL??'http://127.0.0.1:4207/';
const out=path.resolve(process.env.CAMERA_TEST_OUTPUT??'output/camera-depth-v8.0.3');
const seed='0123456789abcdef0123456789abcdef';
const desktop={width:1600,height:1000};
await fs.mkdir(out,{recursive:true});

function fixture(stage){
  const state=new EmbodiedLife().state;
  state.companion=createCompanion({seed,now:1000});
  adoptCompanion(state.companion,'镜头测试',2000);
  state.companion.voice.enabled=false;
  if(stage==='mature'){
    state.companion.activeSeconds=21600;
    state.companion.growth={format:1,startedAt:0,elapsed:21600,nutrition:180,rest:600,progress:1};
  }
  return companionCheckpoint(state);
}

const report={url,expectedVersion:VERSION,checks:[],errors:[],consoleErrors:[],screenshots:[],stages:{},
  scope:'Isolated full-app newborn and mature fixtures; follow, first-person, overview, zone focus, resize, and saved-companion reload. Game camera is covered separately by the scene integration probe.'};
function check(name,value){assert.ok(value,name);report.checks.push(name);}
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
let currentPage;

async function state(page){return page.evaluate(()=>JSON.parse(window.render_game_to_text()));}
async function readyAndPause(page){
  await page.waitForFunction(()=>document.body.dataset.scene==='ready'&&JSON.parse(window.render_game_to_text()).connected,null,{timeout:120000});
  // Only operate the worker in this fresh browser context, never a shared server save.
  await page.evaluate(async()=>{
    const {browserLife,localApi}=await import('/browser-life.mjs');
    if(!browserLife)throw Error('Camera regression requires the isolated browser-life static app.');
    await localApi('/api/command',{type:'pause',value:true});
  });
  await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).paused);
}
async function open(stage){
  const context=await browser.newContext({viewport:desktop});
  const checkpoint=fixture(stage);
  await context.addInitScript(cp=>{
    if(sessionStorage.cameraDepthFixture)return;
    localStorage.setItem('mirror-gap-companion-v2',JSON.stringify(cp));
    localStorage.setItem('drosophila-language','zh');
    sessionStorage.cameraDepthFixture='yes';
  },checkpoint);
  const page=await context.newPage();currentPage=page;
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
  await page.goto(url);
  await readyAndPause(page);
  return {context,page,checkpoint};
}
async function expectClip(page,stage,label,mode,near){
  await page.waitForFunction(expected=>{
    const r=JSON.parse(window.render_game_to_text()).rendering;
    return r.cameraMode===expected.mode&&r.cameraClipMode===expected.mode&&Math.abs(r.cameraNear-expected.near)<1e-10&&r.cameraFar===400;
  },{mode,near},{timeout:15000});
  const snapshot=await state(page),r=snapshot.rendering;
  check(`${stage}: ${label} uses ${mode} near=${near}, far=400`,r.cameraMode===mode&&r.cameraClipMode===mode&&Math.abs(r.cameraNear-near)<1e-10&&r.cameraFar===400);
  check(`${stage}: ${label} keeps finite camera coordinates`,[...r.cameraPosition,...r.cameraTarget,r.cameraFov].every(Number.isFinite));
  report.stages[stage].samples.push({label,mode:r.cameraMode,clipMode:r.cameraClipMode,near:r.cameraNear,far:r.cameraFar,
    cameraPosition:r.cameraPosition,cameraTarget:r.cameraTarget,bodyScale:snapshot.actor.bodyScale,characterScale:r.characterScale});
  return snapshot;
}
async function view(page,mode){await page.click(`[data-view="${mode}"]`);}
async function settleCamera(page){
  await page.evaluate(async()=>{
    const deadline=performance.now()+20000;
    let previous=null,stableSince=performance.now();
    while(performance.now()<deadline){
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const r=JSON.parse(window.render_game_to_text()).rendering;
      const position=[...r.cameraPosition,...r.cameraTarget];
      if(!previous||position.some((value,index)=>Math.abs(value-previous[index])>.0001))stableSince=performance.now();
      else if(performance.now()-stableSince>350)return;
      previous=position;
    }
    throw Error('Camera did not settle for screenshot.');
  });
}
async function screenshot(page,name){
  await settleCamera(page);
  const imagePath=path.join(out,`${name}.png`);
  await page.screenshot({path:imagePath});report.screenshots.push(imagePath);
  await page.screenshot({path:path.join(out,`${name}-review.jpg`),type:'jpeg',quality:80});
}

try{
  for(const stage of ['newborn','mature']){
    report.stages[stage]={samples:[]};
    const {context,page,checkpoint}=await open(stage);
    const initial=await state(page);
    check(`${stage}: current app version is loaded`,initial.version===VERSION);
    check(`${stage}: fixture identity is active`,initial.companion.identity.id===checkpoint.companion.identity.id&&initial.companion.identity.seed===seed);
    check(`${stage}: real hardware renderer is active`,initial.rendering.softwareRenderer===false);
    report.stages[stage].gpuName=initial.rendering.gpuName;
    report.stages[stage].initialBodyScale=initial.actor.bodyScale;

    await expectClip(page,stage,'initial macro follow','follow',.00015);
    await view(page,'overview');
    await expectClip(page,stage,'follow to overview','overview',.04);
    await screenshot(page,`${stage}-overview-from-follow`);

    await view(page,'first');
    await expectClip(page,stage,'macro first-person','first',.0001);
    await view(page,'overview');
    await expectClip(page,stage,'first-person to overview','overview',.04);
    await screenshot(page,`${stage}-overview-from-first`);

    await page.setViewportSize({width:390,height:844});
    await expectClip(page,stage,'overview after mobile resize','overview',.04);
    await screenshot(page,`${stage}-overview-mobile`);
    await view(page,'follow');
    await expectClip(page,stage,'mobile macro follow','follow',.00015);
    await page.setViewportSize(desktop);
    await expectClip(page,stage,'macro follow after desktop resize','follow',.00015);

    await page.click('#habitat-tools-toggle');
    await page.click('[data-zone="feed"]');
    await expectClip(page,stage,'macro follow to supply-table focus','zone',.04);
    await page.click('#habitat-tools-close');
    await page.setViewportSize({width:1280,height:800});
    await expectClip(page,stage,'zone focus after resize','zone',.04);
    await page.setViewportSize(desktop);
    await view(page,'first');
    await expectClip(page,stage,'zone focus to macro first-person','first',.0001);
    await page.click('#habitat-tools-toggle');
    await page.click('[data-zone="rest"]');
    await expectClip(page,stage,'macro first-person to bed focus','zone',.04);
    await page.click('#habitat-tools-close');
    await view(page,'overview');
    await expectClip(page,stage,'zone focus to overview','overview',.04);
    await screenshot(page,`${stage}-overview-from-zone`);

    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('mirror-gap-companion-v2')));
    check(`${stage}: isolated companion was saved`,saved?.companion?.identity?.id===checkpoint.companion.identity.id);
    await page.reload();
    await readyAndPause(page);
    const restored=await expectClip(page,stage,'saved-companion reload follow','follow',.00015);
    check(`${stage}: reload preserves identity and growth stage`,restored.companion.identity.id===saved.companion.identity.id&&Math.abs(restored.companion.growth.progress-saved.companion.growth.progress)<.001);
    await view(page,'overview');
    await expectClip(page,stage,'saved-companion reload to overview','overview',.04);
    await screenshot(page,`${stage}-overview-after-reload`);
    await context.close();currentPage=null;
  }
  check('mature fixture is 2.5 times newborn body scale',Math.abs(report.stages.mature.initialBodyScale/report.stages.newborn.initialBodyScale-2.5)<.001);
  check('no browser page exceptions',report.errors.length===0);
  check('no browser console errors',report.consoleErrors.length===0);
}catch(error){
  report.failure=error.stack;
  try{
    if(currentPage){
      report.failureSnapshot=await state(currentPage);
      const imagePath=path.join(out,'camera-depth-failure.png');
      await currentPage.screenshot({path:imagePath});report.screenshots.push(imagePath);
    }
  }catch{}
  throw error;
}finally{
  await fs.writeFile(path.join(out,'camera-depth-browser-report.json'),JSON.stringify(report,null,2));
  await browser.close();
  console.log(JSON.stringify({checks:report.checks.length,errors:report.errors,consoleErrors:report.consoleErrors,failure:report.failure??null,output:out}));
}
