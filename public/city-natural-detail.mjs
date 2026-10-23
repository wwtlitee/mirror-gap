import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Detail belongs to the existing tree: all pieces are merged into the two
// shared street materials, with no extra objects, lights or collision volumes.
export function createDetailedStreetTree(tree, index = 0) {
  if (![tree?.x,tree?.z].every(Number.isFinite) || tree.x===0) throw new RangeError('Street trees require finite authored sidewalk coordinates');
  const scale = Number.isFinite(tree.scale) && tree.scale > 0 ? tree.scale : 1;
  const x = Math.sign(tree.x) * 34.5, z = tree.z, radius = 2.1 * scale;
  const bark = [], foliage = [];
  const cap = (curve,radius,sides,t) => {
    const geometry=new THREE.CircleGeometry(radius,sides),normal=curve.getTangentAt(t).multiplyScalar(t===0?-1:1);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),normal));
    geometry.translate(...curve.getPointAt(t).toArray());
    bark.push(geometry.toNonIndexed()); geometry.dispose();
  };
  const trunkPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(x, 1.2, z), new THREE.Vector3(x + .06, 2.4, z + .03),
    new THREE.Vector3(x - .04, 3.8, z - .035), new THREE.Vector3(x, 5.3, z),
  ]);
  const trunk = new THREE.TubeGeometry(trunkPath, 18, .15, 10, false);
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const row = Math.floor(i / 11), t = row / 18, centre = trunkPath.getPointAt(t);
    const taper = 1.18 - t * .59;
    const grain = 1 + .065 * Math.sin(i % 11 * 2.31 + t * 37);
    tp.setXYZ(i, centre.x + (tp.getX(i) - centre.x) * taper * grain, tp.getY(i), centre.z + (tp.getZ(i) - centre.z) * taper * grain);
  }
  trunk.computeVertexNormals(); bark.push(trunk.toNonIndexed()); trunk.dispose();
  cap(trunkPath,.177,10,0);cap(trunkPath,.0885,10,1);
  for (let branch = 0; branch < 6; branch++) {
    const angle = branch * Math.PI / 3 + index * .37;
    const start = new THREE.Vector3(x, 3.55 + branch % 2 * .28, z);
    const end = new THREE.Vector3(x + Math.cos(angle) * radius * .64, 5.15 + branch % 3 * .18, z + Math.sin(angle) * radius * .64);
    const middle = start.clone().lerp(end, .52); middle.y += .24;
    const branchPath = new THREE.CatmullRomCurve3([start, middle, end]);
    const geometry = new THREE.TubeGeometry(branchPath, 7, .05, 6, false);
    bark.push(geometry.toNonIndexed()); geometry.dispose();
    cap(branchPath,.05,6,0);cap(branchPath,.05,6,1);
  }
  // Overlapping irregular lobes replace a single faceted primitive. The outer
  // footprint, crown centre and muted plum palette remain authored values.
  for (let lobe = 0; lobe < 11; lobe++) {
    const angle = lobe * 2.399963 + index * .31;
    const ring = lobe === 0 ? 0 : .57;
    const geometry = new THREE.SphereGeometry(1, 12, 8), p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
      const relief = 1 + .045 * Math.sin(vx * 13 + vy * 8 + lobe) * Math.cos(vz * 11 - vy * 6);
      p.setXYZ(i, vx * relief, vy * relief, vz * relief);
    }
    geometry.computeVertexNormals();
    const size = radius * (lobe === 0 ? .58 : .44 + lobe % 3 * .015);
    geometry.scale(size, size * .66, size);
    geometry.translate(x + Math.cos(angle) * radius * ring, 5.3 + (lobe % 3 - 1) * radius * .22, z + Math.sin(angle) * radius * ring);
    const shade = new THREE.Color(0xffffff).multiplyScalar(.82 + lobe % 4 * .085);
    const colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) colors.set(shade.toArray(), i * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    foliage.push(geometry.toNonIndexed()); geometry.dispose();
  }
  const merge = pieces => { const geometry = mergeGeometries(pieces, false); pieces.forEach(piece => piece.dispose()); return geometry; };
  const crown=merge(foliage),authored=new THREE.IcosahedronGeometry(radius,0);
  authored.scale(1,.75,1); authored.translate(x,5.3,z);
  authored.computeBoundingBox(); crown.computeBoundingBox();
  const before=crown.boundingBox.clone(),target=authored.boundingBox,extent=before.getSize(new THREE.Vector3()),wanted=target.getSize(new THREE.Vector3()),p=crown.attributes.position;
  for(let i=0;i<p.count;i++)for(let axis=0;axis<3;axis++)p.array[i*3+axis]=target.min.getComponent(axis)+(p.array[i*3+axis]-before.min.getComponent(axis))/extent.getComponent(axis)*wanted.getComponent(axis);
  crown.computeVertexNormals(); crown.computeBoundingBox(); authored.dispose();
  return {bark:merge(bark), foliage:crown, detail:'tapered-bark-six-branches-eleven-irregular-crown-lobes'};
}
