// Room views need room-scale depth precision even when the resident is tiny.
// The body threshold matches the macro camera rig in scene.mjs.
export function cameraClipping(mode, { bodyScale = 1, gameView = false, orbitDistance = Infinity } = {}) {
  const automatic = ['follow', 'close', 'first'].includes(mode);
  const clipMode = automatic && gameView ? 'game' : mode;
  const smallBody = Number.isFinite(bodyScale) && bodyScale > 0 && bodyScale < .2;
  let near = .04;
  if (clipMode === 'first') near = smallBody ? .0001 : .015;
  else if (clipMode === 'follow' || clipMode === 'close') near = smallBody ? .00015 : .04;
  else if (clipMode === 'manual' && Number.isFinite(orbitDistance) && orbitDistance >= 0 && orbitDistance < .48) near = .00015;
  // Sideways window views must include the 180 m sky dome and distant city.
  // The shared logarithmic depth buffer keeps room and macro surfaces precise.
  return { mode: clipMode, near, far: 400 };
}
