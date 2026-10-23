import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {createCompanion,adoptCompanion} from '../public/companion-identity.mjs';
import {companionCheckpoint} from '../public/companion-checkpoint.mjs';
import {recordHabit} from '../public/companion-development.mjs';
import {bodyMetrics} from '../public/body-metrics.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'file:///C:/Users/39215/.codex/skills/develop-web-game/node_modules/playwright/index.mjs');
const url=process.env.PAUSED_FOLLOW_URL??'http://127.0.0.1:4217/';
const output=process.env.PAUSED_FOLLOW_OUTPUT??'output/natural-home-v8.1.0/paused-follow';
const source=await fs.readFile(new URL('../public/scene.mjs',import.meta.url),'utf8');
const correction='      pausedBodyDelta.subVectors(character.root.position,previousActorPosition);\n      camera.position.add(pausedBodyDelta);controls.target.add(pausedBodyDelta);\n      camera.lookAt(controls.target);';
assert.ok(source.includes(correction),'The regression probe must disable only the paused-frame correction');
const previous=source.replace(correction,'      // Original paused-follow branch kept camera and target frozen.');
const helper=await fs.readFile(new URL('../public/character-export.mjs',import.meta.url),'utf8');
// Same fixture as the natural-home acceptance, without moving its actor or
// changing geometry, collision, clipping, or the initial pause sequence.
const fixture=new EmbodiedLife().state;
fixture.companion=createCompanion({id:'11111111-1111-4111-8111-111111111111',seed:'0123456789abcdef0123456789abcdef',now:1000});
adoptCompanion(fixture.companion,'自然豆',2000);fixture.companion.voice.enabled=false;
fixture.companion.activeSeconds=21600;fixture.companion.growth={format:1,startedAt:0,elapsed:21600,nutrition:180,rest:600,progress:1};
for(const target of ['rest','feed','work','garden','flight','entry','perch','nook','toilet'])for(let n=0;n<3;n++){fixture.companion.activeSeconds+=140;recordHabit(fixture.companion,'place',target,.8,{duration:20});}
fixture.home.water=0;
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const report={url,comparison:'Identical fixture/source; red disables only paused camera translation',runs:[]};
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
try{
  for(const [label,body]of [['red',previous],['green',source]]){
    const context=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true});
    await context.route('**/scene.mjs*',route=>route.fulfill({contentType:'text/javascript',body}));
    await context.route('**/character-export.mjs*',route=>route.fulfill({contentType:'text/javascript',body:helper}));
    await context.addInitScript(cp=>{localStorage.setItem('mirror-gap-companion-v2',JSON.stringify(cp));localStorage.setItem('drosophila-language','zh');},companionCheckpoint(fixture));
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
    await page.goto(url);await page.waitForFunction(()=>document.body.dataset.scene==='ready'&&JSON.parse(window.render_game_to_text()).connected,null,{timeout:120000});
    await page.evaluate(async()=>{const {localApi}=await import('/browser-life.mjs');await localApi('/api/command',{type:'pause',value:true});await localApi('/api/command',{type:'daytime',value:'day'});});
    await page.waitForTimeout(1800);const first=await state();
    await page.waitForTimeout(5000);const settled=await state(),rendering=settled.rendering,radius=bodyMetrics(settled.actor).radius;
    const expected=[...rendering.actorPosition];expected[1]+=radius*.25;
    const run={label,first:first.rendering,settled:rendering,targetError:distance(rendering.cameraTarget,expected),pauseCameraDrift:distance(first.rendering.cameraPosition,rendering.cameraPosition),pauseTargetDrift:distance(first.rendering.cameraTarget,rendering.cameraTarget),errors};
    await page.screenshot({path:`${output}/${label}-first-paused.png`});
    if(label==='green'){
      assert.ok(run.targetError<1e-7,`Paused target error ${run.targetError}`);
      assert.ok(run.pauseCameraDrift<1e-10&&run.pauseTargetDrift<1e-10,'Paused view must stay fixed after placement');
      const canvas=await page.locator('#home-canvas').boundingBox();
      await page.mouse.move(canvas.x+canvas.width*.62,canvas.y+canvas.height*.55);await page.mouse.down();await page.mouse.move(canvas.x+canvas.width*.62+90,canvas.y+canvas.height*.55+30,{steps:8});await page.mouse.up();
      await page.waitForTimeout(1500);const orbit=await state();await page.waitForTimeout(2000);const later=await state();
      assert.equal(later.rendering.cameraMode,'manual');assert.equal(later.paused,true);
      assert.ok(distance(orbit.rendering.cameraPosition,later.rendering.cameraPosition)<1e-7,'Paused orbit must not be overwritten by an automatic rig');
      run.manualOrbit={mode:later.rendering.cameraMode,changed:distance(rendering.cameraPosition,orbit.rendering.cameraPosition),drift:distance(orbit.rendering.cameraPosition,later.rendering.cameraPosition)};
      assert.ok(run.manualOrbit.changed>1e-5);await page.screenshot({path:`${output}/green-paused-manual-orbit.png`});
    }
    report.runs.push(run);await context.close();
  }
  assert.ok(report.runs[0].targetError>1e-4,'Red must reproduce the original target/body mismatch');
  assert.ok(report.runs.every(run=>run.errors.length===0));
  await fs.writeFile(`${output}/report.json`,JSON.stringify(report,null,2),'utf8');
  console.log(JSON.stringify(report.runs.map(({label,targetError,pauseCameraDrift,pauseTargetDrift,manualOrbit,errors})=>({label,targetError,pauseCameraDrift,pauseTargetDrift,manualOrbit,errors}))));
}finally{await browser.close();}
