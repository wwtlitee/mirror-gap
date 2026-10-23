import {withFoodStock} from './food-stock.mjs';
import {naturalMaterial,waitForSurfaceTextures} from './natural-materials.mjs';
import {bodyMetrics} from './body-metrics.mjs';
import {cameraClipping} from './camera-clipping.mjs';
import {segmentOccluded} from './collision-world.mjs';
import {splitFood,updateFoodPortions} from './food-portions.mjs';
import {createWaterSurfaces} from './water-surfaces.mjs';
import { ActorPlayback } from './actor-playback.mjs';
import {createCueTrainingMarkers} from './cue-training-markers.mjs';
import {createMechanicalView,horizontalControlBasis} from './mechanical-view.mjs';
import {batchSoftwareRoom} from './software-batching.mjs';
import {lightweightMaterials} from './render-quality.mjs';
import {buildKenneyRoom} from './room-assets.mjs';
import {createRestMattressGeometry,buildRestUpholstery,buildDeskCabinet,buildDeskJoinery,refineBookcase,buildDiningCabinetDetail} from './room-model-detail.mjs';
import { buildOpenHabitat } from './open-habitat.mjs';
import {createBotanicalLeafGeometry,createPlantPotGeometry,createPotSoilGeometry,createDrinkingBowlGeometry} from './habitat-model-detail.mjs';
import { collectCollisionGeometry } from './collision-export.mjs';
import { buildHabitatRenovation } from './habitat-renovation.mjs';
import { FOOD_TOP, FOOD_PROPS, PERCH_POST, PERCH_PLATFORMS, GARDEN_TOP, GARDEN_POOL, HABITAT_BRANCHES } from './habitat-layout.mjs';
import {RESOURCE_BY_ID,createResourceShape} from './resource-spec.mjs';
import { CalmFollow } from './calm-follow.mjs';
import { createOutsideWorld, createDeskDisplay } from './outside-world.mjs';
import {createWeatherView} from './weather-view.mjs';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROOM, ZONE_BY_ID } from './world-spec.mjs';
import { createMirrorGapCharacter } from './character.mjs';
import {createCharacterExportClone,disposeCharacterExportClone} from './character-export.mjs';
import { buildInteriorDetails } from './interior-details.mjs';
import {buildInteriorRefinement} from './interior-refinement.mjs';
import {createHomeRenderFinish,updatePhysicalHomeLight} from './home-render-finish.mjs';
import { SOLIDS, BRANCH_SEGMENTS, resolveContacts, resolveBodyContacts, moveBody, CHARACTER_SCALE } from './environment-spec.mjs';

const TAU = Math.PI * 2;
const CAMERA_MARGIN = 0.12;
const cameraRay=new THREE.Ray(),cameraDirection=new THREE.Vector3(),cameraIntersection=new THREE.Vector3();

// The camera arm is clipped as one segment, preserving its viewing direction.
// Exporting the geometry-only helper also permits checks without a WebGL context.
export function constrainResidentCamera(anchor, preferred, obstacles, output = new THREE.Vector3()) {
  const direction = cameraDirection.copy(preferred).sub(anchor);
  const wantedDistance = direction.length();
  if (wantedDistance < 1e-8) return output.copy(anchor);
  direction.divideScalar(wantedDistance);
  let allowedDistance = wantedDistance;
  const boundaries = [
    ['x', -ROOM.width / 2 + 0.52],
    ['y', 0.28],
    ['z', -ROOM.depth / 2 + 0.54],
  ];
  for (const [axis, minimum] of boundaries) {
    if (direction[axis] < -1e-8) allowedDistance = Math.min(allowedDistance, Math.max(0, (minimum - anchor[axis]) / direction[axis]));
  }
  const ray = cameraRay.set(anchor, direction);
  const intersection = cameraIntersection;
  for (const obstacle of obstacles) {
    // A landing point may border a conservative furniture proxy. Do not trap
    // the camera at zero distance when its focus already occupies that proxy.
    if (obstacle.containsPoint(anchor)) continue;
    if (ray.intersectBox(obstacle, intersection)) {
      allowedDistance = Math.min(allowedDistance, Math.max(0, anchor.distanceTo(intersection) - 0.025));
    }
  }
  return output.copy(anchor).addScaledVector(direction, allowedDistance);
}

function makeRandom(seed = 81419) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建房间材质画布。');
  draw(context, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function createTextures() {
  const random = makeRandom(118);
  const wood = canvasTexture(256, 1024, (context, width, height) => {
    context.fillStyle = '#85603c';
    context.fillRect(0, 0, width, height);
    for (let index = 0; index < 650; index++) {
      const x = random() * width;
      context.strokeStyle = `rgba(${random() > 0.5 ? '32,17,8' : '229,184,112'},${0.03 + random() * 0.14})`;
      context.lineWidth = random() * 1.3 + 0.25;
      context.beginPath();
      context.moveTo(x, -10);
      context.bezierCurveTo(x + random() * 13, height * 0.3, x - random() * 20, height * 0.6, x + random() * 9, height + 10);
      context.stroke();
    }
    for (let index = 0; index < 3; index++) {
      const x = random() * width;
      const y = random() * height;
      for (let ring = 0; ring < 9; ring++) {
        context.strokeStyle = `rgba(36,20,11,${0.11 - ring * 0.008})`;
        context.beginPath();
        context.ellipse(x, y, 3 + ring * 1.9, 10 + ring * 12, 0.02, 0, TAU);
        context.stroke();
      }
    }
  });
  const stone = canvasTexture(256, 256, (context, width, height) => {
    context.fillStyle = '#424347';
    context.fillRect(0, 0, width, height);
    for (let index = 0; index < 5500; index++) {
      const bright = random() > 0.53;
      context.fillStyle = bright ? `rgba(194,186,170,${random() * 0.11})` : `rgba(0,0,0,${random() * 0.16})`;
      context.fillRect(random() * width, random() * height, random() * 5 + 0.5, random() * 2 + 0.5);
    }
    for (let index = 0; index < 14; index++) {
      const startY = random() * height;
      context.strokeStyle = 'rgba(171,159,138,0.11)';
      context.lineWidth = 0.65;
      context.beginPath(); context.moveTo(0, startY);
      context.bezierCurveTo(60, startY - 12, 190, startY + 9, width, startY - 8);
      context.stroke();
    }
  });
  const rug = canvasTexture(1024, 1024, (context, width, height) => {
    context.fillStyle = '#1b282b'; context.fillRect(0, 0, width, height);
    for (let index = 0; index < 17000; index++) {
      context.fillStyle = random() > 0.5 ? 'rgba(164,146,111,0.1)' : 'rgba(0,0,0,0.13)';
      context.fillRect(random() * width, random() * height, 1, 3);
    }
    context.strokeStyle = '#a88a52'; context.lineWidth = 2;
    for (const radius of [485, 476, 455]) {
      context.beginPath(); context.arc(512, 512, radius, 0, TAU); context.stroke();
    }
    context.save(); context.translate(512, 512); context.rotate(-0.52);
    context.strokeStyle = '#b49764'; context.lineWidth = 2.4;
    context.beginPath(); context.moveTo(-45, 434); context.bezierCurveTo(0, 140, -28, -175, 45, -429); context.stroke();
    for (let index = 0; index < 8; index++) {
      const y = -310 + index * 82;
      const extent = Math.sqrt(Math.max(0, 430 ** 2 - y * y)) * 0.88;
      for (const side of [-1, 1]) {
        context.beginPath(); context.moveTo(0, y + 65);
        context.bezierCurveTo(side * extent * 0.28, y + 32, side * extent * 0.6, y - 28, side * extent, y - 53);
        context.stroke();
        for (let twig = 1; twig < 4; twig++) {
          const x = side * extent * twig / 4;
          context.beginPath(); context.moveTo(x, y + 45 - twig * 21); context.lineTo(x + side * 14, y - 25 - twig * 20); context.stroke();
        }
      }
    }
    context.restore();
  });
  const sky = canvasTexture(1024, 768, (context, width, height) => {
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#28354e'); gradient.addColorStop(0.38, '#777491'); gradient.addColorStop(0.7, '#c8a9a0'); gradient.addColorStop(1, '#354858');
    context.fillStyle = gradient; context.fillRect(0, 0, width, height);
    context.save(); context.filter = 'blur(7px)';
    for (let layer = 0; layer < 3; layer++) {
      const bottom = height - layer * 18;
      context.fillStyle = ['#5b6277', '#414d61', '#263d50'][layer];
      for (let index = 0; index < 28; index++) {
        const x = index * 43 + random() * 12;
        const buildingHeight = 70 + random() * (110 + layer * 54);
        context.fillRect(x, bottom - buildingHeight, 23 + random() * 25, buildingHeight);
      }
    }
    context.restore();
    for (let index = 0; index < 100; index++) {
      const x = random() * width;
      const y = height * 0.58 + random() * height * 0.40;
      const glow = context.createRadialGradient(x, y, 0, x, y, 6);
      glow.addColorStop(0, 'rgba(255,211,144,0.8)'); glow.addColorStop(1, 'rgba(255,180,99,0)');
      context.fillStyle = glow; context.fillRect(x - 6, y - 6, 12, 12);
    }
    context.fillStyle = '#eadcbb'; context.beginPath(); context.arc(825, 121, 23, 0, TAU); context.fill();
    context.fillStyle = '#373f59'; context.beginPath(); context.arc(837, 116, 23, 0, TAU); context.fill();
  });
  const monitor = canvasTexture(1024, 620, (context, width, height) => {
    context.fillStyle = '#071b23'; context.fillRect(0, 0, width, height);
    context.strokeStyle = '#1d4751'; context.lineWidth = 1;
    for (let x = 24; x < width; x += 42) { context.beginPath(); context.moveTo(x, 28); context.lineTo(x, height - 28); context.stroke(); }
    for (let y = 30; y < height; y += 42) { context.beginPath(); context.moveTo(24, y); context.lineTo(width - 24, y); context.stroke(); }
    context.strokeStyle = '#4a99a4'; context.lineWidth = 2;
    context.strokeRect(30, 27, width - 60, height - 54);
    context.fillStyle = '#b6c9bc'; context.font = '22px monospace'; context.fillText('M I R R O R   G A P', 63, 75);
    context.fillStyle = '#a69161'; context.font = '16px monospace'; context.fillText('A FEW THINGS WORTH REMEMBERING', 63, 550);
    context.save(); context.translate(524, 296);
    context.strokeStyle = '#d9b669'; context.lineWidth = 3;
    for (const side of [-1, 1]) {
      context.beginPath(); context.moveTo(0, 55); context.bezierCurveTo(side * 90, -210, side * 295, -200, side * 250, -92); context.bezierCurveTo(side * 240, 0, side * 107, 105, 0, 55); context.stroke();
      for (let index = 0; index < 5; index++) {
        context.beginPath(); context.moveTo(0, 55); context.quadraticCurveTo(side * (95 + index * 15), 0, side * (110 + index * 32), -132 + index * 20); context.stroke();
      }
    }
    context.strokeStyle = '#58d6e5'; context.beginPath(); context.ellipse(0, 23, 46, 53, 0, 0, TAU); context.stroke();
    context.beginPath(); context.moveTo(0, 69); context.lineTo(0, 129); context.stroke();
    context.restore();
  });
  const leaf = canvasTexture(128, 256, (context, width, height) => {
    const gradient = context.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, '#465b28'); gradient.addColorStop(0.49, '#7e8b41'); gradient.addColorStop(0.52, '#879343'); gradient.addColorStop(1, '#354a29');
    context.fillStyle = gradient; context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(190,182,99,0.65)'; context.lineWidth = 2;
    context.beginPath(); context.moveTo(64, 0); context.lineTo(64, 256); context.stroke();
    context.lineWidth = 1;
    for (let y = 30; y < height; y += 29) {
      for (const side of [-1, 1]) {
        context.beginPath(); context.moveTo(64, y); context.quadraticCurveTo(64 + side * 26, y - 19, 64 + side * 60, y - 31); context.stroke();
      }
    }
  });
  const honey = canvasTexture(256, 256, (context, width, height) => {
    context.fillStyle = '#715021'; context.fillRect(0, 0, width, height);
    const size = 24;
    for (let row = -1; row < 9; row++) for (let column = -1; column < 8; column++) {
      const x = column * size * 1.73 + row % 2 * size * 0.865;
      const y = row * size * 1.5;
      context.fillStyle = `rgba(231,166,65,${0.13 + random() * 0.28})`;
      context.strokeStyle = '#ae8140'; context.lineWidth = 2;
      context.beginPath();
      for (let vertex = 0; vertex < 6; vertex++) {
        const angle = (vertex * 60 + 30) * Math.PI / 180;
        const px = x + Math.cos(angle) * size * 0.93;
        const py = y + Math.sin(angle) * size * 0.93;
        if (vertex === 0) context.moveTo(px, py); else context.lineTo(px, py);
      }
      context.closePath(); context.fill(); context.stroke();
    }
  });
  honey.wrapS = honey.wrapT = THREE.RepeatWrapping;
  honey.repeat.set(2, 2.2);
  const shadow = canvasTexture(128, 128, (context, width, height) => {
    const gradient = context.createRadialGradient(64, 64, 5, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(0,0,0,0.64)'); gradient.addColorStop(0.55, 'rgba(0,0,0,0.25)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient; context.fillRect(0, 0, width, height);
  });
  return { wood, stone, rug, sky, monitor, leaf, honey, shadow };
}

function roundedShape(width, height, radius) {
  const x = -width / 2;
  const y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y); shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius); shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height); shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius); shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

