import * as DefaultTHREE from 'three';
import { MECHANICAL_FLY_RADIUS } from './mechanical-fly.mjs';

const KINDS = new Set(['supply', 'delivery', 'relay', 'charge', 'checkpoint']);
const validPosition = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
const validId = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 128;

export function horizontalControlBasis(camera){
  if(!camera?.isCamera)throw new TypeError('A camera is required for horizontal controls');
  const direction=camera.getWorldDirection(new DefaultTHREE.Vector3());
  const length=Math.hypot(direction.x,direction.z);
  const forward=length>1e-6?[direction.x/length,direction.z/length]:[0,-1];
  return {forward,right:[-forward[1],forward[0]]};
}

function resourceScope(THREE) {
  const geometries = new Set(), materials = new Set();
  function material(options) { const value = new THREE.MeshStandardMaterial(options); materials.add(value); return value; }
  function mesh(root, geometry, mat, position = [0, 0, 0], name = '') {
    geometries.add(geometry);
    const value = new THREE.Mesh(geometry, mat);
    value.position.set(...position); value.name = name; root.add(value);
    return value;
  }
  function rod(root, from, to, radius, mat, name = '') {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a);
    const value = mesh(root, new THREE.CylinderGeometry(radius, radius, direction.length(), 6), mat, a.add(b).multiplyScalar(.5).toArray(), name);
    value.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return value;
  }
  function dispose() { geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); geometries.clear(); materials.clear(); }
  return { material, mesh, rod, dispose };
}

function makeRobot(THREE) {
  const resources = resourceScope(THREE), { mesh, rod, material } = resources;
  const root = new THREE.Group(); root.name = 'TapeOut_mechanical_fly';
  const metal = material({ color: 0x4b5b66, metalness: .85, roughness: .27 });
  const silver = material({ color: 0xb6cbd1, metalness: .8, roughness: .2 });
  const wire = material({ color: 0xffb65b, emissive: 0xff7b23, emissiveIntensity: .8, metalness: .35, roughness: .3 });
  const glass = material({ color: 0xb5ecf2, transparent: true, opacity: .55, metalness: .25, roughness: .12, side: THREE.DoubleSide, depthWrite: false });
  const body = mesh(root, new THREE.SphereGeometry(.021, 14, 10), metal, [0, 0, 0], 'Mechanical_body'); body.scale.set(.78, .72, 1.45);
  const abdomen = mesh(root, new THREE.SphereGeometry(.017, 12, 8), silver, [0, -.001, -.036]); abdomen.scale.set(.72, .65, 1.4);
  mesh(root, new THREE.SphereGeometry(.017, 12, 8), metal, [0, .003, .034], 'Mechanical_head');
  for (const x of [-.01, .01]) mesh(root, new THREE.SphereGeometry(.0055, 8, 6), wire, [x, .008, .046]);
  const lampMaterial = material({ color: 0xfff0c5, emissive: 0xffc15c, emissiveIntensity: 2.4, metalness: .2, roughness: .1 });
  mesh(root, new THREE.SphereGeometry(.006, 10, 7), lampMaterial, [0, .005, .05], 'Mechanical_headlamp');
  rod(root, [0, .018, .025], [0, .019, -.047], .0014, wire, 'Mechanical_circuit_spine');
  const wings = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.name = side < 0 ? 'Mechanical_wing_left' : 'Mechanical_wing_right';
    pivot.position.set(side * .012, .013, -.004); root.add(pivot);
    const surface = mesh(pivot, new THREE.SphereGeometry(1, 14, 7), glass, [side * .031, 0, -.007]); surface.scale.set(.039, .0009, .017);
    rod(pivot, [0, 0, 0], [side * .063, 0, -.014], .00065, silver);
    rod(pivot, [side * .012, 0, -.002], [side * .052, 0, -.02], .00045, wire);
    wings.push(pivot);
    for (const index of [-1, 0, 1]) {
      const from = [side * .014, -.008, index * .018];
      const knee = [side * .033, -.018, index * .024];
      rod(root, from, knee, .0018, metal);
      rod(root, knee, [side * .041, -.03, index * .03], .0011, silver);
    }
  }
  const slot = new THREE.Group(); slot.name = 'Mechanical_cargo_slot'; slot.position.set(0, -.022, -.008); root.add(slot);
  const slotRing = mesh(slot, new THREE.TorusGeometry(.013, .0015, 5, 14), silver); slotRing.rotation.x = Math.PI / 2;
  const cargo = mesh(slot, new THREE.BoxGeometry(.018, .014, .022), wire, [0, -.005, 0], 'Mechanical_cargo'); cargo.visible = false;
  const signalMaterial = material({ color: 0x64cfff, emissive: 0x229fe0, emissiveIntensity: 1, transparent: true, opacity: .7, depthWrite: false });
  const signal = mesh(root, new THREE.TorusGeometry(.03, .0012, 5, 24), signalMaterial, [0, .026, 0], 'Mechanical_signal'); signal.rotation.x = Math.PI / 2; signal.visible = false;
  return { root, wings, cargo, signal, signalMaterial, lampMaterial, dispose: resources.dispose };
}

