import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { cameraClipping } from '../public/camera-clipping.mjs';
import { bodyMetrics, BASE_BODY_LENGTH } from '../public/body-metrics.mjs';

const stages = [.19 / 30 / BASE_BODY_LENGTH, .19 / 12 / BASE_BODY_LENGTH, 1];

test('sideways window views retain the distant sky plane',()=>{
 for(const mode of ['overview','zone','manual','first'])assert.ok(cameraClipping(mode).far>200);
});

test('room surfaces retain distinct 24-bit depths after every resident camera mode', () => {
  const depth = (camera, distance) => Math.round((new Vector3(0, 0, -distance).applyMatrix4(camera.projectionMatrix).z + 1) * .5 * (2 ** 24 - 1));
  for (const bodyScale of stages) for (const prior of ['first', 'follow', 'close']) {
    const previous = cameraClipping(prior, { bodyScale });
    const camera = new PerspectiveCamera(37, 16 / 9, previous.near, previous.far);
    for (const view of ['overview', 'zone']) {
      const clip = cameraClipping(view, { bodyScale });
      camera.near = clip.near; camera.far = clip.far; camera.updateProjectionMatrix();
      for (const distance of [10, 20, 30]) {
        assert.notEqual(depth(camera, distance), depth(camera, distance + .01), `${prior} → ${view}, body ${bodyScale}, distance ${distance}`);
      }
    }
  }
});

test('macro clipping stays in front of the smallest resident and returns from the game camera', () => {
  for (const bodyScale of stages.slice(0, 2)) {
    const body = bodyMetrics(bodyScale);
    for (const mode of ['first', 'follow', 'close']) {
      const macro = cameraClipping(mode, { bodyScale });
      assert.ok(macro.near < body.radius, `${mode} does not clip the body at its own radius`);
      const game = cameraClipping(mode, { bodyScale, gameView: true });
      assert.equal(game.mode, 'game');
      assert.equal(game.near, .04);
      assert.deepEqual(cameraClipping(mode, { bodyScale, gameView: false }), macro);
    }
    assert.equal(cameraClipping('overview', { bodyScale, gameView: true }).near, .04);
  }
});

test('manual zoom-out restores room precision and invalid inputs remain finite', () => {
  assert.ok(cameraClipping('manual', { orbitDistance: .12 }).near < .001);
  assert.equal(cameraClipping('manual', { orbitDistance: 20 }).near, .04);
  for (const bodyScale of [undefined, NaN, Infinity, -1, 0, .2]) {
    for (const mode of ['overview', 'follow', 'first', 'unknown']) {
      const clip = cameraClipping(mode, { bodyScale, orbitDistance: NaN });
      assert.ok(Number.isFinite(clip.near) && clip.near > 0 && clip.far > clip.near);
      assert.ok(clip.near >= .015);
    }
  }
});
