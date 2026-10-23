import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {createCompanion,adoptCompanion} from '../public/companion-identity.mjs';
import {companionCheckpoint} from '../public/companion-checkpoint.mjs';
import {recordHabit,recordRelationship,practiceToy,addMilestone} from '../public/companion-development.mjs';
import {bodyMetrics} from '../public/body-metrics.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'file:///C:/Users/39215/.codex/skills/develop-web-game/node_modules/playwright/index.mjs');
const url=process.env.GROWTH_TEST_URL??process.env.UI_TEST_URL??'http://127.0.0.1:4207/';
const out=process.env.GROWTH_TEST_OUTPUT??'output/companion-v8.0';await fs.mkdir(out,{recursive:true});
const seed='0123456789abcdef0123456789abcdef';
function fixture(stage){
  const state=new EmbodiedLife().state;state.companion=createCompanion({seed,now:1000});adoptCompanion(state.companion,'小豆',2000);state.companion.voice.enabled=false;
  const c=state.companion;
  if(stage==='mature'){
    for(let i=0;i<7;i++){c.activeSeconds=120+i*150;recordHabit(c,'food','banana',.9,{duration:12});recordRelationship(c,1);practiceToy(c,80,{newSession:true});}
    c.activeSeconds=21600;c.growth={format:1,startedAt:0,elapsed:21600,nutrition:180,rest:600,progress:1};
    addMilestone(c,{id:'growth-mature',kind:'growth',target:'mature',text:'经过实际进食、休息和相处，身体已经长到成熟体型。'});
  }
  if(stage==='legacy')c.activeSeconds=8000;
  const checkpoint=companionCheckpoint(state);if(stage==='legacy'){delete checkpoint.companion.development;delete checkpoint.companion.growth;}
  return checkpoint;
}
const report={url,checks:[],errors:[],consoleErrors:[],screenshots:[],stages:{}};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
let currentPage;
async function open(stage,viewport={width:1440,height:960}){
  const context=await browser.newContext({viewport,acceptDownloads:true});
  const checkpoint=fixture(stage);
  await context.addInitScript(cp=>{if(!sessionStorage.growthFixture){localStorage.setItem('mirror-gap-companion-v2',JSON.stringify(cp));localStorage.setItem('drosophila-language','zh');sessionStorage.growthFixture='yes';}},checkpoint);
  const page=await context.newPage();currentPage=page;
  page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
  await page.goto(url);
  await page.waitForFunction(()=>document.body.dataset.scene==='ready'&&JSON.parse(window.render_game_to_text()).connected,null,{timeout:120000});
  await page.evaluate(async()=>{const {localApi}=await import('/browser-life.mjs');await localApi('/api/command',{type:'pause',value:true});});
  await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).paused);
  return {context,page,checkpoint};
}
async function screenshot(page,name){const path=`${out}/${name}.png`;await page.screenshot({path});report.screenshots.push(path);}
async function state(page){return page.evaluate(()=>JSON.parse(window.render_game_to_text()));}
async function noOverflow(page,name){check(name,await page.evaluate(()=>{const dialog=document.querySelector('#companion-dialog'),rect=dialog.getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth+1&&dialog.scrollWidth<=dialog.clientWidth+1&&rect.left>=-1&&rect.right<=innerWidth+1;}));}
try{
  for(const stage of ['newborn','mature']){
    const {context,page}=await open(stage);
    await page.click('#companion-toggle');await page.waitForFunction(()=>!document.querySelector('#companion-growth-export').disabled);
    const snapshot=await state(page);report.version=snapshot.version;report.stages[stage]={growth:snapshot.companion.growthSummary,bodyScale:snapshot.actor.bodyScale};
    check(`${stage}: actual identity remains unchanged`,snapshot.companion.identity.seed===seed&&snapshot.companion.identity.name==='小豆');
    check(`${stage}: portrait canvas exists and controls are usable`,await page.locator('#companion-growth-portrait').isVisible()&&await page.locator('#companion-focus').isEnabled());
    const expected=stage==='newborn'?'1.00':'2.50';check(`${stage}: visible length ratio`,(await page.locator('#companion-growth-size').innerText()).includes(expected));
    check(`${stage}: growth stage label`,(await page.locator('#companion-growth-stage').innerText())===(stage==='newborn'?'初养':'成熟'));
    await noOverflow(page,`${stage}: desktop profile stays within viewport`);await screenshot(page,`growth-${stage}-desktop`);
    await page.locator('#companion-growth-portrait').screenshot({path:`${out}/portrait-${stage}.png`});report.screenshots.push(`${out}/portrait-${stage}.png`);
    await page.click('#companion-focus');await page.waitForFunction(()=>{const r=JSON.parse(window.render_game_to_text()).rendering;return !document.querySelector('#companion-dialog').open&&r.cameraMode==='follow'&&r.cameraArmLength<.2;});
    const world=await state(page);report.stages[stage].world={characterScale:world.rendering.characterScale,actorPosition:world.rendering.actorPosition,cameraPosition:world.rendering.cameraPosition,cameraArmLength:world.rendering.cameraArmLength};
    check(`${stage}: visible world mesh matches actual body metrics`,Math.abs(world.rendering.characterScale-bodyMetrics(world.actor).characterScale)<1e-8);
    await screenshot(page,`world-${stage}-follow`);await page.click('#companion-toggle');
    if(stage==='mature'){
      check('mature: durable food habit is visible',(await page.locator('#companion-preferences').innerText()).includes('香蕉')&&(await page.locator('#companion-preferences').innerText()).includes('形成偏好'));
      check('mature: relationship and practiced toy are visible',(await page.locator('#companion-relationship').innerText())==='渐渐熟悉'&&(await page.locator('#companion-toy').innerText()).includes('熟练玩家'));
      check('mature: important growth and habit events have a separate home',(await page.locator('#companion-milestones').innerText()).includes('成熟体型')&&await page.locator('.companion-recent[open]').count()===0);
      const downloadWait=page.waitForEvent('download');await page.click('#companion-growth-export');const download=await downloadWait;const path=`${out}/exported-growth-card.png`;await download.saveAs(path);
      const bytes=await fs.readFile(path);check('growth card exports a real PNG',download.suggestedFilename().endsWith('.png')&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.length>5000);report.screenshots.push(path);
      await page.click('#companion-dialog [data-open-settings=backup]');
      const backupWait=page.waitForEvent('download');await page.click('#companion-export');const backup=await backupWait;const backupPath=`${out}/growth-backup.json`;await backup.saveAs(backupPath);const saved=JSON.parse(await fs.readFile(backupPath,'utf8'));
      check('backup retains growth, habits, milestones and toy progress',saved.companion.growth.progress===1&&saved.companion.development.toy.skill===1&&saved.companion.development.milestones.length>2);
      await page.click('#settings-tab-display');await page.click('[data-language=en]');await page.click('#settings-close');await page.click('#companion-toggle');
      check('English growth stage and actions',(await page.locator('#companion-growth-stage').innerText())==='Mature'&&(await page.locator('#companion-focus').innerText())==='Look closer');
      check('growth export status follows language change',(await page.locator('#companion-growth-status').innerText())==='Growth card saved.');
      check('English milestone content is translated',!(await page.locator('#companion-milestones').innerText()).match(/[\u3400-\u9fff]/u));
      await screenshot(page,'growth-mature-english');
      await page.click('#companion-focus');await page.waitForFunction(()=>!document.querySelector('#companion-dialog').open);
      check('look closer returns to following camera',(await state(page)).rendering.cameraMode==='follow');
      for(const width of [390,320]){await page.setViewportSize({width,height:844});await page.click('#companion-toggle');await noOverflow(page,`${width}px: no horizontal overflow`);await screenshot(page,`growth-mobile-${width}`);await page.click('#companion-close');}
    }
    await context.close();
  }
  check('mature body length is 2.5 times newborn without world rescaling',Math.abs(report.stages.mature.bodyScale/report.stages.newborn.bodyScale-2.5)<.0001);
  check('world meshes grow 2.5 times with a fixed macro camera reference',Math.abs(report.stages.mature.world.characterScale/report.stages.newborn.world.characterScale-2.5)<.0001&&Math.abs(report.stages.mature.world.cameraArmLength-report.stages.newborn.world.cameraArmLength)<.003);
  {
    const {context,page,checkpoint}=await open('legacy');let snapshot=await state(page);
    check('legacy migration preserves identity and active age',snapshot.companion.identity.id===checkpoint.companion.identity.id&&snapshot.companion.activeSeconds>=8000);
    check('legacy migration invents no growth history or stable habits',snapshot.companion.growth.startedAt===8000&&snapshot.companion.growth.progress===0&&Object.keys(snapshot.companion.development.habits.food).length===0);
    await page.click('#settings-toggle');await page.click('#settings-tab-backup');const wait=page.waitForEvent('download');await page.click('#companion-export');const backup=await wait;await backup.saveAs(`${out}/legacy-migrated-backup.json`);
    const migrated=JSON.parse(await fs.readFile(`${out}/legacy-migrated-backup.json`,'utf8'));check('legacy migrated save exports valid new fields',migrated.companion.growth.startedAt===8000&&migrated.companion.development.format===1);
    await page.reload();await page.waitForFunction(()=>document.body.dataset.scene==='ready'&&JSON.parse(window.render_game_to_text()).connected,null,{timeout:120000});snapshot=await state(page);
    check('refresh preserves migrated origin and identity',snapshot.companion.growth.startedAt===8000&&snapshot.companion.identity.id===checkpoint.companion.identity.id);
    await context.close();
  }
  check('no browser page exceptions',report.errors.length===0);check('no browser console errors',report.consoleErrors.length===0);
}catch(error){report.failure=error.stack;try{await currentPage?.screenshot({path:`${out}/growth-failure.png`});}catch{}throw error;}
finally{await fs.writeFile(`${out}/growth-browser-report.json`,JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({checks:report.checks.length,errors:report.errors,consoleErrors:report.consoleErrors,failure:report.failure??null,output:out}));}
