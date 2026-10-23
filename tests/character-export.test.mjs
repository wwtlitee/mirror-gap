import test from 'node:test';
import assert from 'node:assert/strict';
import {createMirrorGapCharacter} from '../public/character.mjs';
import {createCharacterExportClone,disposeCharacterExportClone} from '../public/character-export.mjs';

const createCanvas=()=>{const context={createImageData:(width,height)=>({data:new Uint8ClampedArray(width*height*4)}),putImageData(pixels){this.pixels=pixels;}};return {context,getContext:()=>context};};

function visibleTriangles(root){
  let triangles=0;
  root.traverseVisible(object=>{if(object.isMesh)triangles+=(object.geometry.index?.count??object.geometry.attributes.position.count)/3;});
  return triangles;
}
function snapshot(root){
  const result=[];
  root.traverse(object=>result.push({name:object.name,visible:object.visible,position:object.position.toArray(),quaternion:object.quaternion.toArray(),scale:object.scale.toArray(),userData:structuredClone(object.userData)}));
  return result;
}

test('far-view export keeps full anatomy and compatible skin maps without changing live resources',()=>{
  const character=createMirrorGapCharacter('0123456789abcdef0123456789abcdef');let model=null;
  try{
    character.root.position.set(1,.4,2);character.root.rotation.y=.7;
    character.update({position:[1,.4,2],contact:true,contactSeconds:4,behavior:'idle',velocity:[0,0,0]},.1);
    const nearTriangles=visibleTriangles(character.root);
    character.setDetailLevel('far');
    const farTriangles=visibleTriangles(character.root),before=snapshot(character.root);
    assert.ok(farTriangles<nearTriangles);
    const originals=new Set();character.root.traverse(object=>{if(object.material)for(const material of Array.isArray(object.material)?object.material:[object.material])originals.add(material);});
    const sourceTexture=[...originals].find(material=>material.roughnessMap)?.roughnessMap,sourceVersion=sourceTexture.source.version;
    const sourceObjects=[];character.root.traverse(object=>sourceObjects.push(object));
    model=createCharacterExportClone(character.root,{createCanvas});
    assert.equal(visibleTriangles(model),nearTriangles);
    let restoredGroups=0,index=0;const copies=new Set(),temporaryTextures=new Set();
    model.traverse(object=>{
      const source=sourceObjects[index++],detail=object!==model&&object.isGroup&&['near','mid'].includes(object.userData.detailLevel);
      assert.equal(object.visible,detail?true:source.visible,object.name);
      if(detail)restoredGroups++;
      if(object.name==='Non_anatomical_motion_afterimages'||object.name.startsWith('Sleep_Z_'))assert.equal(object.visible,false,object.name);
      if(object.material)for(const material of Array.isArray(object.material)?object.material:[object.material])if(!originals.has(material)){copies.add(material);assert.equal(material.metalness,0);assert.equal(material.metalnessMap,null);assert.equal(material.roughnessMap.isCanvasTexture,true);assert.equal(material.bumpMap,material.roughnessMap);temporaryTextures.add(material.roughnessMap);}
    });
    assert.ok(restoredGroups>=10);
    assert.deepEqual(snapshot(character.root),before);
    assert.equal(character.root.userData.detailLevel,'far');
    assert.equal(visibleTriangles(character.root),farTriangles);
    assert.deepEqual(model.position.toArray(),character.root.position.toArray());
    assert.equal(copies.size,2);
    assert.equal(temporaryTextures.size,1);
    const exportTexture=[...temporaryTextures][0];
    for(const property of ['colorSpace','flipY','wrapS','wrapT','minFilter','magFilter','generateMipmaps','channel'])assert.equal(exportTexture[property],sourceTexture[property],property);
    assert.deepEqual(exportTexture.repeat.toArray(),sourceTexture.repeat.toArray());
    assert.deepEqual(Array.from(exportTexture.image.context.pixels.data),Array.from(sourceTexture.image.data));
    assert.equal(sourceTexture.source.version,sourceVersion);
    for(const material of originals)if(material.roughnessMap?.isDataTexture)assert.equal(material.metalnessMap,null);
    let copyDisposals=0,textureDisposals=0,sourceDisposals=0;
    for(const material of copies)material.addEventListener('dispose',()=>copyDisposals++);
    for(const material of originals)material.addEventListener('dispose',()=>sourceDisposals++);
    for(const texture of temporaryTextures)texture.addEventListener('dispose',()=>textureDisposals++);
    sourceTexture.addEventListener('dispose',()=>sourceDisposals++);
    disposeCharacterExportClone(model);disposeCharacterExportClone(model);
    assert.equal(copyDisposals,2);assert.equal(textureDisposals,1);assert.equal(sourceDisposals,0);
  }finally{if(model)disposeCharacterExportClone(model);character.dispose();}
});
