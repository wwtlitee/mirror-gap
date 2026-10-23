import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {extractModuleSpecifiers,collectThreeAddonClosure} from './three-addon-closure.mjs';
const out=path.resolve('dist');await fs.mkdir(out,{recursive:true});
await fs.cp('public',out,{recursive:true,filter:source=>!/^mirror-gap-v.*\.glb$/.test(path.basename(source))});
// Historical exports are not loaded by the scene; export is generated live.
for(const file of await fs.readdir(path.join(out,'assets')))if(/^mirror-gap-v.*\.glb$/.test(file))await fs.unlink(path.join(out,'assets',file));
await fs.mkdir(path.join(out,'src'),{recursive:true});
for(const file of await fs.readdir('src'))if(/\.(mjs|json|sha256)$/.test(file)&&!['wallet-auth.mjs','game-store.mjs','neural-research.mjs'].includes(file))await fs.copyFile(path.join('src',file),path.join(out,'src',file));
await fs.cp('node_modules/three/build',path.join(out,'vendor/three/build'),{recursive:true});
async function addonEntries(folder){
 const entries=[];
 for(const item of await fs.readdir(folder,{withFileTypes:true})){
  const file=path.join(folder,item.name);
  if(item.isDirectory())entries.push(...await addonEntries(file));
  else if(/\.(mjs|js)$/.test(item.name))entries.push(...extractModuleSpecifiers(await fs.readFile(file,'utf8')).filter(value=>value.startsWith('three/addons/')));
 }
 return entries;
}
const addonFiles=await collectThreeAddonClosure({addonRoot:path.resolve('node_modules/three/examples/jsm'),entrySpecifiers:[...new Set([...await addonEntries('public'),...await addonEntries('src')])]});
const addonOut=path.join(out,'vendor/three/examples/jsm');await fs.mkdir(path.dirname(addonOut),{recursive:true});
const realOut=await fs.realpath(out),realParent=await fs.realpath(path.dirname(addonOut));
if(path.relative(realOut,path.join(realParent,'jsm'))!==path.join('vendor','three','examples','jsm'))throw Error('Refusing to clean an addon target outside this static build.');
await fs.rm(addonOut,{recursive:true,force:true});
for(const file of addonFiles){const target=path.join(addonOut,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join('node_modules/three/examples/jsm',file),target);}
await fs.copyFile('THIRD_PARTY_NOTICES.md',path.join(out,'THIRD_PARTY_NOTICES.md'));
await fs.cp('licenses',path.join(out,'licenses'),{recursive:true});
async function rewrite(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){
 const file=path.join(dir,entry.name);if(entry.isDirectory()){await rewrite(file);continue;}
 if(!/\.(mjs|js)$/.test(file))continue;
 let text=await fs.readFile(file,'utf8');
 // Module workers do not inherit the document import map. Newly shared model
 // recipes also import Three addons, whose copied modules need this rewrite.
 text=text.replaceAll("'three'","'/vendor/three/build/three.module.js'").replaceAll('"three"','"/vendor/three/build/three.module.js"').replaceAll("'three/addons/","'/vendor/three/examples/jsm/");
 if(dir===path.join(out,'src'))text=text.replaceAll('../public/','../');
 if(entry.name==='browser-life-worker.mjs')text=text.replaceAll('../src/','./src/');
 await fs.writeFile(file,text);
}}
await rewrite(out);
await fs.writeFile(path.join(out,'runtime-config.js'),'window.MIRROR_BROWSER_LIFE=true;\n');
let html=await fs.readFile(path.join(out,'index.html'),'utf8');
const changes={
 '生活观察室':'镜隙的数字分身',
 '生活持续记录中':'身份与经历保存在此浏览器',
 '这里只住着镜隙。':'这里住着你领养的果蝇。',
 '生活与经历保存在这台电脑上。':'身份、外观、声音、身体状态与习惯保存在当前浏览器。关闭页面或切到后台时暂停，再次打开时重新决定目标。可以在「设置 → 存档与备份」导出备份；清除浏览器数据会删除存档。',
 '点亮来自服务端实际仿真放电':'点亮来自浏览器后台线程实际仿真放电',
 '所有访客看到同一份神经活动。':'每位用户拥有独立生活的数字分身。',
 '神经状态随生活存档。':'身体数值和个体习惯自动保存在当前浏览器；神经电位与当前路线在重新打开时初始化。'
};for(const [from,to]of Object.entries(changes))html=html.replaceAll(from,to);
await fs.writeFile(path.join(out,'index.html'),html);
await fs.writeFile(path.join(out,'_headers'),'/*\n  Cache-Control: no-cache\n  X-Content-Type-Options: nosniff\n');
const packageInfo=JSON.parse(await fs.readFile('package.json','utf8'));
const version=packageInfo.productVersion??packageInfo.version;
const critical=['index.html','app.mjs','character.mjs','character-export.mjs','companion-appearance.mjs','companion-preview.mjs','companion-growth-card.mjs','natural-materials.mjs','room-model-detail.mjs','habitat-model-detail.mjs','camera-clipping.mjs','software-batching.mjs','city-model-detail.mjs','city-billboards.mjs','city-interiors.mjs','city-shops.mjs','city-road-life.mjs','city-traffic-paths.mjs','assets/night-city.json','assets/night-city/ad-atlas.png','assets/night-city/ad-street.png','outside-world.mjs','billboard-cycle.mjs','natural-ui.css','scene.mjs','night-city.mjs','night-city-materials.mjs','resource-spec.mjs','resource-landing.mjs','collision-world.mjs','environment-spec.mjs','foot-placement.mjs','room-assets.mjs','open-habitat.mjs','water-surfaces.mjs','browser-life.mjs','browser-life-worker.mjs','companion-checkpoint.mjs','companion-learning.mjs','companion-development.mjs','companion-evidence.mjs','companion-ui.mjs','home-onboarding.mjs','pet-care-ui.mjs','world-spec.mjs','locale-en.json','src/embodied-life.mjs','assets/room-collision.json','assets/room-collision.bin','assets/resource-surfaces.json'];
for(const name of ['food-model-detail.mjs','interior-refinement.mjs','toilet-model-detail.mjs','city-natural-detail.mjs','home-render-finish.mjs','render-quality.mjs','mesh-batching.mjs'])critical.push(name);
critical.push('src/neutral-odor-learning.mjs');
critical.push('tapeout-verification.mjs');
critical.push('coop-trial.mjs','coop-presentation.mjs');
critical.push('coop-pairing.mjs');
critical.push('resource-arrival.mjs','route-planner.mjs');
critical.push('coop-clock.mjs');
critical.push('learned-foraging.mjs','mechanical-fly.mjs','mechanical-view.mjs','mechanical-room-collision.mjs','mirror-campaign.mjs','mirror-coop-world.mjs','tapeout-circuit.mjs','mirror-coop-client.mjs','mirror-coop-worker.mjs','coop.html','coop.css','coop-app.mjs','src/mirror-coop-session.mjs','src/runtime-clock.mjs');
critical.push('training.html','training.css','training-app.mjs','cue-training-client.mjs','cue-training-worker.mjs','cue-training-markers.mjs','src/cue-training-session.mjs');
critical.push('src/odor-learning.mjs','src/mushroom-circuit.mjs','src/mushroom-connectome.json','synaptic-memory-schema.mjs','src/functional-controller.mjs','src/neural-controller.mjs','src/neural-core.mjs','src/functional-connectome.json','src/functional-calibration.json','navigation-attention.mjs','neural-cadence.mjs','companion-checkpoint.mjs');
for(const name of await fs.readdir(path.join(out,'assets/natural-surfaces')))critical.push('assets/natural-surfaces/'+name);
critical.push('resource-data.mjs','resource-contact.mjs');
critical.push('vendor/three/examples/jsm/geometries/RoundedBoxGeometry.js','vendor/three/examples/jsm/utils/BufferGeometryUtils.js');
for(const name of await fs.readdir(path.join(out,'assets/resource-surfaces')))if(name.endsWith('.json'))critical.push('assets/resource-surfaces/'+name);
critical.push('THIRD_PARTY_NOTICES.md',...addonFiles.map(file=>'vendor/three/examples/jsm/'+file));
for(const file of await fs.readdir(path.join(out,'licenses')))critical.push('licenses/'+file);
const resources={};for(const file of critical){const bytes=await fs.readFile(path.join(out,file));resources[file]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
await fs.writeFile(path.join(out,'release-manifest.json'),JSON.stringify({product:'Mirror Gap',version,builtAt:new Date().toISOString(),resources},null,2));
console.log('Mirror Gap static build: '+out+'; Three addon files: '+addonFiles.length);
