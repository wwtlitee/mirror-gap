import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const api=()=>import('../public/cue-training-markers.mjs');
test('the independent training room has a cue marker view',async()=>{
  let exists=false;try{exists=typeof (await api()).cueMarkerDescriptors==='function';}catch{}
  assert.equal(exists,true,'Player training cue markers are not implemented');
});
test('ordinary room snapshots never gain experiment cue graphics',async()=>{
  const {cueMarkerDescriptors}=await api();
  assert.deepEqual(cueMarkerDescriptors({neural:{learning:{cues:[{id:'cue-A',odor:'A',position:[1,2,3],strength:1,enabled:true}]}}}),[]);
});
test('active A and B markers preserve real source positions without modifying state',async()=>{
  const {cueMarkerDescriptors}=await api();
  const s={experiment:{id:'test'},neural:{learning:{cues:[
    {id:'cue-A',odor:'A',position:[1,2,3],strength:1,enabled:true},
    {id:'cue-B',odor:'B',position:[4,5,6],strength:.4,enabled:true},
  ]}}};
  const before=structuredClone(s),descriptors=cueMarkerDescriptors(s);
  assert.equal(descriptors.length,2);assert.notEqual(descriptors[0].color,descriptors[1].color);
  assert.deepEqual(descriptors[0].position,[1,2,3]);assert.equal(descriptors[0].label,'A');
  descriptors[0].position[0]=99;assert.deepEqual(s,before);
});
test('disabled, empty and malformed sources cannot produce misleading or nonfinite markers',async()=>{
  const {cueMarkerDescriptors}=await api();
  const s={experiment:{id:'test'},neural:{learning:{cues:[
    {id:'cue-off',odor:'A',position:[1,2,3],strength:1,enabled:false},
    {id:'cue-empty',odor:'B',position:[1,2,3],strength:0,enabled:true},
    {id:'cue-bad',odor:'A',position:[NaN,2,3],strength:1,enabled:true},
    {id:'looming',odor:'A',position:[1,2,3],strength:1,enabled:true},
  ]}}};
  assert.deepEqual(cueMarkerDescriptors(s),[]);
});
test('changing one emitter from A to B replaces its visible identity without leaking active markers',async()=>{
  const {createCueTrainingMarkers}=await api(),original=globalThis.document;
  globalThis.document={createElement:()=>({getContext:()=>null})};
  try{
    const parent=new THREE.Group(),view=createCueTrainingMarkers(parent);
    const s=odor=>({experiment:{id:'test'},neural:{learning:{cues:[{id:'cue-source',odor,position:[1,2,3],strength:1,enabled:true}]}}});
    view.update(s('A'));view.update(s('B'));
    const visible=parent.children[0].children.filter(group=>group.visible);
    assert.equal(visible.length,1);assert.equal(visible[0].children[0].material.color.getHex(),0xffc533);
    view.dispose();view.dispose();assert.equal(parent.children.length,0);
  }finally{if(original===undefined)delete globalThis.document;else globalThis.document=original;}
});
