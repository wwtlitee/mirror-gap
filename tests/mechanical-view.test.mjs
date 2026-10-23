import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMechanicalFly, pickupMechanicalCargo } from '../public/mechanical-fly.mjs';

let api = {};
try { api = await import('../public/mechanical-view.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const make = () => {
  assert.equal(typeof api.createMechanicalView, 'function', 'mechanical view must exist');
  const parent = new THREE.Group();
  return { parent, view: api.createMechanicalView({ THREE, parent }) };
};
const sample = () => ({ mechanical: createMechanicalFly({ position: [-2.1, 1.6, 1.6] }), objects: [] });

test('camera-relative horizontal controls form a finite orthonormal basis without moving the camera', () => {
  assert.equal(typeof api.horizontalControlBasis, 'function');
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 1, -2); camera.lookAt(0, 1, 0);
  const before = camera.position.toArray(), basis = api.horizontalControlBasis(camera);
  assert.ok(Math.abs(basis.forward[0]) < 1e-9 && Math.abs(basis.forward[1] - 1) < 1e-9);
  assert.ok(Math.abs(basis.right[0] + 1) < 1e-9 && Math.abs(basis.right[1]) < 1e-9);
  assert.deepEqual(camera.position.toArray(), before);
  camera.lookAt(1, 3, 1);
  const diagonal = api.horizontalControlBasis(camera);
  assert.ok(Math.abs(Math.hypot(...diagonal.forward) - 1) < 1e-9);
  assert.ok(Math.abs(diagonal.forward[0] * diagonal.right[0] + diagonal.forward[1] * diagonal.right[1]) < 1e-9);
  camera.position.set(0, 2, 0); camera.lookAt(0, 0, 0);
  assert.ok(Object.values(api.horizontalControlBasis(camera)).flat().every(Number.isFinite));
});

test('mechanical view is opt-in and creates only dynamic descendants', () => {
  const staticRoot = new THREE.Group(), { parent, view } = make();
  assert.equal(parent.children.length, 1);
  assert.equal(view.root.visible, false);
  assert.equal(staticRoot.children.length, 0);
  view.update(sample(), .02);
  assert.equal(view.root.visible, true);
  assert.ok(view.root.getObjectByName('TapeOut_mechanical_fly'));
  assert.ok(view.root.getObjectByName('Mechanical_cargo_slot'));
  view.dispose();
  assert.equal(parent.children.length, 0);
});

test('body follows the authoritative position and yaw without smoothing or editing source data', () => {
  const { view } = make(), coop = sample();
  coop.mechanical.yaw = .7;
  const before = structuredClone(coop);
  view.update(coop, .02);
  const robot = view.root.getObjectByName('TapeOut_mechanical_fly');
  assert.deepEqual(robot.position.toArray(), coop.mechanical.position);
  assert.equal(robot.rotation.y, .7);
  assert.deepEqual(coop, before);
  const target = view.getFollowTarget();
  assert.equal(target.root, robot);
  assert.deepEqual(target.actor.position, coop.mechanical.position);
  assert.equal(target.actor.heading, .7);
  target.actor.position[0] = 99;
  assert.deepEqual(coop, before);
  view.dispose();
});

test('robot body has bounded physical size with distinguishable wings, cargo and headlamp', () => {
  const { view } = make();
  view.update(sample(), 0);
  const robot = view.root.getObjectByName('TapeOut_mechanical_fly');
  robot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(robot), size = box.getSize(new THREE.Vector3());
  assert.ok(size.x >= .08 && size.x < .2);
  assert.ok(size.z >= .08 && size.z < .2);
  assert.ok(view.root.getObjectByName('Mechanical_wing_left'));
  assert.ok(view.root.getObjectByName('Mechanical_wing_right'));
  assert.ok(view.root.getObjectByName('Mechanical_headlamp').material.emissiveIntensity > 0);
  assert.equal(view.root.getObjectByName('Mechanical_cargo').visible, false);
  view.dispose();
});

test('cargo slot and circuit signal reflect actual state including exhausted signal off', () => {
  const { view } = make(), coop = sample();
  coop.mechanical = pickupMechanicalCargo(coop.mechanical, { id: 'parcel', weight: .3 });
  coop.mechanical.emit = 'A';
  view.update(coop, .02);
  assert.equal(view.root.getObjectByName('Mechanical_cargo').visible, true);
  assert.equal(view.root.getObjectByName('Mechanical_cargo').userData.cargoId, 'parcel');
  assert.equal(view.getDiagnostics().signal, 'A');
  coop.mechanical.battery = 0;
  view.update(coop, .02);
  assert.equal(view.getDiagnostics().signal, 'off');
  view.dispose();
});

test('zero delta freezes mechanical animation while positional authority remains exact', () => {
  const { view } = make(), coop = sample();
  coop.mechanical.velocity = [.5, .2, 0];
  view.update(coop, .02);
  const wing = view.root.getObjectByName('Mechanical_wing_left');
  const before = wing.rotation.toArray();
  coop.mechanical.position[0] += .1;
  view.update(coop, 0);
  assert.deepEqual(wing.rotation.toArray(), before);
  assert.deepEqual(view.getFollowTarget().root.position.toArray(), coop.mechanical.position);
  view.dispose();
});