function leafGeometry() {
  return createBotanicalLeafGeometry();
}

export async function createHomeScene(canvas, { onZoneSelect, onViewChange, trainingCues=false, cooperative=false } = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('房间需要一个 Canvas 元素。');
  let renderer;
  // Macro residents and the distant city share one depth buffer. Logarithmic
  // depth keeps storefronts and billboard frames distinct even at near=.00015.
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, alpha: false, powerPreference: 'high-performance' }); }
  catch (error) { throw new Error('当前设备无法启动 3D 房间，请检查 WebGL 支持。', { cause: error }); }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.10;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15191e);
  scene.fog = new THREE.FogExp2(0x15191e, 0.017);
  const staticRoot = new THREE.Group(); staticRoot.name = 'Home_static_architecture'; scene.add(staticRoot);
  const dynamicRoot = new THREE.Group(); dynamicRoot.name = 'Home_dynamic_life'; scene.add(dynamicRoot);
  const cueMarkers=trainingCues?createCueTrainingMarkers(dynamicRoot):null;
  let mechanicalView=null;
  let followActor=cooperative?'mechanical':'neural';
  const camera = new THREE.PerspectiveCamera(37, 1, 0.04, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.enablePan = false;
  controls.minDistance = 3.2; controls.maxDistance = 32;
  controls.minPolarAngle = 0.28; controls.maxPolarAngle = Math.PI * 0.47;
  controls.target.set(0, 1.2, -0.2);
  const supportsHdr=renderer.extensions.has('EXT_color_buffer_float')||renderer.extensions.has('EXT_color_buffer_half_float');
  let environment=null;
  if(supportsHdr){const pmrem=new THREE.PMREMGenerator(renderer),environmentRoom=new RoomEnvironment();environment=pmrem.fromScene(environmentRoom,.055);scene.environment=environment.texture;environmentRoom.dispose();pmrem.dispose();}
  scene.environmentIntensity = 0.40;

  const textures = createTextures();
  const random = makeRandom(4917);
  const material = {
    wood: naturalMaterial('wood',{color:0xdac6a3}),
    darkWood: naturalMaterial('wood',{color:0x8f7359,roughness:.82}),
    stone: naturalMaterial('stone',{color:0xd2cbb9}),
    darkStone: naturalMaterial('stone',{color:0x908c80}),
    gold: new THREE.MeshStandardMaterial({ color: 0x9c7840, roughness: 0.33, metalness: 0.75 }),
    bronze: new THREE.MeshStandardMaterial({ color: 0x615342, roughness: 0.42, metalness: 0.68 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x31342e, roughness: 0.78, metalness: 0 }),
    fabric: naturalMaterial('cloth',{color:0xd9cba9}),
    pillow: naturalMaterial('cloth',{color:0xf1e5c5}),
    moss: naturalMaterial('soil',{color:0x758259}),
    soil: naturalMaterial('soil',{color:0x9a8060}),
    leaf: new THREE.MeshStandardMaterial({ map: textures.leaf, color: 0xcbd498, roughness: 0.79, side: THREE.DoubleSide }),
    pot: naturalMaterial('ceramic',{color:0xc9b698,roughness:.55}),
    water: new THREE.MeshPhysicalMaterial({ color: 0xb6c7bd, metalness: 0, roughness: 0.06, transparent: true, opacity: 0.40, clearcoat: .3, ior:1.333, depthWrite:false }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xeef0df, metalness: 0, roughness: 0.08, transparent: true, opacity: 0.20, ior:1.5, side: THREE.FrontSide, depthWrite: false }),
    bulb: new THREE.MeshStandardMaterial({ color: 0xffe3a5, emissive: 0xffb553, emissiveIntensity: 2.9, roughness: 0.35 }),
    softGlow: naturalMaterial('ceramic',{color:0xd8c19a,roughness:.52}),
    window: new THREE.MeshBasicMaterial({ map: textures.sky, color: 0xc5c9d5 }),
    screen: new THREE.MeshBasicMaterial({ map: textures.monitor, color: 0xb6d1cc }),
  };
  const selectable = [];
  const leaves = [];

  function addMesh(geometry, mat, position = [0, 0, 0], parent = staticRoot, name = '') {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(...position); mesh.name = name;
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
    return mesh;
  }
  function box(size, position, mat = material.wood, parent = staticRoot) {
    return addMesh(new THREE.BoxGeometry(...size), mat, position, parent);
  }
  function cylinder(top, bottom, height, position, mat, parent = staticRoot, sides = 40) {
    return addMesh(new THREE.CylinderGeometry(top, bottom, height, sides), mat, position, parent);
  }
  function sphere(radius, position, mat, parent = staticRoot) {
    return addMesh(new THREE.SphereGeometry(radius, 22, 14), mat, position, parent);
  }
  function path(points, radius, mat, parent = staticRoot, radial = 6) {
    const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
    return addMesh(new THREE.TubeGeometry(curve, Math.max(8, points.length * 6), radius, radial, false), mat, [0, 0, 0], parent);
  }
  function platform(width, depth, height, radius, position, mat, parent = staticRoot) {
    const geometry = new THREE.ExtrudeGeometry(roundedShape(width, depth, radius), { depth: height, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 2, curveSegments: 10, steps: 1 });
    geometry.rotateX(-Math.PI / 2);
    return addMesh(geometry, mat, position, parent);
  }
  function zoneGroup(id) {
    const group = new THREE.Group(); group.name = `Zone_${id}`; group.userData.zoneId = id;
    staticRoot.add(group); selectable.push(group); return group;
  }
  function contactShadow(x, z, width, depth) {
    const mat = new THREE.MeshBasicMaterial({ map: textures.shadow, transparent: true, opacity: 0.60, depthWrite: false });
    // Floorboards top out at 0.025; keep the soft contact just above the wood.
    const mesh = addMesh(new THREE.PlaneGeometry(width, depth), mat, [x, 0.029, z]);
    mesh.rotation.x = -Math.PI / 2; mesh.castShadow = false; mesh.receiveShadow = false;
  }
  function leaf(position, length, widthScale, rotation = [0, 0, 0], tint = 0xffffff) {
    leaves.push({ position, length, widthScale, rotation, tint });
  }
  function bowl(x, y, z, radius, mat = material.gold, parent = staticRoot, liquid = true) {
    addMesh(createDrinkingBowlGeometry(radius), mat, [x, y, z], parent, 'Ceramic_bowl_rolled_rim');
    if (liquid) {
      const water = addMesh(new THREE.CircleGeometry(radius * 0.87, 40), material.water, [x, y + radius * 0.30, z], parent);
      water.rotation.x = -Math.PI / 2;
      water.castShadow = false;
    }
  }
  function lamp(x, y, z, scale = 1, parent = staticRoot, hanging = false) {
    if (hanging) {
      path([[x, y + 0.25 * scale, z], [x, y + 0.70, z], [x + 0.05, 4.65, z]], 0.014, material.gold, parent);
    } else {
      cylinder(0.18 * scale, 0.22 * scale, 0.06 * scale, [x, y - 0.20 * scale, z], material.bronze, parent);
      cylinder(0.045 * scale, 0.06 * scale, 0.22 * scale, [x, y - 0.10 * scale, z], material.gold, parent);
    }
    const glass = sphere(0.20 * scale, [x, y + 0.14 * scale, z], material.glass, parent); glass.castShadow = false;
    sphere(0.07 * scale, [x, y + 0.13 * scale, z], material.bulb, parent).castShadow = false;
    for (const level of [-0.028, 0.31]) cylinder(0.08 * scale, 0.08 * scale, 0.025, [x, y + level * scale, z], material.gold, parent, 20);
  }
  function potPlant(x, y, z, size, parent = staticRoot, leafCount = 8) {
    addMesh(createPlantPotGeometry(size), material.pot, [x, y, z], parent, 'Plant_pot_thick_rim');
    addMesh(createPotSoilGeometry(.27 * size), material.soil, [x, y + .42 * size, z], parent, 'Plant_pot_granular_soil');
    for (let index = 0; index < leafCount; index++) {
      const angle = index / leafCount * TAU + random() * 0.3;
      const height = size * (0.54 + random() * 0.44);
      const reach = size * (0.19 + random() * 0.28);
      const top = [x + Math.cos(angle) * reach, y + height, z + Math.sin(angle) * reach];
      path([[x, y + 0.39 * size, z], [x + Math.cos(angle) * reach * 0.35, y + height * 0.84, z + Math.sin(angle) * reach * 0.35], top], 0.012 * size, material.moss, parent, 8);
      leaf(top, size * (0.42 + random() * 0.25), 0.78, [0.80 + random() * 0.8, angle, Math.sin(angle) * 0.25], index % 3 === 0 ? 0xb7bc8b : 0xffffff);
    }
  }

  // Cutaway architecture: a dark plinth and two substantial, articulated rear walls.
  platform(ROOM.width + 0.55, ROOM.depth + 0.50, 0.40, 0.32, [0, -0.43, 0], material.darkStone);
  box([ROOM.width, 0.13, ROOM.depth], [0, -0.05, 0], material.darkWood);
  const plankGeometry = new THREE.BoxGeometry(0.653, 0.05, 1.468);
  const floor = new THREE.InstancedMesh(plankGeometry, material.wood, 18 * 6);
  floor.castShadow = false; floor.receiveShadow = true; floor.name = 'Individual_walnut_floorboards';
  const transform = new THREE.Object3D();
  const tone = new THREE.Color();
  let instance = 0;
  for (let column = 0; column < 18; column++) for (let row = 0; row < 6; row++) {
    transform.position.set(-ROOM.width / 2 + (column + 0.5) * ROOM.width / 18, 0, -ROOM.depth / 2 + (row + 0.5) * ROOM.depth / 6);
    transform.rotation.set(0, 0, 0); transform.scale.set(1, 1, 1); transform.updateMatrix();
    floor.setMatrixAt(instance, transform.matrix);
    tone.setHSL(0.08 + random() * 0.025, 0.18 + random() * 0.10, 0.64 + random() * 0.19);
    floor.setColorAt(instance++, tone);
  }
  staticRoot.add(floor);
  for (const x of [-5.91, 5.91]) box([0.12, 0.08, 8.94], [x, 0.026, 0], material.gold);
  for (const z of [-4.4, 4.4]) box([11.82, 0.08, 0.12], [0, 0.026, z], material.gold);
  const stoneBlocks = [];
  for (let row = 0; row < 6; row++) {
    const y = row * 0.79 + 0.39;
    for (let column = 0; column < 8; column++) {
      const x = -5.23 + column * 1.49;
      if (x > 0.30) continue;
      stoneBlocks.push({ size: [1.46, 0.766, 0.33], position: [x, y, -4.47] });
    }
    for (let column = 0; column < 5; column++) {
      stoneBlocks.push({ size: [0.33, 0.766, 1.46], position: [-6.02, y, -3.72 + column * 1.49] });
    }
  }
  // One material and instancing retain the masonry relief without hundreds of draw calls.
  const wallBlocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material.darkStone, stoneBlocks.length);
  stoneBlocks.forEach((block, index) => {
    transform.position.set(...block.position); transform.scale.set(...block.size); transform.rotation.set(0, 0, 0); transform.updateMatrix();
    wallBlocks.setMatrixAt(index, transform.matrix);
    tone.setScalar(0.75 + random() * 0.30); wallBlocks.setColorAt(index, tone);
  });
  wallBlocks.castShadow = true; wallBlocks.receiveShadow = true; staticRoot.add(wallBlocks);
  box([12.4, 0.29, 0.51], [0, 4.86, -4.46], material.stone);
  box([0.51, 0.29, 7.73], [-6.02, 4.86, -0.79], material.stone);
  for (const x of [-5.79, -2.72]) {
    box([0.23, 4.7, 0.25], [x, 2.35, -4.2], material.darkWood);
    box([0.045, 4.60, 0.04], [x + 0.07, 2.35, -4.045], material.bronze);
    box([0.40, 0.15, 0.42], [x, 0.19, -4.16], material.stone);
  }
  for (const z of [-4.09, -0.74, 2.7]) box([0.26, 4.74, 0.26], [-5.77, 2.36, z], material.darkWood);
  box([0.23, 0.33, 7.22], [-5.81, 0.21, -0.83], material.stone);
  box([6.20, 0.30, 0.27], [-2.90, 0.2, -4.18], material.stone);
  // A low front lip preserves the open dollhouse view.
  box([8.52, 0.35, 0.29], [-1.66, 0.16, 4.45], material.darkStone);

  const rest = zoneGroup('rest');
  contactShadow(-4.27, -2.47, 3.5, 3.2);
  cylinder(1.48, 1.53, 0.42, [-4.27, 0.23, -2.68], material.darkWood, rest, 64);
  cylinder(1.52, 1.52, 0.075, [-4.27, 0.49, -2.68], material.gold, rest, 64);
  cylinder(1.43, 1.48, 0.10, [-4.27, 0.55, -2.68], material.wood, rest, 64);
  addMesh(createRestMattressGeometry(),material.fabric,[-4.27,0.83,-2.67],rest,'Woven_rest_cushion');
  const bedBack = new THREE.Shape();
  bedBack.moveTo(-1.28, 0); bedBack.lineTo(-1.28, 0.80); bedBack.absarc(0, 0.80, 1.28, Math.PI, 0, true); bedBack.lineTo(1.28, 0); bedBack.closePath();
  const back = addMesh(new THREE.ExtrudeGeometry(bedBack, { depth: 0.27, bevelEnabled: true, bevelThickness: 0.10, bevelSize: 0.08, bevelSegments: 3, curveSegments: 32 }), material.darkStone, [-4.27, 0.61, -3.84], rest);
  const honeyMaterial = naturalMaterial('cloth',{color:0xcac3a6});
  buildRestUpholstery({rest,material,headboardMaterial:honeyMaterial});
  const archPoints = [];
  for (let index = 0; index <= 36; index++) {
    const angle = Math.PI - index / 36 * Math.PI;
    archPoints.push([-4.27 + Math.cos(angle) * 1.34, 1.43 + Math.sin(angle) * 1.34, -3.43]);
  }
  path(archPoints, 0.078, material.wood, rest, 10);
  for (const x of [-5.61, -2.93]) path([[x, 0.72, -3.43], [x, 1.43, -3.43]], 0.078, material.wood, rest, 10);
  cylinder(0.31, 0.36, 0.54, [-2.91, 0.32, -2.71], material.wood, rest);
  lamp(-2.91, 0.84, -2.71, 0.8, rest);

  const feed = zoneGroup('feed');
  contactShadow(-3.38, 1.44, 3.1, 3.6);
  // Recess the cabinet core behind its separate tambour boards; the boards
  // retain the original outer footprint and the serving top stays unchanged.
  platform(2.06, 2.90, 0.77, 0.86, [-3.43, 0.06, 1.33], material.darkWood, feed);
  platform(2.28, 3.12, 0.13, 0.96, [-3.43, 0.86, 1.33], material.wood, feed);
  for (let index = 0; index < 19; index++) {
    const angle = index / 19 * TAU;
    const slat = box([0.038, 0.64, 0.07], [-3.43 + Math.cos(angle) * 1.01, 0.44, 1.33 + Math.sin(angle) * 1.41], material.gold, feed);
    slat.rotation.y = -angle;
  }
  buildDiningCabinetDetail({feed,material});
  const ceramic = naturalMaterial('ceramic',{color:0xe7dec5});
  const waterDish=FOOD_PROPS.water, fruitDish=FOOD_PROPS.fruit, bottle=FOOD_PROPS.bottle, figDish=FOOD_PROPS.fig;
  bowl(waterDish.x,FOOD_TOP,waterDish.z,waterDish.radius,ceramic,feed,false);
  feed.add(createResourceShape(THREE,RESOURCE_BY_ID['water-bowl'],{surface:material.water}));
  bowl(fruitDish.x,FOOD_TOP,fruitDish.z,fruitDish.radius,ceramic,feed,false);
  const red = new THREE.MeshStandardMaterial({ color: 0x982f45, roughness: .48 });
  const purple = new THREE.MeshStandardMaterial({ color: 0x45304e, roughness: .5 });
  cylinder(.19,.19,.018,[bottle.x,FOOD_TOP+.009,bottle.z],material.gold,feed);
  addMesh(new THREE.LatheGeometry([new THREE.Vector2(0,0),new THREE.Vector2(.14,0),new THREE.Vector2(.18,.08),new THREE.Vector2(.18,.24),new THREE.Vector2(.07,.36),new THREE.Vector2(.055,.52)],28),material.glass,[bottle.x,FOOD_TOP+.018,bottle.z],feed);
  cylinder(.155,.13,.17,[bottle.x,FOOD_TOP+.108,bottle.z],new THREE.MeshStandardMaterial({color:0xb78032,transparent:true,opacity:.72,roughness:.25}),feed);
  cylinder(.062,.058,.055,[bottle.x,FOOD_TOP+.555,bottle.z],material.wood,feed);
  // A separate plate of cut fruit replaces ambiguous floating flower discs.
  cylinder(figDish.radius,figDish.radius*.86,.035,[figDish.x,FOOD_TOP+.0175,figDish.z],ceramic,feed);

  const work = zoneGroup('work');
  contactShadow(-0.95, -3.28, 4.0, 2.4);
  platform(3.25, 1.10, 0.15, 0.10, [-1.02, 1.17, -3.43], material.wood, work);
  for(const x of [-2.33,.25])buildDeskCabinet({parent:work,material,x});
  buildDeskJoinery({work,material});
  platform(2.10, 1.28, 0.12, 0.14, [-1.20, 2.15, -3.87], material.gold, work).rotation.x = Math.PI / 2;
  // The screen is a real inset plane in a substantial physical monitor frame.
  const screen = addMesh(new THREE.PlaneGeometry(1.89, 1.08), material.screen, [-1.20, 2.21, -3.675], work);
  screen.castShadow = false;
  const updateDeskDisplay = createDeskDisplay(material.screen);
  const screenFocusPoint=new THREE.Vector3();
  let screenFocusUntil=0;
  const screenCorners=[[-.945,-.54,0],[.945,-.54,0],[-.945,.54,0],[.945,.54,0]].map(p=>new THREE.Vector3(...p));
  const screenWorldCorners=screenCorners.map(()=>new THREE.Vector3()),gazeDirection=new THREE.Vector3(),gazeScratch=new THREE.Vector3();
  if (material.screen.map) material.screen.map.userData.dynamic = true;
  box([0.12, 0.34, 0.12], [-1.20, 1.50, -3.85], material.bronze, work);
  platform(0.73, 0.39, 0.038, 0.09, [-1.20, 1.34, -3.73], material.gold, work);
  platform(0.94, 0.31, 0.035, 0.045, [-1.15, 1.34, -3.17], material.dark, work);
  for (let row = 0; row < 3; row++) for (let column = 0; column < 10; column++) {
    box([0.062, 0.015, 0.056], [-1.49 + column * 0.073, 1.420, -3.26 + row * 0.082], material.bronze, work);
  }
  lamp(0.12, 1.55, -3.58, 1.07, work);
  const mouse=sphere(.1,[-.45,1.40,-3.15],material.dark,work);mouse.scale.set(.7,.48,1);

  const garden = zoneGroup('garden');
  // One uninterrupted floor-to-ceiling pane; the room boundary remains solid.
  const outsideWorld = await createOutsideWorld(dynamicRoot);
  const weatherView=createWeatherView(dynamicRoot);
  const windowGlassMaterial = new THREE.MeshBasicMaterial({color:0xc5dce4,transparent:true,opacity:.025,depthWrite:false,side:THREE.DoubleSide});
  const windowGlass = addMesh(new THREE.PlaneGeometry(5.54,4.68),windowGlassMaterial,[3.03,2.37,-4.42],garden);
  windowGlass.name='panoramic-window-glass';windowGlass.castShadow=false;
  for(const x of [.25,5.81]) box([.045,4.71,.05],[x,2.37,-4.42],material.dark,garden);
  for(const y of [.04,4.70]) box([5.60,.035,.05],[3.03,y,-4.42],material.dark,garden);
  // A narrow supported perch preserves the viewing behavior without a deep sill.
  box([4.70,.10,.42],[3.10,1.23,-3.88],material.wood,garden);
  for(const x of [1.18,5.02]) box([.08,1.18,.22],[x,.59,-3.91],material.darkWood,garden);

  const flight = zoneGroup('flight');
  const rugMaterial = new THREE.MeshStandardMaterial({ map: textures.rug, roughness: 1, metalness: 0 });
  const rugMesh = addMesh(new THREE.CircleGeometry(2.11, 80), rugMaterial, [0.20, 0.036, 0.88], flight);
  rugMesh.rotation.x = -Math.PI / 2; rugMesh.castShadow = false;
  const rugEdge = addMesh(new THREE.TorusGeometry(2.13, 0.026, 5, 90), material.fabric, [0.20, 0.042, 0.88], flight); rugEdge.rotation.x = Math.PI / 2;
  // Invisible proxy makes the flying area selectable without adding a HUD to the room.
  const flightHit = addMesh(new THREE.CylinderGeometry(2.14, 2.14, 0.1, 40), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }), [0.20, 0.07, 0.88], flight); flightHit.castShadow = false;

  const entry = zoneGroup('entry');
  const nook = zoneGroup('nook');
  const perch = zoneGroup('perch');
  const toilet = zoneGroup('toilet');
  await buildOpenHabitat({THREE,box,cylinder,sphere,addMesh,material,groups:{entry,perch}});
  buildHabitatRenovation({THREE,box,cylinder,sphere,path,platform,addMesh,leaf,material,groups:{entry,nook,perch,work}});
  refineBookcase({nook,material});
  await buildKenneyRoom({THREE,box,cylinder,material,groups:{feed,work,toilet}});

  // Botanical layering links the furniture to the architecture.
  potPlant(-5.51, 0.03, 3.66, .48, feed, 5);

  potPlant(1.66, 0.03, 3.83, 0.75, flight, 8);
  const vine = [[-5.60, 3.53, -3.96], [-4.90, 4.21, -4.02], [-3.90, 4.35, -4.03], [-3.20, 4.10, -4.02], [-2.82, 3.59, -4.04], [-2.78, 2.96, -4.01]];
  path(vine, 0.025, material.moss, rest);
  for (let index = 0; index < 30; index++) {
    const amount = index / 29 * (vine.length - 1);
    const start = Math.min(vine.length - 2, Math.floor(amount));
    const t = amount - start;
    const point = vine[start].map((value, axis) => THREE.MathUtils.lerp(value, vine[start + 1][axis], t));
    leaf(point, 0.34 + random() * 0.23, 0.82, [0.45 + random() * 0.6, random() * 2 - 1, (index % 2 ? -1 : 1) * (1.0 + random())], index % 4 ? 0xffffff : 0xa8ba81);
  }
  box([1.75,.14,.59],[-1.99,.105,3.96],material.darkWood);
  const bookMaterials = [0x5f4a35, 0x3e4843, 0x746348, 0x4a3931, 0x554539].map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.92 }));
  for (let index = 0; index < 7; index++) {
    const height = 0.61 + random() * 0.22;
    const book = box([0.18, height, 0.45], [-2.65 + index * 0.22, height / 2 + 0.20, 3.96], bookMaterials[index % bookMaterials.length]); book.rotation.z = (index - 3) * 0.025;
    for (const y of [0.34, 0.73]) box([0.15, 0.015, 0.012], [-2.65 + index * 0.22, y, 4.192], material.gold);
  }
  lamp(-5.07, 3.21, -0.96, 0.72, rest, true);
  lamp(0.10, 3.64, -3.80, 0.76, work, true);

  buildInteriorDetails({ THREE, box, cylinder, sphere, path, platform, addMesh, leaf, material, groups: { rest, feed, work, garden, entry, flight } });
  buildInteriorRefinement({THREE,material,groups:{rest,feed,work,garden,flight,entry,nook,perch,toilet,architecture:staticRoot}});
  // Water ripples come from the live water shader; remove the former metallic
  // rings, which read as floating ornaments and are not resource surfaces.
  const decorativeRipples=[];
  feed.traverse(mesh=>{if(mesh.isMesh&&mesh.geometry.type==='TorusGeometry'&&Math.abs(mesh.position.x-FOOD_PROPS.water.x)<.2&&Math.abs(mesh.position.z-FOOD_PROPS.water.z)<.2&&mesh.geometry.parameters.radius<.1)decorativeRipples.push(mesh);});
  for(const mesh of decorativeRipples){mesh.removeFromParent();mesh.geometry.dispose();}

  const leafInstances = new THREE.InstancedMesh(leafGeometry(), material.leaf, leaves.length);
  // Only foliage between the follow camera and the resident fades. Per-instance
  // cutaway preserves one opaque draw call and does not hide the whole garden.
  const leafFade = new Float32Array(leaves.length).fill(1);
  const leafFadeAttribute = new THREE.InstancedBufferAttribute(leafFade, 1);
  leafInstances.geometry.setAttribute('cameraFade', leafFadeAttribute);
  const leafBounds = [];
  leafInstances.geometry.computeBoundingSphere();
  material.leaf.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float cameraFade; varying float leafCameraFade;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nleafCameraFade = cameraFade;');
    shader.fragmentShader = 'varying float leafCameraFade;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\nif (leafCameraFade < .5) discard;');
  };
  material.leaf.customProgramCacheKey = () => 'resident-foliage-v2';
  leafInstances.name = 'Botanical_leaf_canopy'; leafInstances.castShadow = true; leafInstances.receiveShadow = true;
  leaves.forEach((item, index) => {
    transform.position.set(...item.position); transform.rotation.set(...item.rotation); transform.scale.set(item.length * item.widthScale, item.length, item.length); transform.updateMatrix();
    leafInstances.setMatrixAt(index, transform.matrix); tone.set(item.tint); leafInstances.setColorAt(index, tone);
    leafBounds.push(leafInstances.geometry.boundingSphere.clone().applyMatrix4(transform.matrix));
  });
  staticRoot.add(leafInstances);


  const foodRoots=new Map();staticRoot.updateMatrixWorld(true);
  staticRoot.traverse(object=>{const id=object.userData.resourceId;if(RESOURCE_BY_ID[id]?.kind==='food'){if(!foodRoots.has(id))foodRoots.set(id,[]);foodRoots.get(id).push(object);}});
  const foodMeshes=[];
  for(const [id,roots]of foodRoots){const combined=new THREE.Group(),parent=roots[0].parent;for(const root of roots)combined.attach(root);const portions=splitFood(combined,RESOURCE_BY_ID[id]);parent.add(portions);portions.traverse(o=>{if(o.isMesh&&o.userData.foodTag)foodMeshes.push(o);});}

  // Merge only immutable opaque furniture, by zone and material. Picking still
  // resolves to the same zone group; the articulated actor is never traversed.
  staticRoot.updateMatrixWorld(true);
  const staticBatches = new Map();
  const staticSourceGeometries = new Set();
  let originalStaticMeshCount = 0;
  staticRoot.traverse(object => {
    if (!object.isMesh || object.isInstancedMesh || Array.isArray(object.material)) return;
    originalStaticMeshCount++;
    if (object.material.transparent||object.userData.foodTag) return;
    let owner = object.parent;
    while (owner && owner !== staticRoot && !owner.userData.zoneId) owner = owner.parent;
    owner ||= staticRoot;
    const key = `${owner.uuid}:${object.material.uuid}:${object.castShadow}:${object.receiveShadow}`;
    if (!staticBatches.has(key)) staticBatches.set(key, { owner, mat: object.material, castShadow: object.castShadow, receiveShadow: object.receiveShadow, sources: [] });
    staticBatches.get(key).sources.push(object);
  });
  let mergedStaticMeshCount = originalStaticMeshCount;
  for (const batch of staticBatches.values()) {
    if (batch.sources.length < 2) continue;
    const transformed = batch.sources.map(source => {
      const geometry = source.geometry.index ? source.geometry.toNonIndexed() : source.geometry.clone();
      geometry.applyMatrix4(source.matrixWorld);
      for (const attribute of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv','color'].includes(attribute)) geometry.deleteAttribute(attribute);
      // Botanical colors belong to the actual source surfaces. Uncolored
      // sources sharing a colored material contribute neutral white.
      if(batch.mat.vertexColors&&!geometry.attributes.color)geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count*3).fill(1),3));
      if(!batch.mat.vertexColors)geometry.deleteAttribute('color');
      return geometry;
    });
    const combined = mergeGeometries(transformed, false);
    transformed.forEach(geometry => geometry.dispose());
    if (!combined) continue;
    combined.computeBoundingBox(); combined.computeBoundingSphere();
    const mesh = new THREE.Mesh(combined, batch.mat);
    mesh.name = `${batch.owner.userData.zoneId || 'architecture'}_material_batch`;
    mesh.castShadow = batch.castShadow; mesh.receiveShadow = batch.receiveShadow;
    batch.owner.add(mesh);
    for (const source of batch.sources) { source.removeFromParent(); staticSourceGeometries.add(source.geometry); }
    mergedStaticMeshCount -= batch.sources.length - 1;
  }
  staticSourceGeometries.forEach(geometry => geometry.dispose());

  const ambient = new THREE.HemisphereLight(0xc2d5dc, 0x59452f, 1.25); scene.add(ambient);
  const sunlight = new THREE.DirectionalLight(0xffd19b, 3.0);
  sunlight.position.set(5.8, 8.2, -4.0); sunlight.target.position.set(-0.8, 0, 1.7); scene.add(sunlight, sunlight.target);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(4096, 4096);
  sunlight.shadow.camera.left = -9; sunlight.shadow.camera.right = 9; sunlight.shadow.camera.top = 8; sunlight.shadow.camera.bottom = -8;
  sunlight.shadow.camera.near = 0.5; sunlight.shadow.camera.far = 26;
  sunlight.shadow.bias = -0.00025; sunlight.shadow.normalBias = 0.006;
  sunlight.shadow.autoUpdate = false; sunlight.shadow.needsUpdate = true;
  const warm = new THREE.PointLight(0xffb858, 29, 7.2, 2); warm.position.set(-4.14, 1.85, -2.81); scene.add(warm);
  const deskLight = new THREE.PointLight(0xffc579, 16, 5.7, 2); deskLight.position.set(0.0, 2.38, -2.93); scene.add(deskLight);
  const blueFill = new THREE.PointLight(0x93c9ec, 17, 8.4, 2); blueFill.position.set(3.18, 3.13, -3.33); scene.add(blueFill);
  const frontFill = new THREE.DirectionalLight(0xbad5e4, 1.1); frontFill.position.set(3, 6, 9); scene.add(frontFill);

  let character = createMirrorGapCharacter(),characterSeed=null;
  character.root.position.set(...ZONE_BY_ID.flight.position);
  character.root.scale.setScalar(CHARACTER_SCALE);
  // Furniture shadows are cached. The moving resident uses the soft contact
  // decal below, so software-rendered WebGL does not redraw all shadows per frame.
  character.root.traverse(object => { if (object.isMesh) object.castShadow = false; });
  dynamicRoot.add(character.root);
  const toiletPellet=sphere(.012,[0,0,0],material.darkWood,dynamicRoot);toiletPellet.scale.set(.8,1,1.2);toiletPellet.visible=false;
  const actorShadow = addMesh(new THREE.PlaneGeometry(0.72, 0.72), new THREE.MeshBasicMaterial({ map: textures.shadow, transparent: true, opacity: 0.24, depthWrite: false }), [0.25, 0.054, 0.75], dynamicRoot);
  actorShadow.rotation.x = -Math.PI / 2; actorShadow.castShadow = false;
  const selectionRing = addMesh(new THREE.TorusGeometry(0.66, 0.012, 5, 56), new THREE.MeshBasicMaterial({ color: 0xddb97b, transparent: true, opacity: 0.56, depthWrite: false }), [0, 0.09, 0], dynamicRoot);
  selectionRing.rotation.x = -Math.PI / 2; selectionRing.visible = false; selectionRing.castShadow = false;

  const dustCount = 80;
  const dustPositions = new Float32Array(dustCount * 3);
  const dustBase = [];
  for (let index = 0; index < dustCount; index++) {
    const point = [(random() - 0.5) * 10.4, random() * 4.1 + 0.3, (random() - 0.5) * 7.3];
    dustBase.push(point); dustPositions.set(point, index * 3);
  }
  const dustGeometry = new THREE.BufferGeometry(); dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0xeec58b, size: 0.026, transparent: true, opacity: 0.48, depthWrite: false, sizeAttenuation: true })); dynamicRoot.add(dust);
  const mistPositions = new Float32Array(42 * 3);
  const mistBase = [];
  for (let index = 0; index < 42; index++) {
    const point = [2.85 + random() * 2.3, 0.5 + random() * 1.65, -.65 + random() * 3.9];
    mistBase.push(point); mistPositions.set(point, index * 3);
  }
  const mistGeometry = new THREE.BufferGeometry(); mistGeometry.setAttribute('position', new THREE.BufferAttribute(mistPositions, 3));
  const mist = new THREE.Points(mistGeometry, new THREE.PointsMaterial({ color: 0xc3e3e4, size: 0.061, transparent: true, opacity: 0, depthWrite: false }));
  mist.visible = false; dynamicRoot.add(mist);
  const windChime = new THREE.PointLight(0xffd091, 0, 4, 2); windChime.position.set(4.52, 2.3, 3.4); dynamicRoot.add(windChime);

  let mode = 'follow';
  let cameraClipMode = 'overview';
  let elapsed = 0;
  let disposed = false;
  let contextLost = false;
  let aspect = 1;
  let transition = false;
  let selectionTime = 0;
  let actorPositionInitialized = false;
  let followHeading = 0;
  let sourceActorHeading = 0;
  let cameraAvoidance = false;
  let previousCameraOption = 0, cameraChoiceElapsed = 1;
  let cameraFrameDelta = 0;
  const playback = new ActorPlayback();
  let followNeedsPlacement = true;
  const gl = renderer.getContext();
  const gpuInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const gpuName = gpuInfo ? gl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL) : 'unknown';
  const softwareRenderer = /SwiftShader|llvmpipe|Software|Microsoft Basic/i.test(gpuName);
  await waitForSurfaceTextures();
  const lightweight=softwareRenderer?lightweightMaterials(scene):null;
  // The opt-in view owns its live signal materials and their lifetime. Create it
  // after the resident-room conversion so that signal colors keep their authority.
  mechanicalView=cooperative?createMechanicalView({THREE,parent:dynamicRoot}):null;
  const softwareBatch=softwareRenderer?batchSoftwareRoom(staticRoot):null;
  if(softwareRenderer){renderer.shadowMap.enabled=false;scene.environment=null;}
  const waterSurfaces=createWaterSurfaces(scene,renderer,{software:softwareRenderer});
  const renderFinish=createHomeRenderFinish(renderer,scene,camera,{software:softwareRenderer});
  let quality = softwareRenderer ? .45 : Math.min(window.devicePixelRatio || 1, 1.5);
  let frameAverage = 16.67, qualityElapsed = 0, slowWindows = 0;
  const frameTimes = [];

  const desiredTarget = new THREE.Vector3(0, 1.25, -0.1);
  const desiredCamera = new THREE.Vector3();
  const targetPosition = new THREE.Vector3();
  const previousActorPosition = new THREE.Vector3();
  const pausedBodyDelta = new THREE.Vector3();
  const cameraAnchor = new THREE.Vector3();
  const calmFollow = new CalmFollow();
  const cameraForward = new THREE.Vector3(0, 0, 1);
  const cameraRight = new THREE.Vector3(1, 0, 0);
  const candidateCamera = new THREE.Vector3();
  const safeCamera = new THREE.Vector3();
  const resolvedCamera = new THREE.Vector3();
  const foliageSight = new THREE.Line3();
  const foliagePoint = new THREE.Vector3();
  // Broad collision volumes cover the solid furnishings, including the closed
  // monitor. Leaves, dust, transparent vessels, and picking proxies do
  // not push the camera around. Inflating by the lens radius protects corners.
  const cameraObstacles = SOLIDS.map(solid => new THREE.Box3(new THREE.Vector3(...solid.min), new THREE.Vector3(...solid.max)).expandByScalar(.075));
  for (const branch of BRANCH_SEGMENTS) cameraObstacles.push(new THREE.Box3().setFromPoints([new THREE.Vector3(...branch.start), new THREE.Vector3(...branch.end)]).expandByScalar(branch.radius + .05));
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerStart = null;

  function overviewPosition() {
    const narrow = aspect < 0.85;
    return new THREE.Vector3(narrow ? 14.8 : 13.0, narrow ? 13.8 : 11.1, narrow ? 20.6 : 17.1).multiplyScalar(narrow ? 1.13 : 0.97);
  }
  function updateCameraClipping(bodyScale = followActor==='mechanical' ? .045/.085 : character.root.scale.x / CHARACTER_SCALE, gameView = false) {
    // The first snapshot can replace the legacy-sized placeholder with a tiny
    // resident. Refresh orbit limits too, so the first drag does not jump away.
    if (mode === 'overview' || mode === 'zone') controls.minDistance = 3.2;
    else if (['follow', 'close', 'first'].includes(mode)) controls.minDistance = bodyScale < .2 ? .025 : .48;
    const clip = cameraClipping(mode, {
      bodyScale, gameView, orbitDistance: camera.position.distanceTo(controls.target),
    });
    cameraClipMode = clip.mode;
    if (camera.near !== clip.near || camera.far !== clip.far) {
      camera.near = clip.near; camera.far = clip.far;
      camera.updateProjectionMatrix();
    }
  }
  function trackResident(actor, dt, subjectRoot=character.root, distanceScale=1) {
    if(bodyMetrics(actor).scale<.2){trackSmallResident(actor,dt,subjectRoot);return;}
    const velocity = Array.isArray(actor?.velocity) && actor.velocity.length === 3
      && actor.velocity.every(Number.isFinite) ? actor.velocity : null;
    const planarSpeed = velocity ? Math.hypot(velocity[0], velocity[2]) : 0;
    const moving = actor?.mode === 'travel' || actor?.action === 'explore';
    if(!calmFollow.initialized)calmFollow.reset(followHeading);
    if(subjectRoot===character.root)followHeading=calmFollow.update(actor,dt);
    // Mechanical controls follow the camera axes. Keep its yaw until the player
    // recentres the view, so holding a strafe input cannot turn into a circle.
    cameraAnchor.copy(subjectRoot.position); cameraAnchor.y += (actor?.contact ? .05 : .12)*(subjectRoot===character.root?1:bodyMetrics(actor).scale);
    cameraForward.set(Math.sin(followHeading), 0, Math.cos(followHeading));
    cameraRight.set(cameraForward.z, 0, -cameraForward.x);
    const framing = (aspect < 0.85 ? 1.22 : 1)*distanceScale;
    const options = mode === 'follow'
      ? [[0, .68, -1.85], [0, 1.1, -1.85], [.65, .8, -1.85], [-.65, .8, -1.85], [0, 1.65, -1.85], [1.1, .8, -.6], [-1.1, .8, -.6], [0, .85, 1.5], [0, .02, 1.6], [.6, .02, 1.4], [-.6, .02, 1.4]]
      : [[0.38, 0.38, 1.60], [1.08, 0.55, 1.20], [-1.08, 0.55, 1.20], [1.52, 0.52, 0.24], [-1.52, 0.52, 0.24], [0.40, 0.55, -1.65], [0, .02, 1.6], [.6, .02, 1.4], [-.6, .02, 1.4]];
    let bestScore = -Infinity;
    let bestOption = 0;
    let bestClipped = false;
    cameraChoiceElapsed+=dt;const reconsider=cameraChoiceElapsed>=.12||followNeedsPlacement;if(reconsider)cameraChoiceElapsed=0;
    options.forEach(([side, height, distance], index) => {
      if(!reconsider&&index!==previousCameraOption)return;
      candidateCamera.copy(cameraAnchor)
        .addScaledVector(cameraForward, distance * framing)
        .addScaledVector(cameraRight, side * framing);
      candidateCamera.y += height * framing;
      constrainResidentCamera(cameraAnchor, candidateCamera, cameraObstacles, safeCamera);
      const wantedDistance = cameraAnchor.distanceTo(candidateCamera);
      const clearance = cameraAnchor.distanceTo(safeCamera) / wantedDistance;
      // Prefer the direct shoulder view, changing elevation/side only when it
      // recovers a blocked view. A small preference avoids alternating sides.
      const score = clearance * 2.4 - index * 0.055 + (index === previousCameraOption ? 0.38 : 0);
      if (score > bestScore) {
        bestScore = score; bestOption = index;
        bestClipped = clearance < 0.98;
        desiredCamera.copy(safeCamera);
      }
    });
    previousCameraOption = bestOption;
    cameraAvoidance = bestClipped || bestOption !== 0;
    const armLength = desiredCamera.distanceTo(subjectRoot.position);
    const baseFov = aspect < 0.85 ? 44 : 37;
    const closeFraming = THREE.MathUtils.clamp((.85 - armLength) / .5, 0, 1);
    camera.fov = THREE.MathUtils.damp(camera.fov, THREE.MathUtils.lerp(baseFov, 58, closeFraming), 2, dt);
    camera.updateProjectionMatrix();
    desiredTarget.copy(cameraAnchor);
    if (mode === 'follow') {
      const lookAheadScale = THREE.MathUtils.clamp((armLength - 0.5) / 1.2, 0.05, 1);
      desiredTarget.addScaledVector(cameraForward, (.12 + Math.min(planarSpeed, 2.5) * .035) * lookAheadScale);
      if (velocity) desiredTarget.y += THREE.MathUtils.clamp(velocity[1] * 0.10, -0.10, 0.16);
    }
    const settleRate=actor?.contact && planarSpeed<.04 ? 7 : 2.6;
    if(subjectRoot!==character.root&&followNeedsPlacement){camera.position.copy(desiredCamera);controls.target.copy(desiredTarget);}
    camera.position.lerp(desiredCamera, 1 - Math.exp(-settleRate * dt));
    if(camera.position.distanceToSquared(desiredCamera)<.000009)camera.position.copy(desiredCamera);
    controls.target.lerp(desiredTarget, 1 - Math.exp(-6 * dt));
    // Recheck after interpolation: a turn around a cupboard must not put the
    // intermediate camera inside it, even when both endpoints are clear.
    constrainResidentCamera(cameraAnchor, camera.position, cameraObstacles, resolvedCamera);
    cameraAvoidance ||= camera.position.distanceToSquared(resolvedCamera) > 0.0001;
    camera.position.copy(resolvedCamera);
    camera.position.x = Math.max(-5.48, camera.position.x);
    camera.position.z = Math.max(-3.96, camera.position.z);
    camera.position.y = Math.max(.28, camera.position.y);
    camera.lookAt(controls.target);
  }
  function trackSmallResident(actor,dt,subjectRoot=character.root){
    const body=bodyMetrics(actor);
    if(!calmFollow.initialized)calmFollow.reset(followHeading);
    followHeading=calmFollow.update(actor,dt);
    cameraAnchor.copy(subjectRoot.position);cameraAnchor.y+=body.radius*.25;
    cameraForward.set(Math.sin(followHeading),0,Math.cos(followHeading));
    cameraRight.set(cameraForward.z,0,-cameraForward.x);
    // A fixed macro distance makes body growth visible rather than cancelling it
    // with an equal camera zoom. Translation follows immediately to avoid losing
    // a tiny, fast-flying animal; only the heading is smoothed.
    const framing=aspect<.85?1.25:1;
    const options=[[0,.043,-.115],[.08,.07,-.06],[-.08,.07,-.06],[0,.13,-.025],[0,.07,.10]];
    let found=false;
    for(let i=0;i<options.length;i++){
      const [side,height,distance]=options[i];
      candidateCamera.copy(cameraAnchor).addScaledVector(cameraForward,distance*framing).addScaledVector(cameraRight,side*framing);
      candidateCamera.y+=height*framing;
      candidateCamera.x=THREE.MathUtils.clamp(candidateCamera.x,-5.70,5.70);
      candidateCamera.y=THREE.MathUtils.clamp(candidateCamera.y,.042,4.60);
      candidateCamera.z=THREE.MathUtils.clamp(candidateCamera.z,-4.10,4.18);
      if(!segmentOccluded(cameraAnchor.toArray(),candidateCamera.toArray(),actor)){
        camera.position.copy(candidateCamera);previousCameraOption=i;found=true;break;
      }
    }
    if(!found){camera.position.copy(cameraAnchor);camera.position.y+=body.radius*3;camera.position.z-=body.length*2;}
    cameraAvoidance=!found||previousCameraOption!==0;
    camera.fov=aspect<.85?44:37;camera.updateProjectionMatrix();
    controls.target.copy(cameraAnchor);camera.lookAt(controls.target);
  }
  function resize() {
    if (disposed) return;
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width || canvas.parentElement?.clientWidth || 1));
    const height = Math.max(1, Math.round(bounds.height || canvas.parentElement?.clientHeight || 1));
    aspect = width / height;
    renderer.setPixelRatio(quality);
    renderer.setSize(width, height, false);
    renderFinish.resize(width,height);
    camera.aspect = aspect;
    camera.fov = mode==='first'?76:aspect < 0.85 ? 44 : 37;
    camera.updateProjectionMatrix();
    if (mode === 'overview') { desiredCamera.copy(overviewPosition()); transition = true; }
  }
  function setView(nextMode = 'overview') {
    if (disposed) return;
    // Consume any pending orbit damping before an automatic rig takes over.
    controls.enableDamping = false; controls.update();
    mode = ['overview', 'follow', 'first'].includes(nextMode) ? nextMode : 'overview';
    if(followActor==='mechanical'&&mode==='first')mode='follow';
    controls.enabled=mode!=='first';character.root.visible=mode!=='first'||followActor==='mechanical';
    updateCameraClipping();
    camera.fov = mode==='first'?76:aspect < 0.85 ? 44 : 37; camera.updateProjectionMatrix();

    cameraAvoidance = false; previousCameraOption = 0;
    followNeedsPlacement = true;
    if (mode === 'overview') {
      desiredTarget.set(0, 1.25, -0.1); desiredCamera.copy(overviewPosition()); transition = true;
    } else {
      followHeading = (followActor==='mechanical'?mechanicalView?.getFollowTarget()?.actor.heading:null)??character.root.rotation.y; calmFollow.reset(followHeading);
      transition = false;
    }
  }
  function setFollowActor(nextActor='neural'){
    if(!['mechanical','neural'].includes(nextActor))throw new TypeError('Unknown follow actor');
    if(nextActor==='mechanical'&&!mechanicalView)throw new Error('Mechanical following requires cooperative mode');
    if(disposed)return;
    followActor=nextActor;setView('follow');
  }
  function focusZone(id) {
    const zone = ZONE_BY_ID[id];
    if (!zone || disposed) return;
    mode = 'zone';
    controls.enabled=true;character.root.visible=true;updateCameraClipping();
    camera.fov = aspect < 0.85 ? 44 : 37; camera.updateProjectionMatrix();

    desiredTarget.set(zone.position[0], Math.max(0.9, zone.position[1]), zone.position[2]);
    const distance = aspect < 0.85 ? 1.35 : 1;
    desiredCamera.copy(desiredTarget).add(new THREE.Vector3(5.0 * distance, 4.1 * distance, 6.8 * distance));
    transition = true;
    selectionRing.position.set(zone.position[0], id === 'garden' ? 0.76 : id === 'feed' ? 1.10 : 0.09, zone.position[2]);
    selectionRing.visible = true; selectionTime = 4;
  }
  function pointerDown(event) { pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId }; }
  function pointerUp(event) {
    if (disposed || !pointerStart || pointerStart.id !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y); pointerStart = null;
    if (distance > 6) return;
    const bounds = canvas.getBoundingClientRect();
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(selectable, true);
    for (const hit of hits) {
      let object = hit.object;
      while (object && !object.userData.zoneId) object = object.parent;
      if (object?.userData.zoneId) {
        const id = object.userData.zoneId;
        selectionRing.position.set(ZONE_BY_ID[id].position[0], id === 'garden' ? 0.76 : id === 'feed' ? 1.10 : 0.09, ZONE_BY_ID[id].position[2]);
        selectionRing.visible = true; selectionTime = 3;
        if (typeof onZoneSelect === 'function') onZoneSelect(id);
        break;
      }
    }
  }
  function cancelPointer() { pointerStart = null; }
  function controlsStart() {
    transition = false;
    if (mode !== 'overview') {
      mode = 'manual';
      if (typeof onViewChange === 'function') onViewChange('manual');
    }
  }
  function lost(event) { event.preventDefault(); contextLost = true; }
  function restored() { contextLost = false; sunlight.shadow.needsUpdate = true; resize(); }
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', cancelPointer);
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  controls.addEventListener('start', controlsStart);

  let lastShadowRefresh = -1, lastShadowHour = NaN;
  function update(snapshot, delta = 1 / 60) {return withFoodStock(snapshot,()=>updateScene(snapshot,delta));}
  function updateScene(snapshot, delta) {
    if (disposed || contextLost) return;
    cueMarkers?.update(snapshot);
    updateFoodPortions(foodMeshes,snapshot.living?.care?.foods);
    const nextSeed=snapshot.companion?.identity?.seed??null;
    if(nextSeed&&nextSeed!==characterSeed){
      const old=character, replacement=createMirrorGapCharacter(nextSeed);
      replacement.root.position.copy(old.root.position);replacement.root.quaternion.copy(old.root.quaternion);replacement.root.scale.copy(old.root.scale);
      replacement.root.traverse(object=>{if(object.isMesh)object.castShadow=false;});
      dynamicRoot.remove(old.root);dynamicRoot.add(replacement.root);character=replacement;characterSeed=nextSeed;old.dispose();
    }
    // Camera motion follows wall time even on a slow software renderer. Actor
    // animation remains bounded separately; a low frame rate must not stretch
    // an ordinary camera turn into several seconds of looking ahead of the fly.
    const cameraDt = Math.min(0.5, Math.max(0, Number.isFinite(delta) ? delta : 0));
    const dt = Math.min(0.1, cameraDt);
    cameraFrameDelta = cameraDt;
    if (cameraDt > 0 && !document.hidden) {
      const ms = cameraDt * 1000;
      frameTimes.push(ms); if (frameTimes.length > 180) frameTimes.shift();
      frameAverage += (Math.min(ms, 100) - frameAverage) * .04;
      qualityElapsed += cameraDt;
      if (qualityElapsed >= 2) {
        qualityElapsed = 0;
        slowWindows = frameAverage > 24 ? slowWindows + 1 : 0;
        const limit = Math.min(window.devicePixelRatio || 1, softwareRenderer ? .55 : 1.5);
        const next = slowWindows >= 1 ? Math.max(softwareRenderer ? .35 : .75, quality - .15)
          : frameAverage < 18 ? Math.min(limit, quality + .05) : quality;
        if (Math.abs(next - quality) > .01) { quality = next; resize(); }
      }
    }
    elapsed += dt;
    const visual = playback.sample(snapshot, cameraDt);
    const actor = visual.actor;
    const body=bodyMetrics(actor);
    previousActorPosition.copy(character.root.position);
    character.root.scale.setScalar(body.characterScale);
    const actorDt = snapshot?.paused ? 0 : dt;
    mechanicalView?.update(snapshot.coop,actorDt);
    if (actor?.position?.length === 3 && actor.position.every(Number.isFinite)) {
      const predicted = actor.position;
      targetPosition.set(...predicted);
      if (!actorPositionInitialized) {
        character.root.position.copy(targetPosition);
        character.root.rotation.y = Number.isFinite(actor.heading) ? actor.heading : 0;
        followHeading = character.root.rotation.y; calmFollow.reset(followHeading);
        actorPositionInitialized = true;
      } else if (snapshot.paused || (actor.contact && Math.hypot(...(actor.velocity??[0,0,0]))<.04)) character.root.position.copy(targetPosition);
      else {
        const position=character.root.position.toArray();
        const delta=predicted.map((v,i)=>v-position[i]);
        moveBody(position,delta,1,character.root.rotation.y,undefined,undefined,actor);
        character.root.position.set(...position);
      }
      const heading = Number.isFinite(actor.heading) ? actor.heading : character.root.rotation.y;
      sourceActorHeading = heading;
      const difference = Math.atan2(Math.sin(heading - character.root.rotation.y), Math.cos(heading - character.root.rotation.y));
      character.root.rotation.y += difference;
      const safe=character.root.position.toArray();resolveBodyContacts(safe,[0,0,0],character.root.rotation.y,undefined,undefined,actor);character.root.position.set(...safe);
    }
    const cameraDistance=Math.max(camera.near, camera.position.distanceTo(character.root.position));
    const projectedBodyPixels=body.length*Math.max(1,canvas.clientHeight)/(2*cameraDistance*Math.tan(THREE.MathUtils.degToRad(camera.fov)*.5));
    character.setDetailByPixels?.(projectedBodyPixels);
    character.update({ ...actor, contactSeconds:visual.contactSeconds }, actorDt);
    const hygiene=snapshot?.living?.hygiene,dropAge=hygiene?.lastToiletAt===null?Infinity:(snapshot?.simSeconds??0)-(hygiene?.lastToiletAt??-100);
    toiletPellet.visible=dropAge>=0&&dropAge<7&&!!hygiene?.lastDropPosition;
    toiletPellet.scale.set(.8*body.scale,body.scale,1.2*body.scale);
    if(toiletPellet.visible){const [x,y,z]=hygiene.lastDropPosition;toiletPellet.position.set(x,Math.max(.278,y-dropAge*dropAge*.4),z);}
    actorShadow.position.x = character.root.position.x; actorShadow.position.z = character.root.position.z;
    actorShadow.material.opacity = THREE.MathUtils.clamp(0.25 - character.root.position.y * 0.035, 0.07, 0.20);
    actorShadow.scale.setScalar((0.70 + character.root.position.y * 0.12)*body.scale);
    if (selectionTime > 0) {
      selectionTime -= dt; selectionRing.material.opacity = Math.min(0.54, selectionTime * 0.32);
      selectionRing.scale.setScalar(1 + Math.sin(elapsed * 2.2) * 0.025);
      if (selectionTime <= 0) selectionRing.visible = false;
    }
    const hour = Number.isFinite(snapshot?.clock?.hour) ? snapshot.clock.hour : 17;
    const daylight = (snapshot?.clock?.daylight ?? Math.max(0, Math.sin((hour - 6) / 24 * TAU)))*(1-(snapshot?.weather?.cloud??0)*.3);
    weatherView.update(snapshot?.weather,snapshot?.paused?0:cameraDt);
    outsideWorld.update(hour, daylight, snapshot?.paused ? 0 : cameraDt);
    updateDeskDisplay(snapshot?.living?.workstation, snapshot?.simSeconds ?? elapsed);
    const sunAngle = (hour - 6) / 12 * Math.PI;
    // The only glazed opening is the right half of the rear wall. Keep the
    // daytime key outside that opening rather than behind the opaque stone.
    sunlight.position.set(5.5 + Math.cos(sunAngle) * 2, 3 + Math.max(0, Math.sin(sunAngle)) * 7, -6);
    if (Math.floor(elapsed / 2) !== lastShadowRefresh || Math.abs(hour-lastShadowHour) > .02 || !Number.isFinite(lastShadowHour)) {
      sunlight.shadow.needsUpdate = true;
      lastShadowRefresh = Math.floor(elapsed / 2); lastShadowHour = hour;
    }
    updatePhysicalHomeLight({renderer,scene,ambient,sunlight,warm,deskLight,blueFill,frontFill},daylight,hour,snapshot?.living?.shadow??0);
    material.bulb.emissiveIntensity = 2.9;
    lightweight?.update(daylight);softwareBatch?.update(daylight);
    material.window.color.setRGB(0.68 + daylight * 0.24, 0.70 + daylight * 0.22, 0.80 + daylight * 0.18);
    const reaction = snapshot?.reaction?.type;
    mist.visible = reaction === 'mist';
    if (mist.visible) {
      mist.material.opacity = 0.20 + Math.sin(elapsed * 2) * 0.045;
      for (let index = 0; index < mistBase.length; index++) {
        mistPositions[index * 3] = mistBase[index][0] + Math.sin(elapsed * 0.72 + index) * 0.12;
        mistPositions[index * 3 + 1] = 0.88 + ((mistBase[index][1] + elapsed * 0.12) % 1.66);
      }
      mistGeometry.attributes.position.needsUpdate = true;
    }
    windChime.intensity = reaction === 'chime' ? 7 + Math.sin(elapsed * 6) * 3 : 0;
    for (let index = 0; index < dustCount; index++) {
      dustPositions[index * 3] = dustBase[index][0] + Math.sin(elapsed * 0.12 + index) * 0.07;
      dustPositions[index * 3 + 1] = dustBase[index][1] + Math.sin(elapsed * 0.20 + index * 1.7) * 0.13;
    }
    dustGeometry.attributes.position.needsUpdate = true;
    const mechanicalTarget=followActor==='mechanical'?mechanicalView?.getFollowTarget():null;
    const cameraActor=mechanicalTarget?.actor??actor,cameraRoot=mechanicalTarget?.root??character.root;
    const gameView=!mechanicalTarget&&['first','follow','close'].includes(mode)&&snapshot?.living?.workstation?.phase==='playing';
    character.root.visible=mode!=='first'||gameView||Boolean(mechanicalTarget);
    if(mechanicalTarget&&['follow','close','first'].includes(mode)){
      trackResident(cameraActor,snapshot?.paused?(followNeedsPlacement?10:0):cameraDt,cameraRoot,.34);
      followNeedsPlacement=false;
    }else if(gameView){
      const gameFov=aspect<.85?44:37;
      if(camera.fov!==gameFov){camera.fov=gameFov;camera.updateProjectionMatrix();}
      if(!snapshot?.paused||followNeedsPlacement){
        camera.position.lerp(new THREE.Vector3(-1.2,2.16,-1.25),1-Math.exp(-cameraDt*3));
        controls.target.lerp(new THREE.Vector3(-1.2,2.21,-3.675),1-Math.exp(-cameraDt*3));
      }
      camera.lookAt(controls.target);followNeedsPlacement=false;
    }else if(mode==='first'){
      const heading=character.root.rotation.y;
      const delta=Math.atan2(Math.sin(heading-followHeading),Math.cos(heading-followHeading));
      followHeading+=delta*(1-Math.exp(-cameraDt*9));
      camera.position.copy(character.root.position);camera.position.x+=Math.sin(heading)*.14*body.scale;camera.position.z+=Math.cos(heading)*.14*body.scale;camera.position.y+=.035*body.scale;
      controls.target.copy(camera.position);controls.target.x+=Math.sin(followHeading);controls.target.z+=Math.cos(followHeading);
      controls.target.y+=Math.sin(actor.pitch??0);
      const screenEngaged=['playing','attention'].includes(snapshot?.living?.workstation?.phase)||['play','watch'].includes(actor?.behavior)||['play','watch'].includes(snapshot?.living?.behavior);
      if(screenEngaged)screenFocusUntil=elapsed+.8;
      if(screenEngaged||(actor.contact&&actor.zoneId==='work'&&elapsed<screenFocusUntil)){
        screen.updateWorldMatrix(true,false);gazeDirection.set(0,0,0);
        screenCorners.forEach((corner,i)=>{screenWorldCorners[i].copy(corner).applyMatrix4(screen.matrixWorld);gazeScratch.copy(screenWorldCorners[i]).sub(camera.position).normalize();gazeDirection.add(gazeScratch);});
        controls.target.copy(camera.position).add(gazeDirection.normalize());camera.lookAt(controls.target);camera.updateMatrixWorld();
        let tangent=Math.tan(76*Math.PI/360);
        for(const corner of screenWorldCorners){gazeScratch.copy(corner).applyMatrix4(camera.matrixWorldInverse);if(gazeScratch.z<-.01)tangent=Math.max(tangent,Math.abs(gazeScratch.y/-gazeScratch.z)*1.06,Math.abs(gazeScratch.x/-gazeScratch.z)/camera.aspect*1.06);}
        const fov=Math.min(120,Math.atan(tangent)*360/Math.PI);if(Math.abs(camera.fov-fov)>.01){camera.fov=fov;camera.updateProjectionMatrix();}
      }else if(camera.fov!==76){camera.fov=76;camera.updateProjectionMatrix();
      }
      camera.lookAt(controls.target);followNeedsPlacement=false;
    } else if (snapshot?.paused && !followNeedsPlacement && actorPositionInitialized && (mode === 'follow' || mode === 'close')) {
      // Playback/contact can settle the body on the first paused frame. Carry
      // its existing camera offset along without choosing another automatic rig.
      pausedBodyDelta.subVectors(character.root.position,previousActorPosition);
      camera.position.add(pausedBodyDelta);controls.target.add(pausedBodyDelta);
      camera.lookAt(controls.target);
    } else if (mode === 'follow' || mode === 'close') {
      trackResident(actor, snapshot?.paused ? 10 : cameraDt);
      followNeedsPlacement = false;
    } else if (transition) {
      const smoothing = 1 - Math.exp(-4 * cameraDt);
      camera.position.lerp(desiredCamera, smoothing); controls.target.lerp(desiredTarget, smoothing);
      if (camera.position.distanceToSquared(desiredCamera) < 0.0004 && controls.target.distanceToSquared(desiredTarget) < 0.0004) transition = false;
    }
    if (mode !== 'follow' && mode !== 'close' && mode!=='first') controls.update();
    // Resolve after camera movement and for every frame, including paused views.
    // This also restores room precision when leaving a macro or game camera.
    updateCameraClipping(bodyMetrics(cameraActor).scale, gameView);
    foliageSight.set(cameraRoot.position, camera.position);
    const automaticView = mode === 'follow' || mode === 'close';
    let foliageChanged=false;
    for (let i = 0; i < leafBounds.length; i++) {
      const leaf = leafBounds[i];
      foliageSight.closestPointToPoint(leaf.center, true, foliagePoint);
      const obstructs = automaticView && foliagePoint.distanceToSquared(leaf.center) < (leaf.radius + .09) ** 2;
      const wantedFade = obstructs ? 0 : 1;
      foliageChanged ||= leafFade[i]!==wantedFade;leafFade[i] = wantedFade;
    }
    if(foliageChanged)leafFadeAttribute.needsUpdate = true;
    waterSurfaces.update(actor,actorDt,daylight);
    waterSurfaces.renderReflection(camera,frameAverage,cameraDt);
    renderFinish.render();
  }

  async function exportCharacter() {
    if (disposed) throw new Error('房间已经关闭。');
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const model = createCharacterExportClone(character.root);
    model.position.set(0, 0, 0); model.rotation.set(0, 0, 0);
    model.userData.worldBodyLength=1.49*model.scale.x;
    try{
      const data = await new GLTFExporter().parseAsync(model, { binary: true, onlyVisible: true, trs: true });
      return new Blob([data], { type: 'model/gltf-binary' });
    }finally{disposeCharacterExportClone(model);}
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cueMarkers?.dispose();
    mechanicalView?.dispose();
    canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', cancelPointer);
    canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('webglcontextrestored', restored);
    controls.removeEventListener('start', controlsStart); controls.dispose();
    const geometries = new Set(), materials = new Set(), usedTextures = new Set(Object.values(textures));
    scene.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(mat);
        for (const property of ['map', 'emissiveMap', 'normalMap', 'bumpMap', 'roughnessMap', 'alphaMap']) if (mat[property]) usedTextures.add(mat[property]);
      }
    });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(mat => mat.dispose()); usedTextures.forEach(texture => texture.dispose());
    waterSurfaces.dispose();renderFinish.dispose();softwareBatch?.dispose();lightweight?.dispose(); environment?.dispose(); renderer.dispose();
  }

  resize();
  camera.position.copy(overviewPosition()); controls.target.copy(desiredTarget); controls.update(); transition = false;
  renderFinish.render();
  function getDiagnostics() {
    return {
      ...(cueMarkers?{cueMarkers:cueMarkers.diagnostics()}:{}),
      ...(mechanicalView?{cooperative:{...mechanicalView.getDiagnostics(),followActor}}:{}),
      foodPortions:{total:new Set(foodMeshes.map(m=>`${m.userData.foodId}:${m.userData.foodPiece}`)).size,visible:new Set(foodMeshes.filter(m=>m.visible).map(m=>`${m.userData.foodId}:${m.userData.foodPiece}`)).size,byFood:Object.fromEntries([...foodRoots.keys()].map(id=>[id,new Set(foodMeshes.filter(m=>m.visible&&m.userData.foodId===id).map(m=>m.userData.foodPiece)).size]))},
      playback: playback.diagnostics(),
      water:waterSurfaces.diagnostics(),
      staticMeshesBeforeBatching: originalStaticMeshCount,
      staticMeshesAfterBatching: mergedStaticMeshCount,
      exteriorDepths: outsideWorld.depths,
      sky: outsideWorld.getState(),
      weather:weatherView.diagnostics(),
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      pixelRatio: renderer.getPixelRatio(),
      logarithmicDepthBuffer: renderer.capabilities.logarithmicDepthBuffer,
      antialias: renderer.getContext().getContextAttributes().antialias,
      cameraMode: mode,
      cameraClipMode,
      cameraNear: camera.near,
      cameraFar: camera.far,
      cameraOrbitMinDistance: controls.minDistance,
      softwareBatches:softwareBatch?{before:softwareBatch.before,after:softwareBatch.after,retainedSurfaces:softwareBatch.retainedSurfaces}:null, renderFinish:renderFinish.mode, gpuName, softwareRenderer, lightweight:!!lightweight, frameAverageMs: frameAverage,
      frameP95Ms: [...frameTimes].sort((a,b) => a-b)[Math.floor(frameTimes.length * .95)] ?? 0,
      characterBatching: character.root.userData.batching,
      characterSeed,
      cameraFov: camera.fov,
      cameraPosition: camera.position.toArray(),
      cameraTarget: controls.target.toArray(),
      actorPosition: character.root.position.toArray(),
      actorHeading: character.root.rotation.y,
      sourceActorHeading,
      characterScale: character.root.scale.x,
      characterPose: character.root.userData.pose,
      cameraFrameDelta,
      followHeading,
      cameraAvoidance,
      cameraOption: previousCameraOption,
      cameraArmLength: camera.position.distanceTo(character.root.position),
      cameraBehindDot: (camera.position.x - character.root.position.x) * Math.sin(character.root.rotation.y)
        + (camera.position.z - character.root.position.z) * Math.cos(character.root.rotation.y),
      cameraWallClearance: {
        left: camera.position.x + ROOM.width / 2 - 0.52,
        back: camera.position.z + ROOM.depth / 2 - 0.54,
        floor: camera.position.y - 0.28,
      },
    };
  }
  await renderer.compileAsync(scene,camera);
  return { update, setView, setFollowActor, focusZone, resize, dispose, exportCharacter, getDiagnostics, getMovementBasis:()=>horizontalControlBasis(camera), getCooperativeLabels:()=>mechanicalView?.projectLabels(camera)??[], getCollisionGeometry:()=>collectCollisionGeometry(staticRoot) };
}
