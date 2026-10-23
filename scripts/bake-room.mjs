import http from 'node:http';import path from 'node:path';import fs from 'node:fs/promises';import{fileURLToPath}from 'node:url';import{createHash}from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),publicRoot=path.join(root,'public');
await import('./bake-food.mjs');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const types={'.mjs':'text/javascript','.js':'text/javascript','.glb':'model/gltf-binary','.json':'application/json'};
const server=http.createServer(async(req,res)=>{try{
 const route=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(route==='/'){res.setHeader('Content-Type','text/html');res.end(`<style>canvas{width:800px;height:600px}</style><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/"}}</script><canvas></canvas><script type="module">import{createHomeScene}from '/scene.mjs';window.room=await createHomeScene(document.querySelector('canvas'));window.ready=true;</script>`);return;}
 // Static construction does not need the previous physics bake. This permits a
 // fresh build even when no collision binary exists yet.
 if(route==='/collision-world.mjs'){res.setHeader('Content-Type','text/javascript');res.end('export const collisionInfo={};export const resolveMeshContact=()=>null,meshClearance=()=>null,segmentOccluded=()=>false,surfaceBelow=()=>null,supportedFeet=()=>0;');return;}
 const vendor=route.startsWith('/vendor/three/'),base=vendor?path.join(root,'node_modules/three'):publicRoot,file=path.resolve(base,vendor?route.slice(14):route.slice(1));
 if(!file.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}
 const bytes=await fs.readFile(file);res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(bytes);
 }catch(e){res.writeHead(404);res.end(e.message);}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--ignore-gpu-blocklist','--enable-gpu']});const page=await browser.newPage();page.on('pageerror',e=>console.error(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.ready);
 const bake=await page.evaluate(()=>room.getCollisionGeometry()),packed=new Float32Array(bake.faces.length);
 for(let i=0;i<packed.length;i++){const n=bake.faces[i];if(!Number.isFinite(n)||Math.abs(n)>32768)throw Error('Collision coordinate out of range');packed[i]=n;}
 // Quantization can collapse tiny imported triangles; remove them before physics.
 const clean=[];for(let i=0;i<packed.length;i+=10){const ax=packed[i+3]-packed[i],ay=packed[i+4]-packed[i+1],az=packed[i+5]-packed[i+2],bx=packed[i+6]-packed[i],by=packed[i+7]-packed[i+1],bz=packed[i+8]-packed[i+2];if((ay*bz-az*by)**2+(az*bx-ax*bz)**2+(ax*by-ay*bx)**2>0)clean.push(...packed.subarray(i,i+10));}
 const validPacked=new Float32Array(clean);
 const files=['food-model-detail.mjs','interior-refinement.mjs','toilet-model-detail.mjs','city-natural-detail.mjs','home-render-finish.mjs','render-quality.mjs','mesh-batching.mjs','natural-materials.mjs','room-model-detail.mjs','habitat-model-detail.mjs','camera-clipping.mjs','software-batching.mjs','city-model-detail.mjs','food-portions.mjs','food-stock.mjs','scene.mjs','room-assets.mjs','open-habitat.mjs','habitat-renovation.mjs','habitat-layout.mjs','habitat-ground.mjs','interior-details.mjs','collision-export.mjs','resource-spec.mjs','water-surfaces.mjs','outside-world.mjs','night-city.mjs','night-city-materials.mjs','city-billboards.mjs','billboard-cycle.mjs','city-interiors.mjs','city-shops.mjs','city-road-life.mjs','city-traffic-paths.mjs','assets/night-city.json','toilet-contact.mjs','assets/resource-surfaces.json'];
 for(const folder of ['assets/kenney-nature','assets/kenney-home']){try{for(const f of await fs.readdir(path.join(publicRoot,folder)))if(f.endsWith('.glb'))files.push(folder+'/'+f);}catch(e){if(e.code!=='ENOENT')throw e;}}
 files.push('resource-data.mjs','resource-contact.mjs','collision-world.mjs');
 for(const file of await fs.readdir(path.join(publicRoot,'assets/resource-surfaces')))if(file.endsWith('.json'))files.push('assets/resource-surfaces/'+file);
 const sources={};for(const file of files)sources[file]=createHash('sha256').update(await fs.readFile(path.join(publicRoot,file))).digest('hex');
 const packageInfo=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
 const version=packageInfo.productVersion??packageInfo.version;
 await fs.writeFile(path.join(publicRoot,'assets/room-collision.bin.tmp'),Buffer.from(validPacked.buffer));await fs.rename(path.join(publicRoot,'assets/room-collision.bin.tmp'),path.join(publicRoot,'assets/room-collision.bin'));
 await fs.writeFile(path.join(publicRoot,'assets/room-collision.json'),JSON.stringify({format:'float32-v1',version,scale:1,precision:.000001,triangles:validPacked.length/10,sources,objects:bake.objects},null,2));
 console.log(JSON.stringify({version,triangles:validPacked.length/10,bytes:validPacked.byteLength,objects:bake.objects.length}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
