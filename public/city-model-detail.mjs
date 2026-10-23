import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {SHOPS} from './city-shops.mjs';

// All dimensions stay in the authored city coordinates. Detail joins the existing
// material batches; it does not move buildings, replace artwork or add lights.
export function createBeveledCityBox(width,height,depth,radius=.08){
 if(![width,height,depth].every(n=>Number.isFinite(n)&&n>0))throw new RangeError('City box dimensions must be positive');
 const bevel=Math.min(Math.max(0,Number.isFinite(radius)?radius:0),Math.min(width,height,depth)*.2);
 return bevel>0?new RoundedBoxGeometry(width,height,depth,2,bevel):new THREE.BoxGeometry(width,height,depth);
}

export function createCityTire(radius,width){
 if(![radius,width].every(n=>Number.isFinite(n)&&n>0))throw new RangeError('City tire dimensions must be positive');
 // A closed annular section gives the original wheel a rounded shoulder. A
 // separate hub fills its center without extending the original wheel bounds.
 const profile=[[.45,-.5],[.72,-.5],[.92,-.45],[1,-.3],[1,.3],[.92,.45],[.72,.5],[.45,.5],[.45,-.5]];
 return new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r*radius,y*width)),20);
}

// Return unit geometry for the original addPart transform, with a world-sized
// bevel. Normalizing first keeps the original building bounds and rotations.
export function createStreetPartGeometry(part){
 if(part.kind==='curtain'){
  const geometry=new THREE.BoxGeometry(1,1,1,1,1,40),p=geometry.attributes.position;
  for(let i=0;i<p.count;i++)p.setX(i,p.getX(i)*.28+Math.sin((p.getZ(i)+.5)*Math.PI*10)*.35);
  geometry.computeVertexNormals();return geometry;
 }
 if(part.kind==='cylinder')return new THREE.CylinderGeometry((part.top??1)*.5,.5,1,Math.min(32,Math.max(24,part.sides??12)));
 if(part.kind==='ring'){
  const geometry=new THREE.TorusGeometry(.5,part.thickness/part.w,6,36);
  geometry.rotateX(Math.PI/2);return geometry;
 }
 if(part.kind==='sphere')return new THREE.SphereGeometry(.5,16,10);
 if(part.kind==='crown')return new THREE.IcosahedronGeometry(.5,0);
 if(part.kind==='box'&&part.owner&&Math.min(part.w,part.h,part.d)>=.3&&part.h>=.3&&part.d>=1){
  const geometry=createBeveledCityBox(part.w,part.h,part.d,/^facade\d$/.test(part.material)?.28:.065);
  geometry.scale(1/part.w,1/part.h,1/part.d);return geometry;
 }
 return new THREE.BoxGeometry(1,1,1);
}

