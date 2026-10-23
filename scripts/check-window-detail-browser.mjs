import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {createCompanion,adoptCompanion} from '../public/companion-identity.mjs';
import {companionCheckpoint} from '../public/companion-checkpoint.mjs';
import {recordHabit} from '../public/companion-development.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'file:///C:/Users/39215/.codex/skills/develop-web-game/node_modules/playwright/index.mjs');
const url=process.env.WINDOW_TEST_URL??'http://127.0.0.1:4217/';
const output=path.resolve(process.env.WINDOW_TEST_OUTPUT??'output/window-v8.1.0a/detail');
const probeEnabled=process.env.WINDOW_TEST_PROBE!=='0';
await fs.mkdir(output,{recursive:true});
const fixture=new EmbodiedLife().state;
fixture.companion=createCompanion({id:'11111111-1111-4111-8111-111111111111',seed:'0123456789abcdef0123456789abcdef',now:1000});
adoptCompanion(fixture.companion,'自然豆',2000);fixture.companion.voice.enabled=false;
fixture.companion.activeSeconds=21600;fixture.companion.growth={format:1,startedAt:0,elapsed:21600,nutrition:180,rest:600,progress:1};
for(const target of ['rest','feed','work','garden','flight','entry','perch','nook','toilet'])for(let n=0;n<3;n++){fixture.companion.activeSeconds+=140;recordHabit(fixture.companion,'place',target,.8,{duration:20});}
fixture.home.water=0;
const checkpoint=companionCheckpoint(fixture);
const report={url,startedAt:new Date().toISOString(),fixture:{identity:fixture.companion.identity,checkpointSha256:crypto.createHash('sha256').update(JSON.stringify(checkpoint)).digest('hex')},checks:[],screenshots:[],errors:[],consoleErrors:[],assets:{},views:{},animation:null,probe:null,visualReview:'Pending inspection of the saved pixels; automated checks do not establish visual fidelity.'};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
let page;
const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
const api=body=>page.evaluate(async body=>{const {localApi}=await import('/browser-life.mjs');await localApi('/api/command',body);},body);
const saveShot=async name=>{const filename=path.join(output,`${name}.png`);await page.screenshot({path:filename});report.screenshots.push(filename);return filename;};
const settle=()=>page.waitForTimeout(1800);
const focusGarden=async()=>{await page.click('#habitat-tools-toggle');await page.click('[data-zone="garden"]');await page.click('#habitat-tools-close');await settle();};
const motion=state=>({boards:state.rendering.sky.city.billboards.boards,rail:state.rendering.sky.city.traffic.positions,cars:state.rendering.sky.city.traffic.carPositions,hover:state.rendering.sky.city.traffic.hoverPositions,robots:state.rendering.sky.city.traffic.robotPositions});
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function comparePixels(first,second){
  const images=await Promise.all([first,second].map(filename=>fs.readFile(filename).then(data=>data.toString('base64'))));
  return page.evaluate(async images=>{
    const read=async data=>{const picture=new Image();picture.src=`data:image/png;base64,${data}`;await picture.decode();const canvas=document.createElement('canvas');canvas.width=picture.width;canvas.height=picture.height;const context=canvas.getContext('2d');context.drawImage(picture,0,0);return{pixels:context.getImageData(0,0,canvas.width,canvas.height).data,width:canvas.width};};
    const [a,b]=await Promise.all(images.map(read));
    // These unaltered application screenshot regions are inside the default
    // garden opening and avoid HUD overlays and the fading selection ring.
    const regions={billboard:{x:860,y:75,width:160,height:130},rail:{x:560,y:205,width:650,height:65},shops:{x:630,y:280,width:450,height:115},road:{x:580,y:410,width:600,height:30}};
    return Object.fromEntries(Object.entries(regions).map(([name,rect])=>{let changed=0,totalDifference=0,maxDifference=0;for(let y=rect.y;y<rect.y+rect.height;y++)for(let x=rect.x;x<rect.x+rect.width;x++){const offset=(y*a.width+x)*4;let change=0;for(let channel=0;channel<3;channel++){const difference=Math.abs(a.pixels[offset+channel]-b.pixels[offset+channel]);totalDifference+=difference;change=Math.max(change,difference);}if(change>0)changed++;maxDifference=Math.max(maxDifference,change);}const count=rect.width*rect.height;return[name,{rect,pixels:count,changedPixels:changed,changedFraction:changed/count,meanChannelDifference:totalDifference/(count*3),maxChannelDifference:maxDifference}];}));
  },images);
}
try{
  const context=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true});
  await context.addInitScript(cp=>{localStorage.setItem('mirror-gap-companion-v2',JSON.stringify(cp));localStorage.setItem('drosophila-language','zh');},checkpoint);
  page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
  await page.goto(url);
  await page.waitForFunction(()=>document.body.dataset.scene==='ready'&&JSON.parse(window.render_game_to_text()).connected,null,{timeout:120000});
  report.transport='isolated browser fetch and Web Crypto';
  for(const name of ['scene.mjs','outside-world.mjs','night-city.mjs','night-city-materials.mjs','city-model-detail.mjs','city-shops.mjs','city-billboards.mjs','city-road-life.mjs','assets/night-city.json']){
    // Use the same browser network stack as the application. Node's separate
    // request stack may bypass the user's transport configuration.
    const asset=await page.evaluate(async name=>{
      const response=await fetch(new URL(name,location.href),{cache:'no-store',signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw Error(`HTTP ${response.status} ${name}`);
      const digest=await crypto.subtle.digest('SHA-256',await response.arrayBuffer());
      return{sha256:Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('')};
    },name);
    check(`served ${name}`,Boolean(asset.sha256));report.assets[name]=asset;
  }
  await api({type:'pause',value:true});await api({type:'daytime',value:'day'});await settle();await focusGarden();
  const day=await state();report.views.day=day.rendering;
  check('same fixed identity',day.companion.identity.id===fixture.companion.identity.id);
  check('authored city and shops restored',day.rendering.sky.city.signs===2&&day.rendering.sky.city.shops===8&&day.rendering.sky.city.modeledRooms===118);
  check('original rail and road traffic present',day.rendering.sky.city.traffic.railCarriages===2&&day.rendering.sky.city.traffic.groundCars===8);
  check('source detail geometry present',day.rendering.sky.city.modelDetail.beveledBuildings===22&&day.rendering.sky.city.modelDetail.roles.includes('projecting-window-sill'));
  await saveShot('app-window-day');
  await api({type:'daytime',value:'night'});await settle();report.views.night=(await state()).rendering;await saveShot('app-window-night');
  // Orbit through the normal pointer interface. Camera diagnostics establish that
  // each image came from a different real application view, not a cropped copy.
  const box=await page.locator('#home-canvas').boundingBox();assert.ok(box,'Application canvas is present');
  for(const [name,dx]of [['left',-145],['right',145]]){
    await focusGarden();await page.mouse.move(box.x+box.width*.61,box.y+box.height*.46);await page.mouse.down();
    await page.mouse.move(box.x+box.width*.61+dx,box.y+box.height*.46+12,{steps:12});await page.mouse.up();await settle();
    const orbit=await state();report.views[name]=orbit.rendering;
    check(`${name} orbit uses actual manual camera`,orbit.rendering.cameraMode==='manual');
    check(`${name} orbit changes camera`,!equal(orbit.rendering.cameraPosition,report.views.night.cameraPosition));
    await saveShot(`app-window-${name}`);
  }
  await focusGarden();await api({type:'daytime',value:'night'});await settle();
  const pauseStart=await state(),pausedFirst=await saveShot('app-window-paused-start');await page.waitForTimeout(3000);const pauseEnd=await state(),pausedLast=await saveShot('app-window-paused-end');
  check('paused billboard, rail, road, hover and robots stay fixed',equal(motion(pauseStart),motion(pauseEnd)));
  check('paused camera stays fixed',equal(pauseStart.rendering.cameraPosition,pauseEnd.rendering.cameraPosition));
  const pausedPixels=await comparePixels(pausedFirst,pausedLast);
  check('paused city pixels remain stable',Object.values(pausedPixels).every(region=>region.meanChannelDifference<.5));
  // A complete 19.2-second billboard period needs real animation time. The short
  // snapshots below also show actual vehicle movement and changing billboards.
  await api({type:'pause',value:false});await page.waitForTimeout(1500);const resumedEarly=await state();await saveShot('app-window-resumed-early');
  check('rail moves after resume',!equal(motion(pauseEnd).rail,motion(resumedEarly).rail));
  check('ground cars move after resume',!equal(motion(pauseEnd).cars,motion(resumedEarly).cars));
  const billboardStart=motion(pauseEnd).boards;
  await page.waitForFunction(initial=>JSON.parse(window.render_game_to_text()).rendering.sky.city.billboards.boards[0].from!==initial[0].from,billboardStart,{timeout:45000});
  const resumedBillboard=await state(),resumedShot=await saveShot('app-window-resumed-billboard');
  check('actual billboard playlist advances after resume',!equal(billboardStart,motion(resumedBillboard).boards));
  check('central visible billboard completes a real frame change',billboardStart[0].from!==motion(resumedBillboard).boards[0].from);
  await api({type:'pause',value:true});await page.waitForTimeout(350);const fadePauseStart=await state();await page.waitForTimeout(1500);const fadePauseEnd=await state();
  check('pause also freezes billboard during changed frame',equal(motion(fadePauseStart),motion(fadePauseEnd)));
  report.animation={pauseSeconds:3,pausedStart:motion(pauseStart),pausedEnd:motion(pauseEnd),resumedEarly:motion(resumedEarly),resumedBillboard:motion(resumedBillboard),fadePauseStart:motion(fadePauseStart),fadePauseEnd:motion(fadePauseEnd),pausedPixels,resumedPixels:await comparePixels(pausedLast,resumedShot),simSeconds:{start:pauseStart.simSeconds,end:pauseEnd.simSeconds,resumed:resumedBillboard.simSeconds}};
  if(probeEnabled){
    await page.setViewportSize({width:1300,height:900});
    report.probe=await page.evaluate(async()=>{
      const THREE=await import('/vendor/three/build/three.module.js');
      const {createNightCity}=await import('/night-city.mjs');
      const {RoomEnvironment}=await import('/vendor/three/examples/jsm/environments/RoomEnvironment.js');
      const data=await fetch('/assets/night-city.json').then(r=>r.json());
      const canvas=document.createElement('canvas');canvas.id='city-source-model-probe';canvas.style='position:fixed;inset:0;z-index:1000;width:1300px;height:900px';document.body.append(canvas);
      const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});renderer.setSize(1300,900,false);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.setClearColor(0x162430);
      const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,1300/900,.02,150);
      const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment(),environment=pmrem.fromScene(room,.055);scene.environment=environment.texture;scene.environmentIntensity=.4;room.dispose();pmrem.dispose();
      const ambient=new THREE.AmbientLight(0xe7eef8,1.28),sun=new THREE.DirectionalLight(0xffffff,3);sun.position.set(0,10,-4);scene.add(ambient,sun);
      // Invoke the exact served city factory. Only the application window portal
      // clip is omitted because this camera is outside that room; no asset,
      // material, geometry, authored transform, or animation is replaced.
      const city=await createNightCity(scene,material=>material);city.update(1,0);scene.updateMatrixWorld(true);
      const root=scene.getObjectByName('GameHub_Night_City_Opening_Street');
      const views={windows:{position:[25,25,-116],target:[43,22,-129]},shop:{position:[25,8,-126],target:[38.8,6,-142]},rail:{position:[27,16,-107],target:[36,17.5,-120]}};
      const models=[];root.traverse(o=>{if(o.isMesh)models.push({name:o.name,triangles:(o.geometry.index?.count??o.geometry.attributes.position.count)/3,instances:o.isInstancedMesh?o.count:1});});
      window.cityModelProbe={render(name){const view=views[name];camera.position.copy(root.localToWorld(new THREE.Vector3(...view.position)));camera.lookAt(root.localToWorld(new THREE.Vector3(...view.target)));renderer.render(scene,camera);return{...view,cameraPosition:camera.position.toArray(),target:root.localToWorld(new THREE.Vector3(...view.target)).toArray(),drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles};},dispose(){const geometries=new Set(),materials=new Set(),textures=new Set();scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const material of Array.isArray(o.material)?o.material:[o.material])if(material){materials.add(material);for(const property of ['map','emissiveMap','bumpMap','roughnessMap','normalMap'])if(material[property])textures.add(material[property]);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());environment.dispose();renderer.dispose();canvas.remove();delete window.cityModelProbe;}};
      return{scope:'Source-model geometry inspection outside the application camera; exact served createNightCity, original materials/layout/transforms, application window clipping omitted only for this external camera.',stats:city.stats,rootTransform:{position:root.position.toArray(),rotation:root.rotation.toArray(),scale:root.scale.toArray()},authoredView:data.view,models,views:{}};
    });
    for(const name of ['windows','shop','rail']){report.probe.views[name]=await page.evaluate(name=>window.cityModelProbe.render(name),name);await saveShot(`source-model-${name}`);}
    await page.evaluate(()=>window.cityModelProbe.dispose());
  }
  check('no uncaught browser errors',report.errors.length===0);
  check('no browser console errors',report.consoleErrors.length===0);
  report.finishedAt=new Date().toISOString();
}catch(error){report.failure=error.stack??String(error);if(page)try{await saveShot('failure');}catch{}throw error;}
finally{await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2),'utf8');await browser.close();}
console.log(JSON.stringify({checks:report.checks.length,screenshots:report.screenshots.length,errors:report.errors,consoleErrors:report.consoleErrors,probe:report.probe?.stats,output}));
