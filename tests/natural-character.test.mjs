import test from 'node:test';
import assert from 'node:assert/strict';
import {createMirrorGapCharacter} from '../public/character.mjs';
import {appearanceLabels,appearancePalette,naturalAppearanceFromSeed,NATURAL_APPEARANCE_SCHEMA} from '../public/companion-appearance.mjs';
import {appearanceFromSeed,createCompanion,adoptCompanion,validateCompanion} from '../public/companion-identity.mjs';
import {bodyMetrics} from '../public/body-metrics.mjs';

const seed='0123456789abcdef0123456789abcdef';
function inspect(root){
  const materials=new Set(),geometries=new Set(),parts=[];let triangles=0,visibleTriangles=0,meshes=0;
  root.traverse(object=>{
    if(!object.isMesh)return;meshes++;geometries.add(object.geometry);
    const count=(object.geometry.index?.count??object.geometry.attributes.position.count)/3;triangles+=count;
    let visible=true;for(let parent=object;parent;parent=parent.parent)visible&&=parent.visible;
    if(visible)visibleTriangles+=count;
    for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);
    parts.push(object.name,...object.userData.parts??[]);
  });
  return {materials,geometries,parts,triangles,visibleTriangles,meshes};
}
function geometryFingerprint(root){
  const values=[];root.traverse(object=>{if(object.isMesh)values.push([object.name,Array.from(object.geometry.attributes.position.array),object.material.name]);});return values;
}

test('natural phenotype is keyed, deterministic and preserves the legacy export and individual data',()=>{
  const companion=createCompanion({id:'01234567-89ab-cdef-0123-456789abcdef',seed,now:1000});adoptCompanion(companion,'小豆',2000);
  const before=structuredClone(companion),legacy=appearanceFromSeed(seed),a=appearancePalette(seed);
  assert.equal(a.schema,NATURAL_APPEARANCE_SCHEMA);for(const [key,value]of Object.entries(legacy))assert.equal(a[key],value);
  assert.deepEqual(naturalAppearanceFromSeed(seed),naturalAppearanceFromSeed(seed));
  assert.notDeepEqual(naturalAppearanceFromSeed(seed),naturalAppearanceFromSeed('f'.repeat(32)));
  for(let i=0;i<256;i++){
    const p=naturalAppearanceFromSeed(i.toString(16).padStart(32,'0'));
    assert.equal(p.metallic,0);assert.ok(p.shellHue>=.074&&p.shellHue<=.102);
    assert.ok(p.eyeHue>=.005&&p.eyeHue<=.027);assert.ok(p.wingOpacity>=.17&&p.wingOpacity<=.23);
    assert.ok(p.antennaLength>=.97&&p.antennaLength<=1.03);
  }
  assert.equal(appearanceLabels(seed).length,6);assert.equal(appearanceLabels(seed,true).length,6);
  assert.ok(appearanceLabels(seed).every(label=>!label.includes('核心')));
  validateCompanion(companion);assert.deepEqual(companion,before);
});

test('natural mesh contains real fine anatomy without emissive, metallic or core decorations',()=>{
  const c=createMirrorGapCharacter(seed);
  try{
    const {parts,materials,triangles,meshes}=inspect(c.root);
    for(const part of ['Continuous_mesothoracic_cuticle','Scutellum','Continuous_tapered_abdomen','Domed_hexagonal_cornea','Arista_branch','Paired_labellar_lobe','Coxa','Trochanter','Paired_adhesive_pad','Costal_wing_margin'])assert.ok(parts.includes(part),part);
    assert.equal(parts.filter(part=>part==='Haltere_knob').length,2);
    assert.equal(parts.filter(part=>part==='Ocellus').length,3);
    assert.equal(parts.filter(part=>part==='Thin_wing_membrane').length,2);
    assert.ok(c.root.userData.ommatidialCellsPerEye>=200);
    assert.ok(parts.every(part=>!/amber|cyan|fissure|obsidian|core_mount|neural_node|Personal_wing_ring/i.test(part)));
    for(const material of materials){if('metalness'in material)assert.equal(material.metalness,0);if(material.emissive)assert.equal(material.emissive.getHex(),0);}
    assert.ok(triangles<35000,`triangles=${triangles}`);assert.ok(meshes<90,`meshes=${meshes}`);assert.ok(materials.size<=12);
    assert.equal(c.root.userData.bodyLength,1.49);assert.equal(c.root.getObjectByName('Separate_head').position.z,.365);
    assert.equal(c.root.getObjectByName('Folded_proboscis').position.z,.184);
    const feet=[];c.root.traverse(object=>{if(object.userData.footLocal)feet.push(object.userData.footLocal);});assert.equal(feet.length,6);
  }finally{c.dispose();}
});

