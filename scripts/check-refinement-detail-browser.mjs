import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {createCompanion} from '../public/companion-identity.mjs';
import {BASE_BODY_LENGTH} from '../public/body-metrics.mjs';
import {toiletRimStations,toiletPose} from '../public/toilet-contact.mjs';

// Actual source-scene inspection in an isolated headless browser. The temporary
// response hook changes only the camera; no application, API or player storage
// is loaded. A screenshot is evidence for review, never an automatic quality pass.
// node scripts/check-refinement-detail-browser.mjs [publicRoot] [output]
// --public-root PATH --output PATH --only NAME,NAME --list --width N --height N
// --software avoids hardware GPU use; --isolate-owner NAME removes unrelated
// authored city parts only in a diagnostic response, never in production.
// --supplemental adds actual createNightCity model inspection without window
// clipping, in a separate scene. Those images are NOT player-window evidence.
// REFINEMENT_PUBLIC_ROOT / REFINEMENT_OUTPUT (ROOM_TEST_ROOT/OUTPUT also work).

const projectRoot=path.resolve(import.meta.dirname,'..');
const range=(prefix,n)=>Array.from({length:n},(_,i)=>prefix+String(i+1).padStart(2,'0'));
const allItems=[...range('A',10),...range('B',8),...range('C',13),...range('D',13),...range('E',6),...range('F',11),...range('G',18),...range('H',4)];
const view=(name,label,position,target,items,light='day')=>({name,label,position,target,items,light});
const overview=[12.61,10.767,16.587],overviewTarget=[0,1.25,-.1];
const shots=[
 view('01-overview-day','白天完整全景',overview,overviewTarget,[...allItems.filter(id=>!id.startsWith('G')), 'G01','G02','G07']),
 view('02-overview-night','夜晚完整全景',overview,overviewTarget,['A08','B07','B08','C04','G01','G02','G14','H02','H03','H04'],'night'),
 view('03-bed-soft','床垫、枕头与软包床头',[-1.8,2.9,.1],[-4.27,1.43,-2.95],range('B',5)),
 view('04-bed-joinery-lamp','床座、边桌与床头灯',[-1.2,1.65,-.75],[-3.35,.80,-2.66],['B01','B03','B06','B07']),
 view('05-pendant-rest','休息区吊灯',[-3.78,3.93,.22],[-5.07,3.32,-.96],['B08','A06']),
 view('06-pendant-work','办公区吊灯',[1.14,4.20,-2.10],[.10,3.76,-3.80],['B08','A05','A06']),
 view('07-desk-cabinets-monitor','桌柜、拉手、显示器',[2.5,2.5,.1],[-1,1.25,-3.15],range('C',5)),
 view('08-keyboard-mouse-notebook','键盘、鼠标、笔记本',[-.8,2.85,-.85],[-1.26,1.38,-3.20],['C06','C07','C08','B07']),
 view('09-chair','躺椅与脚托',[.8,1.55,-.4],[-1.18,.58,-1.98],['C09']),
 view('10-bookcase-books','书架、层板及全部书本',[-.5,3.0,3.2],[-5.18,1.75,1.60],['C10','C11','C12']),
 view('11-standing-books','前沿托架与七本书',[-.7,1.7,6.2],[-1.99,.60,3.96],['C13','A07']),
 view('12-dining-all','餐台与全部食品',[-.1,2.3,4.3],[-3.43,.82,1.33],range('D',13)),
 view('13-food-apple','苹果、果梗与叶子',[-2.66,1.61,2.23],[-3.11,1.19,1.55],['D06']),
 view('14-food-banana','香蕉',[-2.55,1.65,2.49],[-3.01,1.175,1.73],['D07','D04']),
 view('15-food-burger','汉堡及托盘',[-3.29,1.78,1.28],[-3.94,1.23,.48],['D08','D05']),
 view('16-food-pizza','披萨与分片',[-2.20,1.80,3.34],[-2.82,1.10,2.48],['D09','D05']),
 view('17-food-fries','薯条纸盒、盒内与散装薯条',[-3.18,1.81,1.82],[-3.68,1.21,1.12],['D10']),
 view('18-food-sandwich','三明治',[-3.57,1.64,2.55],[-4.05,1.115,1.85],['D11']),
 view('19-food-fig','无花果果肉、种子与盘',[-3.17,1.67,2.89],[-3.62,1.12,2.24],['D12','D05']),
 view('20-bottle-bowls','瓶子、瓶塞、液体与两碗',[-1.75,2.65,3.4],[-3.48,1.22,1.12],['D02','D03','D04','D05','D13']),
 view('21-rug-floor','地毯厚度、滚边、流苏与地板',[3.9,4.0,5.3],[.20,.04,.88],['E01','A02','A03']),
 view('22-plant-left','左前盆栽、盆口、土壤与叶片',[-4.90,.76,4.20],[-5.51,.34,3.66],['E02']),
 view('23-plant-right','右前盆栽、盆口、土壤与叶片',[2.40,1.00,4.60],[1.66,.50,3.83],['E02']),
 view('24-vine-wall','藤蔓、叶柄、墙柱与石块',[-1.70,4.20,-1.25],[-4.20,3.93,-4.0],['E03','A04','A05','A06','A07']),
 view('25-habitat-all','生态全景及基座',[7.6,4.3,6.3],[4.10,.95,1.60],range('F',11)),
 view('26-habitat-stones-palm','主景石、棕榈、倒木及灌木',[6.1,3.6,1.6],[4.55,1.25,.4],['F02','F03','F05','F06']),
 view('27-habitat-grass-mushrooms','大叶草、细草、蘑菇与灌木',[2.2,1.6,2.9],[3.50,.58,1.80],['F06','F07','F08','F09']),
 view('28-habitat-pool-lily-pebbles','湿土、卵石、浮叶与浅水',[4.7,1.6,4.4],[4.50,.32,3.10],['F01','F04','F10','F11','H03']),
 view('29-toilet-front','马桶正面、座圈、盆内水',[4.20,1.25,1.10],[4.35,.55,.38],['E04','E05','E06']),
 view('30-toilet-side-back','马桶侧后面、掀盖与连接',[4.20,1.75,-1.55],[4.35,.58,.38],['E04','E05','E06']),
 view('31-window-buildings','窗框、楼体、楼内房间与广告',[3.03,3.35,-2.20],[3.03,5.0,-16.0],[...range('G',8),'G13','G14','A08','A09','A10']),
 view('32-window-shops','八家店铺、橱窗与道路',[3.03,2.40,-3.95],[3.00,-.9,-12.3],['G09','G10','G11']),
 view('33-window-trees-traffic','行道树与中央道路交通',[3.03,3.60,-4.10],[3.03,-1.25,-10.20],['G11','G12','G13','G15','G16','G17','G18']),
 view('34-window-night','夜间街区、广告与灯光',[3.03,3.10,-2.00],[3.03,3.25,-16.0],[...range('G',18),'H02','H03','H04'],'night'),
 {...view('35-actor-body','果蝇本体近景',null,null,['H01']),actorCamera:true},
 view('36-window-street-left','真实窗内向左看道路、树、车与机器人',[2.70,3.40,-4.24],[-15,-.90,-11.50],['G09','G10','G11','G12','G13','G15','G16','G17','G18']),
 view('37-window-street-right','真实窗内向右看道路、树、车与机器人',[3.30,3.40,-4.24],[18,-.90,-11.50],['G09','G10','G11','G12','G13','G15','G16','G17','G18']),
 view('38-window-sky-day','真实窗内仰看白天天空与云',[3.03,4.30,-4.25],[3.03,32,-58],['H02']),
 view('39-window-sky-night','真实窗内仰看夜间天空与星点',[3.03,4.30,-4.25],[3.03,32,-58],['H02'],'night'),
 {...view('40-window-rain-day','真实窗内雨天气遮挡与尺度',[3.03,3.0,-2.40],[3.03,3.5,-16],['H02','H03']),weather:{cloud:.65,rain:.8,wind:.2}},
 {...view('41-window-rain-night','真实窗内夜雨与街灯关系',[3.03,3.0,-2.40],[3.03,3.5,-16],['H02','H03'],'night'),weather:{cloud:.65,rain:.8,wind:.2}},
 {...view('42-actor-back','果蝇背面腹节翅脉与六足',null,null,['H01']),actorCamera:true,actorOffset:[-.023,.016,-.032]},
 {...view('43-window-sun','真实窗内太阳方向与自然遮挡',[5.58,4.50,-4.33],[15,14.26,-64],['H02']),hour:14},
 {...view('44-window-moon','真实窗内月亮方向与自然遮挡',[.52,4.50,-4.33],[-9,14.26,-64],['H02'],'night'),hour:22},
 {...view('45-mist-fixture','原比例喷雾状态注入渲染',[6.1,2.75,4.8],[4.0,1.45,1.2],['H03']),effect:'mist'},
 {...view('46-pellet-fixture','原比例排泄粒状态注入渲染',[4.366,.307,.404],[4.35,.29,.38],['H03']),effect:'pellet'},
 {...view('47-actor-left','果蝇左侧关节与足端',null,null,['H01']),actorCamera:true,actorOffset:[-.032,.004,.010]},
 {...view('48-actor-right','果蝇右侧关节与足端',null,null,['H01']),actorCamera:true,actorOffset:[.032,.004,.010]},
 {...view('49-actor-underside','果蝇腹面和六足静态构造',null,null,['H01']),actorCamera:true,actorOffset:[0,-.013,.030]},
 view('50-base-edge','房屋底台前右接角与厚度',[6.8,.25,6.8],[4.8,-.10,3.8],['A01','A02','A03','A07']),
];

