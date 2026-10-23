import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {BOOKCASE} from './habitat-layout.mjs';
import {naturalMaterial} from './natural-materials.mjs';

// Construction detail stays inside the original furniture envelopes and uses
// the original material objects, so the room's existing zone batches still work.
export function createFurnitureBox(width,height,depth,radius=.018){
 if(![width,height,depth].every(n=>Number.isFinite(n)&&n>0))throw new RangeError('Furniture dimensions must be positive');
 if(!Number.isFinite(radius)||radius<0)throw new RangeError('Furniture bevel must be non-negative');
 if(radius===0)return new THREE.BoxGeometry(width,height,depth);
 return new RoundedBoxGeometry(width,height,depth,radius>.018?3:1,Math.min(radius,Math.min(width,height,depth)*.45));
}

function addPart(parent,geometry,material,position,role){
 const mesh=new THREE.Mesh(geometry,material);
 mesh.position.set(...position);mesh.castShadow=mesh.receiveShadow=true;
 mesh.name=role;mesh.userData.detailRole=role;parent.add(mesh);return mesh;
}

function addBox(parent,size,position,material,role,radius=.018){
 return addPart(parent,createFurnitureBox(...size,radius),material,position,role);
}

function addSeam(parent,points,radius,material,role,closed=false){
 const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)),closed,'centripetal');
 // Dense control points track the upholstery surface, but are not a request
 // for equally dense mesh tessellation. Stitching gets a strict arc budget.
 const segments=Math.min(closed?80:28,Math.max(closed?48:12,Math.ceil(curve.getLength()*(closed?12:8))));
 return addPart(parent,new THREE.TubeGeometry(curve,segments,radius,5,closed),material,[0,0,0],role);
}

export function createRestMattressGeometry(){
 // A sewn mattress has a broad crown and a defined gusset, unlike an ellipsoid.
 // Extrema remain exactly x=+-1.21, y=+-.21, z=+-1.13.
 const profile=[[0,-.21],[.66,-.207],[.90,-.177],[.984,-.115],[1,-.025],[.993,.065],[.939,.137],[.72,.19],[.34,.208],[0,.21]];
 const geometry=new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r,y)),96);
 // The quilted top has shallow, radial compression, while its crown, contact
 // ring and measured extrema stay where the resident's support surface was.
 const surface=geometry.attributes.position;
 for(let i=0;i<surface.count;i++){
  const x=surface.getX(i),y=surface.getY(i),z=surface.getZ(i),r=Math.hypot(x,z);
  if(y>.07&&r>0&&r<.96){
   const angle=Math.atan2(z,x),weight=Math.sin(Math.PI*r)**2;
   surface.setY(i,y-.009*weight*(.35+.65*Math.sin(angle*6)**2));
  }
 }
 geometry.computeVertexNormals();
 // LatheGeometry emits collapsed pole triangles for zero-radius endpoints.
 // Remove those faces before either the room merger or collision baker sees it.
 const p=geometry.attributes.position,index=geometry.index,usable=[],a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
 for(let i=0;i<index.count;i+=3){
  a.fromBufferAttribute(p,index.getX(i));b.fromBufferAttribute(p,index.getX(i+1));c.fromBufferAttribute(p,index.getX(i+2));
  if(b.sub(a).cross(c.sub(a)).lengthSq()>1e-20)usable.push(index.getX(i),index.getX(i+1),index.getX(i+2));
 }
 geometry.setIndex(usable);geometry.scale(1.21,1,1.13);return geometry;
}

// RoundedBoxGeometry stores separate vertices per triangle. Recomputing its
// normals directly makes every deformed cushion faceted. Smooth equal-position
// vertices without welding their UV seams or changing the contact geometry.
export function smoothUpholsteryNormals(geometry){
 geometry.computeVertexNormals();
 const p=geometry.attributes.position,n=geometry.attributes.normal,sums=new Map(),keys=[];
 for(let i=0;i<p.count;i++){
  const key=[p.getX(i),p.getY(i),p.getZ(i)].map(value=>Math.round(value*1e6)).join(',');keys.push(key);
  const sum=sums.get(key)??new THREE.Vector3();sum.add(new THREE.Vector3().fromBufferAttribute(n,i));sums.set(key,sum);
 }
 for(const sum of sums.values())sum.normalize();
 for(let i=0;i<p.count;i++){const normal=sums.get(keys[i]);n.setXYZ(i,normal.x,normal.y,normal.z);}
 n.needsUpdate=true;return geometry;
}

