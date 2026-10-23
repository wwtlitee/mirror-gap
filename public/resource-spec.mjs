import {FOOD_PROPS,FOOD_TOP} from './habitat-layout.mjs';
import {naturalMaterial} from './natural-materials.mjs';
import {createDetailedFoodModel,createDetailedFig} from './food-model-detail.mjs';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
// Scene objects declare affordances. Behaviour code never selects object names
// or a privileged room/coordinate as the only place to eat or drink.
export const RESOURCE_DEFINITIONS=[
 {id:'apple',label:'苹果',kind:'food',zone:'feed',signalId:'fruit',asset:'apple',position:[-3.11,1.09,1.55],size:[.19,.20,.19],yaw:0,edibleU:[.96875]},
 {id:'banana',label:'香蕉',kind:'food',zone:'feed',asset:'banana',position:[-3.08,1.104,1.71],size:[.12,.17,.55],yaw:Math.PI/2,edibleU:[.71875]},
 {id:'burger',label:'汉堡',kind:'food',zone:'feed',asset:'burger-cheese',position:[-3.94,1.06,.48],size:[.49,.34,.49],yaw:.3},
 {id:'pizza',label:'披萨',kind:'food',zone:'feed',asset:'pizza',position:[-2.82,1.06,2.48],size:[.70,.08,.70],yaw:.2},
 {id:'fries',label:'薯条',kind:'food',zone:'feed',asset:'fries',position:[-3.68,1.025,1.12],size:[.26,.37,.27],yaw:.35,edibleU:[.71875],serving:[[-3.43,1.0475,1.00,.2],[-3.40,1.0475,1.10,-.25],[-3.45,1.0475,1.22,.4]]},
 {id:'sandwich',label:'三明治',kind:'food',zone:'feed',asset:'sandwich',position:[-4.05,1.025,1.85],size:[.32,.18,.32],yaw:.4},
 {id:'fig',label:'切开的无花果',kind:'food',zone:'feed',shape:'fig',position:[FOOD_PROPS.fig.x,FOOD_TOP+.072,FOOD_PROPS.fig.z]},
 {id:'water-bowl',label:'碗里的清水',kind:'water',zone:'feed',signalId:'drinking-bowl',shape:'disc',position:[FOOD_PROPS.water.x,FOOD_TOP+FOOD_PROPS.water.radius*.30,FOOD_PROPS.water.z],radius:FOOD_PROPS.water.radius*.87,segments:40},
 {id:'shallow-pool',label:'浅水池',kind:'water',zone:'entry',signalId:'water',shape:'disc',position:[4.5,.326,3.1],radius:.74,segments:48},
];
export const RESOURCE_BY_ID=Object.fromEntries(RESOURCE_DEFINITIONS.map(r=>[r.id,r]));

