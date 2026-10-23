import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {nearbyTriangles} from '../public/collision-world.mjs';

const collisionModuleUrl = new URL('../public/collision-world.mjs', import.meta.url);
const collisionSource = await readFile(collisionModuleUrl, 'utf8');
const physicsModuleUrl = new URL('../public/environment-spec.mjs', import.meta.url);
const physicsSource = await readFile(physicsModuleUrl, 'utf8');

// Replace only asset loading in an isolated module. The production BVH,
// candidate selection and contact solver run unchanged against both fixtures.
async function collisionFixture(faces) {
  const packed = new Float32Array(faces);
  const bytes = new Uint8Array(packed.buffer);
  const first = collisionSource.indexOf("const url=new URL('./assets/room-collision.bin',import.meta.url);");
  const last = collisionSource.indexOf('const floating=');
  assert.ok(first >= 0 && last > first, 'collision asset-loading boundary');
  let source = collisionSource.slice(0, first)
    + `const bytes=Uint8Array.from(${JSON.stringify([...bytes])});const metadata={format:'float32-v1',scale:1};\n`
    + collisionSource.slice(last);
  source = source.replace(/from '\.\/([^']+)'/g, (_, path) => `from '${new URL(path, collisionModuleUrl).href}'`);
  source = source.replace("from 'three'", `from '${import.meta.resolve('three')}'`);
  const collisionUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const physics = physicsSource.replace(/from '\.\/([^']+)'/g, (_, path) => `from '${path === 'collision-world.mjs' ? collisionUrl : new URL(path, physicsModuleUrl).href}'`);
  return {...await import(collisionUrl), physics: await import(`data:text/javascript;base64,${Buffer.from(physics).toString('base64')}`)};
}

test('BVH candidates use source triangle order for every contact query', () => {
  for (const position of [[4.52,.615,.58], [4.52,.615,.50], [4.52,.615,.66], [-4.35,1.14,-2.15]]) {
    const ids = nearbyTriangles(position, .12);
    assert.ok(ids.length > 0, `fixture has candidates: ${position}`);
    assert.deepEqual(ids, ids.slice().sort((a,b) => a-b));
    assert.deepEqual(nearbyTriangles(position, .12), ids);
  }
});

test('distant geometry can rebalance the BVH without changing local contact', async () => {
  const bytes = await readFile(new URL('../public/assets/room-collision.bin', import.meta.url));
  const packed = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const local = [];
  const min = [3.9,.15,-.3], max = [4.85,1.2,1.1];
  for (let offset = 0; offset < packed.length; offset += 10) {
    const face = [...packed.subarray(offset, offset + 10)];
    if ([0,1,2].every(axis => Math.max(face[axis],face[axis+3],face[axis+6]) >= min[axis]
      && Math.min(face[axis],face[axis+3],face[axis+6]) <= max[axis])) local.push(...face);
  }
  assert.ok(local.length / 10 > 100, 'actual curved toilet geometry is present');
  const distant = [];
  for (let i = 0; i < 96; i++) {
    const x = 30 + i * .7, y = 2 + i % 3, z = i % 2 ? -30 : 30;
    distant.push(x,y,z, x+.2,y,z, x,y+.2,z, 4);
  }
  const [original, rebalanced] = await Promise.all([collisionFixture(local), collisionFixture([...local,...distant])]);
  assert.equal(rebalanced.collisionInfo.triangles, original.collisionInfo.triangles + 96);
  const position = [4.52,.615,.58], radius = .085;
  const candidates = original.nearbyTriangles(position, radius + .003);
  assert.ok(candidates.length > 10);
  const contact = world => {
    const point = [...position], velocity = [0,-.12,0];
    const support = world.physics.resolveBodyContacts(point, velocity, 0);
    return {point, velocity, support};
  };
  assert.deepEqual(contact(rebalanced), contact(original));
  assert.deepEqual(rebalanced.nearbyTriangles(position, radius + .003), candidates);
});