test('visible emission uses the actual TapeOut circuit output instead of input intent', () => {
  const { view } = make(), coop = sample();
  coop.mechanical.emit = 'A';
  coop.circuit = { selected: 'A', actual: 'B' };
  view.update(coop, .02);
  assert.equal(view.getDiagnostics().signal, 'B');
  coop.circuit.actual = 'off';
  view.update(coop, .02);
  assert.equal(view.getDiagnostics().signal, 'off');
  assert.equal(view.root.getObjectByName('Mechanical_signal').visible, false);
  view.dispose();
});

test('all mission node kinds use actual snapshot locations and reconcile active objects', () => {
  const { view } = make(), coop = sample();
  coop.objects = ['supply', 'delivery', 'relay', 'charge', 'checkpoint'].map((kind, index) => ({ id: kind, kind, position: [index * .3, 1, 0], active: true, label: kind, state: 'ready' }));
  const before = structuredClone(coop);
  view.update(coop, .02);
  for (const item of coop.objects) {
    const node = view.root.getObjectByName(`Coop_node_${item.id}`);
    assert.deepEqual(node.position.toArray(), item.position);
    assert.equal(node.userData.kind, item.kind);
    assert.equal(node.userData.label, item.label);
    assert.ok(node.children.length > 0);
  }
  assert.deepEqual(coop, before);
  coop.objects[0].active = false;
  coop.objects.splice(1, 1);
  coop.objects[1].position = [1, 2, 3];
  view.update(coop, .02);
  assert.equal(view.root.getObjectByName('Coop_node_supply'), undefined);
  assert.equal(view.root.getObjectByName('Coop_node_delivery'), undefined);
  assert.deepEqual(view.root.getObjectByName('Coop_node_relay').position.toArray(), [1, 2, 3]);
  assert.equal(view.getDiagnostics().objectCount, 3);
  view.dispose();
});

test('invalid and duplicate node identities cannot create misleading markers', () => {
  const { view } = make(), coop = sample();
  coop.objects = [
    { id: 'valid', kind: 'supply', position: [0, 1, 0], active: true },
    { id: 'valid', kind: 'relay', position: [2, 1, 0], active: true },
    { id: 'nan', kind: 'relay', position: [NaN, 1, 0], active: true },
    { id: 'holes', kind: 'relay', position: Array(3), active: true },
    { id: 'unknown', kind: 'hologram', position: [0, 1, 0], active: true }
  ];
  view.update(coop, .02);
  assert.equal(view.getDiagnostics().objectCount, 0);
  view.update({ mechanical: { position: [NaN, 0, 0] }, objects: [] }, .02);
  assert.equal(view.root.visible, false);
  assert.equal(view.getFollowTarget(), null);
  view.dispose();
});

test('charging hardware sits beneath the mechanical centre while its real world anchor stays exact', () => {
  const { view } = make(), coop = sample();
  coop.objects = [{ id: 'dock', kind: 'charge', position: [-2.1, 1.6, 1.6], active: true, label: '充能台' }];
  view.update(coop, 0);
  const dock = view.root.getObjectByName('Coop_node_dock');
  assert.deepEqual(dock.position.toArray(), [-2.1, 1.6, 1.6]);
  assert.ok(new THREE.Box3().setFromObject(dock).max.y < 1.56);
  view.dispose();
});

test('world guidance labels project the same active node anchors through the actual camera', () => {
  const { view } = make(), coop = sample();
  coop.objects = [{ id: 'delivery', kind: 'delivery', position: [0, 1, 0], active: true, label: '投递餐盘' }];
  view.update(coop, 0);
  const camera = new THREE.PerspectiveCamera(40, 1, .01, 100); camera.position.set(0, 2, 4); camera.lookAt(0, 1, 0); camera.updateMatrixWorld(true);
  assert.equal(typeof view.projectLabels, 'function');
  const labels = view.projectLabels(camera);
  assert.equal(labels.length, 1);
  assert.equal(labels[0].label, '投递餐盘');
  assert.ok(Math.abs(labels[0].x - .5) < 1e-9 && Math.abs(labels[0].y - .5) < 1e-9);
  labels[0].label = 'edited';
  assert.equal(view.projectLabels(camera)[0].label, '投递餐盘');
  camera.lookAt(0, 3, 8); camera.updateMatrixWorld(true);
  assert.deepEqual(view.projectLabels(camera), []);
  view.dispose();
});

test('resources dispose exactly once and repeated cleanup is safe', () => {
  const { view } = make();
  view.update({ ...sample(), objects: [{ id: 'relay', kind: 'relay', position: [0, 1, 0], active: true }] }, .02);
  let geometries = 0, materials = 0;
  const seenGeometry = new Set(), seenMaterial = new Set();
  view.root.traverse(object => {
    if (object.geometry && !seenGeometry.has(object.geometry)) { seenGeometry.add(object.geometry); object.geometry.addEventListener('dispose', () => geometries++); }
    if (object.material && !seenMaterial.has(object.material)) { seenMaterial.add(object.material); object.material.addEventListener('dispose', () => materials++); }
  });
  view.dispose(); view.dispose();
  assert.equal(geometries, seenGeometry.size);
  assert.equal(materials, seenMaterial.size);
});