function upholsteryGeometry(width,height,depth,radius,{compression=.018,axis='y'}={}){
 const geometry=new RoundedBoxGeometry(width,height,depth,width>1?5:3,Math.min(radius,Math.min(width,height,depth)*.45)),p=geometry.attributes.position;
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
  const u=Math.min(1,Math.abs(x)/(width/2)),v=Math.min(1,Math.abs(z)/(depth/2));
  const weight=Math.sin(Math.PI*u)**2*Math.sin(Math.PI*v)**2;
  if(axis==='y'&&y>0)p.setY(i,y-compression*weight);
  if(axis==='z'&&z>0){
   const vertical=Math.min(1,Math.abs(y)/(height/2));
   p.setZ(i,z-compression*Math.sin(Math.PI*u)**2*Math.sin(Math.PI*vertical)**2);
  }
 }
 return smoothUpholsteryNormals(geometry);
}

const HEADBOARD={width:1.28*.91,straight:.8*.92,arch:1.28*.92};
const headboardTop=x=>HEADBOARD.straight+HEADBOARD.arch*Math.sqrt(Math.max(0,1-(x/HEADBOARD.width)**2));
function tuftCenters(){
 const points=[];
 for(let row=0;row<4;row++)for(let col=-2;col<=2;col++){
  const x=col*.43,y=.30+row*.43;
  if(Math.abs(x)<HEADBOARD.width-.12&&y<headboardTop(x)-.16)points.push([x,y]);
 }
 return points;
}
const TUFT_CENTERS=tuftCenters();
function headboardFront(x,y){
 const top=headboardTop(x),u=(x/HEADBOARD.width+1)/2,v=y/top;
 let depth=.026+.063*Math.sin(Math.PI*u)*Math.sin(Math.PI*v);
 for(const [tx,ty]of TUFT_CENTERS)depth-=.035*Math.exp(-((x-tx)**2+(y-ty)**2)/.009);
 return Math.max(.009,depth);
}

export function createPaddedHeadboardGeometry(){
 const columns=48,rows=36,positions=[],uvs=[],indices=[];
 for(let row=0;row<=rows;row++)for(let col=0;col<=columns;col++){
  const x=(col/columns*2-1)*HEADBOARD.width,y=row/rows*headboardTop(x);
  positions.push(x,y,headboardFront(x,y));uvs.push(col/columns,row/rows);
 }
 for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
  const a=row*(columns+1)+col,b=a+1,c=a+columns+1,d=c+1;
  indices.push(a,b,d,a,d,c);
 }
 const perimeter=[];
 for(let col=0;col<columns;col++)perimeter.push(col);
 for(let row=0;row<rows;row++)perimeter.push(row*(columns+1)+columns);
 for(let col=columns;col>0;col--)perimeter.push(rows*(columns+1)+col);
 for(let row=rows;row>0;row--)perimeter.push(row*(columns+1));
 const back=[];
 for(const front of perimeter){back.push(positions.length/3);positions.push(positions[front*3],positions[front*3+1],0);uvs.push(uvs[front*2],uvs[front*2+1]);}
 const center=positions.length/3;positions.push(0,HEADBOARD.straight*.7,0);uvs.push(.5,.3);
 for(let i=0;i<perimeter.length;i++){
  const next=(i+1)%perimeter.length,a=perimeter[i],b=perimeter[next],c=back[i],d=back[next];
  indices.push(a,c,b,b,c,d,center,d,c);
 }
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
 geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