const cli={positional:[]};
for(let i=2;i<process.argv.length;i++){
 const argument=process.argv[i];
 if(['--list','--help','--supplemental','--software'].includes(argument)){cli[argument.slice(2)]=true;continue;}
 if(argument.startsWith('--')){
  assert.ok(['--public-root','--output','--only','--width','--height','--isolate-owner'].includes(argument),`Unknown option ${argument}`);
  const value=process.argv[++i];assert.ok(value&&!value.startsWith('--'),`Missing value for ${argument}`);cli[argument.slice(2)]=value;
 }else cli.positional.push(argument);
}
assert.ok(cli.positional.length<=2,'Only publicRoot and output positional arguments are supported');
if(cli.help){
 console.log('node scripts/check-refinement-detail-browser.mjs [publicRoot] [output] [--only NAME,NAME] [--list] [--supplemental]\nSupplemental images use actual createNightCity models, neutral inspection light and no window clipping; they are not player-window acceptance.\nEnv: REFINEMENT_PUBLIC_ROOT, REFINEMENT_OUTPUT, REFINEMENT_WIDTH, REFINEMENT_HEIGHT, PLAYWRIGHT_MODULE');
 console.log('Additional options: --software; --isolate-owner NAME (independent city-model shots only).');
 process.exit(0);
}
const publicRoot=path.resolve(cli['public-root']??cli.positional[0]??process.env.REFINEMENT_PUBLIC_ROOT??process.env.ROOM_TEST_ROOT??path.join(projectRoot,'public'));
const supplemental=[];
if(cli.supplemental){
 const cityData=JSON.parse(await fs.readFile(path.join(publicRoot,'assets/night-city.json'),'utf8'));
 const toWorld=([x,y,z])=>[3+(z-cityData.view.sourceWindow[2])*cityData.view.scale,cityData.view.groundY+y*cityData.view.scale,-4.4+(cityData.view.sourceWindow[0]-x)*cityData.view.scale];
 const modelView=(name,label,position,target,items,light='day')=>({...view(name,label,toWorld(position),toWorld(target),items,light),factory:'city-model',sourcePosition:position,sourceTarget:target,evidence:'Independent actual createNightCity factory; identity material wrapper, neutral inspection light, no physical-window clipping. Not player-window evidence.'});
 for(const [name,z]of [['SOL',-220],['AEON',-180],['NOX',-142],['IGNIS',-105],['VERA',-62],['LUNE',-22],['ORBIT',20],['KITE',62]]){
  supplemental.push(modelView(`city-shop-${name.toLowerCase()}`,`${name} 店铺、橱窗与固体室内模型`,[8,10,z+5],[40,4.8,z],['G09','G10']));
 }
 for(const building of cityData.buildings){
  const parts=cityData.parts.filter(part=>part.owner===building.id);
  assert.ok(parts.length,`Building ${building.id} has source geometry`);
  const height=Math.max(...parts.map(part=>(part.y??0)+(part.h??0)/2));
  const centre=[building.x,height*.48,building.z],distance=Math.max(65,height*1.35);
  supplemental.push(modelView(`city-building-${building.id}`,`${building.id} 原场景建筑与楼内房间`,[building.x-distance,centre[1]+height*.08,building.z+distance*.32],centre,['G01','G02','G03','G04','G05','G06','G08','G13','G14']));
 }
 supplemental.push(
  modelView('city-skyline-left','远楼左侧整体轮廓',[15,138,-285],[112,125,-245],['G07']),
  modelView('city-skyline-right','远楼右侧整体轮廓',[20,140,95],[122,125,55],['G07']),
  modelView('city-traffic-ground','地面汽车车身、轮胎与车灯',[-30,5,-331],[-23,2.4,-340],['G15','G11']),
  modelView('city-traffic-hover','悬浮车车身、玻璃与悬浮机构',[-22,37,-313],[-16,34,-320],['G16']),
  modelView('city-traffic-rail','轨道车车身、门缝、底部与轨道',[24,26,-248],[36,20.2,-257],['G17','G13']),
  modelView('city-robot-walker','双足服务机器人近景',[-35.8,3.6,-246.9],[-33,2.25,-250],['G18']),
  modelView('city-robot-rover','轮式服务机器人近景',[28.5,3.6,-241],[33,2,-245],['G18']),
  modelView('city-tree-left','左侧行道树树干、分枝与树冠',[-44,8,-50],[-34.5,3.5,-58],['G12']),
  modelView('city-tree-right','右侧行道树树干、分枝与树冠',[22,8,50],[34.5,3.5,42],['G12']),
  modelView('city-model-night','独立夜间店铺、广告与轨道模型',[2,42,-32],[56,24,-67],range('G',18),'night'),
  modelView('city-split-links','实际双塔后上方与连桥',[330,185,178],[165,81,86],['G05']),
  modelView('city-split-gap','正对三条原连桥及塔间空隙',[162.84,90,220],[162.84,65,83.84],['G05']),
  modelView('city-redline-structure','实际服务脊后上方结构',[315,200,-290],[129,96,-190],['G06']),
  modelView('city-redline-joint','原挂接板、外挂脊上部与红色构件',[40,135,-240],[108,115,-185],['G06']),
  modelView('city-redline-roof','实际屋顶斜杆与平台连接',[115,180,-145],[123.4,170.45,-183],['G06']),
 );
 for(let i=0;i<9;i++){
  const owner=`skyline-1-${i}`,parts=cityData.parts.filter(part=>part.owner===owner),body=parts[0];
  const height=Math.max(...parts.map(part=>part.y+part.h/2));
  supplemental.push(modelView(`city-skyline-${i}`,`${owner}全高轮廓及顶部`,[body.x+height*1.8,height*.62,body.z+height*.20],[body.x,height*.5,body.z],['G07']));
 }
 const outsideView=(name,label,position,target,light='day')=>({...view(name,label,position,target,['H02'],light),factory:'outside-model',evidence:'Independent actual createOutsideWorld, with only the window-discard disabled in a server response alias. Original models/materials/clock retained. Not player-window evidence.'});
 supplemental.push(
  outsideView('outside-sun','真实天空工厂太阳细节',[15,14.25833,-57],[15,14.25833,-64]),
  outsideView('outside-moon','真实天空工厂月球浅坑',[-9,14.25833,-57],[-9,14.25833,-64],'night'),
  outsideView('outside-ridges','真实天空工厂三层远山',[3,2,-42],[3,-2,-64]),
  outsideView('outside-clouds','真实天空工厂云层',[3,28,-30],[3,28,-53]),
  outsideView('outside-stars','真实天空工厂星点',[3,18,-40],[3,18,-70],'night'),
 );
}
const available=[...shots,...supplemental],requested=cli.only?.split(',').filter(Boolean);
if(requested)assert.ok(requested.every(name=>available.some(shot=>shot.name===name)),`Unknown shot: ${requested.filter(name=>!available.some(shot=>shot.name===name)).join(', ')}`);
const selected=requested?available.filter(shot=>requested.includes(shot.name)):available;
const isolatedOwner=cli['isolate-owner']??null;
if(isolatedOwner){
 assert.match(isolatedOwner,/^[a-z0-9-]+$/,'Authored owner identifier');
 assert.ok(selected.every(shot=>shot.factory==='city-model'),'Owner isolation is only available for independent city model shots');
 const cityData=JSON.parse(await fs.readFile(path.join(publicRoot,'assets/night-city.json'),'utf8'));
 assert.ok(cityData.parts.some(part=>part.owner===isolatedOwner),'Owner exists in actual geometry');
}
const intendedItems=[...new Set(selected.flatMap(shot=>shot.items))].sort();
if(cli.list){console.log(JSON.stringify({shots:selected,plannedItems:allItems.length,intendedItems:intendedItems.length,uncoveredItems:allItems.filter(id=>!intendedItems.includes(id)),visualAcceptance:'Pending real pixels; coverage here is intention only.'},null,2));process.exit(0);}

