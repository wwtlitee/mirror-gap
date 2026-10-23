import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildInteriorRefinement} from '../public/interior-refinement.mjs';

const palette=()=>Object.fromEntries(['dark','wood','darkWood','bronze','gold','fabric','pillow'].map(name=>[name,new THREE.MeshStandardMaterial({name})]));
const add=(group,geometry,material,position)=>{const mesh=new THREE.Mesh(geometry,material);mesh.position.set(...position);group.add(mesh);return mesh;};
const extruded=()=>new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0,0),new THREE.Vector2(1,0),new THREE.Vector2(1,1)]),{depth:.01,bevelEnabled:false});

test('desk keyboard and notebook rest on the real beveled tabletop without buried cases',()=>{
 const material=palette(),work=new THREE.Group();
 add(work,extruded(),material.dark,[-1.15,1.34,-3.17]);
 for(const side of [-1,1])add(work,new THREE.BoxGeometry(.31,.018,.43),material.pillow,[-1.97+side*.16,1.365,-3.25]);
 buildInteriorRefinement({material,groups:{work}});work.updateMatrixWorld(true);
 for(const name of ['Keyboard_lower_case','Notebook_flexible_cover']){
  const bottom=new THREE.Box3().setFromObject(work.getObjectByName(name),true).min.y;
  assert.ok(Math.abs(bottom-1.355)<1e-6,`${name} must meet the tabletop at 1.355`);
 }
 assert.equal(work.children.filter(mesh=>mesh.name==='Keyboard_sculpted_keycap').length,30);
 for(const cap of work.children.filter(mesh=>mesh.name==='Keyboard_sculpted_keycap'))assert.ok(new THREE.Box3().setFromObject(cap,true).max.y<=1.428,'key tops retain the delivered supported stance');
});

test('standing books keep all seven instances and place real page layers across book thickness',()=>{
 const material=palette(),architecture=new THREE.Group();
 for(let i=0;i<7;i++)add(architecture,new THREE.BoxGeometry(.18,.75,.45),material.wood,[-2.65+i*.22,.575,3.96]);
 buildInteriorRefinement({material,groups:{architecture}});
 const pages=[];architecture.traverse(mesh=>{if(mesh.name==='Standing_book_page_edges')pages.push(mesh);});
 assert.equal(pages.length,7);
 for(const mesh of pages){
  const p=mesh.geometry.attributes.position,top=[];
  for(let i=0;i<p.count;i++)if(p.getY(i)>.36)top.push([p.getX(i),p.getY(i)]);
  assert.ok(new Set(top.map(([x])=>x.toFixed(5))).size>20,'page sheets stack across X');
  assert.ok(Math.max(...top.map(([,y])=>y))-Math.min(...top.map(([,y])=>y))>.001,'top paper edges have shallow real steps');
 }
});
