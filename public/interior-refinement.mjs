import * as DefaultTHREE from 'three';
import {createFurnitureBox,smoothUpholsteryNormals} from './room-model-detail.mjs';
import {FOOD_PROPS,FOOD_TOP} from './habitat-layout.mjs';
import {naturalMaterial} from './natural-materials.mjs';

const close=(a,b,tolerance=.0001)=>Math.abs(a-b)<tolerance;
const at=(mesh,x,y,z)=>close(mesh.position.x,x)&&close(mesh.position.y,y)&&close(mesh.position.z,z);
const directMeshes=group=>group?.children.filter(child=>child.isMesh)??[];

// Revolved caps contain zero-radius endpoints. Remove only their collapsed
// triangles, retaining the closed, measured solid used by the collision baker.
function cleanGeometry(THREE,geometry){
 const position=geometry.attributes.position,index=geometry.index;
 if(!index)return geometry;
 const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),keep=[];
 for(let i=0;i<index.count;i+=3){
  const ia=index.getX(i),ib=index.getX(i+1),ic=index.getX(i+2);
  a.fromBufferAttribute(position,ia);b.fromBufferAttribute(position,ib);c.fromBufferAttribute(position,ic);
  if(b.sub(a).cross(c.sub(a)).lengthSq()>1e-22)keep.push(ia,ib,ic);
 }
 geometry.setIndex(keep);geometry.computeVertexNormals();return geometry;
}

