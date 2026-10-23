import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {RESOURCE_BY_ID,createResourceShape} from './resource-spec.mjs';
import {HABITAT_GROUND} from './habitat-ground.mjs';
import {naturalMaterial} from './natural-materials.mjs';
import {refineHabitatStoneModel,refineHabitatPalmModel,refineHabitatOrganicModel,createHabitatSoilMaterial,createHabitatSoilGeometry,createHabitatBarkMaterial} from './habitat-model-detail.mjs';

// Asset placements use a bottom anchor and a measured target size, never the
// source pack's arbitrary scale. The collision exporter sees these same meshes.
export const HABITAT_ASSETS=[
 ['rock_largeA',[4.96,.30,-.10],[1.1,1.65,1.25],.4],
 ['rock_largeC',[4.90,.30,1.00],[1.15,.94,1.20],-.5],
 ['rock_smallFlatA',[4.26,.30,1.57],[1.25,.44,.94],.35],
 ['rock_smallFlatA',[3.65,.30,2.03],[.9,.22,.8],-.3],
 ['rock_smallE',[5.15,.30,2.13],[.47,.40,.58],1.3],
 ['tree_palmDetailedShort',[3.63,.30,-.04],[1.87,2.35,1.68],.3],
 ['log',[3.50,.30,1.19],[1.40,.32,.43],.72],
 ['plant_bushDetailed',[5.04,.30,-.70],[.58,.60,.45],.3],
 ['plant_bushDetailed',[2.97,.30,.76],[.47,.46,.65],-.5],
 ['plant_bushDetailed',[5.21,.30,1.63],[.43,.56,.48],.7],
 ['grass_leafsLarge',[3.43,.30,-.44],[.43,.62,.51],1.0],
 ['grass_leafsLarge',[3.07,.30,2.50],[.48,.66,.56],.1],
 ['grass_leafsLarge',[3.60,.30,3.61],[.54,.43,.39],.6],
 ['grass_leafsLarge',[5.15,.30,3.61],[.40,.50,.34],1.1],
 ['grass_large',[3.09,.30,1.58],[.30,.34,.47],1.3],
 ['grass_large',[4.2,.30,-.57],[.40,.34,.31],0],
 ['plant_bushDetailed',[4.43,.30,-.49],[.56,.54,.40],.4],
 ['plant_bushDetailed',[3.07,.30,.20],[.40,.36,.47],1.2],
 ['plant_bushDetailed',[3.11,.30,3.48],[.50,.40,.51],.9],
 ['plant_bushDetailed',[5.25,.30,2.74],[.32,.41,.39],.2],
 ['grass_leafsLarge',[4.06,.30,2.29],[.38,.41,.39],.2],
 ['grass_leafsLarge',[3.80,.30,.08],[.40,.43,.36],.8],
 ['mushroom_tanGroup',[3.98,.30,.51],[.40,.30,.38],.2],
 ['mushroom_tanGroup',[2.94,.30,1.97],[.23,.20,.28],.6],
 ['lily_large',[4.84,.331,3.34],[.26,.038,.24],.7],
 ['lily_large',[4.23,.331,3.39],[.22,.033,.23],-.2],
];
export async function buildOpenHabitat({THREE,box,cylinder,sphere,addMesh,material:m,groups:{entry,perch}}){
 const loader=new GLTFLoader(),models=new Map();
 await Promise.all([...new Set(HABITAT_ASSETS.map(a=>a[0]))].map(async name=>models.set(name,(await loader.loadAsync(`/assets/kenney-nature/${name}.glb`)).scene)));
 const surfaces=new Map();
 const sourceMaterial=(mat,assetName)=>{
  if(surfaces.has(mat))return surfaces.get(mat);
  // Kenney rocks name their flat upper primitive "grass". Both primitives
  // belong to the stone, so that historical name must not select leaf albedo.
  const name=mat.name,kind=assetName.startsWith('rock_')?'stone':/leaf|grass/i.test(name)?'leaf':assetName.startsWith('tree_')?'bark':/wood/i.test(name)?'wood':'stone';
  const color=kind==='leaf'?0xadc586:kind==='bark'?0x9b8970:kind==='wood'?(/Inner/.test(name)?0xdcc8a0:0x887259):0xb0b2a6;
  const material=kind==='bark'?createHabitatBarkMaterial(color):naturalMaterial(kind,{color,roughness:kind==='leaf'?.66:kind==='wood'?.91:.94,bumpScale:kind==='stone'?.0025:kind==='wood'?.002:.0008,vertexColors:kind==='stone'});
  material.name=`Habitat_${name}_${kind}`;surfaces.set(mat,material);return material;
 };
 const rebuiltOrganic=new Set(['plant_bushDetailed','grass_leafsLarge','grass_large','mushroom_tanGroup','lily_large','log']);
 for(const [name,model]of models)if(!rebuiltOrganic.has(name))model.traverse(o=>{if(o.isMesh)o.material=Array.isArray(o.material)?o.material.map(mat=>sourceMaterial(mat,name)):sourceMaterial(o.material,name);});
 // Build closed rounded stones once; every placed rock and river pebble shares
 // the same limestone surface, authored extent, footprint and support height.
 for(const [name,model]of models)if(name.startsWith('rock_'))refineHabitatStoneModel(model);
 refineHabitatPalmModel(models.get('tree_palmDetailedShort'));
 for(const [name,model]of models)models.set(name,refineHabitatOrganicModel(model,name));
 const earth=createHabitatSoilMaterial(0x55452f),wetEarth=createHabitatSoilMaterial(0x3f422c,true);
 // A low continuous tray reads as a miniature landscape, with no enclosing glass.
 for(const slab of HABITAT_GROUND){
  const mesh=box(slab.size,slab.position,slab.material==='base'?m.darkWood:slab.zone==='entry'?wetEarth:earth,slab.zone==='entry'?entry:perch);
  // The shallow pool keeps the exact authored .300 floor. Its closed ground
  // volume supports the resident there; recessing that visible floor would
  // leave a gap between the body solver and the real mesh contact surface.
  if(slab.material!=='base'&&slab.zone!=='entry'){mesh.geometry.dispose();mesh.geometry=createHabitatSoilGeometry(slab.size);}
  mesh.name=slab.id==='habitat-base'?'Habitat_walnut_landscape_tray':slab.zone==='entry'?'Habitat_moist_granular_bank':'Habitat_dry_granular_soil';
 }
 // Real vertical timber boards stay inside the original base bounds. Their
 // end joints make the tray a constructed object without changing support.
 const trim=naturalMaterial('wood',{color:0x9d805f,roughness:.78});
 for(const z of [-.9,3.98])box([2.88,.112,.02],[4.13,.145,z],trim,z>2.3?entry:perch).name='Habitat_tray_crossgrain_endboard';
 for(const x of [2.70,5.56])box([.018,.112,4.87],[x,.145,1.54],trim,perch).name='Habitat_tray_longgrain_sideboard';
 for(const [name,position,size,angle]of HABITAT_ASSETS){
  const model=models.get(name).clone(true);model.rotation.y=angle;model.updateMatrixWorld(true);
  let bounds=new THREE.Box3().setFromObject(model),extent=bounds.getSize(new THREE.Vector3());
  model.scale.set(size[0]/extent.x,size[1]/extent.y,size[2]/extent.z);model.updateMatrixWorld(true);
  bounds=new THREE.Box3().setFromObject(model);const centre=bounds.getCenter(new THREE.Vector3());
  model.position.set(position[0]-centre.x,position[1]-bounds.min.y,position[2]-centre.z);
  model.name=`kenney-${name}`;model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  (position[2]>2.3?entry:perch).add(model);
 }
 const pool=createResourceShape(THREE,RESOURCE_BY_ID['shallow-pool'],{surface:m.water});entry.add(pool);
 pool.traverse(o=>{o.castShadow=false;o.userData.collision=false;}); // The soil supports the shallow liquid.
 for(let i=0;i<17;i++){
  const a=i/17*Math.PI*2,r=.83+.025*Math.sin(i*3.7);
  const rock=models.get('rock_smallFlatA').clone(true),b=new THREE.Box3().setFromObject(rock),size=b.getSize(new THREE.Vector3());
  rock.scale.set(.15/size.x,.07/size.y,.13/size.z);rock.rotation.y=i*.83;rock.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(rock),c=bounds.getCenter(new THREE.Vector3());
  rock.position.set(4.5+Math.cos(a)*r-c.x,.30-bounds.min.y,3.1+Math.sin(a)*.69-c.z);rock.name='river-pebble';
  rock.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});entry.add(rock);
 }
}
