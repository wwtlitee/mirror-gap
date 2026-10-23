import test from 'node:test';import assert from 'node:assert/strict';
import{collisionInfo,meshClearance,surfaceBelow,supportedFeet}from '../public/collision-world.mjs';
import{moveBody}from '../public/environment-spec.mjs';
import{createMirrorGapCharacter}from '../public/character.mjs';
const supports={floor:[0,.3,.75],desk:[-2,1.7,-3.2],window:[3.1,1.6,-3.88],bookcase:[-4.93,1.4,2.1],bed:[-4.35,1.4,-2.15],food:[-2.82,1.5,2.48],wetland:[4.5,.6,3.1],rock:[4.96,2.2,-.1]};
function land(p){p=[...p];for(let i=0;i<130;i++)moveBody(p,[0,-.3,0],.02,0);return p;}
test('final room mesh includes small objects; sphere support follows actual geometry',()=>{
 // v8.1.0c adds all seven detailed foods, fixtures and ecology to the same
 // physical mesh. Retain full float precision and an explicit 20 MB ceiling;
 // exact BVH-ray equivalence and real runtime checks cover the larger scope.
 assert.ok(collisionInfo.triangles>50000&&collisionInfo.triangles<500000);assert.ok(collisionInfo.bytes<20e6);assert.equal(collisionInfo.precision,.000001);
 for(const [name,p]of Object.entries(supports)){const point=land(p),hit=meshClearance(point,.1);assert.ok(hit&&hit.distance>=.083,`${name} not penetrating`);assert.equal(supportedFeet(point),6,name);}
});
test('six standing tarsi touch real surfaces in every region, including curved bedding and rocks',()=>{
 for(const [name,p]of Object.entries(supports)){
  const c=createMirrorGapCharacter();try{c.root.scale.setScalar(.22);c.root.position.set(...land(p));c.update({contact:true,contactSeconds:4,mode:'activity',behavior:'inspect',velocity:[0,0,0]},.1);
   const feet=c.root.userData.pose.feet;assert.equal(feet.length,6);assert.ok(feet.every(f=>f.supported&&f.gap<.002),`${name}: ${JSON.stringify(feet)}`);
  }finally{c.dispose();}
 }
});
test('walking alternates grounded tripod and lifted feet; paused joints do not drift',()=>{
 const c=createMirrorGapCharacter();try{c.root.scale.setScalar(.22);c.root.position.set(...land(supports.window));
  const a={contact:true,contactSeconds:4,mode:'activity',behavior:'walk',velocity:[.12,0,0]};c.update(a,.08);
  const feet=c.root.userData.pose.feet;assert.equal(feet.filter(f=>f.swing).length,3);assert.ok(feet.filter(f=>!f.swing).every(f=>f.supported&&f.gap<.002));const before=structuredClone(c.root.userData.pose);c.update(a,0);assert.deepEqual(c.root.userData.pose,before);
 }finally{c.dispose();}
});
test('old floating bookshelf location has no support and the open ecology has no glass wall',()=>{
 assert.equal(supportedFeet([-5.03,1.615,.2]),0);
 const p=[2.4,2.7,2.9];moveBody(p,[1,0,0],.6,0);assert.ok(p[0]>2.95);
 assert.equal(surfaceBelow(0,3,0,.2),null);
});
