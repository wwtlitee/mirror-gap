import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {createCompanion,adoptCompanion} from '../public/companion-identity.mjs';
import {companionCheckpoint} from '../public/companion-checkpoint.mjs';
import {recordHabit} from '../public/companion-development.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'file:///C:/Users/39215/.codex/skills/develop-web-game/node_modules/playwright/index.mjs');
const url=process.env.NATURAL_TEST_URL??'http://127.0.0.1:4217/';
const out=path.resolve(process.env.NATURAL_TEST_OUTPUT??'output/natural-home-v8.1.0');
const baseline=process.env.NATURAL_BASELINE==='1',seed='0123456789abcdef0123456789abcdef';
await fs.mkdir(out,{recursive:true});
const fixture=new EmbodiedLife().state;fixture.companion=createCompanion({id:'11111111-1111-4111-8111-111111111111',seed,now:1000});adoptCompanion(fixture.companion,'自然豆',2000);fixture.companion.voice.enabled=false;
fixture.companion.activeSeconds=21600;fixture.companion.growth={format:1,startedAt:0,elapsed:21600,nutrition:180,rest:600,progress:1};
for(const target of ['rest','feed','work','garden','flight','entry','perch','nook','toilet'])for(let n=0;n<3;n++){fixture.companion.activeSeconds+=140;recordHabit(fixture.companion,'place',target,.8,{duration:20});}
fixture.home.water=0;
const report={url,baseline,checks:[],screenshots:[],errors:[],consoleErrors:[],rendering:{},model:null};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
let context,page;
const shot=async name=>{const filename=path.join(out,name+'.png');await page.screenshot({path:filename});report.screenshots.push(filename);};
const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
const api=async body=>page.evaluate(async body=>{const {localApi}=await import('/browser-life.mjs');await localApi('/api/command',body);},body);
async function settle(){await page.waitForTimeout(1800);}
async function zone(id){await page.click('#habitat-tools-toggle');await page.click(`[data-zone="${id}"]`);await page.click('#habitat-tools-close');await settle();}
try{
  context=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true});
  await context.addInitScript(cp=>{if(!sessionStorage.naturalFixture){localStorage.setItem('mirror-gap-companion-v2',JSON.stringify(cp));localStorage.setItem('drosophila-language','zh');sessionStorage.naturalFixture='1';}},companionCheckpoint(fixture));
  page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
  await page.goto(url);await page.waitForFunction(()=>document.body.dataset.scene==='ready'&&JSON.parse(window.render_game_to_text()).connected,null,{timeout:120000});
  await api({type:'pause',value:true});await api({type:'daytime',value:'day'});await settle();
  check('fixture identity and real scene are loaded',(await state()).companion.identity.id===fixture.companion.identity.id);
  await shot('app-follow-day');await page.click('[data-view=overview]');await settle();await shot('app-overview-day');report.rendering.day=(await state()).rendering;
  await zone('feed');await shot('app-food-day');await zone('garden');await shot('app-window-day');
  await api({type:'daytime',value:'night'});await settle();await shot('app-window-night');
  await page.click('[data-view=overview]');await settle();await shot('app-overview-night');
  await api({type:'daytime',value:'day'});await page.click('#companion-toggle');await settle();await shot('profile-natural-model');
  if(!baseline){
    check('all nine fixture habits are shown',await page.locator('#companion-preferences details').count()===9);
    await page.locator('#companion-preferences summary').first().click();await settle();check('expanded habit keeps evidence through refresh',await page.locator('#companion-preferences details').first().evaluate(el=>el.open&&el.textContent.includes('有效记录')));await shot('profile-habit-evidence');
  }
  await page.click('#companion-close');
  if(!baseline){
    await api({type:'pause',value:false});await page.click('[data-care=replace-water]');await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).home.water>99);
    check('water preparation adds actual inventory',(await state()).home.water>99);check('care displays observation without claiming recovery',await page.locator('#care-result').innerText().then(text=>text.includes('观察')));await api({type:'pause',value:true});
    await page.click('#settings-toggle');await page.click('#settings-tab-backup');
    check('valid recovery snapshots are visible',await page.locator('.companion-snapshot').count()>0);await page.click('#companion-snapshots summary');await shot('settings-valid-saves');
    const download=page.waitForEvent('download');await page.locator('.companion-snapshot button').first().click();const saved=await download;await saved.saveAs(path.join(out,'exported-snapshot.json'));check('exported recovery copy validates',JSON.parse(await fs.readFile(path.join(out,'exported-snapshot.json'),'utf8')).companion.identity.id===fixture.companion.identity.id);
    await page.click('#settings-tab-display');await page.click('[data-language=en]');
    await page.waitForFunction(()=>document.querySelector('#home-intro-replay').textContent==='Getting started');
    check('intro replay follows language changes',await page.locator('#home-intro-replay').innerText()==='Getting started');
    await page.click('#settings-tab-about');await page.click('#home-intro-replay');check('intro can be replayed',await page.locator('#home-intro').evaluate(el=>el.open));
    check('intro opens in the selected language',await page.locator('#home-intro-title').innerText()==='Meet your companion');
    await shot('intro-replay');await page.click('#home-intro-skip');
    await page.click('#settings-toggle');await page.click('#settings-tab-display');await page.click('[data-language=zh]');await page.click('#settings-close');
    await page.setViewportSize({width:390,height:844});await settle();await shot('app-mobile');check('mobile has no horizontal page overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.setViewportSize({width:844,height:390});await settle();await shot('app-mobile-landscape');
    await page.setViewportSize({width:1600,height:1000});await page.reload();await page.waitForFunction(()=>document.body.dataset.scene==='ready'&&JSON.parse(window.render_game_to_text()).connected,null,{timeout:120000});await api({type:'pause',value:true});
    check('reload retains identity and mature growth',(await state()).companion.identity.id===fixture.companion.identity.id&&(await state()).companion.growth.progress===1);
    report.rendering.final=(await state()).rendering;
  }
  // Render the actual model at fixed scale from six directions, using the same
  // source module as the application. These are geometry probes, not mock art.
  await page.setViewportSize({width:900,height:700});
  report.model=await page.evaluate(async seed=>{
    const THREE=await import('/vendor/three/build/three.module.js'),{createMirrorGapCharacter}=await import('/character.mjs');
    const canvas=document.createElement('canvas');canvas.id='natural-model-probe';canvas.style='position:fixed;inset:0;z-index:100;width:900px;height:700px';document.body.append(canvas);
    const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});renderer.setSize(900,700,false);renderer.setPixelRatio(1);renderer.setClearColor(0xd9d6cc);renderer.toneMapping=THREE.ACESFilmicToneMapping;
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(36,900/700,.01,30);scene.add(new THREE.HemisphereLight(0xfff6e7,0x77746b,2.2));const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(3,5,4);scene.add(key);
    const fly=createMirrorGapCharacter(seed);scene.add(fly.root);fly.update({contact:true,behavior:'idle',velocity:[0,0,0],heading:0,position:[0,0,0]},0);
    let meshes=0,triangles=0,emissive=0;fly.root.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position?.count??0)/3;for(const m of Array.isArray(o.material)?o.material:[o.material])if(m.emissive?.getHex()&&m.emissiveIntensity>0)emissive++;}});
    window.naturalProbe={canvas,renderer,scene,camera,fly};return {meshes,triangles,emissive};
  },seed);
  for(const [name,position]of [['front',[0,.5,3.5]],['right',[3.4,.5,0]],['back',[0,.5,-3.5]],['left',[-3.4,.5,0]],['top',[.2,3.6,.1]],['three-quarter',[2.5,1.9,2.6]]]){
    const pixels=await page.evaluate(position=>{const p=window.naturalProbe;p.camera.position.set(...position);p.camera.lookAt(0,0,0);p.renderer.render(p.scene,p.camera);return p.canvas.toDataURL('image/png').split(',')[1];},position);
    const filename=path.join(out,'model-'+name+'.png');await fs.writeFile(filename,Buffer.from(pixels,'base64'));report.screenshots.push(filename);
  }
  await page.evaluate(()=>{const p=window.naturalProbe;p.fly.dispose();p.renderer.dispose();p.canvas.remove();delete window.naturalProbe;});
  check('no browser page exceptions',report.errors.length===0);check('no browser console errors',report.consoleErrors.length===0);
}catch(error){report.failure=error.stack;process.exitCode=1;try{await shot('failure');}catch{}}
finally{await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await context?.close();await browser.close();}
console.log(JSON.stringify({url,baseline,checks:report.checks.length,errors:report.errors,consoleErrors:report.consoleErrors,failure:report.failure??null,out}));