const packageInfo=JSON.parse(await fs.readFile(path.join(projectRoot,'package.json'),'utf8'));
const runId=new Date().toISOString().replace(/[:.]/g,'-');
const output=path.resolve(cli.output??cli.positional[1]??process.env.REFINEMENT_OUTPUT??process.env.ROOM_TEST_OUTPUT??path.join(projectRoot,`output/room-v${packageInfo.productVersion??packageInfo.version}/refinement-detail-${runId}`));
const viewport={width:Number(cli.width??process.env.REFINEMENT_WIDTH??1600),height:Number(cli.height??process.env.REFINEMENT_HEIGHT??1200)};
assert.ok(Object.values(viewport).every(n=>Number.isInteger(n)&&n>=320&&n<=4096),'Viewport dimensions must be integers from 320 to 4096');
await fs.mkdir(output,{recursive:true});

const base=new EmbodiedLife().snapshot();
const fixture={version:'refinement-render-fixture-v1',simSeconds:0,paused:true,
 clock:{hour:14,daylight:.866,mode:'fixed',timezone:'Asia/Shanghai'},weather:{cloud:0,rain:0},
 actor:{...base.actor,position:[0,.11,.8],velocity:[0,0,0],heading:0,pitch:0,bank:0,contact:true,zoneId:'flight',mode:'activity',action:'observe',bodyScale:.19/12/BASE_BODY_LENGTH},
 living:base.living,companion:createCompanion({id:'22222222-2222-4222-8222-222222222222',seed:'0123456789abcdef0123456789abcdef',now:1000})};