export function buildRestUpholstery({rest,material:m,headboardMaterial}){
 const origin=[-4.27,.68,-3.455];
 addPart(rest,createPaddedHeadboardGeometry(),headboardMaterial,origin,'Padded_arch_headboard');
 // Diamond seams follow the actual bulging surface. Their endpoints stay clear
 // of the timber arch and do not float over the edge of the upholstered panel.
 for(const direction of [-1,1])for(let band=-4;band<=7;band++){
  const points=[];
  for(let i=0;i<=100;i++){
   const x=-HEADBOARD.width+.065+i/100*(HEADBOARD.width*2-.13),y=direction*x+band*.43+.30;
   if(y>.08&&y<headboardTop(x)-.075)points.push([origin[0]+x,origin[1]+y,origin[2]+headboardFront(x,y)+.003]);
  }
  if(points.length>2)addSeam(rest,points,.0042,m.fabric,'Headboard_quilted_seam');
 }
 for(const [x,y]of TUFT_CENTERS){
  const button=addPart(rest,new THREE.SphereGeometry(.024,10,6),m.fabric,[origin[0]+x,origin[1]+y,origin[2]+headboardFront(x,y)+.004],'Headboard_cloth_button');
  button.scale.z=.45;
 }
 for(const [y,radius]of [[.744,.987],[.927,.972]]){
  const points=Array.from({length:96},(_,i)=>{const a=i/96*Math.PI*2;return[-4.27+Math.cos(a)*1.21*radius,y,-2.67+Math.sin(a)*1.13*radius];});
  addSeam(rest,points,.009,m.pillow,'Mattress_sewn_gusset',true);
 }
 // The pillow retains its original size, location and tilt, with a real sewn hem.
 const pillow=addPart(rest,upholsteryGeometry(1.464,.636,.576,.20,{compression:.025,axis:'z'}),m.pillow,[-4.42,1,-3.14],'Soft_box_pillow');
 pillow.rotation.z=-.08;
 const edge=roundedRectanglePath(1.464,.636,.20).getSpacedPoints(80).slice(0,-1).map(p=>[p.x,p.y,0]);
 const hem=addSeam(rest,edge,.006,m.fabric,'Pillow_sewn_edge',true);hem.position.copy(pillow.position);hem.rotation.copy(pillow.rotation);
}

export function buildDeskCabinet({parent,material:m,x}){
 // Separate carcass boards replace the opaque cabinet block. The side field
 // really sits behind its frame, and drawers have a bottom, sides and back.
 addBox(parent,[.386,1.02,.025],[x,.58,-3.8275],m.darkWood,'Desk_cabinet_beveled_case',.008);
 for(const y of [.0475,1.1125])addBox(parent,[.43,.045,.84],[x,y,-3.42],m.darkWood,'Desk_cabinet_horizontal_board',.008);
 for(const side of [-1,1]){
  addBox(parent,[.016,1.02,.84],[x+side*.207,.58,-3.42],m.darkWood,'Desk_cabinet_side_board',.006);
  addBox(parent,[.012,.824,.638],[x+side*.215,.61,-3.425],m.wood,'Cabinet_recessed_side_field',.004);
 }
 // Inset fields sit behind four separate frame rails; their recess is real
 // geometry, so highlights and shadows change with the camera and daylight.
 for(let row=0;row<3;row++){
  const y=.29+row*.34;
  addBox(parent,[.338,.022,.728],[x,y-.108,-3.359],m.darkWood,'Drawer_actual_bottom',.005);
  for(const side of [-1,1])addBox(parent,[.022,.212,.728],[x+side*.179,y,-3.359],m.wood,'Drawer_actual_side',.005);
  addBox(parent,[.338,.212,.022],[x,y,-3.712],m.wood,'Drawer_actual_back',.005);
  addBox(parent,[.452,.292,.028],[x,y,-2.981],m.wood,'Drawer_rear_panel',.008);
  addBox(parent,[.386,.226,.044],[x,y,-2.961],m.wood,'Drawer_inset_field',.008);
  for(const dy of [-.13,.13])addBox(parent,[.46,.04,.09],[x,y+dy,-2.95],m.wood,'Drawer_horizontal_frame',.009);
  for(const dx of [-.211,.211])addBox(parent,[.038,.222,.09],[x+dx,y,-2.95],m.wood,'Drawer_vertical_frame',.009);
  for(const dx of [-.1,.1]){
   addBox(parent,[.04,.053,.011],[x+dx,y+.02,-2.901],m.bronze,'Drawer_handle_mount',.008);
  }
  addSeam(parent,[[x-.1,y+.02,-2.901],[x-.1,y+.02,-2.880],[x-.077,y+.02,-2.873],[x+.077,y+.02,-2.873],[x+.1,y+.02,-2.880],[x+.1,y+.02,-2.901]],.011,m.bronze,'Drawer_returned_pull');
 }
 addBox(parent,[.43,.10,.82],[x,.075,-3.42],m.darkWood,'Desk_recessed_plinth',.012);
 for(const side of [-1,1]){
  const sideX=x+side*.218;
  for(const z of [-3.76,-3.09])addBox(parent,[.024,.88,.029],[sideX,.61,z],m.wood,'Cabinet_side_stile',.004);
  for(const y of [.184,1.036])addBox(parent,[.024,.028,.698],[sideX,y,-3.425],m.wood,'Cabinet_side_rail',.004);
 }
}

