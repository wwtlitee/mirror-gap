import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {createCompanion,adoptCompanion} from '../public/companion-identity.mjs';
import {createCare} from '../public/pet-care.mjs';
import {companionCheckpoint} from '../public/companion-checkpoint.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'file:///C:/Users/39215/.codex/skills/develop-web-game/node_modules/playwright/index.mjs');
const baseUrl=process.env.UI_TEST_URL??'http://127.0.0.1:4207/';
const out=process.env.UI_TEST_OUTPUT??'output/companion-v8.0-ui';
await fs.mkdir(out,{recursive:true});
const fixture=new EmbodiedLife().state;
fixture.companion=createCompanion();adoptCompanion(fixture.companion,'小分');
fixture.companion.voice.enabled=false;fixture.living.care=createCare();
const report={url:baseUrl,checks:[],errors:[],consoleErrors:[],screenshots:[]};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
let page;
try{
  const context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true});
  await context.addInitScript(checkpoint=>{
    if(!sessionStorage.uiOrganizationSeeded){
      localStorage.setItem('mirror-gap-companion-v2',JSON.stringify(checkpoint));
      localStorage.setItem('drosophila-language','zh');
      sessionStorage.uiOrganizationSeeded='yes';
    }
  },companionCheckpoint(fixture));
  page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
  const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
  const ready=()=>page.waitForFunction(()=>document.body.dataset.scene==='ready'&&JSON.parse(window.render_game_to_text()).connected,null,{timeout:120000});
  const pause=async()=>{
    await page.evaluate(async()=>{const {localApi}=await import('/browser-life.mjs');await localApi('/api/command',{type:'pause',value:true});});
    await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).paused);
  };
  const screenshot=async name=>{const path=`${out}/${name}.png`;await page.screenshot({path});report.screenshots.push(path);};
  const selectTab=async name=>{
    await page.click(`#settings-tab-${name}`);
    await page.waitForFunction(name=>document.getElementById(`settings-tab-${name}`).getAttribute('aria-selected')==='true'&&!document.getElementById(`settings-pane-${name}`).hidden,name);
  };
  const openSettings=async(name='sound')=>{await page.click('#settings-toggle');await selectTab(name);};
  const closeSettings=async()=>{await page.click('#settings-close');await page.waitForFunction(()=>!document.getElementById('settings-dialog').open);};
  const rangeValue=async(id,value,event='change')=>page.locator(id).evaluate((input,{value,event})=>{input.value=String(value);input.dispatchEvent(new Event(event,{bubbles:true}));},{value,event});
  const noHorizontalOverflow=async label=>{
    const sizes=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,dialog:[...document.querySelectorAll('dialog[open]')].map(el=>({id:el.id,width:el.clientWidth,scroll:el.scrollWidth,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right}))}));
    check(`${label}: no page or dialog horizontal overflow`,sizes.document<=sizes.width+1&&sizes.dialog.every(el=>el.scroll<=el.width+1&&el.left>=-1&&el.right<=sizes.width+1));
  };
  const checkTabs=async label=>check(`${label}: exactly one selected and visible settings pane`,await page.locator('#settings-dialog [role=tab][aria-selected=true]').count()===1&&await page.locator('#settings-dialog [role=tabpanel]:visible').count()===1);

  await page.goto(baseUrl);await ready();await pause();
  report.version=(await state()).version;
  check('five care actions visible at the front',await page.locator('#care-needs .need-action:visible').count()===5);
  check('ten states have one clear home',await page.locator('.need').count()===10&&await page.locator('#care-needs .need').count()===5&&await page.locator('#body-needs .need').count()===5);
  check('observation-only body states start folded',!(await page.locator('#body-details').evaluate(el=>el.open))&&await page.locator('#body-needs .need:visible').count()===0);
  await page.click('#body-details summary');
  check('all five additional states are reachable',await page.locator('#body-needs .need:visible').count()===5&&await page.locator('#body-needs .need-action').count()===0);
  await page.click('#body-details summary');
  check('technical metrics and motion explanation moved out of the main HUD',await page.locator('.hud-brain #neuron-count,.behavior-dock #motion-explanation').count()===0&&await page.locator('#neural-drawer #neuron-count,#neural-drawer #motion-explanation').count()===2);
  check('version and FPS are in settings',await page.locator('#settings-dialog .version,#settings-dialog #render-rate').count()===2);
  await noHorizontalOverflow('desktop');await screenshot('ui-desktop');

  await page.click('#habitat-tools-toggle');
  check('room drawer contains locations, journal and two interactions',await page.locator('#habitat-tools #zone-grid,#habitat-tools #journal').count()===2&&await page.locator('#habitat-tools [data-companion-action]').count()===2);
  check('room drawer has no weather, sound, language or backup settings',await page.locator('#habitat-tools #home-weather,#habitat-tools #companion-volume,#habitat-tools [data-language],#habitat-tools #companion-export,#habitat-tools .atmosphere-controls').count()===0);
  check('duplicate feed interaction removed',await page.locator('[data-companion-action=feed]').count()===0);
  await screenshot('ui-room-records');await page.click('#habitat-tools-close');

  await openSettings();
  check('sound tab owns voice and environment controls',await page.locator('#settings-pane-sound #companion-volume,#settings-pane-sound #home-weather,#settings-pane-sound #home-ambience-volume').count()===3);
  await checkTabs('sound tab');
  await page.selectOption('#home-weather','drizzle');
  await page.locator('#home-ambience-enabled').uncheck();
  await rangeValue('#home-ambience-volume',17,'input');
  check('weather and ambience controls save viewer preferences',await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('mirror-gap-atmosphere-v1'));return p.mode==='drizzle'&&!p.enabled&&Math.abs(p.volume-.17)<.001;}));
  await rangeValue('#companion-volume',35);
  await page.waitForFunction(()=>Math.abs(JSON.parse(window.render_game_to_text()).companion.voice.volume-.35)<.001);
  await page.locator('#companion-voice-enabled').check();
  await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).companion.voice.enabled);
  await page.locator('#companion-voice-enabled').uncheck();
  await page.waitForFunction(()=>!JSON.parse(window.render_game_to_text()).companion.voice.enabled);
  check('voice controls save through the existing companion API',Math.abs((await state()).companion.voice.volume-.35)<.001);
  await screenshot('ui-settings-sound');

  await selectTab('display');
  check('display tab owns language and visibility preferences',await page.locator('#settings-pane-display [data-language]').count()===2&&await page.locator('#settings-pane-display #show-brain,#settings-pane-display #show-hints').count()===2);
  await page.locator('#show-brain').uncheck();await page.locator('#show-hints').uncheck();
  await closeSettings();
  check('display choices hide the brain and view hint',!(await page.locator('.hud-brain').isVisible())&&!(await page.locator('.orbit-hint').isVisible()));
  await openSettings('display');await page.click('[data-language=en]');
  await page.waitForFunction(()=>document.documentElement.lang==='en');
  check('paused language switch refreshes settings tab labels',await page.locator('#settings-tab-sound').innerText()==='Sound & weather');
  await selectTab('sound');
  check('paused language switch refreshes moved voice controls',await page.locator('#companion-listen').innerText()==='Hear its voice');
  check('paused language switch refreshes weather options',await page.locator('#home-weather option:checked').innerText()==='Drizzle');

  await selectTab('backup');await checkTabs('backup tab');
  check('backup tab owns save status, identity and all backup actions',await page.locator('#settings-pane-backup #save-status,#settings-pane-backup #companion-id,#settings-pane-backup #companion-export,#settings-pane-backup #companion-import,#settings-pane-backup #companion-recover').count()===5);
  const downloadReady=page.waitForEvent('download');await page.click('#companion-export');const download=await downloadReady;
  check('backup export remains connected after moving controls',download.suggestedFilename().startsWith('fruit-fly-'));
  await page.waitForFunction(()=>document.getElementById('companion-backup-status').textContent==='Backup exported.');
  await selectTab('about');await checkTabs('about tab');
  check('about tab owns explanation, version and performance',await page.locator('#settings-pane-about #about-button,#settings-pane-about .version,#settings-pane-about #render-rate').count()===3);
  await page.click('#about-button');
  check('about explanation opens from settings',await page.locator('#about-dialog').evaluate(el=>el.open));
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.getElementById('about-dialog').open);
  check('closing explanation returns focus to its settings button',await page.locator('#about-button').evaluate(el=>el===document.activeElement&&document.getElementById('settings-dialog').open));
  const modelDownloadReady=page.waitForEvent('download');await page.click('#export-character');const modelDownload=await modelDownloadReady;
  check('3D model export downloads the current version',modelDownload.suggestedFilename()===`mirror-gap-v${report.version}.glb`);
  await page.waitForFunction(()=>/已导出|exported/i.test(document.getElementById('export-model-status').textContent)&&!document.getElementById('export-character').disabled);
  check('3D model export completion remains visible inside settings',await page.locator('#settings-pane-about #export-model-status').isVisible());
  await screenshot('ui-settings-about-en');

  await page.locator('#settings-tab-sound').focus();await page.keyboard.press('ArrowDown');
  check('ArrowDown moves focus and selection together',await page.locator('#settings-tab-display').evaluate(el=>el===document.activeElement&&el.getAttribute('aria-selected')==='true'));
  await page.keyboard.press('ArrowUp');
  check('ArrowUp returns to the previous category',await page.locator('#settings-tab-sound').evaluate(el=>el===document.activeElement&&el.getAttribute('aria-selected')==='true'));
  await page.keyboard.press('End');
  check('End selects the last category',await page.locator('#settings-tab-about').evaluate(el=>el===document.activeElement&&el.getAttribute('aria-selected')==='true'));
  await page.keyboard.press('Home');
  check('Home selects the first category',await page.locator('#settings-tab-sound').evaluate(el=>el===document.activeElement&&el.getAttribute('aria-selected')==='true'));
  await page.keyboard.press('Escape');
  check('Escape closes settings and restores the trigger focus',await page.locator('#settings-toggle').evaluate(el=>el===document.activeElement&&!document.getElementById('settings-dialog').open));

  await page.click('#companion-toggle');
  check('profile retains identity, renaming, habits and memories',await page.locator('#companion-dialog #companion-title,#companion-dialog #companion-name,#companion-dialog #companion-preferences,#companion-dialog #companion-memories').count()===4);
  check('profile has no duplicate voice slider or backup actions',await page.locator('#companion-dialog #companion-volume,#companion-dialog #companion-export,#companion-dialog #companion-import').count()===0);
  await page.click('#companion-dialog [data-open-settings=sound]');
  check('profile voice shortcut opens the sound category',await page.locator('#settings-dialog').evaluate(el=>el.open)&&await page.locator('#settings-tab-sound').getAttribute('aria-selected')==='true'&&!(await page.locator('#companion-dialog').evaluate(el=>el.open)));
  await closeSettings();await page.click('#companion-toggle');await page.click('#companion-dialog [data-open-settings=backup]');
  check('profile backup shortcut opens the backup category',await page.locator('#settings-tab-backup').getAttribute('aria-selected')==='true');
  await closeSettings();

  await page.reload();await ready();await pause();await openSettings('sound');
  check('weather and ambience preferences survive reload',await page.locator('#home-weather').inputValue()==='drizzle'&&!(await page.locator('#home-ambience-enabled').isChecked())&&await page.locator('#home-ambience-volume').inputValue()==='17');
  check('voice preferences survive reload',await page.locator('#companion-volume').inputValue()==='35'&&!(await page.locator('#companion-voice-enabled').isChecked()));
  await selectTab('display');
  check('language and visibility preferences survive reload',await page.evaluate(()=>document.documentElement.lang==='en')&&!(await page.locator('#show-brain').isChecked())&&!(await page.locator('#show-hints').isChecked()));
  await page.locator('#show-brain').check();await page.locator('#show-hints').check();await page.click('[data-language=zh]');await closeSettings();

  await page.setViewportSize({width:390,height:844});
  check('enabled view hints remain visible on mobile',await page.locator('.orbit-hint').isVisible());
  if(await page.locator('.hud-status').evaluate(el=>el.classList.contains('is-collapsed')))await page.click('.hud-status .hud-collapse');
  await page.locator('[data-care-need=curiosity]').scrollIntoViewIfNeeded();
  check('all care actions remain reachable on mobile',await page.locator('#care-needs .need-action:visible').count()===5);
  await page.locator('#body-details summary').scrollIntoViewIfNeeded();await page.click('#body-details summary');
  await page.locator('#body-needs .need').last().scrollIntoViewIfNeeded();
  check('mobile can reach the last body detail',await page.locator('#body-needs .need').last().isVisible());
  check('care collapse stays visible after scrolling to the last body detail',await page.locator('.hud-status .hud-collapse').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}));
  await page.locator('.hud-status .hud-collapse').click({trial:true});
  await noHorizontalOverflow('mobile body details');await screenshot('ui-mobile-body');
  await page.click('.hud-status .hud-collapse');
  if(await page.locator('.hud-brain').evaluate(el=>el.classList.contains('is-collapsed')))await page.click('.hud-brain .hud-collapse');
  await openSettings('display');await page.locator('#show-brain').uncheck();await closeSettings();
  check('hiding an expanded brain panel restores the care panel',await page.locator('.hud-status').isVisible());
  if(await page.locator('.hud-status').evaluate(el=>el.classList.contains('is-collapsed')))await page.click('.hud-status .hud-collapse');
  check('care actions remain reachable after the expanded brain is hidden',await page.locator('#care-needs .need-action:visible').count()===5);
  await page.click('.hud-status .hud-collapse');
  await openSettings('display');await page.locator('#show-brain').check();await closeSettings();
  if(!(await page.locator('.hud-brain').evaluate(el=>el.classList.contains('is-collapsed'))))await page.click('.hud-brain .hud-collapse');
  await screenshot('ui-mobile');await openSettings('sound');
  await noHorizontalOverflow('mobile settings');await screenshot('ui-mobile-settings');
  for(const tab of ['display','backup','about']){await selectTab(tab);await checkTabs(`mobile ${tab}`);await noHorizontalOverflow(`mobile ${tab}`);}
  await selectTab('display');await page.click('[data-language=en]');await selectTab('sound');await screenshot('ui-mobile-settings-en');
  await page.setViewportSize({width:390,height:568});await selectTab('backup');
  await page.locator('#companion-import').scrollIntoViewIfNeeded();
  check('short mobile viewport still reaches backup controls',await page.locator('#companion-import').isVisible());
  await noHorizontalOverflow('short mobile settings');await screenshot('ui-mobile-short-settings');
  await closeSettings();await page.setViewportSize({width:320,height:568});
  const primaryButtons=await page.locator('#habitat-tools-toggle,#neural-drawer-toggle,#companion-toggle').evaluateAll(buttons=>buttons.map(button=>{const r=button.getBoundingClientRect();return {id:button.id,left:r.left,right:r.right,top:r.top,bottom:r.bottom};}).sort((a,b)=>a.left-b.left));
  check('three main entries remain separate within a 320px viewport',primaryButtons.length===3&&primaryButtons.every((r,index)=>r.left>=0&&r.right<=320&&r.top>=0&&r.bottom<=568&&(index===0||r.left>=primaryButtons[index-1].right)));
  await noHorizontalOverflow('320px mobile');await screenshot('ui-mobile-320');
  check('camera buttons and fullscreen stay inside a 320px screen',await page.locator('.scene-toolbar button').evaluateAll(buttons=>buttons.every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})));
  const duplicateIds=await page.evaluate(()=>{const counts=new Map();for(const el of document.querySelectorAll('[id]'))counts.set(el.id,(counts.get(el.id)??0)+1);return [...counts].filter(([,count])=>count>1).map(([id])=>id);});
  check('no duplicate IDs after all moves',duplicateIds.length===0);
  check('no browser runtime errors',report.errors.length===0);
  report.passed=true;
}catch(error){
  report.passed=false;report.failure=error.stack;process.exitCode=1;
  if(page)try{await page.screenshot({path:`${out}/ui-failure.png`});}catch{}
}finally{
  await fs.writeFile(`${out}/ui-organization-browser.json`,JSON.stringify(report,null,2));
  await browser.close();console.log(JSON.stringify(report));
}