if(selected.some(shot=>shot.effect==='pellet')){
 const station=toiletRimStations(fixture.actor)[0];assert.ok(station,'Actual supported inner-rim station');
 const pose=toiletPose({...fixture.actor,position:station.position,heading:station.heading,zoneId:'toilet',contact:true});
 assert.ok(pose,'Actual physical outlet pose');fixture.inspectionDrop=pose.drop;
 assert.ok(pose.drop[1]>.46,'Fixture outlet is above the real water surface');
}
const fixtureJson=JSON.stringify(fixture);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={scope:'Isolated actual home source scene through the physical window, plus optional separate createNightCity model inspection with identity material wrapper and no window clipping. Neither mode validates application flow, business APIs or player storage.',
 publicRoot,output,productVersion:packageInfo.productVersion??packageInfo.version,viewport,startedAt:new Date().toISOString(),
 fixtureSha256:digest(fixtureJson),fixture:{paused:true,actorPosition:fixture.actor.position,bodyScale:fixture.actor.bodyScale,seed:fixture.companion.identity.seed,day:{hour:14,daylight:.866},night:{hour:22,daylight:0},inspectionDrop:fixture.inspectionDrop??null},
 isolatedOwner,isolationMeaning:isolatedOwner?'Diagnostic response excludes unrelated authored parts and trees; actual owner geometry, material and transform retained. Does not validate visibility through the player window.':null,
 coverage:{plannedItems:allItems.length,intendedItems,uncoveredItems:allItems.filter(id=>!intendedItems.includes(id)),meaning:'Intended camera coverage only; does not establish that every instance is visible or acceptable.'},
 errors:[],consoleErrors:[],consoleWarnings:[],requestFailures:[],httpErrors:[],resourceDrift:[],resources:{},shots:[],
 visualAcceptance:'Pending pixel inspection; screenshot capture, draw counts and triangle counts alone do not establish refinement quality.'};