export function buildDeskJoinery({work,material:m}){
 addBox(work,[3.06,.105,.065],[-1.02,1.078,-2.922],m.darkWood,'Desk_structural_front_apron',.014);
 for(const x of [-2.53,.45])addBox(work,[.068,.105,.85],[x,1.078,-3.43],m.darkWood,'Desk_structural_side_apron',.012);
 for(const x of [-2.33,.25])for(const z of [-3.74,-3.06]){
  addBox(work,[.18,.08,.06],[x,1.045,z],m.wood,'Desk_mortised_corner_block',.006);
  const screw=addPart(work,new THREE.CylinderGeometry(.012,.012,.004,12),m.bronze,[x,1.087,z],'Desk_joinery_screw');
  screw.userData.collision=false;
 }
}

export function refineBookcase({nook,material:m}){
 const original=[];nook.traverse(mesh=>{if(mesh.isMesh&&mesh.geometry.type==='BoxGeometry')original.push(mesh);});
 for(const mesh of original){
  const {width,height,depth}=mesh.geometry.parameters,old=mesh.geometry;
  if(mesh.name==='Book_page_block'){
   // Fine stepped fore-edges are actual paper geometry. They remain inside
   // the page block, with the original covers supplying the outer envelope.
   // This bookcase rotates each book by a quarter-turn: paper thickness is Z,
   // so the top and fore-edge must show layers across Z, never across height.
   mesh.geometry=new THREE.BoxGeometry(width,height,depth,1,1,32);
   const p=mesh.geometry.attributes.position;
   for(let i=0;i<p.count;i++){
    const y=p.getY(i),row=Math.round((p.getZ(i)/depth+.5)*32);
    const groove=row>0&&row<32&&row%2?.0012:0;
    const x=p.getX(i);p.setX(i,x-Math.sign(x)*groove);
    p.setY(i,y-Math.sign(y)*groove*.65);
   }
   mesh.geometry.computeVertexNormals();mesh.userData.detailRole='Book_stepped_paper_fore_edge';old.dispose();continue;
  }
  // Rebate the two case sides behind the new face frame, rather than burying
  // decoration inside the original opaque board. Rear edges stay stationary.
  const caseSide=Math.abs(height-3.30)<1e-8&&Math.abs(depth-.11)<1e-8;
  mesh.geometry=createFurnitureBox(width-(caseSide?.036:0),height,depth,Math.min(.014,Math.min(width,height,depth)*.22));
  if(caseSide)mesh.position.x-=.018;
  mesh.userData.detailRole='Bookcase_beveled_original_board';old.dispose();
 }
 const bc=BOOKCASE,[left,,front]=bc.min,[right,,back]=bc.max;
 const place=(size,p,material,role,radius=.008)=>addBox(nook,[size[2],size[1],size[0]],[-p[2]-1.53,p[1],p[0]+5.95],material,role,radius);
 // The face frame fits into the original side/shelf volumes, preserving both
 // the open hiding bay and the exact heights of all five landing shelves.
 for(const x of [left+.055,right-.055])place([.11,3.22,.038],[x,1.69,front+.018],m.wood,'Bookcase_face_stile');
 for(const level of bc.levels)place([right-left-.19,.052,.047],[(left+right)/2,level-.058,front+.019],m.wood,'Bookcase_shelf_nosing');
 // Butt the rails between the stiles. Overlapping their coplanar front faces
 // produced sparkling triangles at all four corners in close views.
 for(const y of [.115,3.285])place([right-left-.22,.105,.052],[(left+right)/2,y,front+.025],m.darkWood,'Bookcase_molded_rail',.012);
 for(const x of [left+.12,right-.12])for(const y of bc.levels.slice(1,-1))for(const z of [front+.13,back-.16]){
  const peg=addPart(nook,new THREE.CylinderGeometry(.015,.015,.038,10),m.bronze,[-z-1.53,y-.118,x+5.95],'Bookcase_shelf_pin');peg.rotation.x=Math.PI/2;
 }
 return {refinedBoards:original.length};
}