export function createStreetDetailParts(data){
 const parts=[];
 const box=(detailRole,material,x,y,z,w,h,d,owner)=>parts.push({kind:'box',detailRole,material,x,y,z,w,h,d,...(owner?{owner}:{})});
 // Fit the exact recessed rooms produced by city-interiors, including their
 // existing glazing and central mullion. Raised perimeter frames catch light.
 for(const building of data.buildings.filter(b=>b.id.startsWith('avenue-'))){
  const height=building.use==='residential'?188:144;
  for(let floor=0;floor<Math.floor((height-16)/5);floor++)for(const side of [-1,1]){
   const y=15+floor*5,z=building.z+side*21;
   for(const dy of [.04,4.04])box('recessed-window-frame','metal',41.90,y+dy,z,.20,.16,7.58,building.id);
   for(const dz of [-3.75,3.75])box('recessed-window-frame','metal',41.90,y+2.04,z+dz,.20,3.84,.16,building.id);
   box('projecting-window-sill','concrete',41.75,y-.03,z,.52,.17,7.72,building.id);
  }
 }
 // Model the borders and handles already painted into the original storefront
 // atlas. Keep the signs and interior artwork unobstructed and in the same place.
 for(const shop of SHOPS){
  const zAt=pixel=>shop.z+(pixel/512-.5)*shop.width;
  const yAt=pixel=>6.15+4.5-pixel/512*9;
  for(const pixel of [18,405,490])box('shop-glass-mullion','metal',38.82,(yAt(183)+yAt(488))/2,zAt(pixel),.20,yAt(183)-yAt(488),.16,shop.name);
  for(const pixel of [183,488])box('shop-glass-frame','metal',38.82,yAt(pixel),shop.z,.20,.12,shop.width*.93,shop.name);
  for(const pixel of [427,468])box('shop-door-frame','metal',38.79,(yAt(229)+yAt(441))/2,zAt(pixel),.22,yAt(229)-yAt(441),.12,shop.name);
  box('shop-door-frame','metal',38.79,yAt(229),(zAt(427)+zAt(468))/2,.22,.12,zAt(468)-zAt(427),shop.name);
  box('shop-door-handle','bronze',38.66,yAt(356),zAt(434),.23,.36,.08,shop.name);
 }
 // The original cyan rail remains on the original seven posts. Connection
 // collars and bearing blocks make the support read as joined construction.
 for(const z of [-260,-190,-120,-50,20,90,160]){
  box('rail-post-foot','metal',36,1.42,z,1.72,.34,1.72);
  box('rail-post-bearing','metal',36,17.43,z,2.3,.38,2.3);
  box('rail-beam-joint','bronze',36,18,z,4.86,.84,.28);
 }
 // Shallow seams on the existing pavement, away from the original lane marks.
 for(const side of [-1,1])for(let z=data.road.from+8;z<data.road.to;z+=12){
  box('pavement-joint','metal',side*34.1,1.324,z,4.12,.015,.035);
 }
 // Facade joints follow each authored body, including the nine distant towers.
 // They sit behind campaign planes and do not cover the existing window art.
 for(const body of data.parts.filter(p=>p.kind==='box'&&p.owner&&/^facade\d$/.test(p.material)&&Math.min(p.w,p.h,p.d)>=8)){
  const front=body.x-body.w/2,low=body.y-body.h/2,top=body.y+body.h/2;
  const far=body.owner.startsWith('skyline-'),spacing=far?12:5;
  for(let y=low+spacing;y<top-.3;y+=spacing)box('facade-floor-joint','metal',front-.065,y,body.z,.14,.085,body.d-.3,body.owner);
  for(let z=body.z-body.d/2+4;z<body.z+body.d/2-1;z+=far?8:5.2)box('facade-window-mullion','metal',front-.075,body.y,z,.16,body.h-.3,.085,body.owner);
  for(const side of [-1,1])box('facade-corner-reveal','charcoal',front-.08,body.y,body.z+side*(body.d/2-.17),.18,body.h-.2,.20,body.owner);
  box('roof-edge-coping','metal',body.x,top+.045,body.z,body.w+.2,.09,body.d+.2,body.owner);
  for(const side of [-1,1])box('roof-parapet-cap','pale',body.x,top+.10,body.z+side*(body.d/2-.09),body.w,.11,.20,body.owner);
 }
 // The existing theatre drums get thin metallic expansion joints between their
 // authored illuminated terraces, rather than another layer of neon rings.
 for(const drum of data.parts.filter(p=>p.kind==='cylinder'&&/^facade\d$/.test(p.material))){
  for(let y=drum.y-drum.h/2+7;y<drum.y+drum.h/2;y+=7)parts.push({kind:'ring',detailRole:'theatre-drum-joint',material:'metal',owner:drum.owner,x:drum.x,y,z:drum.z,w:drum.w+.04,h:.08,d:drum.d+.04,thickness:.065});
  for(let i=0;i<16;i++){const angle=i*Math.PI/8;box('theatre-vertical-reveal','bronze',drum.x+Math.cos(angle)*(drum.w/2+.018),drum.y,drum.z+Math.sin(angle)*(drum.d/2+.018),.09,drum.h-.2,.09,drum.owner);}
 }
 // Existing glazing now reads as assembled panes with seals and sill depth.
 for(const pane of data.parts.filter(p=>['glass','lobbyGlass','retailGlass'].includes(p.material)&&p.kind==='box'&&p.w<1&&p.d>5)){
  const side=pane.x<(data.buildings.find(b=>b.id===pane.owner)?.x??pane.x)?-1:1;
  for(let z=pane.z-pane.d/2+5;z<pane.z+pane.d/2;z+=6)box('lobby-glazing-seal','metal',pane.x+side*.025,pane.y,z,.08,pane.h,.045,pane.owner);
  box('lobby-window-sill','stone',pane.x+side*.17,pane.y-pane.h/2+.04,pane.z,.42,.12,pane.d,pane.owner);
 }
 for(const sign of data.signs){
  const facing=sign.ry??0,normalX=Math.sin(facing),normalZ=Math.cos(facing),alongX=Math.cos(facing),alongZ=-Math.sin(facing);
  for(const side of [-1,1]){const part={kind:'box',detailRole:'campaign-frame-edge',material:'metal',owner:sign.owner,x:sign.x+normalX*.04+alongX*side*(sign.w/2+.10),y:sign.y,z:sign.z+normalZ*.04+alongZ*side*(sign.w/2+.10),w:.16,h:sign.h+.25,d:.25,ry:facing};parts.push(part);}
  for(const side of [-1,1])parts.push({kind:'box',detailRole:'campaign-frame-ledge',material:'bronze',owner:sign.owner,x:sign.x+normalX*.045,y:sign.y+side*(sign.h/2+.08),z:sign.z+normalZ*.045,w:sign.w+.28,h:.14,d:.27,ry:facing});
 }
 for(const z of [-260,-190,-120,-50,20,90,160]){
  for(const side of [-1,1]){const a=[36,15.8,z],b=[36+side*1.6,17.56,z],h=Math.hypot(b[0]-a[0],b[1]-a[1]);parts.push({kind:'beam',detailRole:'rail-support-gusset',material:'metal',x:(a[0]+b[0])/2,y:(a[1]+b[1])/2,z,w:.22,h,d:.22,a,b});}
  for(const side of [-1,1])for(const offset of [-.52,.52])parts.push({kind:'sphere',detailRole:'rail-bearing-bolt',material:'bronze',x:36+side*1.17,y:17.44,z:z+offset,w:.13,h:.13,d:.13});
 }
 for(const side of [-1,1]){
  for(let z=data.road.from+3;z<data.road.to;z+=6)box('curb-block-joint','stone',side*32.1,1.367,z,.22,.025,.065);
  box('pavement-longitudinal-joint','metal',side*34.1,1.324,(data.road.from+data.road.to)/2,.025,.015,data.road.to-data.road.from);
 }
 return parts;
}