const sourceFiles=new Map();
const html=`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:#15191e}canvas{display:block;width:100%;height:100%}</style><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/"}}</script></head><body><canvas></canvas><script type="module">try{const{createHomeScene}=await import('/scene.mjs');window.room=await createHomeScene(document.querySelector('canvas'));window.fixture=${fixtureJson};window.ready=true;}catch(error){window.bootError=error.stack??String(error);console.error(error);}</script></body></html>`;
const cityHtml=`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:#15191e}canvas{display:block;width:100%;height:100%}</style><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/"}}</script></head><body><canvas></canvas><script type="module">try{
 const THREE=await import('three'),{createNightCity}=await import('/night-city.mjs'),{RoomEnvironment}=await import('three/addons/environments/RoomEnvironment.js'),{createHomeRenderFinish}=await import('/home-render-finish.mjs'),{waitForSurfaceTextures}=await import('/natural-materials.mjs');
 const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true,logarithmicDepthBuffer:true,alpha:false,powerPreference:'high-performance'});renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight,false);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.AgXToneMapping;renderer.toneMappingExposure=1.10;
 const scene=new THREE.Scene();scene.background=new THREE.Color(0x15191e);const camera=new THREE.PerspectiveCamera(40,innerWidth/innerHeight,.005,250),ambient=new THREE.HemisphereLight(0xcddce3,0x716454,1),sun=new THREE.DirectionalLight(0xf6f2e8,2.1);sun.position.set(-5,12,8);scene.add(ambient,sun);
 const pmrem=new THREE.PMREMGenerator(renderer),roomEnvironment=new RoomEnvironment(),environment=pmrem.fromScene(roomEnvironment,.055);scene.environment=environment.texture;scene.environmentIntensity=.6;pmrem.dispose();roomEnvironment.dispose();
 const city=await createNightCity(scene,material=>material);await waitForSurfaceTextures();city.update(.866,0);const finish=createHomeRenderFinish(renderer,scene,camera);finish.resize(innerWidth,innerHeight);const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info'),gpuName=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
 window.cityInspection={capture(position,target,light){const daylight=light==='night'?0:.866;city.update(daylight,0);sun.intensity=light==='night'?.025:2.1;ambient.intensity=light==='night'?.27:1;scene.environmentIntensity=light==='night'?.28:.6;camera.position.set(...position);camera.lookAt(new THREE.Vector3(...target));camera.updateMatrixWorld();finish.render();return{cameraPosition:camera.position.toArray(),cameraTarget:target,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,gpuName,softwareRenderer:/SwiftShader|llvmpipe|software/i.test(gpuName),pixelRatio:renderer.getPixelRatio(),city:city.stats,renderFinish:finish.mode};},dispose(){const geometries=new Set(),materials=new Set(),textures=new Set();scene.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const material of(Array.isArray(object.material)?object.material:[object.material]).filter(Boolean)){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);}});finish.dispose();for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();for(const texture of textures)texture.dispose();environment.dispose();renderer.dispose();}};window.ready=true;
 }catch(error){window.bootError=error.stack??String(error);console.error(error);}</script></body></html>`;
