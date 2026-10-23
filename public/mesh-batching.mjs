import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Keep articulated parents intact. Only immutable mesh children in one joint
// are combined, so antennae, six legs and two wings retain independent motion.
export function batchArticulatedMeshes(root) {
  const groups = [];
  root.traverse(object => { if (object.isGroup) groups.push(object); });
  const removed = new Set();
  let before = 0, after = 0;
  for (const parent of groups) {
    const batches = new Map();
    for (const child of parent.children) {
      if (!child.isMesh || Array.isArray(child.material)) continue;
      before++;
      const key = `${child.material.uuid}/${child.renderOrder}/${Object.keys(child.geometry.attributes).sort().join(',')}`;
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key).push(child);
    }
    for (const sources of batches.values()) {
      if (sources.length === 1) { after++; continue; }
      const geometries = sources.map(source => {
        source.updateMatrix();
        const geometry = source.geometry.index ? source.geometry.toNonIndexed() : source.geometry.clone();
        return geometry.applyMatrix4(source.matrix);
      });
      const geometry = mergeGeometries(geometries, false);
      geometries.forEach(g => g.dispose());
      if (!geometry) { after += sources.length; continue; }
      geometry.computeBoundingSphere(); geometry.computeBoundingBox();
      const mesh = new THREE.Mesh(geometry, sources[0].material);
      mesh.name = `${parent.name}_${sources[0].name}_batch`;
      mesh.renderOrder = sources[0].renderOrder;
      mesh.userData.parts = sources.map(source => source.name);
      parent.add(mesh);
      for (const source of sources) { removed.add(source.geometry); source.removeFromParent(); }
      after++;
    }
  }
  const retained = new Set(); root.traverse(o => { if (o.geometry) retained.add(o.geometry); });
  removed.forEach(g => { if (!retained.has(g)) g.dispose(); });
  return { before, after };
}
