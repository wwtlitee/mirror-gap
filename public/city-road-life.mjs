import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {trafficPaths} from './city-traffic-paths.mjs';
import {createBeveledCityBox,createCityTire} from './city-model-detail.mjs';

// Original road cars, aerial sedans and sidewalk service robots share batches.
export function createRoadLife(root,clip){
 const solid=clip(new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,metalness:.32,roughness:.48}));
 const glow=clip(new THREE.MeshBasicMaterial({color:0xffffff,vertexColors:true,toneMapped:false}));
 const dummy=new THREE.Object3D();let triangles=0,drawCalls=0;
 function model(count,build,beveled=false){
  const parts=[[],[]];
  const piece=(geometry,color,x,y,z,lit=false)=>{geometry.translate(x,y,z);const g=geometry.index?geometry.toNonIndexed():geometry.clone(),c=new THREE.Color(color),colors=[];for(let i=0;i<g.attributes.position.count;i++)colors.push(c.r,c.g,c.b);g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));parts[lit?1:0].push(g);geometry.dispose();};
 const box=(color,x,y,z,w,h,d,lit=false)=>piece(beveled&&!lit&&Math.min(w,h,d)>=.07?createBeveledCityBox(w,h,d,.055):new THREE.BoxGeometry(w,h,d),color,x,y,z,lit);
  build(box,piece);
  return parts.filter(p=>p.length).map((p,i)=>{const geometry=mergeGeometries(p,false);p.forEach(g=>g.dispose());const mesh=new THREE.InstancedMesh(geometry,i?glow:solid,count);mesh.frustumCulled=false;root.add(mesh);triangles+=geometry.attributes.position.count/3*count;drawCalls++;return mesh;});
 }
 const cars=model(8,(box,piece)=>{
  box(0x7e8584,0,0,0,1.85,.55,4.2);box(0x263940,0,.55,-.18,1.62,.7,2.15);box(0x858b88,0,.94,-.25,1.68,.08,1.95);
  for(const x of [-.97,.97])for(const z of [-1.3,1.3]){
   const tire=createCityTire(.37,.24);tire.rotateZ(Math.PI/2);piece(tire,0x1d2428,x,-.26,z);
   const hub=new THREE.CylinderGeometry(.37*.45,.37*.45,.24,20);hub.rotateZ(Math.PI/2);piece(hub,0x7e8584,x,-.26,z);
  }
  // Pillars follow the original glass silhouette, with the existing body color.
  for(const x of [-.815,.815])box(0x7e8584,x,.55,-.18,.035,.7,.085);
  for(const x of [-.64,.64]){box(0xf3e3bf,x,.06,2.12,.42,.14,.035,true);box(0xb34a39,x,.08,-2.12,.35,.13,.035,true);}
  // Hood / boot reveals, rocker trim, door joints and mirrors attach to the
  // existing envelope. All eight cars keep the same two instanced draws.
  for(const z of [-1.55,1.52])box(0x8b9391,0,.287,z,1.66,.025,1.0);
  for(const z of [-2.085,2.085]){box(0x4e5b5c,0,-.10,z,1.68,.09,.04);box(0x243338,0,-.03,z,1.05,.095,.035);}
  for(const side of [-1,1]){
   box(0x394b51,side*.935,-.14,0,.025,.045,3.7);
   box(0x536368,side*.817,.24,-.15,.025,.026,2.03);
   for(const z of [-.18,.73])box(0x3b4c51,side*.936,.05,z,.016,.34,.022);
   box(0xa1aaa7,side*.95,.16,.26,.028,.035,.18);
   box(0x758481,side*.948,.44,.73,.11,.08,.19);
   for(const z of [-1.3,1.3]){
    const rim=new THREE.TorusGeometry(.147,.012,5,12);rim.rotateY(Math.PI/2);piece(rim,0xb3beb9,side*1.102,-.26,z);
    for(let spoke=0;spoke<5;spoke++){const geometry=new THREE.BoxGeometry(.016,.24,.020);geometry.rotateX(spoke*Math.PI/5);piece(geometry,0xa6b2af,side*1.108,-.26,z);}
   }
  }
 },true);
 const air=model(2,(box,piece)=>{
  box(0x475b65,0,0,0,2.05,.48,4.5);box(0x1c303a,0,.46,-.2,1.7,.65,2.3);box(0x697980,0,.81,-.2,1.76,.08,2.1);
  for(const x of [-1.02,1.02])for(const z of [-1.5,1.5]){piece(new THREE.CylinderGeometry(.43,.36,.22,20),0x303f46,x,-.27,z);box(0x739ea6,x,-.4,z,.4,.035,.4,true);}
  for(const x of [-.855,.855])box(0x475b65,x,.46,-.2,.035,.65,.085);
  for(const x of [-.64,.64])box(0xe8d8b7,x,.06,2.28,.35,.10,.03,true);
  for(const side of [-1,1]){
   box(0x8b9da0,side*.862,.19,-.2,.026,.035,2.11);
   box(0x263b45,side*1.016,-.11,0,.027,.08,4.09);
   box(0xa1b0ae,side*1.032,.16,.35,.025,.034,.22);
   box(0x758f96,side*.94,.47,.69,.12,.07,.17);
   for(const z of [-1.5,1.5]){
    const ring=new THREE.TorusGeometry(.30,.035,6,16);ring.rotateX(Math.PI/2);piece(ring,0x7d9498,side*1.02,-.38,z);
    piece(new THREE.CylinderGeometry(.14,.14,.09,12),0x243841,side*1.02,-.38,z);
   }
  }
  for(const z of [-2.21,2.21])box(0x334b56,0,-.065,z,1.55,.12,.06);
 },true);
 const walkers=model(6,(box,piece)=>{
  box(0x8c887b,0,1.12,0,.6,.65,.38);box(0x515d61,0,1.69,0,.5,.39,.4);box(0xa6beb9,0,1.7,.21,.27,.06,.02,true);
  for(const side of [-1,1])box(0x596466,side*.39,1.04,0,.13,.6,.15);
  box(0x897e62,.4,.74,.15,.22,.26,.3);
  box(0x263a41,0,1.7,.206,.32,.105,.018);
  box(0xa6beb9,0,1.7,.219,.26,.05,.016,true);
  box(0x59696b,0,1.13,.196,.37,.38,.024);
  for(const side of [-1,1]){
   piece(new THREE.SphereGeometry(.115,12,8),0x78868a,side*.33,1.30,0);
   piece(new THREE.SphereGeometry(.075,12,8),0x394c53,side*.39,.79,0);
   box(0x71807e,side*.18,.11,.035,.20,.15,.25);
  }
  for(const y of [.96,1.08,1.20])box(0x293c43,0,y,.212,.23,.017,.010);
  box(0x53656b,.41,.84,.307,.13,.06,.025);
 },true);
 const rovers=model(6,(box,piece)=>{
  box(0x9b9483,0,.53,0,.9,.65,1.15);box(0x44565a,0,.88,0,.74,.08,.96);box(0xb4c5b7,0,.6,.59,.42,.06,.02,true);
  for(const x of [-.48,.48])for(const z of [-.37,.37]){const g=createCityTire(.22,.15);g.rotateZ(Math.PI/2);piece(g,0x253036,x,.23,z);const hub=new THREE.CylinderGeometry(.22*.45,.22*.45,.15,20);hub.rotateZ(Math.PI/2);piece(hub,0x9b9483,x,.23,z);}
  box(0x707b72,0,.77,0,.77,.024,.93);
  for(const side of [-1,1]){box(0x4b6063,side*.457,.57,0,.016,.37,.73);for(const z of [-.26,.08,.30])box(0x283c40,side*.47,.57,z,.015,.28,.014);}
  box(0x364e51,0,.61,.592,.50,.15,.025);box(0xb4c5b7,0,.61,.609,.40,.055,.013,true);
  for(const z of [-.57,.57])box(0x647875,0,.30,z,.79,.08,.025);
 },true);
 const legGeometry=createBeveledCityBox(.16,.72,.18,.028),legs=new THREE.InstancedMesh(legGeometry,clip(new THREE.MeshStandardMaterial({color:0x465257,metalness:.3,roughness:.7})),12);root.add(legs);drawCalls++;triangles+=(legGeometry.index?.count??legGeometry.attributes.position.count)/3*12;
 let state={};
 function place(meshes,index,position,heading){dummy.position.fromArray(position);dummy.rotation.set(0,heading,0);dummy.scale.setScalar(1);dummy.updateMatrix();for(const mesh of meshes)mesh.setMatrixAt(index,dummy.matrix);}
 function update(time){const paths=trafficPaths(time);
  paths.cars.forEach((p,i)=>place(cars,i,p.position,p.heading));paths.hover.forEach((p,i)=>place(air,i,p.position,p.heading));
  paths.robots.forEach((p,i)=>{const index=Math.floor(i/2);place(i%2?rovers:walkers,index,p.position,p.heading);if(i%2===0){for(const side of [-1,1]){dummy.position.set(p.position[0]+side*.18,p.position[1]+.40,p.position[2]+Math.sin(p.phase)*side*.11);dummy.rotation.set(Math.sin(p.phase)*side*.28,p.heading,0);dummy.updateMatrix();legs.setMatrixAt(index*2+(side===1?1:0),dummy.matrix);}}});
  [...cars,...air,...walkers,...rovers,legs].forEach(m=>m.instanceMatrix.needsUpdate=true);
  state={groundCars:8,hoverCars:2,robots:12,carPositions:paths.cars.map(p=>p.position),hoverPositions:paths.hover.map(p=>p.position),robotPositions:paths.robots.map(p=>p.position)};
 }
 update(0);return {update,state:()=>state,triangles,drawCalls};
}