const types={'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.glb':'model/gltf-binary','.mp3':'audio/mpeg','.woff2':'font/woff2'};
// Reuse the model inspector, calling the actual exterior factory. Only the
// aperture discard is disabled by its local module alias; shaders keep the
// original world-height varyings and all original celestial geometry.
const outsideHtml=cityHtml
 .replace("{createNightCity}=await import('/night-city.mjs')","{createOutsideWorld}=await import('/__inspection-outside-world.mjs')")
 .replace('const city=await createNightCity(scene,material=>material);await waitForSurfaceTextures();city.update(.866,0);','const outside=await createOutsideWorld(scene);await waitForSurfaceTextures();outside.update(14,.866,0);')
 .replace('city.update(daylight,0);',"outside.update(light==='night'?22:14,daylight,0);")
 .replace('city:city.stats,renderFinish:', 'city:outside.getState().city,sky:outside.getState(),renderFinish:');
const server=http.createServer(async(req,res)=>{
 let route='';
 try{
  route=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  res.setHeader('Cache-Control','no-store');
  if(route==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  if(route==='/city-model'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(cityHtml);return;}
  if(route==='/outside-model'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(outsideHtml);return;}
  if(route==='/favicon.ico'){res.writeHead(204);res.end();return;}
  const vendor=route.startsWith('/vendor/three/'),baseRoot=vendor?path.join(projectRoot,'node_modules/three'):publicRoot;
  const file=path.resolve(baseRoot,vendor?route.slice(14):route==='/__inspection-outside-world.mjs'?'outside-world.mjs':route.slice(1)),relative=path.relative(baseRoot,file);
  if(relative.startsWith('..')||path.isAbsolute(relative)){res.writeHead(403);res.end('Outside inspection root');return;}
  const bytes=await fs.readFile(file);report.resources[route]={sha256:digest(bytes),bytes:bytes.length};
  if(!vendor&&['.mjs','.js','.json'].includes(path.extname(file)))sourceFiles.set(route,{file,sha256:digest(bytes)});
  res.setHeader('Content-Type',types[path.extname(file)]??'application/octet-stream');
  if(route==='/__inspection-outside-world.mjs'){
   const source=bytes.toString('utf8'),discard='if(t < 0.0 || t > 1.0 || opening.x < .40 || opening.x > 5.69 || opening.y < 1.10 || opening.y > 4.67) discard;';
   assert.equal(source.split(discard).length,2,'One actual physical-window discard expected');
   res.end(source.replace(discard,'// Independent model inspection: aperture discard only is disabled.'));return;
  }
  if(route==='/night-city.mjs'&&isolatedOwner){
   const source=bytes.toString('utf8'),anchor='function addPart(p){';
   assert.equal(source.split(anchor).length,2,'One authored part entry point');
   res.end(source.replace(anchor,anchor+`if(p.owner!==${JSON.stringify(isolatedOwner)})return;`).replace('data.trees.forEach','[].forEach'));return;
  }
  if(route==='/scene.mjs'){
   const source=bytes.toString('utf8'),anchor='return { update, setView, focusZone';
   assert.equal(source.split(anchor).length,2,'Scene must expose one explicit camera-only inspection anchor');
   res.end(source.replace(anchor,`return { inspectCamera(position,target){mode='manual';transition=false;controls.enabled=false;controls.minDistance=.0005;controls.maxDistance=120;controls.minPolarAngle=0;controls.maxPolarAngle=Math.PI;camera.position.set(...position);controls.target.set(...target);controls.update();}, update, setView, focusZone`));return;
  }
  res.end(bytes);
 }catch(error){report.httpErrors.push({route,message:error.message});res.writeHead(404);res.end(error.message);}
});

let browser,context,page;
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'file:///C:/Users/39215/.codex/skills/develop-web-game/node_modules/playwright/index.mjs');
 browser=await chromium.launch({headless:true,args:cli.software?['--use-gl=angle','--use-angle=swiftshader']:['--use-angle=d3d11','--ignore-gpu-blocklist','--enable-gpu']});
 context=await browser.newContext({viewport,deviceScaleFactor:1});page=await context.newPage();
 page.on('pageerror',error=>report.errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());else if(message.type()==='warning')report.consoleWarnings.push(message.text());});
 page.on('requestfailed',request=>report.requestFailures.push({url:request.url(),message:request.failure()?.errorText}));
 const origin=`http://127.0.0.1:${server.address().port}`;
 let currentFactory=null;
 const openFactory=async factory=>{
  if(currentFactory===factory)return;
  if(currentFactory)await page.evaluate(()=>{window.room?.dispose();window.cityInspection?.dispose();});
  await page.goto(origin+(factory==='city-model'?'/city-model':factory==='outside-model'?'/outside-model':'/'),{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>window.ready||window.bootError,null,{timeout:120000});
  const bootError=await page.evaluate(()=>window.bootError??null);assert.equal(bootError,null,bootError??'Scene boot');
  assert.deepEqual(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length,cookies:document.cookie})),{local:0,session:0,cookies:''},'Fresh inspection origin has no stored player state');
  currentFactory=factory;
 };
 for(const shot of selected){
  try{
   await openFactory(shot.factory??'home');
   const diagnostics=await page.evaluate(({position,target,light,actorCamera,actorOffset,factory,hour,weather,effect})=>{
    if(factory==='city-model'||factory==='outside-model')return cityInspection.capture(position,target,light);
    fixture.clock.hour=hour??(light==='night'?22:14);fixture.clock.daylight=light==='night'?0:.866;fixture.weather=weather??{cloud:0,rain:0,wind:0};
    fixture.reaction=effect==='mist'?{type:'mist'}:null;
    fixture.living.hygiene.lastToiletAt=effect==='pellet'?fixture.simSeconds:null;
    fixture.living.hygiene.lastDropPosition=effect==='pellet'?fixture.inspectionDrop:null;
    if(effect==='pellet'){
     target=[...fixture.inspectionDrop];position=target.map((value,index)=>value+[.010,.012,.014][index]);
    }
    room.update(fixture,1/60);
    if(actorCamera){const actor=room.getDiagnostics().actorPosition;target=[actor[0],actor[1]+.005,actor[2]];position=(actorOffset??[.024,.018,.033]).map((value,index)=>actor[index]+value);}
    room.inspectCamera(position,target);for(let i=0;i<16;i++)room.update(fixture,1/60);
    return room.getDiagnostics();
   },shot);
   assert.ok([...diagnostics.cameraPosition,...diagnostics.cameraTarget].every(Number.isFinite),'Finite camera and target');
   assert.ok(Number.isFinite(diagnostics.drawCalls)&&diagnostics.drawCalls>0,'Main scene rendered draws');
   assert.ok(Number.isFinite(diagnostics.triangles)&&diagnostics.triangles>0,'Main scene rendered triangles');
   const filename=path.join(output,`${shot.name}.png`),png=await page.screenshot({path:filename,animations:'disabled'});
   report.shots.push({...shot,file:filename,pngSha256:digest(png),camera:diagnostics.cameraPosition,cameraTarget:diagnostics.cameraTarget,
    drawCalls:diagnostics.drawCalls,triangles:diagnostics.triangles,gpuName:diagnostics.gpuName,softwareRenderer:diagnostics.softwareRenderer,pixelRatio:diagnostics.pixelRatio,
    water:diagnostics.water,sky:diagnostics.sky,city:diagnostics.city,renderFinish:diagnostics.renderFinish,visualReview:'Pending pixel inspection'});
   console.log(JSON.stringify({shot:shot.name,drawCalls:diagnostics.drawCalls,triangles:diagnostics.triangles,file:filename}));
  }catch(error){report.shots.push({...shot,failure:error.stack});report.errors.push(`${shot.name}: ${error.message}`);}
 }
 report.storageAfter=await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length,cookies:document.cookie}));
 assert.deepEqual(report.storageAfter,{local:0,session:0,cookies:''},'Scene inspection did not write browser storage');
 for(const [route,resource]of sourceFiles){const current=digest(await fs.readFile(resource.file));if(current!==resource.sha256)report.resourceDrift.push({route,captured:resource.sha256,current});}
 assert.equal(report.resourceDrift.length,0,'Inspection sources remained unchanged during capture');
 assert.equal(report.errors.length,0,'No uncaught scene or screenshot errors');
 assert.equal(report.consoleErrors.length,0,'No shader or console errors');
 assert.equal(report.requestFailures.length,0,'No failed resource requests');
 assert.equal(report.httpErrors.length,0,'All scene resources served');
 await page.evaluate(()=>{window.room?.dispose();window.cityInspection?.dispose();});
}catch(error){report.failure=error.stack;process.exitCode=1;}
finally{
 await context?.close();await browser?.close();
 if(server.listening)await new Promise(resolve=>server.close(resolve));
 report.completedAt=new Date().toISOString();
 await fs.writeFile(path.join(output,'refinement-inspection.json'),JSON.stringify(report,null,2),'utf8');
 console.log(JSON.stringify({output,requestedShots:selected.length,capturedShots:report.shots.filter(shot=>shot.file).length,errors:report.errors,consoleErrors:report.consoleErrors.length,failure:report.failure??null,visualAcceptance:report.visualAcceptance}));
}
