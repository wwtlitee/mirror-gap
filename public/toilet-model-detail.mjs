import * as THREE from 'three';
import {naturalMaterial} from './natural-materials.mjs';

// Dimensions are measured from toiletSquare.glb. The final room normalization,
// quarter turn, open-lid hinge and flat side-rim landing surfaces stay authored.
const BOWL = {x:.15181,z:-.14447336,outerX:.120554987,outerZ:.14447336,innerX:.09784370,innerZ:.12176207,rimY:.227715};

function roundedPerimeter(halfX, halfZ, radius, segments = 6) {
  const r = Math.min(radius, halfX * .8, halfZ * .8), result = [];
  for (let corner = 0; corner < 4; corner++) {
    const centreX = corner === 0 || corner === 3 ? halfX - r : -halfX + r;
    const centreZ = corner < 2 ? halfZ - r : -halfZ + r;
    for (let i = 0; i <= segments; i++) {
      const angle = corner * Math.PI / 2 + i / segments * Math.PI / 2;
      result.push([centreX + Math.cos(angle) * r, centreZ + Math.sin(angle) * r]);
    }
  }
  return result;
}

function porcelainProfile(rings, centreX, centreZ, capStart = true, capEnd = true) {
  const positions = [], uvs = [], indices = [], count = roundedPerimeter(...rings[0].slice(1)).length;
  for (let row = 0; row < rings.length; row++) {
    const [y, halfX, halfZ, radius] = rings[row];
    for (const [x, z] of roundedPerimeter(halfX, halfZ, radius)) { positions.push(centreX + x, y, centreZ + z); uvs.push(x / (.30362001) + .5, z / (.38717672) + .5); }
  }
  for (let row = 0; row < rings.length - 1; row++) for (let side = 0; side < count; side++) {
    const a = row * count + side, b = row * count + (side + 1) % count, c = a + count, d = b + count;
    indices.push(a, c, b, b, c, d);
  }
  for (const [row, enabled] of [[0, capStart], [rings.length - 1, capEnd]]) {
    if (!enabled) continue;
    const index = positions.length / 3; positions.push(centreX, rings[row][0], centreZ); uvs.push(.5, .5);
    for (let side = 0; side < count; side++) { const a = row * count + side, b = row * count + (side + 1) % count; indices.push(...(row === 0 ? [index,a,b] : [index,b,a])); }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3)); geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2)); geometry.setIndex(indices); geometry.computeVertexNormals();
  geometry.userData.detail = 'closed-round-corner-ceramic-cross-section'; return geometry;
}

function roundedBlock(size, centre, material, name, radius) {
  const [width,height,depth] = size, bevel = Math.min(radius * .30,height * .20), x = width / 2, z = depth / 2, y = centre[1] - height / 2;
  const geometry = porcelainProfile([[y,x-bevel,z-bevel,radius],[y+bevel,x,z,radius],[y+height-bevel,x,z,radius],[y+height,x-bevel,z-bevel,radius]],centre[0],centre[2]);
  const mesh = new THREE.Mesh(geometry,material); mesh.name = name; return mesh;
}