function roundedRectanglePath(width,height,radius){
 const x=width/2-radius,y=height/2-radius,path=new THREE.Path();
 path.moveTo(x,height/2);path.lineTo(-x,height/2);path.absarc(-x,y,radius,Math.PI/2,Math.PI);
 path.lineTo(-width/2,-y);path.absarc(-x,-y,radius,Math.PI,Math.PI*1.5);
 path.lineTo(x,-height/2);path.absarc(x,-y,radius,Math.PI*1.5,Math.PI*2);
 path.lineTo(width/2,y);path.absarc(x,y,radius,0,Math.PI/2);return path;
}

export function buildDiningCabinetDetail({feed,material:m}){
 // The authored island uses quadratic corners, not circular arcs. Offset that
 // exact outline so curved boards cannot disappear behind its solid core.
 const contour=new THREE.Path(),x=-1.06,z=-1.48,width=2.12,depth=2.96,radius=.89;
 contour.moveTo(x+radius,z);contour.lineTo(x+width-radius,z);contour.quadraticCurveTo(x+width,z,x+width,z+radius);
 contour.lineTo(x+width,z+depth-radius);contour.quadraticCurveTo(x+width,z+depth,x+width-radius,z+depth);
 contour.lineTo(x+radius,z+depth);contour.quadraticCurveTo(x,z+depth,x,z+depth-radius);
 contour.lineTo(x,z+radius);contour.quadraticCurveTo(x,z,x+radius,z);
 const points=contour.getSpacedPoints(72).slice(0,-1);
 // Separate rounded tambour boards replace the featureless broad cabinet wall.
 // The board fronts are inset in the old bevel envelope, not a larger cabinet.
 for(let i=0;i<points.length;i++){
  const p=points[i],previous=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length],tangent=next.clone().sub(previous).normalize();
  const board=addBox(feed,[.095,.655,.018],[-3.43+p.x+tangent.y*.023,.445,1.33+p.y-tangent.x*.023],m.darkWood,'Dining_cabinet_tambour_board',.007);
  const surface=board.geometry.attributes.position;
  for(let vertex=0;vertex<surface.count;vertex++){
   const bx=surface.getX(vertex),bz=surface.getZ(vertex);
   if(bz>0)surface.setZ(vertex,bz-.003*Math.sin(Math.PI*Math.min(1,Math.abs(bx)/.0475))**2);
  }
  board.geometry.computeVertexNormals();
  board.rotation.y=Math.atan2(tangent.y,-tangent.x);
 }
}