function makeNode(THREE, descriptor) {
  const resources = resourceScope(THREE), { material, mesh, rod } = resources;
  const root = new THREE.Group(); root.name = `Coop_node_${descriptor.id}`;
  const colors = { supply: 0xffba64, delivery: 0x6be7c8, relay: 0x74bfff, charge: 0xffdb74, checkpoint: 0xb2b5ff };
  const metal = material({ color: 0x526779, metalness: .75, roughness: .3 });
  const accent = material({ color: colors[descriptor.kind], emissive: colors[descriptor.kind], emissiveIntensity: .6, metalness: .3, roughness: .25 });
  const ring = (radius, y) => { const value = mesh(root, new THREE.TorusGeometry(radius, .003, 6, 24), accent, [0, y, 0]); value.rotation.x = Math.PI / 2; return value; };
  if (descriptor.kind === 'supply') {
    const box = mesh(root, new THREE.BoxGeometry(.038, .034, .046), metal, [0, 0, 0]); box.rotation.y = Math.PI / 4;
    mesh(root, new THREE.BoxGeometry(.012, .038, .05), accent); ring(.037, -.018);
  } else if (descriptor.kind === 'relay') {
    mesh(root, new THREE.CylinderGeometry(.035, .044, .012, 12), metal, [0, -.005, 0]);
    rod(root, [0, 0, 0], [0, .09, 0], .006, metal);
    mesh(root, new THREE.OctahedronGeometry(.021), accent, [0, .09, 0]);
    const hoop = ring(.033, .09); hoop.rotation.x = 0;
  } else if (descriptor.kind === 'checkpoint') {
    mesh(root, new THREE.CylinderGeometry(.065, .072, .012, 14), metal);
    const hoop = mesh(root, new THREE.TorusGeometry(.06, .004, 6, 28), accent, [0, .07, 0]); hoop.rotation.y = Math.PI / 6;
    rod(root, [0, 0, 0], [0, .07, 0], .004, metal);
  } else {
    const radius = descriptor.kind === 'charge' ? .075 : .09;
    mesh(root, new THREE.CylinderGeometry(radius, radius * 1.08, .01, descriptor.kind === 'charge' ? 6 : 20), metal, [0, -.005, 0]);
    ring(radius * .85, .003);
    if (descriptor.kind === 'charge') {
      rod(root, [-.02, .007, -.02], [.008, .007, 0], .004, accent);
      rod(root, [.008, .007, 0], [-.005, .007, .005], .004, accent);
      rod(root, [-.005, .007, .005], [.02, .007, .025], .004, accent);
    } else for (const x of [-1, 1]) for (const z of [-1, 1]) mesh(root, new THREE.BoxGeometry(.01, .022, .01), accent, [x * .055, .012, z * .055]);
  }
  if(descriptor.kind==='charge')for(const child of root.children)child.position.y-=.055;
  return { root, accent, dispose: resources.dispose };
}