// The same detailed mesh is used by the room and resource-surface baker.
// Explicit part semantics supersede palette UVs, which remain supported for
// older source assets and all other foods.
export function createNaturalFoodModel(THREE, definition, {geometryOnly = false} = {}) {
 if(definition.id !== 'apple')return createDetailedFoodModel(definition,{geometryOnly});
 const root=new THREE.Group();root.name='Natural_apple';root.userData.resourceId=definition.id;
 const skin=geometryOnly?new THREE.MeshBasicMaterial():naturalMaterial('fruit');
 const bark=new THREE.MeshStandardMaterial({color:0x665036,roughness:.96});
 const leafMaterial=geometryOnly?new THREE.MeshBasicMaterial():naturalMaterial('leaf',{color:0xb7bf80});
 const geometry=new THREE.SphereGeometry(1,48,32),p=geometry.attributes.position;
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),y=p.getY(i),z=p.getZ(i),r=Math.hypot(x,z),angle=Math.atan2(z,x);
  const lobes=1+.026*Math.cos(angle*5)*(.3+.7*Math.abs(y));
  const top=y>0?.13*Math.exp(-r*r*19):0,bottom=y<0?.055*Math.exp(-r*r*20):0;
  // Apples have a broad shoulder around the calyx. Keep that near-level
  // shoulder in the actual geometry rather than relying on a visual normal
  // map to disguise an unstable spherical perch for a millimetre-sized fly.
  const shoulder=y>0?Math.min(.765,y*.84-top):y*.84+bottom;
  p.setXYZ(i,x*lobes,shoulder,z*lobes);
 }
 geometry.computeVertexNormals();
 const add=(geometry,material,name,edible)=>{const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.userData={edible,resourcePart:edible?'fruit-skin':'stalk-or-leaf'};root.add(mesh);return mesh;};
 add(geometry,skin,'Apple_skin',true);
 // Normalize the entire fruit, including the inedible stalk. A long stalk
 // would steal height from the edible shoulder and move existing mouth targets
 // outside the physical proboscis range even though the object bounds match.
 const stemCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(0,.69,0),new THREE.Vector3(.025,.79,.015),new THREE.Vector3(.06,.91,.035)]);
 add(new THREE.TubeGeometry(stemCurve,10,.034,8,false),bark,'Apple_stalk',false);
 const positions=[],uv=[],indices=[];
 for(let row=0;row<=12;row++){
  const t=row/12,width=Math.sin(t*Math.PI)*.13;
  for(let col=0;col<3;col++){positions.push(.035+t*.44,(col===1?.027*Math.sin(t*Math.PI):0)+.78+Math.sin(t*Math.PI)*.08,.018+(col-1)*width);uv.push(t,col/2);}
 }
 for(let row=0;row<12;row++)for(let col=0;col<2;col++){const n=row*3+col;if(row>0)indices.push(n,n+3,n+1);if(row<11)indices.push(n+1,n+3,n+4);}
 const leafGeometry=new THREE.BufferGeometry();leafGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));leafGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));leafGeometry.setIndex(indices);leafGeometry.computeVertexNormals();
 add(leafGeometry,leafMaterial,'Apple_leaf',false);
 return root;
}
export function createResourceShape(THREE,definition,materials){
 const group=new THREE.Group();group.position.set(...definition.position);group.userData.resourceId=definition.id;
 const add=(geometry,material,position=[0,0,0],scale=[1,1,1])=>{const mesh=new THREE.Mesh(geometry,material);mesh.position.set(...position);mesh.scale.set(...scale);group.add(mesh);return mesh;};
 if(definition.shape==='disc')add(new THREE.CircleGeometry(definition.radius,definition.segments),materials.surface).rotation.x=-Math.PI/2;
 else if(definition.shape==='fig'){
  group.add(createDetailedFig(materials));
 }else throw Error(`Unsupported resource shape: ${definition.shape}`);
 return group;
}

// A few chips served beside the tall carton provide genuine reachable food.
// Rendering and edible collision extraction share exactly this geometry.
export function createResourceServing(THREE,definition,material){
 const group=new THREE.Group();group.userData.resourceId=definition.id;
 for(const [x,y,z,yaw]of definition.serving??[]){const mesh=new THREE.Mesh(new RoundedBoxGeometry(.045,.045,.18,3,.004),material);mesh.position.set(x,y,z);mesh.rotation.y=yaw;mesh.userData.edible=true;group.add(mesh);}
 return group;
}

// Food dimensions are local axes. Normalize before yaw; rotating the bounds
// first compresses a long banana into a short, thick shape.
export function placeResourceModel(THREE,model,definition){
 model.rotation.set(0,0,0);model.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(model,true),size=bounds.getSize(new THREE.Vector3());
 model.scale.set(...definition.size.map((n,i)=>n/size.getComponent(i)));
 model.rotation.y=definition.yaw??0;model.updateMatrixWorld(true);
 bounds.setFromObject(model,true);const center=bounds.getCenter(new THREE.Vector3());
 model.position.set(definition.position[0]-center.x,definition.position[1]-bounds.min.y,definition.position[2]-center.z);model.updateMatrixWorld(true);
 return model;
}
