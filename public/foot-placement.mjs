import {bodyMetrics} from './body-metrics.mjs';
import * as THREE from 'three';
import {surfaceBelow,meshClearance} from './collision-world.mjs';

// Two-bone IK places each tarsal endpoint on the rendered terrain. This affects
// joints only: it cannot pull the body along a route or supply neural propulsion.
export function placeFeet(root,body,legs,{walking,stride,grooming,time=0}){
 const m=bodyMetrics(root.scale.x/.22);
 root.updateMatrixWorld(true);const feet=[];
 for(const leg of legs){
  const {group,lower,side,index}=leg,baseKnee=lower.position.clone(),baseFoot=new THREE.Vector3(...lower.userData.footLocal);
  const lengthA=baseKnee.length(),lengthB=baseFoot.length(),maxReach=lengthA+lengthB;
  group.quaternion.identity();lower.quaternion.identity();group.updateWorldMatrix(false,false);lower.updateWorldMatrix(false,false);
  const hip=group.getWorldPosition(new THREE.Vector3()),natural=lower.localToWorld(baseFoot.clone());
  const phase=Math.sin(stride+(index%2===(side>0?0:1)?0:Math.PI)),swing=walking&&phase>0;
  let hit=null,target=null;
  for(const inset of [1,.80,.60,.35,0]){
   const x=root.position.x+(natural.x-root.position.x)*inset,z=root.position.z+(natural.z-root.position.z)*inset;
   const candidate=surfaceBelow(x,hip.y+m.footProbeAbove,z,.22*m.scale,m.scale);if(!candidate)continue;
   const local=body.worldToLocal(new THREE.Vector3(...candidate.position)).sub(group.position);
   if(local.length()>maxReach*.999||local.length()<Math.abs(lengthA-lengthB)+.002)continue;
   hit=candidate;target=new THREE.Vector3(...hit.position);break;
  }
  if(!target){leg.plant=null;feet.push({supported:false,swing:false,position:natural.toArray()});continue;}
  if(walking&&!swing&&leg.plant&&!leg.wasSwing){
   const local=body.worldToLocal(leg.plant.clone()).sub(group.position);
   if(local.length()<maxReach*.995)target.copy(leg.plant);
  }
  if(swing)target.y+=.012*m.scale*phase;
  leg.plant=target.clone();leg.wasSwing=swing;
  // Grooming lifts the forelegs intentionally; all other stance feet stay planted.
  if(grooming&&index===0){
   const cycle=time%4,stroke=Math.sin(time*14+side*.45);
   const local=cycle<2?new THREE.Vector3(side*(.22+.035*stroke),.09+.075*Math.cos(time*14),.465+.025*stroke)
     :cycle<3?new THREE.Vector3(side*(.018+.012*stroke),-.025,.50)
     :new THREE.Vector3(side*.06,.13+.04*stroke,.525);
   target.copy(body.localToWorld(local));
  }
  const goal=body.worldToLocal(target.clone()).sub(group.position),distance=Math.min(maxReach-.00001,goal.length());
  const direction=goal.clone().normalize(),along=(lengthA*lengthA-lengthB*lengthB+distance*distance)/(2*distance);
  const bend=baseKnee.clone().addScaledVector(direction,-baseKnee.dot(direction));
  if(bend.lengthSq()<1e-10)bend.set(side,0,0).addScaledVector(direction,-side*direction.x);
  bend.normalize();const knee=direction.clone().multiplyScalar(along).addScaledVector(bend,Math.sqrt(Math.max(0,lengthA*lengthA-along*along)));
  group.quaternion.setFromUnitVectors(baseKnee.clone().normalize(),knee.clone().normalize());
  const lowerGoal=goal.sub(knee).applyQuaternion(group.quaternion.clone().invert()).normalize();
  lower.quaternion.setFromUnitVectors(baseFoot.clone().normalize(),lowerGoal);group.updateWorldMatrix(false,false);lower.updateWorldMatrix(false,false);
  const actual=lower.localToWorld(baseFoot.clone()),clearance=meshClearance(actual.toArray(),.05*m.scale);
  feet.push({supported:true,swing:swing||grooming&&index===0,position:actual.toArray(),surface:hit.position,gap:clearance?.distance??null});
 }
 return feet;
}
