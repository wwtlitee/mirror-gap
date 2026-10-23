import * as THREE from 'three';
import {ZONES} from './world-spec.mjs';

// Bake the final world transforms, including individual instanced leaves and
// imported GLB children. No furniture-sized AABB replaces the actual surfaces.
export function collectCollisionGeometry(root){
 root.updateMatrixWorld(true);
 const faces=[],objects=[],matrix=new THREE.Matrix4(),world=new THREE.Matrix4(),v=new THREE.Vector3();
 root.traverse(mesh=>{
  if(!mesh.isMesh||mesh.userData.collision===false||!mesh.visible)return;
  const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];
  if(mats.every(m=>m.colorWrite===false||m.transparent&&m.opacity<.15))return;
  let owner=mesh;while(owner&&!owner.userData.zoneId)owner=owner.parent;
  const zone=owner?.userData.zoneId??'flight',z=ZONES.findIndex(v=>v.id===zone),start=faces.length/10;
  const geometry=mesh.geometry,p=geometry.attributes.position,index=geometry.index,count=index?index.count:p.count;
  const instances=mesh.isInstancedMesh?mesh.count:1;
  for(let n=0;n<instances;n++){
   if(mesh.isInstancedMesh){mesh.getMatrixAt(n,matrix);world.multiplyMatrices(mesh.matrixWorld,matrix);}else world.copy(mesh.matrixWorld);
   for(let i=0;i<count;i+=3){const points=[];
    for(let k=0;k<3;k++){v.fromBufferAttribute(p,index?index.getX(i+k):i+k).applyMatrix4(world);points.push(v.x,v.y,v.z);}
    const a=new THREE.Vector3(...points.slice(0,3)),b=new THREE.Vector3(...points.slice(3,6)),c=new THREE.Vector3(...points.slice(6,9));
    if(b.sub(a).cross(c.sub(a)).lengthSq()<1e-12)continue;
    faces.push(...points,z+(mesh.userData.foodTag??0)*ZONES.length);
   }
  }
  objects.push({name:mesh.name||mesh.geometry.type,zone,triangles:faces.length/10-start});
 });
 return {faces,objects};
}
