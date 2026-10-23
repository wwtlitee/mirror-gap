import {createStreetShops} from './city-shops.mjs';
import {createRoadLife} from './city-road-life.mjs';
import {createCityBillboards} from './city-billboards.mjs';
import {addStreetInteriors} from './city-interiors.mjs';
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createCityMaterials} from './night-city-materials.mjs';
import {createBeveledCityBox,createStreetPartGeometry,createStreetDetailParts} from './city-model-detail.mjs';
import {createDetailedStreetTree} from './city-natural-detail.mjs';

// Authored architecture, curated into a quieter avenue with one campaign per tower.
export async function createNightCity(parent,clip){
 const response=await fetch('/assets/night-city.json');if(!response.ok)throw Error('Night City street unavailable');
 const data=await response.json(),root=new THREE.Group();root.name='GameHub_Night_City_Opening_Street';parent.add(root);
 const scale=data.view.scale;root.rotation.y=Math.PI/2;root.scale.setScalar(scale);
 root.position.set(3-data.view.sourceWindow[2]*scale,data.view.groundY,-4.4+data.view.sourceWindow[0]*scale);
 const M=createCityMaterials(THREE),batches=new Map(),dummy=new THREE.Object3D(),up=new THREE.Vector3(0,1,0);
 const used=new Set(),nightMaterials=[],neonMaterials=[];let triangles=0,drawCalls=0,beveledBuildings=0,beveledParts=0;
 const materialFor=key=>/^facade\d$/.test(key)?M.facade[Number(key.slice(-1))]:M[key];
 function addGeometry(geometry,material){if(!material?.isMaterial)throw Error('Unknown street material');if(!batches.has(material))batches.set(material,[]);const unindexed=geometry.index?geometry.toNonIndexed():geometry.clone();batches.get(material).push(unindexed);geometry.dispose();}
 function addPart(p){
  const g=createStreetPartGeometry(p);if(g.type==='RoundedBoxGeometry'){beveledParts++;if(p.owner&&/^facade\d$/.test(p.material))beveledBuildings++;}
  dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(p.rx??0,p.ry??0,p.rz??0);dummy.scale.set(p.w,p.h,p.d);
  if(p.kind==='ring'){dummy.rotation.set(0,0,0);dummy.scale.setScalar(p.w);}
  if(p.kind==='beam')dummy.quaternion.setFromUnitVectors(up,new THREE.Vector3(...p.b).sub(new THREE.Vector3(...p.a)).normalize());
  dummy.updateMatrix();g.applyMatrix4(dummy.matrix);addGeometry(g,materialFor(p.material));
 }
 data.parts.forEach(addPart);
 const modeledRooms=addStreetInteriors(data,addPart);
 const shops=createStreetShops(root,clip,addPart);triangles+=shops.triangles;drawCalls+=shops.drawCalls;
 const detailParts=createStreetDetailParts(data);detailParts.forEach(addPart);
 // The rail hugs the opposite pavement below the apartment, leaving the view open.
 for(const z of [-260,-190,-120,-50,20,90,160])addPart({kind:'box',material:'metal',x:36,y:9,z,w:1.1,h:18,d:1.1});
 addPart({kind:'box',material:'metal',x:36,y:18,z:-50,w:4.8,h:.8,d:600});
 for(const x of [34.5,37.5])addPart({kind:'box',material:'cyan',x,y:18.6,z:-50,w:.12,h:.12,d:600});
 for(const sign of data.signs)if(sign.frame!==false)addPart({kind:'box',material:'metal',x:sign.x,y:sign.y,z:sign.z,w:sign.w+.3,h:sign.h+.3,d:.2,ry:sign.ry??0});
 const box=(material,x,y,z,w,h,d)=>addPart({kind:'box',material,x,y,z,w,h,d});
 const road=data.road,length=road.to-road.from,center=(road.to+road.from)/2;
 box('stone',0,-.3,center,360,1,length+40);box('asphalt',0,1.15,center,64,.08,length);
 for(const side of [-1,1]){box('concrete',side*34.1,1.25,center,4.2,.14,length);box('pale',side*32.1,1.34,center,.2,.08,length);box('paint',side*30.5,1.21,center,.15,.03,length);}
 for(let z=road.from+4;z<road.to;z+=10){box('paint',0,1.21,z,.22,.025,4);for(const x of [-10,10])box('paint',x,1.21,z,.15,.025,3);}
 // Original gateway junction: preserve its perpendicular connection and crossings.
 box('asphalt',74,1.17,-180,148,.08,20);
 for(let z=-187;z<=-173;z+=2)box('paint',15,1.225,z,8,.02,.8);
 // Original tree positions and plum palette remain; continuous bark, branches
 // and overlapping organic crown lobes now form each entire tree.
 data.trees.forEach((tree,index)=>{const detail=createDetailedStreetTree(tree,index);addGeometry(detail.bark,M.bark??M.bronze);addGeometry(detail.foliage,M.foliage??M.plum);});
 for(const [material,parts]of batches){
  const g=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());const mesh=new THREE.Mesh(g,clip(material));mesh.name='Street / '+(material.name||material.type);mesh.receiveShadow=true;root.add(mesh);used.add(material);triangles+=g.attributes.position.count/3;drawCalls++;
  if(material.isMeshStandardMaterial){nightMaterials.push({material,base:material.color.clone(),emission:material.emissiveIntensity});}
  else neonMaterials.push({material,base:material.color.clone()});
 }
 // Dispose generated but unused material/texture variants.
 const all=new Set([...Object.values(M).filter(v=>v?.isMaterial),...M.facade]);const liveTextures=new Set([...used].flatMap(m=>[m.map,m.emissiveMap].filter(Boolean)));
 for(const m of all)if(!used.has(m)){for(const t of [m.map,m.emissiveMap])if(t&&!liveTextures.has(t))t.dispose();m.dispose();}
 const signs=data.signs,billboards=await createCityBillboards(root,clip,signs);triangles+=billboards.triangles;drawCalls+=billboards.drawCalls;
 // Local pools under authored light sources give neon a presence on the pavement,
 // without adding hundreds of real-time lights or a second scene render.
 const glowCanvas=document.createElement('canvas');glowCanvas.width=glowCanvas.height=64;const ctx=glowCanvas.getContext('2d'),gradient=ctx.createRadialGradient(32,32,0,32,32,32);gradient.addColorStop(0,'rgba(255,255,255,.7)');gradient.addColorStop(.4,'rgba(255,255,255,.22)');gradient.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
 const glowMap=new THREE.CanvasTexture(glowCanvas),glowMaterial=clip(new THREE.MeshBasicMaterial({map:glowMap,transparent:true,depthWrite:false,vertexColors:true,blending:THREE.AdditiveBlending,toneMapped:false})),glowGeometries=[];
 for(const light of data.lights.filter(l=>l.y<35)){
  const size=Math.min(22,light.range??20),g=new THREE.PlaneGeometry(size,size),c=new THREE.Color(0xf0d7b1),colors=[];for(let i=0;i<4;i++)colors.push(c.r,c.g,c.b);g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.rotateX(-Math.PI/2);g.translate(light.x,1.4,light.z);glowGeometries.push(g.toNonIndexed());g.dispose();
 }
 if(glowGeometries.length){const g=mergeGeometries(glowGeometries,false);glowGeometries.forEach(p=>p.dispose());root.add(new THREE.Mesh(g,glowMaterial));triangles+=g.attributes.position.count/3;drawCalls++;}
 const traffic=createTraffic(root,clip,data.transit),roadLife=createRoadLife(root,clip);drawCalls+=traffic.drawCalls+roadLife.drawCalls;triangles+=traffic.triangles+roadLife.triangles;
 let currentTime=0;const stats={source:data.source,buildings:data.buildings.length,streetRows:data.visibility?.streetRows??2,roadWidth:data.road.width,signs:signs.length,posters:signs.filter(s=>s.index!==undefined).length,triangles,drawCalls,windowSource:data.view.sourceWindow,originalCoordinates:false,curated:true,modeledRooms,shops:shops.count,modelDetail:{beveledBuildings,beveledParts,parts:detailParts.length,roles:[...new Set(detailParts.map(p=>p.detailRole))],trees:data.trees.length,treeParts:'tapered-bark-six-branches-eleven-irregular-crown-lobes',detailedOwners:[...new Set(detailParts.map(p=>p.owner).filter(Boolean))],shopInteriors:shops.modeledInteriors}};
 return {stats,update(daylight,dt=0){
  currentTime+=Math.max(0,Math.min(dt,.1));
  for(const {material,base,emission}of nightMaterials){material.color.copy(base).multiplyScalar(.65+.35*daylight);if(material.emissiveMap)material.emissiveIntensity=emission*(.5+(1-daylight)*2.8);}
  for(const {material,base}of neonMaterials)material.color.copy(base).multiplyScalar(.85+(1-daylight)*.35);
  shops.update(daylight);billboards.update(currentTime,daylight);stats.billboards=billboards.state();glowMaterial.opacity=.12+(1-daylight)*.58;traffic.update(currentTime);roadLife.update(currentTime);stats.traffic={...traffic.state(),...roadLife.state()};
 }};
}