/** Refine existing assemblies before static batching, without a second set of props. */
export function buildInteriorRefinement({THREE=DefaultTHREE,material:m,groups}){
 if(!m||!groups)throw new TypeError('Interior refinement needs room materials and groups');
 const {rest,feed,work,garden,flight,architecture}=groups;
 const anchor=architecture??work??rest??Object.values(groups).find(group=>group?.isObject3D);
 if(anchor?.userData.interiorRefinement)return {...anchor.userData.interiorRefinement,roles:[...anchor.userData.interiorRefinement.roles]};
 const summary={replaced:0,added:0,roles:new Set()};
 const part=(parent,geometry,material,position,name)=>{
  const mesh=new THREE.Mesh(geometry,material);mesh.position.set(...position);
  mesh.name=name;mesh.userData.detailRole=name;mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);
  summary.added++;summary.roles.add(name);return mesh;
 };
 const box=(parent,size,p,material,name,radius=.006)=>part(parent,createFurnitureBox(...size,radius),material,p,name);
 const lathe=(profile,segments=48)=>cleanGeometry(THREE,new THREE.LatheGeometry(profile.map(p=>new THREE.Vector2(...p)),segments));
 const remove=mesh=>{mesh.removeFromParent();mesh.geometry.dispose();summary.replaced++;};
 const replaceGeometry=(mesh,geometry,name)=>{
  const previous=mesh.geometry;mesh.geometry=geometry;previous.dispose();mesh.name=name;mesh.userData.detailRole=name;
  summary.replaced++;summary.roles.add(name);
 };
 const roundBoxes=group=>{
  for(const mesh of directMeshes(group)){
   if(mesh.geometry.type!=='BoxGeometry'||mesh.userData.interiorRefined)continue;
   const {width,height,depth}=mesh.geometry.parameters;
   replaceGeometry(mesh,createFurnitureBox(width,height,depth,Math.min(.012,Math.min(width,height,depth)*.23)),mesh.name||'Joinery_beveled_existing_part');
   mesh.userData.interiorRefined=true;
  }
 };

 // The existing floorboards, masonry, columns and beams receive actual edge
 // bevels. Instanced meshes keep their original transforms and material colors.
 for(const mesh of directMeshes(architecture)){
  if(mesh.isInstancedMesh&&mesh.geometry.type==='BoxGeometry'){
   const {width,height,depth}=mesh.geometry.parameters;
   replaceGeometry(mesh,createFurnitureBox(width,height,depth,mesh.name==='Individual_walnut_floorboards'?.006:.009),mesh.name||'Beveled_masonry_blocks');
  }
 }

 const turned=(group,predicate,profile,name)=>{
  for(const mesh of directMeshes(group).filter(predicate))replaceGeometry(mesh,lathe(profile),name);
 };
 turned(rest,mesh=>mesh.geometry.type==='CylinderGeometry'&&at(mesh,-4.27,.23,-2.68),
  [[0,-.21],[1.49,-.21],[1.53,-.194],[1.53,-.17],[1.485,-.15],[1.48,.17],[1.47,.21],[0,.21]],'Bed_turned_wooden_plinth');
 turned(rest,mesh=>mesh.geometry.type==='CylinderGeometry'&&at(mesh,-2.91,.32,-2.71),
  [[0,-.27],[.33,-.27],[.36,-.254],[.36,-.228],[.285,-.20],[.268,.18],[.31,.235],[.31,.27],[0,.27]],'Side_table_turned_wood');

 function rebuildLamp(parent,x,y,z,scale,hanging=false){
  if(!parent)return;
  const originals=directMeshes(parent).filter(mesh=>{
   const g=mesh.geometry,p=g.parameters;
   if(g.type==='SphereGeometry')return close(mesh.position.x,x)&&close(mesh.position.z,z)&&[.20*scale,.07*scale].some(radius=>close(p.radius,radius));
   if(g.type==='CylinderGeometry')return close(mesh.position.x,x)&&close(mesh.position.z,z)&&mesh.position.y>=y-.24*scale&&mesh.position.y<=y+.34*scale&&(mesh.material===m.gold||mesh.material===m.bronze);
   return hanging&&g.type==='TubeGeometry'&&close(p.radius,.014)&&close(p.path.points?.[0]?.x??Infinity,x)&&close(p.path.points?.[0]?.z??Infinity,z);
  });
  if(!originals.length)return;
  originals.forEach(remove);
  if(hanging){
   const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(x,y+.25*scale,z),new THREE.Vector3(x,y+.70,z),new THREE.Vector3(x+.05,4.65,z)]);
   part(parent,new THREE.TubeGeometry(curve,28,.009,8),m.gold,[0,0,0],'Pendant_flexible_cord');
  }else{
   part(parent,lathe([[0,-.03],[.207,-.03],[.22,-.02],[.22,.004],[.185,.03],[0,.03]].map(([r,h])=>[r*scale,h*scale])),m.bronze,[x,y-.20*scale,z],'Lamp_turned_base');
   part(parent,lathe([[0,-.11],[.06,-.11],[.054,-.09],[.026,-.06],[.023,.07],[.045,.11],[0,.11]].map(([r,h])=>[r*scale,h*scale])),m.gold,[x,y-.10*scale,z],'Lamp_turned_stem');
  }
  const outer=[[.052,-.193],[.125,-.155],[.177,-.093],[.2,0],[.178,.094],[.115,.164],[.032,.197],[0,.2]];
  const inner=[...outer].reverse().map(([r,h])=>[Math.max(0,r-.0035),h===.2?.196:h+.001]);
  const globe=part(parent,lathe([...outer,...inner,outer[0]].map(([r,h])=>[r*scale,h*scale]),64),m.glass,[x,y+.14*scale,z],'Lamp_hollow_glass_globe');
  globe.castShadow=false;
  const bulb=part(parent,new THREE.SphereGeometry(.07*scale,24,16),m.bulb,[x,y+.13*scale,z],'Lamp_warm_bulb');bulb.castShadow=false;
  for(const level of [-.028,.31])part(parent,lathe([[0,-.0125],[.073,-.0125],[.08,-.006],[.08,.006],[.073,.0125],[0,.0125]].map(([r,h])=>[r*scale,h])),m.gold,[x,y+level*scale,z],'Lamp_globe_collar');
 }
 rebuildLamp(rest,-2.91,.84,-2.71,.8);
 rebuildLamp(work,.12,1.55,-3.58,1.07);
 rebuildLamp(rest,-5.07,3.21,-.96,.72,true);
 rebuildLamp(work,.10,3.64,-3.80,.76,true);

 if(work){
  const monitor=directMeshes(work).find(mesh=>mesh.geometry.type==='ExtrudeGeometry'&&at(mesh,-1.20,2.15,-3.87));
  if(monitor){
   remove(monitor);
   const vents=directMeshes(work).filter(mesh=>mesh.geometry.type==='BoxGeometry'&&close(mesh.geometry.parameters.width,.055)&&close(mesh.position.y,2.74)&&close(mesh.position.z,-3.603));
   vents.forEach(remove);
   box(work,[2.11,1.29,.035],[-1.20,2.15,-3.8875],m.dark,'Monitor_separate_rear_shell',.010);
   box(work,[2.17,.195,.19],[-1.20,1.5725,-3.81],m.gold,'Monitor_lower_bezel',.012);
   for(const x of [-2.215,-.185])box(work,[.14,1.08,.19],[x,2.21,-3.81],m.gold,'Monitor_side_bezel',.010);
   // The original decorative vent bars floated ahead of the screen. Cut real
   // slots between the top rail's front/back bands, with a dark inner liner.
   for(const z of [-3.8875,-3.7325])box(work,[2.17,.075,.035],[-1.2,2.7875,z],m.gold,'Monitor_top_vent_band',.005);
   let edge=-2.285;
   for(let i=0;i<14;i++){
    const x=-1.79+i*.085,left=x-.0275;
    if(left>edge)box(work,[left-edge,.075,.12],[(edge+left)/2,2.7875,-3.81],m.gold,'Monitor_top_vent_bridge',.004);
    box(work,[.055,.004,.115],[x,2.755,-3.81],m.dark,'Monitor_recessed_vent_liner',.001);edge=x+.0275;
   }
   box(work,[-.115-edge,.075,.12],[(edge-.115)/2,2.7875,-3.81],m.gold,'Monitor_top_vent_bridge',.004);
  }
 }

 // A keyboard has an inset board and individual caps above short switches.
 // Remove the old shell and its thirty boxes as one measured assembly.
 if(work){
  const keyboard=directMeshes(work).find(mesh=>mesh.geometry.type==='ExtrudeGeometry'&&at(mesh,-1.15,1.34,-3.17));
  if(keyboard){
   const oldKeys=directMeshes(work).filter(mesh=>mesh.geometry.type==='BoxGeometry'&&close(mesh.geometry.parameters.width,.062)&&close(mesh.position.y,1.420));
   remove(keyboard);oldKeys.forEach(remove);
   box(work,[1.01,.030,.38],[-1.15,1.370,-3.17],m.dark,'Keyboard_lower_case',.007);
   for(const z of [-3.34,-3.00])box(work,[1.01,.025,.04],[-1.15,1.3975,z],m.dark,'Keyboard_beveled_outer_rail');
   for(const x of [-1.635,-.665])box(work,[.04,.025,.30],[x,1.3975,-3.17],m.dark,'Keyboard_beveled_side_rail');
   box(work,[.91,.016,.275],[-1.15,1.387,-3.17],m.dark,'Keyboard_recessed_switch_board');
   for(let row=0;row<3;row++)for(let column=0;column<10;column++){
    const x=-1.49+column*.073,z=-3.26+row*.082;
    box(work,[.034,.015,.031],[x,1.405,z],m.dark,'Keyboard_switch_stem',.003);
    const cap=box(work,[.062,.015,.056],[x,1.420,z],m.bronze,'Keyboard_sculpted_keycap',.004);
    const vertices=cap.geometry.attributes.position;
    for(let i=0;i<vertices.count;i++)if(vertices.getY(i)>0){
     const u=Math.min(1,Math.abs(vertices.getX(i))/.031),v=Math.min(1,Math.abs(vertices.getZ(i))/.028);
     vertices.setY(i,vertices.getY(i)-.002*Math.sin(Math.PI*u)**2*Math.sin(Math.PI*v)**2);
    }
    smoothUpholsteryNormals(cap.geometry);
   }
   // A thin lower casing rests on the desk at 1.355. Keep key tops at their
   // delivered height, so an existing supported screen stance stays valid.
  }
  const mouse=directMeshes(work).find(mesh=>mesh.geometry.type==='SphereGeometry'&&at(mesh,-.45,1.40,-3.15));
  if(mouse){
   remove(mouse);
   const shell=part(work,new THREE.SphereGeometry(.1,32,12,0,Math.PI*2,Math.PI/2,Math.PI/2),m.dark,[-.45,1.40,-3.15],'Mouse_lower_shell');shell.scale.set(.7,.48,1);
   for(const start of [-Math.PI/2+.016,Math.PI/2+.016]){
    const button=part(work,new THREE.SphereGeometry(.1,24,12,start,Math.PI-.032,0,Math.PI/2),m.dark,[-.45,1.40,-3.15],'Mouse_separate_button');button.scale.set(.7,.48,1);
   }
   const wheel=part(work,new THREE.CylinderGeometry(.012,.012,.020,20),m.bronze,[-.45,1.436,-3.165],'Mouse_scroll_wheel');wheel.rotation.z=Math.PI/2;
  }
 }

 if(work){
  const pages=directMeshes(work).filter(mesh=>mesh.geometry.type==='BoxGeometry'&&close(mesh.geometry.parameters.width,.31)&&close(mesh.position.y,1.365));
  if(pages.length===2){
   const paper=pages[0].material;
   const originals=directMeshes(work).filter(mesh=>pages.includes(mesh)||(mesh.geometry.type==='BoxGeometry'&&close(mesh.geometry.parameters.width,.21)&&close(mesh.position.y,1.388))||(mesh.geometry.type==='TubeGeometry'&&close(mesh.geometry.parameters.radius,.012)&&close(mesh.geometry.parameters.path.points?.[0]?.x??Infinity,-1.97)));
   originals.forEach(remove);
   box(work,[.628,.006,.43],[-1.97,1.358,-3.25],m.darkWood,'Notebook_flexible_cover',.002);
   for(const side of [-1,1]){
    const pageGroup=new THREE.Group();pageGroup.position.set(-1.97+side*.16,1.374,-3.25);pageGroup.rotation.z=side*.075;work.add(pageGroup);
    box(pageGroup,[.31,.008,.43],[0,-.002,0],paper,'Notebook_layered_page_block',.002);
    const surface=new THREE.PlaneGeometry(.31,.43,12,12);surface.rotateX(-Math.PI/2);
    const vertices=surface.attributes.position;
    const height=x=>.006-.008*Math.exp(-(((x+side*.155)/.055)**2));
    for(let i=0;i<vertices.count;i++)vertices.setY(i,height(vertices.getX(i)));
    surface.computeVertexNormals();part(pageGroup,surface,paper,[0,0,0],'Notebook_curved_open_page');
    for(let line=0;line<6;line++)box(pageGroup,[.21,.001,.006],[0,height(0)+.0007,-.15+line*.048],m.darkWood,'Notebook_ink_line',0);
   }
   const spine=new THREE.CatmullRomCurve3([new THREE.Vector3(-1.97,1.385,-3.46),new THREE.Vector3(-1.97,1.371,-3.25),new THREE.Vector3(-1.97,1.385,-3.04)]);
   part(work,new THREE.TubeGeometry(spine,20,.0035,6),m.gold,[0,.009,0],'Notebook_bound_fold');
  }
 }

 if(feed){
  const bottle=FOOD_PROPS.bottle;
  for(const mesh of directMeshes(feed)){
   if(!close(mesh.position.x,bottle.x)||!close(mesh.position.z,bottle.z))continue;
   if(mesh.geometry.type==='LatheGeometry'&&at(mesh,bottle.x,FOOD_TOP+.018,bottle.z)){
    const outer=[[0,0],[.13,0],[.151,.012],[.179,.075],[.18,.22],[.172,.244],[.069,.358],[.056,.389],[.056,.50],[.063,.505],[.063,.52],[.049,.52]];
    const inner=[[.047,.507],[.047,.386],[.060,.356],[.162,.239],[.17,.215],[.17,.08],[.142,.022],[0,.012]];
    replaceGeometry(mesh,lathe([...outer,...inner],64),'Bottle_hollow_glass_body');mesh.castShadow=false;
   }else if(mesh.geometry.type==='CylinderGeometry'&&close(mesh.position.y,FOOD_TOP+.108)){
    replaceGeometry(mesh,lathe([[0,-.085],[.125,-.085],[.137,-.065],[.155,.075],[.152,.085],[0,.083]]),'Bottle_liquid_meniscus');mesh.castShadow=false;
   }else if(mesh.geometry.type==='CylinderGeometry'&&close(mesh.position.y,FOOD_TOP+.555)){
    replaceGeometry(mesh,lathe([[0,-.0275],[.055,-.0275],[.058,-.024],[.061,.024],[.062,.0275],[0,.0275]],32),'Bottle_beveled_cork');
   }
  }
  const plates=directMeshes(feed).filter(mesh=>mesh.geometry.type==='CylinderGeometry'&&[.025,.035].some(h=>close(mesh.geometry.parameters.height,h))&&!close(mesh.position.x,bottle.x));
  for(const mesh of plates){
   const {radiusTop:r,height:h}=mesh.geometry.parameters;
   replaceGeometry(mesh,lathe([[0,-h/2],[r*.62,-h/2],[r*.68,-h*.35],[r*.72,-h*.12],[r*.90,h*.36],[r,h/2],[r*.99,h*.16],[r*.86,-h*.04],[r*.68,-h*.10],[0,-h*.10]],64),'Serving_plate_recessed_well');
  }
 }

 // The front-facing books are rebuilt within their existing tilted envelopes.
 if(architecture){
  const books=directMeshes(architecture).filter(mesh=>mesh.geometry.type==='BoxGeometry'&&close(mesh.geometry.parameters.width,.18)&&close(mesh.geometry.parameters.depth,.45)&&close(mesh.position.z,3.96));
  const paper=new THREE.MeshStandardMaterial({color:0xdccfb8,roughness:.96});
  const label=new THREE.MeshStandardMaterial({color:0x716557,roughness:.94}),clothCovers=new Map();
  for(const original of books){
   if(!clothCovers.has(original.material))clothCovers.set(original.material,naturalMaterial('cloth',{color:original.material.color.clone(),roughness:.88}));
   const h=original.geometry.parameters.height,cover=clothCovers.get(original.material),position=original.position.clone(),rotation=original.rotation.clone();
   const marks=directMeshes(architecture).filter(mesh=>mesh.geometry.type==='BoxGeometry'&&close(mesh.geometry.parameters.width,.15)&&close(mesh.position.x,original.position.x)&&close(mesh.position.z,4.192));
   remove(original);marks.forEach(remove);
   const book=new THREE.Group();book.position.copy(position);book.rotation.copy(rotation);architecture.add(book);
   const page=part(book,new THREE.BoxGeometry(.152,h-.024,.415,24,1,1),paper,[0,0,-.004],'Standing_book_page_edges');
   const vertices=page.geometry.attributes.position;
   for(let i=0;i<vertices.count;i++){
    const row=Math.round((vertices.getX(i)/.152+.5)*24),groove=row>0&&row<24&&row%2?.0012:0;
    const y=vertices.getY(i),z=vertices.getZ(i);
    vertices.setY(i,y-Math.sign(y)*groove);vertices.setZ(i,z-Math.sign(z)*groove);
   }
   page.geometry.computeVertexNormals();
   for(const x of [-.083,.083])box(book,[.014,h,.45],[x,0,0],cover,'Standing_book_hard_cover',.003);
   const spine=part(book,new THREE.CylinderGeometry(1,1,h,20),cover,[0,0,.215],'Standing_book_rounded_spine');spine.scale.set(.09,1,.01);
   for(const y of [-h*.28,h*.28])box(book,[.13,.012,.003],[0,y,.225],m.gold,'Standing_book_foil_band',.001);
   box(book,[.093,.108,.002],[0,h*.06,.226],label,'Standing_book_inset_title',.001);
  }
 }

 // Window rails are hollow channel sections; the glass plane stays untouched.
 for(const mesh of directMeshes(garden).filter(mesh=>mesh.geometry.type==='BoxGeometry'&&close(mesh.position.z,-4.42)&&mesh.material===m.dark)){
  const {width:w,height:h,depth:d}=mesh.geometry.parameters,position=mesh.position.clone(),vertical=h>w;
  remove(mesh);
  for(const offset of [-.019,.019])box(garden,[w,h,.012],[position.x,position.y,position.z+offset],m.dark,'Window_channel_flange',.002);
  box(garden,vertical?[.013,h,d-.006]:[w,.013,d-.006],[position.x,position.y,position.z],m.dark,'Window_channel_web',.002);
 }
 const rug=directMeshes(flight).find(mesh=>mesh.geometry.type==='CircleGeometry'&&close(mesh.geometry.parameters.radius,2.11));
 if(rug){
  replaceGeometry(rug,new THREE.CylinderGeometry(2.11,2.11,.008,96),'Woven_rug_with_thickness');rug.rotation.set(0,0,0);rug.position.y=.032;
  const edge=directMeshes(flight).find(mesh=>mesh.geometry.type==='TorusGeometry'&&close(mesh.geometry.parameters.radius,2.13));
  if(edge){edge.scale.z=.25;edge.name='Rug_flattened_bound_edge';edge.userData.detailRole=edge.name;}
 }
 for(const group of [rest,feed,work,garden,architecture])roundBoxes(group);
 const result={...summary,roles:[...summary.roles]};
 if(anchor)anchor.userData.interiorRefinement=result;
 return result;
}