export function createDetailedToilet(source) {
  if (!source?.getObjectByName('Group')?.isMesh) throw new TypeError('Authored toilet hinge mesh is required');
  const root = new THREE.Group(), ceramic = naturalMaterial('ceramic',{color:0xfff5e5,roughness:.22,bumpScale:.00010}), seatMaterial = naturalMaterial('ceramic',{color:0xeef0e9,roughness:.29,bumpScale:.00005});
  const chrome = new THREE.MeshStandardMaterial({color:0xc8cdcb,metalness:.88,roughness:.24}); chrome.userData.naturalSurface = 'metal';
  const rubber = new THREE.MeshStandardMaterial({color:0x797b73,roughness:.94}); rubber.userData.naturalSurface = 'rubber';
  const b = BOWL;
  const shell = porcelainProfile([
    [0,.12155717,.14128983,.024],[.007,.119,.139,.024],[.025,.105,.125,.027],
    [.035720,.09945788,.11919052,.027],[.078,.0908,.109,.035],[.111625,.09041625,.10835502,.035],
    [.150,.105,.126,.030],[.174,.118,.142,.027],[.183065,b.outerX,b.outerZ,.02567375],
    [.202,b.outerX,b.outerZ,.02567375],[.213,b.outerX-.002,b.outerZ-.002,.02567375],
    [.216,b.outerX-.004,b.outerZ-.004,.02567375],[.216,b.innerX,b.innerZ,.01236978],
    [.205,b.innerX-.002,b.innerZ-.002,.014],[.182,.086,.108,.023],
    [.157715,.06555527,.08158059,.035],[.147,.052,.068,.034],[.144,.042,.057,.032],
  ],b.x,b.z);
  const body = new THREE.Mesh(shell,ceramic); body.name = 'Toilet_porcelain_curved_pedestal_complete_inner_basin'; root.add(body);
  // The actual top remains .227715, with the exact old straight side rims.
  // Rounded transitions are below that plane, leaving six-foot support intact.
  const seat = porcelainProfile([
    [.216,b.outerX-.003,b.outerZ-.003,.02567375],[.219,b.outerX,b.outerZ,.02567375],
    [.225,b.outerX,b.outerZ,.02567375],[b.rimY,b.outerX-.001,b.outerZ-.001,.02567375],
    [b.rimY,b.innerX,b.innerZ,.01236978],[.224,b.innerX+.001,b.innerZ+.001,.01236978],
    [.216,b.innerX+.002,b.innerZ+.002,.014],
    [.216,b.outerX-.003,b.outerZ-.003,.02567375],
  ],b.x,b.z,false,false);
  const seatMesh = new THREE.Mesh(seat,seatMaterial); seatMesh.name = 'Toilet_separate_flat_supported_seat_ring'; root.add(seatMesh);
  root.add(roundedBlock([.138415,.041,.08930],[b.x,.2115,-.33359672],ceramic,'Toilet_rear_bowl_tank_connector',.008));
  root.add(roundedBlock([.30362001,.178600,.084835],[b.x,.317015,-.34475922],ceramic,'Toilet_glazed_round_corner_cistern',.012));
  root.add(roundedBlock([.30362001,.04465,.084835],[b.x,.428640,-.34475922],ceramic,'Toilet_removable_beveled_cistern_lid',.010));
  root.add(roundedBlock([.038,.007,.004],[.039,.386,-.299],chrome,'Toilet_chrome_flush_lever',.002));
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(.0065,.0065,.003,16),chrome); knob.rotation.x = Math.PI / 2; knob.position.set(.057,.386,-.301); knob.name = 'Toilet_flush_lever_pivot'; root.add(knob);

  const oldLid = source.getObjectByName('Group'), lid = roundedBlock([.243524134,.02,.195687398],[-.121762067,.01,0],seatMaterial,'Group',.01237);
  lid.position.copy(oldLid.position); lid.quaternion.copy(oldLid.quaternion); lid.scale.copy(oldLid.scale); root.add(lid);
  for (const z of [-.065,.065]) {
    const stop = roundedBlock([.022,.002,.012],[-.16,.0012,z],rubber,'Toilet_lid_moulded_bumper',.002); lid.add(stop);
  }
  for (const x of [.076,.228]) {
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(.007,.007,.026,18),chrome); hinge.rotation.z = Math.PI / 2; hinge.position.set(x,b.rimY+.004,-.26623544); hinge.name = 'Toilet_attached_lid_hinge_barrel'; root.add(hinge);
    root.add(roundedBlock([.028,.006,.015],[x,b.rimY-.001,-.271],chrome,'Toilet_hinge_base_plate',.003));
  }
  root.userData.detail = 'real-basin-separate-seat-cistern-hinged-lid-authored-landing-height';
  root.traverse(mesh=>{if(mesh.isMesh){mesh.castShadow=true;mesh.receiveShadow=true;}}); return root;
}
