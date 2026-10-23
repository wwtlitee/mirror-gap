import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {RESOURCE_BY_ID,createNaturalFoodModel,placeResourceModel} from '../public/resource-spec.mjs';
import {createDrinkingBowlGeometry} from '../public/habitat-model-detail.mjs';
import {FOOD_PROPS,FOOD_TOP} from '../public/habitat-layout.mjs';

test('banana rests inside its real ceramic fruit bowl without crossing the wall',()=>{
  const definition=RESOURCE_BY_ID.banana,dish=FOOD_PROPS.fruit;
  const banana=placeResourceModel(THREE,createNaturalFoodModel(THREE,definition,{geometryOnly:true}),definition);
  const bowl=new THREE.Mesh(createDrinkingBowlGeometry(dish.radius),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  bowl.position.set(dish.x,FOOD_TOP,dish.z);bowl.updateMatrixWorld(true);
  const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0);let smallestGap=Infinity;
  try{
    banana.traverse(mesh=>{
      if(!mesh.isMesh)return;
      const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
      for(let face=0;face<(index?.count??p.count);face+=3){
        const points=[0,1,2].map(offset=>new THREE.Vector3().fromBufferAttribute(p,index?index.getX(face+offset):face+offset).applyMatrix4(mesh.matrixWorld));
        const samples=[...points,points[0].clone().add(points[1]).add(points[2]).multiplyScalar(1/3)];
        for(const point of samples){
          assert.ok(Math.hypot(point.x-dish.x,point.z-dish.z)<dish.radius*.94,'fruit stays inside the inner rim');
          ray.set(new THREE.Vector3(point.x,FOOD_TOP+1,point.z),down);
          const hit=ray.intersectObject(bowl)[0];assert.ok(hit,'bowl supports the full banana footprint');
          const gap=point.y-hit.point.y;assert.ok(gap>=-1e-6,mesh.name+' must not penetrate the inner wall');
          smallestGap=Math.min(smallestGap,gap);
        }
      }
    });
    assert.ok(smallestGap<.002,'the fruit rests on the bowl instead of floating above it');
  }finally{
    banana.traverse(mesh=>{if(mesh.isMesh){mesh.geometry.dispose();mesh.material.dispose();}});
    bowl.geometry.dispose();bowl.material.dispose();
  }
});
