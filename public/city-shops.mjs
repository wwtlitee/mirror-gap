import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Each address has one authored identity, rather than a repeated storefront tile.
export const SHOPS=[
 ['SOL','夜航食堂','NOODLE / 24', '#ffa965','food',-220,30],
 ['AEON','星环通信','CONNECT / REPAIR','#75d7ed','tech',-180,32],
 ['NOX','云上书店','BOOKS / COFFEE','#bd9de0','books',-142,27],
 ['IGNIS','赤道剧场','NIGHT / LIVE','#ee7279','theatre',-105,36],
 ['VERA','光合诊所','NEXT LIFE','#80d7c0','clinic',-62,29],
 ['LUNE','月庭料理','LATE DINING','#e9a4bf','food',-22,33],
 ['ORBIT','轨道唱片','VINYL / SOUND','#f2c573','records',20,30],
 ['KITE','风筝工坊','ROBOT SERVICE','#93bdda','repair',62,32],
 ['MOSS','苔原花店','FLOWERS / DAILY','#a7c28b','flowers',-171,35],
 ['PULSE','脉冲街机','PLAY / ALL NIGHT','#bd9fee','arcade',-105,36],
 ['FRAME','方寸相馆','FILM / PRINT','#e8b788','photo',-40,28],
 ['DAWN','破晓便利','OPEN / 24 HOURS','#82cbd5','market',25,38],
].map(([name,label,sub,color,use,z,width],i)=>({name,label,sub,color,use,z,width,side:i<8?1:-1})).filter(shop=>shop.side===1);

// Only the furniture already pictured in the authored shop art becomes solid:
// shelves / devices / stage frame / counter and seats, with no new storefronts.
export function createShopInteriorParts(shop,index){
 const parts=[],z=shop.z,width=shop.width,owner=shop.name;
 const box=(role,material,x,y,pz,w,h,d)=>parts.push({kind:'box',detailRole:role,material,x,y,z:pz,w,h,d,owner});
 if(['books','records','repair'].includes(shop.use)){
  for(let row=0;row<3;row++){
   const y=3.1+row*1.02;box('shop-shelf','roomFloor',41.10,y,z-.5,1.1,.13,width*.64);
   for(let col=0;col<13;col++){
    const pz=z-width*.29+col*width*.045;
    box('shop-shelf-stock',['roomFurniture','roomCurtain','pale','bronze'][(col+row+index)%4],40.86,y+.40,pz,.56,.62+(col%3)*.06,width*.027);
    box('shop-stock-spine','pale',40.568,y+.48,pz,.014,.028,width*.023);
   }
  }
 }else if(shop.use==='tech'){
  for(let i=0;i<4;i++){
   const pz=z+width*(-.31+i*.16);box('shop-device-cabinet','roomFurniture',40.91,4.34,pz,1.25,3.04,width*.12);
   box('shop-device-screen','roomScreen',40.27,5.16,pz,.03,1.18,width*.095);
   box('shop-device-console','metal',40.03,3.87,pz,.50,.18,width*.12);
   for(let key=0;key<4;key++)box('shop-console-button','pale',39.83,3.98,pz+(key-1.5)*.13,.065,.03,.065);
  }
 }else if(shop.use==='theatre'){
  box('shop-stage-plinth','roomDark',41.60,3.19,z,.65,.12,width*.60);
  for(const offset of [-1,1]){box('shop-stage-frame','bronze',41.39,4.94,z+offset*width*.29,.20,3.35,.18);box('shop-stage-frame','bronze',41.39,4.94+offset*1.63,z,.20,.12,width*.60);}
 }else{
  const seatMaterial=shop.use==='clinic'?'roomOffice':'roomCurtain';
  box('shop-counter','roomFloor',40.91,3.32,z-width*.055,1.45,.58,width*.62);
  box('shop-counter-top','bronze',40.91,3.65,z-width*.055,1.58,.10,width*.64);
  for(let i=0;i<4;i++){
   const pz=z+width*(-.31+i*.145);
   box('shop-seat','roomFurniture',39.54,2.64,pz,.64,.17,width*.055);
   box('shop-seat-cushion',seatMaterial,39.54,2.74,pz,.60,.07,width*.05);
   for(const dx of [-.20,.20])box('shop-seat-leg','metal',39.54+dx,2.26,pz,.075,.63,.075);
   parts.push({kind:'cylinder',detailRole:'shop-counter-serving',material:seatMaterial,x:40.60,y:3.94,z:pz,w:.27,h:.47,d:.27,owner});
  }
 }
 return parts;
}

