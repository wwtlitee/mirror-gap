import {GLTFLoader}from 'three/addons/loaders/GLTFLoader.js';
import {RESOURCE_DEFINITIONS,createResourceServing,placeResourceModel,createNaturalFoodModel} from './resource-spec.mjs';
import {naturalizeImportedMaterial} from './natural-materials.mjs';
import {TOILET_BASIN} from './toilet-contact.mjs';
import {createDetailedLoungeChair} from './room-model-detail.mjs';
import {createDetailedToilet} from './toilet-model-detail.mjs';
export function openToiletLid(THREE,model){
 if(model.getObjectByName('Raised_toilet_lid')?.userData.open)return;
 const lid=model.getObjectByName('Group');
 if(!lid?.isMesh)throw Error('Toilet lid hinge missing from asset');
 if(lid.userData.open)return;
 lid.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI*.54));
 lid.name='Raised_toilet_lid';lid.userData.open=true;
}
export async function buildKenneyRoom({THREE,box,cylinder,material:m,groups}){
 const {feed,work,toilet}=groups;
 const placements=[
 ...RESOURCE_DEFINITIONS.filter(r=>r.asset).map(r=>[r.asset,r.position,r.size,r.yaw,groups[r.zone]]),
 ['loungeChairRelax',[-1.18,.04,-1.98],[1.24,1.12,1.30],Math.PI,work],
 ['toiletSquare',[4.35,.30,.38],[.49,.43,.62],Math.PI*1.5,toilet],
 ];
 for(const definition of RESOURCE_DEFINITIONS.filter(r=>r.serving))groups[definition.zone].add(createResourceServing(THREE,definition,new THREE.MeshStandardMaterial({color:0xe7bb62,roughness:.82})));
 const loader=new GLTFLoader();await Promise.all(placements.map(async([name,p,size,yaw,parent])=>{
  const definition=RESOURCE_DEFINITIONS.find(r=>r.asset===name);
  let model=createNaturalFoodModel(THREE,definition??{})??(await loader.loadAsync(`/assets/kenney-home/${name}.glb`)).scene;
  if(name==='loungeChairRelax'){
   const original=model;model=createDetailedLoungeChair(original);
   original.traverse(mesh=>{if(mesh.isMesh)mesh.geometry.dispose();});
  }
  if(name==='toiletSquare'){
   const original=model;model=createDetailedToilet(original);
   original.traverse(mesh=>{if(mesh.isMesh)mesh.geometry.dispose();});
  }
  model.rotation.y=yaw;model.updateMatrixWorld(true);
  // Normalize the toilet before yaw so a quarter turn preserves its proportions.
  if(name==='toiletSquare'){model.rotation.y=0;model.updateMatrixWorld(true);}
  const b=new THREE.Box3().setFromObject(model),s=b.getSize(new THREE.Vector3());model.scale.set(size[0]/s.x,size[1]/s.y,size[2]/s.z);model.rotation.y=yaw;model.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(model),c=bounds.getCenter(new THREE.Vector3());model.position.set(p[0]-c.x,p[1]-bounds.min.y,p[2]-c.z);
  const resource=RESOURCE_DEFINITIONS.find(r=>r.asset===name);
  if(resource){model.scale.setScalar(1);model.position.set(0,0,0);placeResourceModel(THREE,model,resource);}
  if(name==='toiletSquare')openToiletLid(THREE,model);
  model.userData.resourceId=definition?.id;model.name=`kenney-${name}`;const materialCopies=new Map();model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;const convert=mat=>{if(mat.userData.naturalSurface)return mat;if(!materialCopies.has(mat))materialCopies.set(mat,naturalizeImportedMaterial(mat,definition?'food':name==='toiletSquare'?'ceramic':'cloth'));return materialCopies.get(mat);};o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material);}});parent.add(model);
 }));
 // Water sits below the porcelain rim; feet use the actual basin geometry.
 // Sanitary water is decorative, not an open drinking resource.
 const waterShape=new THREE.Shape();
 waterShape.moveTo(-.13,-.12);waterShape.lineTo(.13,-.12);waterShape.quadraticCurveTo(.15,-.12,.15,-.10);
 waterShape.lineTo(.15,.10);waterShape.quadraticCurveTo(.15,.12,.13,.12);waterShape.lineTo(-.13,.12);
 waterShape.quadraticCurveTo(-.15,.12,-.15,.10);waterShape.lineTo(-.15,-.10);waterShape.quadraticCurveTo(-.15,-.12,-.13,-.12);waterShape.closePath();
 const water=new THREE.Mesh(new THREE.ShapeGeometry(waterShape,12),new THREE.MeshPhysicalMaterial({color:0xa6b9ae,transparent:true,opacity:.40,roughness:.08,metalness:0,ior:1.333,side:THREE.DoubleSide,depthWrite:false}));
 water.name='Toilet_blue_water';water.rotation.x=-Math.PI/2;water.position.set(TOILET_BASIN.x,TOILET_BASIN.waterY,TOILET_BASIN.z);
 water.userData.collision=false;toilet.add(water);
 for(const [x,z,r]of [[-3.94,.48,.34],[-2.82,2.48,.40]])cylinder(r,r*.94,.025,[x,1.0375,z],m.pillow,feed,40);
}