/** Dynamic visual authority only; scene nodes never become static collision geometry. */
export function createMechanicalView({ THREE = DefaultTHREE, parent } = {}) {
  if (!parent || typeof parent.add !== 'function') throw new TypeError('Mechanical view requires a dynamic parent');
  const root = new THREE.Group(); root.name = 'Cooperative_dynamic_objects'; root.visible = false; parent.add(root);
  const robot = makeRobot(THREE); root.add(robot.root);
  const nodes = new Map();
  let elapsed = 0, disposed = false, followTarget = null, signal = 'off';
  function update(coop, delta = 0) {
    if (disposed) return;
    const mechanical = coop?.mechanical;
    const valid = validPosition(mechanical?.position) && validPosition(mechanical?.velocity) && Number.isFinite(mechanical?.yaw) && Number.isFinite(mechanical?.battery);
    root.visible = valid;
    if (!valid) { followTarget = null; return; }
    const dt = Number.isFinite(delta) ? Math.max(0, Math.min(.1, delta)) : 0;
    elapsed += dt;
    robot.root.position.set(...mechanical.position); robot.root.rotation.y = mechanical.yaw;
    const speed = Math.hypot(...mechanical.velocity), powered = mechanical.battery > 0;
    const flap = powered && speed > .01 ? Math.sin(elapsed * 95) * .31 : .12;
    robot.wings[0].rotation.z = flap; robot.wings[1].rotation.z = -flap;
    robot.cargo.visible = Boolean(mechanical.cargo && validId(mechanical.cargo.id));
    robot.cargo.userData.cargoId = robot.cargo.visible ? mechanical.cargo.id : null;
    const actualSignal = coop.circuit?.actual ?? mechanical.emit;
    signal = powered && ['A', 'B'].includes(actualSignal) ? actualSignal : 'off';
    robot.signal.visible = signal !== 'off';
    robot.signalMaterial.color.setHex(signal === 'B' ? 0xffda68 : 0x64cfff);
    robot.signalMaterial.emissive.copy(robot.signalMaterial.color);
    robot.signal.scale.setScalar(1 + Math.sin(elapsed * 5) * .08);
    robot.lampMaterial.emissiveIntensity = powered ? mechanical.battery < 20 ? 1 : 2.4 : .08;
    followTarget = { root: robot.root, actor: { position: [...mechanical.position], velocity: [...mechanical.velocity], heading: mechanical.yaw, bodyScale: MECHANICAL_FLY_RADIUS / .085, contact: Math.abs(mechanical.velocity[1]) < .01, mode: speed > .01 ? 'travel' : 'activity', action: speed > .01 ? 'explore' : 'rest' } };

    const descriptors = Array.isArray(coop.objects) ? coop.objects : [], counts = new Map();
    for (const item of descriptors) if (validId(item?.id)) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
    const active = new Set();
    for (const item of descriptors) {
      if (!validId(item?.id) || counts.get(item.id) !== 1 || !KINDS.has(item.kind) || !validPosition(item.position) || item.active !== true) continue;
      active.add(item.id);
      let node = nodes.get(item.id);
      if (node && node.root.userData.kind !== item.kind) { root.remove(node.root); node.dispose(); nodes.delete(item.id); node = null; }
      if (!node) { node = makeNode(THREE, item); nodes.set(item.id, node); root.add(node.root); }
      node.root.position.set(...item.position);
      node.root.userData = { id: item.id, kind: item.kind, label: typeof item.label === 'string' ? item.label : '', state: typeof item.state === 'string' ? item.state : null };
      node.accent.emissiveIntensity = ['done', 'complete', 'delivered', 'charged'].includes(item.state) ? .25 : .65;
    }
    for (const [id, node] of nodes) if (!active.has(id)) { root.remove(node.root); node.dispose(); nodes.delete(id); }
  }
  function getFollowTarget() {
    return followTarget ? { root: followTarget.root, actor: { ...followTarget.actor, position: [...followTarget.actor.position], velocity: [...followTarget.actor.velocity] } } : null;
  }
  function projectLabels(camera){
    if(disposed||!root.visible||!camera?.isCamera)return [];
    root.updateWorldMatrix(true,true);camera.updateMatrixWorld(true);
    const origin=robot.root.getWorldPosition(new THREE.Vector3()),labels=[];
    for(const [id,node]of nodes){
      const point=node.root.getWorldPosition(new THREE.Vector3()),distance=point.distanceTo(origin),altitude=point.y-origin.y;
      point.project(camera);
      if(point.z < -1||point.z > 1||Math.abs(point.x)>.96||Math.abs(point.y)>.9)continue;
      labels.push({id,kind:node.root.userData.kind,label:node.root.userData.label||node.root.userData.kind,x:(point.x+1)/2,y:(1-point.y)/2,distance,altitude});
    }
    return labels.sort((a,b)=>a.distance-b.distance).slice(0,4);
  }
  function dispose() {
    if (disposed) return;
    disposed = true; parent.remove(root); robot.dispose();
    for (const node of nodes.values()) node.dispose();
    nodes.clear(); followTarget = null;
  }
  return { root, update, getFollowTarget, projectLabels, getDiagnostics: () => ({ visible: root.visible && !disposed, objectCount: nodes.size, signal, physicalRadius: MECHANICAL_FLY_RADIUS }), dispose };
}