test('same natural seed produces the same actual geometry and materials',()=>{
  const a=createMirrorGapCharacter(seed),b=createMirrorGapCharacter(seed);
  try{
    assert.deepEqual(geometryFingerprint(a.root),geometryFingerprint(b.root));
    assert.deepEqual(a.root.userData.appearance,b.root.userData.appearance);
  }finally{a.dispose();b.dispose();}
});

test('microscopic detail has hysteresis and never changes pose, anchors or geometry',()=>{
  const c=createMirrorGapCharacter(seed);
  try{
    c.root.scale.setScalar(bodyMetrics(.019).characterScale);c.update({contact:false,mode:'travel',position:[0,3,0],velocity:[0,0,1]},.1);
    const pose=structuredClone(c.root.userData.pose),anchors=structuredClone(c.root.userData.rigAnchors),geometries=inspect(c.root).geometries;
    const near=inspect(c.root).visibleTriangles;c.setDetailByPixels(70);assert.equal(c.root.userData.detailLevel,'mid');const mid=inspect(c.root).visibleTriangles;
    c.setDetailByPixels(80);assert.equal(c.root.userData.detailLevel,'mid');c.setDetailByPixels(10);assert.equal(c.root.userData.detailLevel,'far');
    const far=inspect(c.root).visibleTriangles;assert.ok(near>mid&&mid>far);
    c.setDetailByPixels(23);assert.equal(c.root.userData.detailLevel,'far');c.setDetailByPixels(100);assert.equal(c.root.userData.detailLevel,'near');
    c.setDetailByPixels(NaN);assert.equal(c.root.userData.detailLevel,'near');assert.throws(()=>c.setDetailLevel('unknown'),RangeError);
    assert.deepEqual(c.root.userData.pose,pose);assert.deepEqual(c.root.userData.rigAnchors,anchors);assert.deepEqual(inspect(c.root).geometries,geometries);
  }finally{c.dispose();}
});

test('growth scales and all existing animation states remain finite and pause freezes joints',()=>{
  for(const bodyScale of [.019,.04,.048]){
    const c=createMirrorGapCharacter(seed);try{
      c.root.scale.setScalar(bodyMetrics(bodyScale).characterScale);c.root.position.set(0,.125*bodyScale,.75);
      for(const behavior of ['idle','walk','rest','groom','bathe','idle-groom','observe','play','toilet','flight']){
        for(let i=0;i<8;i++)c.update({behavior,bodyScale,position:c.root.position.toArray(),contact:behavior!=='flight',contactSeconds:4,mode:behavior==='flight'?'travel':'activity',velocity:behavior==='walk'?[.03,0,0]:[0,0,0],pitch:.1,bank:-.1},1/60);
        c.root.updateMatrixWorld(true);c.root.traverse(object=>assert.ok(object.matrixWorld.elements.every(Number.isFinite),object.name));
        assert.ok(Number.isFinite(c.root.userData.pose.bodyHeight));
      }
      const before=[];c.root.traverse(object=>before.push(object.matrixWorld.toArray()));c.update({contact:true},0);c.root.updateMatrixWorld(true);
      const after=[];c.root.traverse(object=>after.push(object.matrixWorld.toArray()));assert.deepEqual(after,before);
      c.update({contact:true,contactSeconds:4,action:'eat',feedingTarget:[NaN,0,0],velocity:[NaN,0,0]},.1);
      c.root.updateMatrixWorld(true);c.root.traverse(object=>assert.ok(object.matrixWorld.elements.every(Number.isFinite)));
    }finally{c.dispose();}
  }
});

test('natural textures, materials and geometries dispose once, including repeated disposal',()=>{
  const c=createMirrorGapCharacter(seed),resources=new Set(),counts=new Map();
  c.root.traverse(object=>{
    if(object.geometry)resources.add(object.geometry);
    for(const material of object.material?(Array.isArray(object.material)?object.material:[object.material]):[]){resources.add(material);for(const key of ['map','roughnessMap','bumpMap'])if(material[key])resources.add(material[key]);}
  });
  for(const resource of resources){counts.set(resource,0);resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)+1));}
  c.dispose();c.dispose();for(const [resource,count]of counts)assert.equal(count,1,resource.name||resource.type);
});
