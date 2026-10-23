import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {loadPlaywright} from './playwright-module.mjs';
const {chromium}=await loadPlaywright();
const browser=await chromium.launch({headless:true}),report={checks:[],errors:[]};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
try{const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto('http://127.0.0.1:4207/voice-samples.html');
  await page.evaluate(async()=>{const {createHomeAmbience}=await import('/home-ambience.mjs');window.ambienceTest=createHomeAmbience({random:()=>0});window.soundState={paused:false,companion:{identity:{adoptedAt:1}},actor:{contact:true},living:{sleep:{active:false}}};window.soundWeather={rain:1,wind:.6};window.speaking=false;window.soundTimer=setInterval(()=>ambienceTest.update(soundState,soundWeather,speaking),50);});
  await page.click('h1');await page.waitForTimeout(1000);
  const diagnostic=()=>page.evaluate(()=>ambienceTest.diagnostics());
  check('user gesture starts real Web Audio rain and wind',(await diagnostic()).state==='running'&&(await diagnostic()).rainGain>.08&&(await diagnostic()).rainLoaded);
  check('landed fly has no wing buzz',(await diagnostic()).wingGain===0);
  await page.evaluate(()=>soundState.actor.contact=false);await page.waitForTimeout(400);check('airborne fly raises the wing sound',(await diagnostic()).wingGain>.015);
  await page.evaluate(()=>{soundState.actor.contact=true;speaking=true;});await page.waitForTimeout(400);check('speech and environment coexist with mild balancing',(await diagnostic()).duck>.75&&(await diagnostic()).duck<.95&&(await diagnostic()).wingGain<.001);
  await page.evaluate(()=>speaking=false);await page.waitForTimeout(2200);check('environment recovers gently after speech',(await diagnostic()).duck>.9);
  console.log('Waiting for the naturally scheduled footsteps.');
  await page.waitForFunction(()=>ambienceTest.diagnostics().footsteps>=6,null,{timeout:45000});check('a quiet six-step pass occurs after its random interval',(await diagnostic()).footsteps===6);
  await page.evaluate(()=>ambienceTest.configure({enabled:false,volume:.28}));await page.waitForTimeout(100);check('explicit environment mute stops output',(await diagnostic()).masterGain===0);
  await page.evaluate(()=>{ambienceTest.dispose();clearInterval(soundTimer);});await page.waitForTimeout(100);check('disposal closes the audio context',(await diagnostic()).state==='closed');
  check('no Web Audio runtime errors',report.errors.length===0);report.passed=true;
}catch(e){report.passed=false;report.failure=e.stack;process.exitCode=1;console.error(e);}
finally{await fs.writeFile('output/companion-v7.2/atmosphere-audio.json',JSON.stringify(report,null,2));await browser.close();}