export function createDetailedLoungeChair(source){
 const materials=new Map();source.traverse(mesh=>{if(mesh.isMesh)for(const mat of(Array.isArray(mesh.material)?mesh.material:[mesh.material]))materials.set(mat.name,mat);});
 for(const name of ['carpet','wood','metal'])if(!materials.has(name))throw new Error(`Lounge chair is missing its authored ${name} material`);
 const authoredCloth=materials.get('carpet');
 const cloth=naturalMaterial('cloth',{color:authoredCloth.color.clone(),roughness:.98});cloth.name=authoredCloth.name;
 const root=new THREE.Group(),wood=materials.get('wood'),metal=materials.get('metal');
 root.name='Tailored_lounge_chair';
 const part=(size,p,material,role,r=.012)=>addBox(root,size,p,material,role,r);
 part([.49,.135,.41],[.245,.1175,-.40969],cloth,'Chair_lower_upholstered_frame',.018);
 for(const x of [.045,.445])part([.09,.30,.39],[x,.21,-.41969],cloth,'Chair_rounded_arm',.028);
 addPart(root,upholsteryGeometry(.30966,.077,.305,.022,{compression:.010}),cloth,[.245,.2465,-.37169],'Chair_separate_seat_cushion');
 const back=addPart(root,upholsteryGeometry(.37966,.26,.0902,.022,{compression:.008,axis:'z'}),cloth,[.245,.5,-.59959],'Chair_reclined_back_cushion');
 const pos=back.geometry.attributes.position;
 for(let i=0;i<pos.count;i++){
  const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i),t=(y+.13)/.26;
  pos.setXYZ(i,x*(1-.2107*t),y,z-y*(.06/.26));
 }
 pos.needsUpdate=true;smoothUpholsteryNormals(back.geometry);
 const footrest=addPart(root,upholsteryGeometry(.30966,.0526,.20,.010,{compression:.003}),cloth,[.245,.09353,-.1034],'Chair_extended_foot_cushion');footrest.rotation.x=-.2618;
 for(const x of [.02,.47])for(const z of [-.59469,-.24469])part([.04,.05,.04],[x,.025,z],wood,'Chair_beveled_foot',.004);
 for(const x of [.047,.443])part([.033,.023,.31],[x,.067,-.420],wood,'Chair_exposed_structural_side_rail',.004);
 for(const z of [-.554,-.284])part([.39,.023,.03],[.245,.067,z],wood,'Chair_structural_cross_rail',.004);
 for(const x of [.13517,.35483]){
  const rail=part([.03,.025,.114],[x,.075,-.168],metal,'Chair_footrest_link',.004);rail.rotation.x=-.19;
  for(const z of [-.215,-.125]){
   const pin=addPart(root,new THREE.CylinderGeometry(.009,.009,.032,10),metal,[x,.075,z],'Chair_linkage_pivot');pin.rotation.z=Math.PI/2;
  }
 }
 for(const x of [.045,.445]){
  const points=roundedRectanglePath(.033,.326,.012).getSpacedPoints(48).slice(0,-1).map(p=>[x+p.x,.361,-.41969+p.y]);
  addSeam(root,points,.0024,cloth,'Chair_arm_sewn_edge',true);
 }
 for(const y of [.408,.559]){
  const points=Array.from({length:17},(_,i)=>{const x=(i/16*2-1)*.133,z=-.59959+.0451-(y-.5)*(.06/.26);return[.245+x,y,z+.0015];});
  addSeam(root,points,.0025,cloth,'Chair_back_pleated_seam');
 }
 // Keep the authored three material draws before room batching; no small seam
 // receives a separate material or per-frame work.
 const bins=new Map();root.updateMatrixWorld(true);
 for(const child of root.children){
  const geometry=child.geometry.index?child.geometry.toNonIndexed():child.geometry.clone();geometry.applyMatrix4(child.matrix);
  if(!bins.has(child.material))bins.set(child.material,[]);bins.get(child.material).push(geometry);
 }
 const roles=root.children.map(mesh=>mesh.userData.detailRole);
 for(const child of [...root.children]){child.geometry.dispose();root.remove(child);}
 for(const [material,geometries]of bins){
  const combined=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());
  addPart(root,combined,material,[0,0,0],`Tailored_chair_${material.name}`);
 }
 root.userData.detailRoles=roles;return root;
}