function createTraffic(root,clip,path){
 const body=clip(new THREE.MeshStandardMaterial({color:0x829aa5,metalness:.57,roughness:.32})),glass=clip(new THREE.MeshStandardMaterial({color:0x18303b,metalness:.6,roughness:.3})),light=clip(new THREE.MeshBasicMaterial({color:0x7bdded,toneMapped:false}));
 const carParts=[[],[],[]];const add=(g,index,x=0,y=0,z=0)=>{g.translate(x,y,z);carParts[index].push(g.index?g.toNonIndexed():g.clone());g.dispose();};
 // One continuous shell preserves the original envelope without overlapping
 // cylinder end-caps and full spheres flickering through each other.
 const tube=new THREE.CapsuleGeometry(1.45,9,10,32);tube.rotateX(Math.PI/2);tube.scale(1.3,1,1);add(tube,0);
 add(createBeveledCityBox(3.77,.85,7,.10),1,0,.42,0);add(new THREE.BoxGeometry(3.78,.12,6.7),2,0,-.44,0);
 for(const z of [-2.25,0,2.25])add(new THREE.BoxGeometry(3.79,.90,.10),0,0,.42,z);
 for(const side of [-1,1])add(new THREE.SphereGeometry(.18,12,8),2,side*.9,-.2,5.65);
 // The same carriages gain attached seals, door reveals and underbody ribs.
 // Three original instanced material batches still draw both carriages.
 for(const side of [-1,1]){
  for(const z of [-3.35,-1.15,1.15,3.35])add(createBeveledCityBox(.055,.56,.68,.012),0,side*1.875,.43,z);
  for(const y of [.05,.82])add(new THREE.BoxGeometry(.045,.035,6.68),0,side*1.9,y,0);
  for(const z of [-2.25,2.25])add(new THREE.BoxGeometry(.025,.57,.025),0,side*1.91,.42,z+.13);
  add(createBeveledCityBox(.07,.05,.28,.015),0,side*1.94,.30,2.34);
 }
 for(const z of [-3,-1,1,3])add(createBeveledCityBox(2.4,.10,.25,.02),0,0,-1.33,z);
 const meshes=carParts.map((parts,i)=>{const g=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());const m=new THREE.InstancedMesh(g,[body,glass,light][i],2);m.frustumCulled=false;root.add(m);return m;});
 // Rail carriages stay on the rail; aerial sedans are a separate model and lane.
 const dummy=new THREE.Object3D(),segments=[];let total=0;
 const visiblePath=path;for(let i=1;i<visiblePath.length;i++){const a=visiblePath[i-1],b=visiblePath[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);segments.push({a,b,length,start:total});total+=length;}
 const positions=[];
 function railAt(distance){distance=((distance%total)+total)%total;const s=segments.find(s=>distance<s.start+s.length)??segments.at(-1),t=(distance-s.start)/s.length;return{x:s.a[0]+(s.b[0]-s.a[0])*t,z:s.a[1]+(s.b[1]-s.a[1])*t,heading:Math.atan2(s.b[0]-s.a[0],s.b[1]-s.a[1])};}
 return {drawCalls:3,triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3*2,0),update(time){positions.length=0;
  for(let i=0;i<2;i++){
   if(i<2){const p=railAt(time*10+100+(i===0?-7:7));dummy.position.set(p.x,20.2,p.z);dummy.rotation.set(0,p.heading,0);dummy.scale.setScalar(1);}

   dummy.updateMatrix();for(const mesh of meshes)mesh.setMatrixAt(i,dummy.matrix);positions.push(dummy.position.toArray());
  }meshes.forEach(m=>m.instanceMatrix.needsUpdate=true);
 },state:()=>({railCarriages:2,positions:positions.map(p=>[...p])})};
}