export function createStreetShops(root,clip,add){
 const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=1024;const ctx=canvas.getContext('2d'),panels=[];
 const box=(m,x,y,z,w,h,d,extra={})=>add({kind:'box',material:m,x,y,z,w,h,d,...extra});
 SHOPS.forEach((s,i)=>{
  const ox=i%4*512,oy=Math.floor(i/4)*512;ctx.save();ctx.translate(ox,oy);
  ctx.fillStyle='#111d24';ctx.fillRect(0,0,512,512);
  // A different sign composition per address: vertical mast, marquee or split logo.
  ctx.fillStyle=s.color;ctx.shadowColor=s.color;ctx.shadowBlur=8;ctx.lineWidth=3;ctx.strokeStyle=s.color;
  if(i%3===0){ctx.strokeRect(14,14,484,124);ctx.font='bold 42px sans-serif';ctx.fillText(s.name,105,64);ctx.font='25px Microsoft YaHei,sans-serif';ctx.fillText(s.label,105,108);}
  else if(i%3===1){ctx.fillRect(14,14,86,174);ctx.fillStyle='#142129';ctx.font='bold 40px sans-serif';ctx.fillText(s.name.slice(0,1),40,75);ctx.fillStyle=s.color;ctx.font='bold 45px sans-serif';ctx.fillText(s.name,120,70);ctx.font='25px Microsoft YaHei,sans-serif';ctx.fillText(s.label,120,112);}
  else{ctx.font='bold 56px sans-serif';ctx.fillText(s.name,24,68);ctx.fillRect(22,85,466,3);ctx.font='26px Microsoft YaHei,sans-serif';ctx.fillText(s.label,24,121);}
  // Bespoke graphic marks; no emoji or dependent external icon font.
  ctx.shadowBlur=0;ctx.strokeStyle=s.color;ctx.beginPath();
  if(s.use==='food'){ctx.arc(57,63,29,0,Math.PI);ctx.moveTo(30,56);ctx.lineTo(85,56);ctx.moveTo(45,46);ctx.lineTo(50,25);}
  else if(s.use==='clinic'){ctx.moveTo(54,28);ctx.lineTo(54,94);ctx.moveTo(23,61);ctx.lineTo(87,61);}
  else{for(let k=0;k<6;k++){const a=k*Math.PI/3+i*.2,x=58+29*Math.cos(a),y=60+29*Math.sin(a);k?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();}
  if(i%3===0)ctx.stroke();ctx.font='16px monospace';ctx.fillStyle='#b9c5c6';ctx.fillText(s.sub,22,158);
  ctx.fillStyle='#273238';ctx.fillRect(16,183,480,305);ctx.fillStyle='#a98e6e';ctx.fillRect(24,196,464,281);
  ctx.fillStyle='#3c4343';ctx.beginPath();ctx.moveTo(24,477);ctx.lineTo(98,409);ctx.lineTo(416,409);ctx.lineTo(488,477);ctx.fill();
  ctx.fillStyle='#d2b991';ctx.fillRect(26,199,460,8);
  if(['books','market','records','repair'].includes(s.use)){
   for(let row=0;row<3;row++){ctx.fillStyle='#554b41';ctx.fillRect(50,270+row*51,330,7);for(let col=0;col<13;col++){ctx.fillStyle=['#688182','#b69c77','#716875','#a7ac91'][(col+row+i)%4];ctx.fillRect(53+col*25,236+row*51,15+(col%3)*2,30);}}
  }else if(s.use==='theatre'||s.use==='photo'){
   ctx.fillStyle='#30333d';ctx.fillRect(64,226,332,169);ctx.strokeStyle=s.color;ctx.lineWidth=8;ctx.strokeRect(84,240,292,143);ctx.fillStyle=s.color;ctx.font='bold 32px sans-serif';ctx.fillText(s.use==='theatre'?'TONIGHT':'PORTRAITS',120,312);
  }else if(s.use==='arcade'||s.use==='tech'){
   for(let k=0;k<4;k++){ctx.fillStyle='#253139';ctx.fillRect(53+k*82,253,62,160);ctx.fillStyle=s.color;ctx.fillRect(60+k*82,265,47,60);ctx.fillStyle='#434c58';ctx.fillRect(53+k*82,337,62,15);}
  }else if(s.use==='flowers'){
   for(let k=0;k<9;k++){ctx.fillStyle='#756656';ctx.fillRect(42+k*43,372-(k%3)*30,28,35);ctx.fillStyle=k%2?'#77936e':'#a8b68b';ctx.beginPath();ctx.arc(57+k*43,350-(k%3)*30,24,0,7);ctx.fill();}
  }else{ctx.fillStyle='#6a4e3e';ctx.fillRect(55,349,321,39);for(let k=0;k<4;k++){ctx.fillStyle=s.use==='clinic'?'#a3b6b0':'#b78b62';ctx.fillRect(72+k*74,393,29,44);ctx.fillStyle='#ebd7ab';ctx.fillRect(76+k*74,285,22,26);}}
  ctx.fillStyle='#182930';ctx.fillRect(419,215,57,255);ctx.strokeStyle='#849792';ctx.lineWidth=3;ctx.strokeRect(427,229,41,212);ctx.fillStyle='#f4ddb2';ctx.fillRect(434,346,3,20);
  ctx.fillStyle='#26343b';for(const x of [18,405,490])ctx.fillRect(x,182,5,309);ctx.restore();
  const x=s.side*38.9,w=s.width;
  // Carve the original shell into a back and two cheeks; lower glass now has
  // actual depth, while the exact authored identity remains on the sign atlas.
  box('metal',s.side*42.02,6.0,s.z,.18,9.5,w+.7,{owner:s.name});
  for(const side of [-1,1])box('metal',s.side*40.5,6.0,s.z+side*(w/2+.25),3,9.5,.18,{owner:s.name});
  box('roomFloor',s.side*38.7,1.7,s.z,3.8,.35,w+1.2,{owner:s.name});
  box('roomFloor',s.side*40.65,1.85,s.z,2.7,.16,w-.2,{owner:s.name});
  box('roomGlazing',s.side*38.86,4.75,s.z,.018,5.35,w*.91,{owner:s.name});
  box('metal',s.side*40.4,10.85,s.z,1.0,.3,w+1.4);
  if(i%3===0)box('bronze',s.side*37.8,7.35,s.z,2.3,.22,w+.6);
  // Both portions keep the same atlas pixels. Only the already pictured room
  // moves behind glazing; the upper sign remains at the original street face.
  for(const [from,to,depth]of [[0,183,x],[183,512,s.side*41.90]]){
   const height=(to-from)/512*9,g=new THREE.PlaneGeometry(w,height),uv=g.attributes.uv;
   for(let n=0;n<uv.count;n++)uv.setXY(n,(i%4+(uv.getX(n)*508+2)/512)/4,1-(Math.floor(i/4)+(from+(1-uv.getY(n))*(to-from))*508/512/512+2/512)/2);
   g.rotateY(-s.side*Math.PI/2);g.translate(depth,10.65-(from+to)/1024*9,s.z);panels.push(g.toNonIndexed());g.dispose();
  }
  createShopInteriorParts(s,i).forEach(add);
 });
 const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;
 const material=clip(new THREE.MeshStandardMaterial({map,color:0xbac3c6,roughness:.72,metalness:.05,emissiveMap:map,emissive:0xffffff,emissiveIntensity:.12,side:THREE.DoubleSide}));
 const geometry=mergeGeometries(panels,false);panels.forEach(g=>g.dispose());root.add(new THREE.Mesh(geometry,material));
 // Narrow projecting lightboxes remain below the elevated rail and face along the pavement.
 const blade=document.createElement('canvas');blade.width=1024;blade.height=512;const bc=blade.getContext('2d'),faces=[];
 SHOPS.forEach((s,i)=>{const x=i*128;bc.fillStyle='#142129';bc.fillRect(x,0,128,512);bc.strokeStyle=s.color;bc.lineWidth=5;bc.strokeRect(x+7,7,114,498);bc.fillStyle=s.color;bc.font='bold 51px Microsoft YaHei,sans-serif';[...s.label].forEach((c,j)=>bc.fillText(c,x+37,90+j*91));
  if(i%2)return;
  box('metal',s.side*38.2,13.8,s.z+s.width*.4,2.7,6.5,.5);
  for(const side of [-1,1]){const g=new THREE.PlaneGeometry(2.5,6.2),uv=g.attributes.uv;for(let n=0;n<uv.count;n++)uv.setXY(n,(i+(uv.getX(n)*124+2)/128)/8,uv.getY(n)*.992+.004);if(side<0)g.rotateY(Math.PI);g.translate(s.side*38.2,13.8,s.z+s.width*.4+side*.27);faces.push(g.toNonIndexed());g.dispose();}
 });
 const bladeMap=new THREE.CanvasTexture(blade);bladeMap.colorSpace=THREE.SRGBColorSpace;bladeMap.anisotropy=4;
 const bladeMaterial=clip(new THREE.MeshBasicMaterial({map:bladeMap,toneMapped:false}));const bladeGeometry=mergeGeometries(faces,false);faces.forEach(g=>g.dispose());root.add(new THREE.Mesh(bladeGeometry,bladeMaterial));
 return {count:SHOPS.length,modeledInteriors:SHOPS.length,triangles:SHOPS.length*4+(SHOPS.filter((_,i)=>i%2===0).length*4),drawCalls:2,update(daylight){material.color.setScalar(.78+.12*daylight);material.emissiveIntensity=.10+(1-daylight)*.22;bladeMaterial.color.setScalar(.7+.3*(1-daylight));}};
}
