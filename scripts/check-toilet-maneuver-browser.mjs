import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {createCompanion,adoptCompanion} from '../public/companion-identity.mjs';
import {companionCheckpoint} from '../public/companion-checkpoint.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'file:///C:/Users/39215/.codex/skills/develop-web-game/node_modules/playwright/index.mjs');
const url=process.env.TOILET_TEST_URL??'http://127.0.0.1:4207/';
const out=process.env.TOILET_TEST_OUTPUT??'output/toilet-v8.0.1/browser';await fs.mkdir(out,{recursive:true});
const s=new EmbodiedLife().state;s.companion=createCompanion({seed:'0123456789abcdef0123456789abcdef',now:1000});adoptCompanion(s.companion,'小豆',2000);s.companion.voice.enabled=false;
Object.assign(s.needs,{energy:95,satiety:95,curiosity:10,comfort:95});Object.assign(s.living.physiology,{waste:.95,thirst:.05,dirt:.05,sleepPressure:.05});
const report={url,checks:[],errors:[],consoleErrors:[],phases:[],samples:[],screenshots:[]};
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
let page;
try{
 const context=await browser.newContext({viewport:{width:1440,height:960}});
 await context.addInitScript(cp=>{localStorage.setItem('mirror-gap-companion-v2',JSON.stringify(cp));localStorage.setItem('drosophila-language','zh');},companionCheckpoint(s));
 page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 await page.goto(url);await page.waitForFunction(()=>document.body.dataset.scene==='ready'&&JSON.parse(window.render_game_to_text()).connected,null,{timeout:120000});
 const started=Date.now();let left=false;
 while(Date.now()-started<150000){
  const sample=await page.evaluate(()=>{const s=JSON.parse(window.render_game_to_text());return {version:s.version,t:s.simSeconds,p:s.actor.position,v:s.actor.velocity,heading:s.actor.heading,contact:s.actor.contact,feet:s.actor.supportFeet,phase:s.living.toiletManeuver?.phase??null,waste:s.living.physiology.waste,bowel:s.living.hygiene.bowelMovements,cooldown:s.living.activityCooldowns?.toilet??0,escape:s.living.escape.attempts,behavior:s.living.behavior,title:s.activity.title,rendering:s.rendering};});
  report.version=sample.version;report.samples.push(sample);
  if(sample.phase&&report.phases.at(-1)!==sample.phase){
   report.phases.push(sample.phase);
   const file=`${out}/${report.phases.length}-${sample.phase}.png`;await page.screenshot({path:file});report.screenshots.push(file);
  }
  if(sample.phase==='leave')left=true;
  if(left&&!sample.phase&&sample.cooldown>sample.t){report.final=sample;break;}
  await page.waitForTimeout(150);
 }
 const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);};
 check('the live browser completes one elimination and exits to the outer rim',report.final?.bowel===1&&report.final.waste<.02);
 const stages=['approach','land','walk','turn','eliminate','leave'];let cursor=-1;
 for(const phase of stages){cursor=report.phases.indexOf(phase,cursor+1);check(`live phase ${phase} occurs in order`,cursor>=0);}
 check('no escape burst interrupts a progressing toilet sequence',report.samples.every(s=>s.escape===0));
 check('elimination always has actual contact and at least three supported feet',report.samples.filter(s=>s.behavior==='toilet').every(s=>s.contact&&s.feet>=3));
 check('small rim footsteps are visibly animated as walking',report.samples.some(s=>s.phase==='walk'&&s.behavior==='walk'));
 check('completed sequence enters the existing toilet cooldown',report.final.cooldown>report.final.t);
 check('no duplicate discharge after returning to the outer rim',report.samples.every(s=>s.bowel<=1));
 check('no page exceptions or console errors',!report.errors.length&&!report.consoleErrors.length);
 report.passed=true;
}catch(error){report.passed=false;report.failure=error.stack;if(page)try{await page.screenshot({path:`${out}/failure.png`});}catch{}process.exitCode=1;}
finally{await fs.writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({passed:report.passed,version:report.version,checks:report.checks.length,phases:report.phases,errors:report.errors,consoleErrors:report.consoleErrors,failure:report.failure??null,output:out}));}
