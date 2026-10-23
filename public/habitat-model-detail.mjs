import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {naturalMaterial,useGeneratedAlbedo} from './natural-materials.mjs';

const requirePositive = value => {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError('Habitat dimensions must be positive and finite');
};

// One shared, closed blade is still instanced by the room. Its length, broad
// outline and UV direction match the authored foliage, including camera fading.
export function createBotanicalLeafGeometry() {
  const rows = 14, columns = 4, positions = [], uvs = [], indices = [];
  const surface = (t, across, underside) => {
    const envelope = Math.sin(Math.PI * t);
    const width = envelope ** .88 * .32 * (1 + .028 * across * Math.sin(t * Math.PI * 2));
    const edge = Math.abs(across);
    const outline = 1 - .012 * edge ** 4 * Math.sin(t * Math.PI * 14) ** 2;
    const blade = envelope * (.07 + .09 * (1 - edge ** 1.65));
    const midrib = .007 * envelope * Math.exp(-Math.abs(across) * 26);
    const veinPhase = (t + edge * .135) * 7 * Math.PI;
    const veins = .004 * envelope * (1 - edge) * Math.exp(-(Math.sin(veinPhase) ** 2) * 55);
    const curledEdge = .013 * envelope * edge ** 5 * Math.sin(t * Math.PI * 3) + .004 * envelope * edge ** 3 * Math.sin(t * Math.PI * 9);
    return [across * width * outline, t, blade + midrib + veins + curledEdge - (underside ? .008 * envelope : 0)];
  };
  const add = (point, uv) => { const index = positions.length / 3; positions.push(...point); uvs.push(...uv); return index; };
  const bottomTip = add([0, 0, 0], [.5, 0]);
  const topTip = add([0, 1, 0], [.5, 1]);
  const sides = [];
  for (const underside of [false, true]) {
    const grid = [];
    for (let row = 1; row < rows; row++) {
      const strip = [];
      for (let col = 0; col <= columns; col++) strip.push(add(surface(row / rows, col / columns * 2 - 1, underside), [col / columns, row / rows]));
      grid.push(strip);
    }
    const face = (a, b, c) => indices.push(...(underside ? [a, c, b] : [a, b, c]));
    for (let col = 0; col < columns; col++) {
      face(bottomTip, grid[0][col + 1], grid[0][col]);
      face(grid.at(-1)[col], grid.at(-1)[col + 1], topTip);
    }
    for (let row = 0; row < grid.length - 1; row++) for (let col = 0; col < columns; col++) {
      const a = grid[row][col], b = grid[row][col + 1], c = grid[row + 1][col], d = grid[row + 1][col + 1];
      face(a, b, c); face(b, d, c);
    }
    sides.push(grid);
  }
  for (const column of [0, columns]) {
    const upper = [bottomTip, ...sides[0].map(row => row[column]), topTip];
    const lower = [bottomTip, ...sides[1].map(row => row[column]), topTip];
    const face = (a, b, c) => indices.push(...(column === 0 ? [a, c, b] : [a, b, c]));
    for (let row = 0; row < rows; row++) {
      if (row > 0) face(upper[row], lower[row], upper[row + 1]);
      if (row < rows - 1) face(upper[row + 1], lower[row], lower[row + 1]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  geometry.userData.detail = 'asymmetric-pointed-blade-raised-veins-corrugated-closed-edge';
  return geometry;
}

function latheProfile(points, scale = 1, segments = 48) {
  const geometry = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r * scale, y * scale)), segments);
  const p = geometry.attributes.position, index = geometry.index, faces = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  // Lathe's axis vertices produce zero-area fan triangles. They do not belong
  // in the render or collision mesh, even though the baker also filters them.
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(p, index.getX(i)); b.fromBufferAttribute(p, index.getX(i + 1)); c.fromBufferAttribute(p, index.getX(i + 2));
    if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-24) faces.push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
  }
  geometry.setIndex(faces);
  geometry.userData.detail = 'closed-section-foot-wall-rounded-lip-inner-wall';
  return geometry;
}

export function createPlantPotGeometry(size) {
  requirePositive(size);
  // The original .33 radius / .46 height are unchanged. The rim now joins a
  // complete inner wall and bottom instead of ending as an open sheet.
  return latheProfile([
    [0, .014], [.140, .014], [.146, .010], [.151, .003], [.158, 0], [.181, 0], [.185, .003], [.198, .014], [.203, .03],
    [.216, .04], [.235, .066], [.25, .09], [.283, .20], [.317, .335],
    [.328, .371], [.33, .389], [.327, .413], [.318, .438], [.31, .452],
    [.300, .46], [.289, .46], [.280, .454], [.277, .445], [.278, .428],
    [.296, .389], [.291, .361], [.26, .22], [.218, .088], [.200, .059],
    [.180, .05], [0, .05],
  ], size);
}

export function createDrinkingBowlGeometry(radius) {
  requirePositive(radius);
  // The water resource remains at r*.30 with r*.87 radius. Its complete disc
  // is inside the inner wall; neither resource coordinates nor bowl bounds move.
  return latheProfile([
    [0, .018], [.23, .018], [.27, .014], [.285, .006], [.29, 0], [.35, 0], [.37, .005], [.40, .015], [.43, .033],
    [.48, .055], [.59, .085], [.69, .13], [.78, .18], [.86, .24],
    [.92, .31], [.97, .38], [.995, .424], [1, .437], [.994, .451],
    [.98, .46], [.965, .458], [.953, .447], [.949, .430],
    [.932, .377], [.916, .33], [.903, .30], [.875, .256], [.81, .195],
    [.71, .149], [.60, .123], [.48, .112], [.30, .11], [0, .11],
  ], radius, 56);
}

export function createPotSoilGeometry(radius, height = .018) {
  requirePositive(radius); requirePositive(height);
  const rings = 11, segments = 56, positions = [0, height * .38, 0], uv = [.5, .5], indices = [];
  for (let ring = 1; ring <= rings; ring++) for (let i = 0; i < segments; i++) {
    const t = ring / rings, angle = i / segments * Math.PI * 2, x = Math.cos(angle) * radius * t, z = Math.sin(angle) * radius * t;
    const grain = Math.sin(x / radius * 24 + Math.cos(z / radius * 17)) * Math.cos(z / radius * 19 + x / radius * 9);
    const clod = Math.sin(x / radius * 8 + z / radius * 5) * Math.cos(z / radius * 12);
    const y = height * (.25 + grain * .18 + clod * .08) * (1 - .35 * t);
    positions.push(x, y, z); uv.push(x / radius / 2 + .5, z / radius / 2 + .5);
  }
  for (let i = 0; i < segments; i++) indices.push(0, 1 + (i + 1) % segments, 1 + i);
  for (let ring = 1; ring < rings; ring++) for (let i = 0; i < segments; i++) {
    const a = 1 + (ring - 1) * segments + i, b = 1 + (ring - 1) * segments + (i + 1) % segments, c = a + segments, d = b + segments;
    indices.push(a, b, c, b, d, c);
  }
  const bottom = positions.length / 3; positions.push(0, -height / 2, 0); uv.push(.5, .5);
  const lowerRing = positions.length / 3;
  for (let i = 0; i < segments; i++) {
    const angle = i / segments * Math.PI * 2; positions.push(Math.cos(angle) * radius, -height / 2, Math.sin(angle) * radius); uv.push(i / segments, 0);
  }
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments, a = 1 + (rings - 1) * segments + i, b = 1 + (rings - 1) * segments + next, c = lowerRing + i, d = lowerRing + next;
    indices.push(a, b, c, b, d, c, bottom, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.userData.detail = 'closed-granular-soil-surface'; return geometry;
}

// A continuous closed worn ellipsoid replaces the pack's flat-topped column.
// Source material identities and transforms stay intact; both primitives share
// the same smooth surface, extent and regenerated UVs.
function refineAuthoredSupportedStone(model, segments = 3) {
  if (!Number.isInteger(segments) || segments < 2 || segments > 5) throw new RangeError('Stone refinement must use 2 to 5 segments');
  const meshes = [], normals = new Map(), vector = () => new THREE.Vector3();
  model.traverse(mesh => { if (mesh.isMesh) meshes.push(mesh); });
  const key = point => point.toArray().map(n => Math.round(n * 1e6)).join(',');
  for (const mesh of meshes) {
    const p = mesh.geometry.attributes.position, index = mesh.geometry.index;
    for (let i = 0; i < (index?.count ?? p.count); i += 3) {
      const points = [0, 1, 2].map(k => vector().fromBufferAttribute(p, index ? index.getX(i + k) : i + k));
      const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
      for (const point of points) { const id = key(point); if (!normals.has(id)) normals.set(id, vector()); normals.get(id).add(normal); }
    }
  }
  for (const normal of normals.values()) normal.normalize();
  for (const mesh of meshes) {
    const original = mesh.geometry, p = original.attributes.position, uv = original.attributes.uv, index = original.index;
    original.computeBoundingBox(); const bounds = original.boundingBox;
    const positions = [], uvs = [], indices = [];
    const edge = (a, b, normal) => a.clone().multiplyScalar(2).add(b).addScaledVector(normal, -b.clone().sub(a).dot(normal)).divideScalar(3);
    for (let i = 0; i < (index?.count ?? p.count); i += 3) {
      const ids = [0, 1, 2].map(k => index ? index.getX(i + k) : i + k), v = ids.map(id => vector().fromBufferAttribute(p, id));
      const n = v.map(point => normals.get(key(point))), controls = [edge(v[0], v[1], n[0]), edge(v[1], v[0], n[1]), edge(v[0], v[2], n[0]), edge(v[2], v[0], n[2]), edge(v[1], v[2], n[1]), edge(v[2], v[1], n[2])];
      const average = controls.reduce((sum, point) => sum.add(point), vector()).divideScalar(6);
      const centre = average.clone().multiplyScalar(1.5).sub(v.reduce((sum, point) => sum.add(point), vector()).divideScalar(6));
      const grid = [];
      for (let row = 0; row <= segments; row++) {
        grid[row] = [];
        for (let col = 0; col <= segments - row; col++) {
          const b = row / segments, c = col / segments, a = 1 - b - c;
          const point = vector().addScaledVector(v[0], a ** 3).addScaledVector(v[1], b ** 3).addScaledVector(v[2], c ** 3)
            .addScaledVector(controls[0], 3 * a * a * b).addScaledVector(controls[1], 3 * a * b * b)
            .addScaledVector(controls[2], 3 * a * a * c).addScaledVector(controls[3], 3 * a * c * c)
            .addScaledVector(controls[4], 3 * b * b * c).addScaledVector(controls[5], 3 * b * c * c).addScaledVector(centre, 6 * a * b * c);
          // A restrained blend retains the old angular character and prevents
          // a full PN patch from folding a thin, concave source triangle.
          point.lerp(vector().addScaledVector(v[0], a).addScaledVector(v[1], b).addScaledVector(v[2], c), .4).clamp(bounds.min, bounds.max);
          grid[row][col] = positions.length / 3; positions.push(...point.toArray());
          uvs.push(uv ? uv.getX(ids[0]) * a + uv.getX(ids[1]) * b + uv.getX(ids[2]) * c : b, uv ? uv.getY(ids[0]) * a + uv.getY(ids[1]) * b + uv.getY(ids[2]) * c : c);
        }
      }
      for (let row = 0; row < segments; row++) for (let col = 0; col < segments - row; col++) {
        indices.push(grid[row][col], grid[row + 1][col], grid[row][col + 1]);
        if (col < segments - row - 1) indices.push(grid[row + 1][col], grid[row + 1][col + 1], grid[row][col + 1]);
      }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
    geometry.userData.detail = 'curved-authored-stone-faces'; mesh.geometry = geometry;
  }
  return model;
}


export function refineHabitatStoneModel(model, segments = 3) {
  if(model.getObjectByName('Mesh_rock_largeA')){
    refineAuthoredSupportedStone(model,segments);
    model.traverse(mesh=>{if(mesh.isMesh){mesh.geometry.computeBoundingBox();mesh.geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(mesh.geometry.attributes.position.count*3).fill(1),3));}});
    return model;
  }
  if (!Number.isInteger(segments) || segments < 2 || segments > 5) throw new RangeError('Stone refinement must use 2 to 5 segments');
  const meshes=[];model.traverse(mesh=>{if(mesh.isMesh)meshes.push(mesh);});
  if(!meshes.length)return model;
  const target=new THREE.Box3();
  for(const mesh of meshes){mesh.geometry.computeBoundingBox();target.union(mesh.geometry.boundingBox);}
  const geometry=new THREE.SphereGeometry(1,segments*8,segments*5),p=geometry.attributes.position,index=geometry.index;
  for(let i=0;i<p.count;i++){
    const direction=new THREE.Vector3().fromBufferAttribute(p,i).normalize();
    const wear=1+.09*Math.sin(direction.x*5+direction.y*3)*Math.cos(direction.z*4)+.035*Math.sin(direction.y*7-direction.z*4);
    const shoulder=value=>Math.sign(value)*Math.abs(value)**.70;
    const lean=.10*direction.y*(1-direction.y*direction.y);
    // Worn fracture planes leave uneven shoulders; river stones and standing
    // stones share a mineral structure without becoming perfect eggs.
    p.setXYZ(i,shoulder(direction.x)*wear+lean,direction.y*wear,shoulder(direction.z)*wear);
  }
  fitGeometryBounds(geometry,target);
  // Smooth coincident seam/pole normals after deformation, before separating
  // material primitives. The top shoulder is continuous with the stone body.
  const normals=new Map(),normal=geometry.attributes.normal;
  const key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(value=>Math.round(value*1e6)).join(',');
  for(let i=0;i<p.count;i++){const id=key(i);if(!normals.has(id))normals.set(id,new THREE.Vector3());normals.get(id).add(new THREE.Vector3().fromBufferAttribute(normal,i));}
  for(const value of normals.values())value.normalize();
  for(let i=0;i<p.count;i++){const value=normals.get(key(i));normal.setXYZ(i,value.x,value.y,value.z);}
  const colors=new Float32Array(p.count*3),stoneSize=target.getSize(new THREE.Vector3());
  for(let i=0;i<p.count;i++){
    const x=(p.getX(i)-target.min.x)/stoneSize.x,y=(p.getY(i)-target.min.y)/stoneSize.y,z=(p.getZ(i)-target.min.z)/stoneSize.z;
    const mineral=.92+.07*Math.sin(x*11+y*6)*Math.cos(z*9-y*3);
    const moss=Math.max(0,Math.sin(x*15+z*12)*Math.cos(z*17-y*8)) * Math.max(0,(normal.getY(i)-.25)/.75) * .68;
    new THREE.Color(mineral,mineral*.99,mineral*.94).lerp(new THREE.Color(.38,.44,.20),moss).toArray(colors,i*3);
  }
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  const faces=meshes.map(()=>[]),centre=target.getCenter(new THREE.Vector3()),height=target.getSize(new THREE.Vector3()).y;
  for(let i=0;i<index.count;i+=3){
    const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)],y=ids.reduce((sum,id)=>sum+p.getY(id),0)/3;
    const part=meshes.length===1?0:Math.min(meshes.length-1,Math.floor(Math.max(0,Math.min(.999999,(y-centre.y)/height+.32))*meshes.length));
    faces[part].push(...ids);
  }
  meshes.forEach((mesh,i)=>{const surface=geometry.clone();surface.setIndex(faces[i]);surface.userData.detail='closed-worn-rounded-stone-shared-smooth-shoulder';mesh.geometry=surface;});
  geometry.dispose();return model;
}

function fitGeometryBounds(geometry, target) {
  geometry.computeBoundingBox();
  const source = geometry.boundingBox, extent = source.getSize(new THREE.Vector3()), wanted = target.getSize(new THREE.Vector3()), p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) for (let axis = 0; axis < 3; axis++) p.array[i * 3 + axis] = target.min.getComponent(axis) + (p.array[i * 3 + axis] - source.min.getComponent(axis)) / extent.getComponent(axis) * wanted.getComponent(axis);
  p.needsUpdate = true; geometry.computeVertexNormals(); geometry.computeBoundingBox(); return geometry;
}

function palmCanopyGeometry() {
  const surfaces = [];
  const centreline = new THREE.CatmullRomCurve3([
    new THREE.Vector3(.005, .087, 0), new THREE.Vector3(.115, .160, 0), new THREE.Vector3(.27, .150, 0), new THREE.Vector3(.42, .074, 0), new THREE.Vector3(.54, .003, 0),
  ], false, 'centripetal');
  for (let frond = 0; frond < 4; frond++) {
    const angle = frond * Math.PI / 2;
    const rotate = point => point.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -angle);
    const rachis = closedStemGeometry(centreline, .0065, .0018, 8, 4);
    rachis.rotateY(-angle); surfaces.push(rachis);
    // A pinnate crown consists of separate, tapered leaflets carried by a
    // continuous rachis. Gaps, drooping tips and the V fold are real silhouettes.
    for (let pair = 0; pair < 12; pair++) for (const side of [-1, 1]) {
      const t = .10 + pair * .073, root = centreline.getPoint(t);
      const spread = (.085 + .08 * Math.sin(t * Math.PI)) * (1 - .70 * t ** 3);
      const tip = root.clone().add(new THREE.Vector3(.045 + .045 * t, -.016 - .030 * t, side * spread));
      surfaces.push(compactLeafGeometry(rotate(root), rotate(tip), .022 * (1 - .54 * t), .006));
    }
  }
  const geometry = mergeGeometries(surfaces); surfaces.forEach(surface => surface.dispose()); return geometry;
}

function closedStemGeometry(curve, startRadius, endRadius, rows = 12, sides = 7) {
  const frames = curve.computeFrenetFrames(rows, false), positions = [], uvs = [], indices = [];
  for (let row = 0; row <= rows; row++) {
    const t = row / rows, centre = curve.getPoint(t), radius = startRadius + (endRadius - startRadius) * t;
    for (let side = 0; side < sides; side++) {
      const angle = side / sides * Math.PI * 2;
      const point = centre.clone().addScaledVector(frames.normals[row], Math.cos(angle) * radius).addScaledVector(frames.binormals[row], Math.sin(angle) * radius);
      positions.push(...point.toArray()); uvs.push(side / sides, t);
    }
  }
  for (let row = 0; row < rows; row++) for (let side = 0; side < sides; side++) {
    const a = row * sides + side, b = row * sides + (side + 1) % sides, c = a + sides, d = b + sides;
    indices.push(a, b, c, b, d, c);
  }
  for (const row of [0, rows]) {
    const centre = curve.getPoint(row / rows), id = positions.length / 3; positions.push(...centre.toArray()); uvs.push(.5, row / rows);
    for (let side = 0; side < sides; side++) { const a = row * sides + side, b = row * sides + (side + 1) % sides; indices.push(...(row === 0 ? [id, b, a] : [id, a, b])); }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

// A closed three-station leaf uses a shallow V section instead of a flat
// triangle. Shared tips avoid collapsed faces and bound collision complexity.
function compactLeafGeometry(start, end, width, fold = .018) {
  const direction = end.clone().sub(start), length = direction.length();
  if (length < 1e-8) throw new RangeError('Leaf endpoints must differ');
  const side = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, .001)).normalize();
  const up = new THREE.Vector3().crossVectors(side, direction).normalize(), positions = [...start.toArray(), ...end.toArray()], uvs = [.5, 0, .5, 1], indices = [], grids = [];
  for (const underside of [false, true]) {
    const grid = [];
    for (const t of [1 / 3, 2 / 3]) {
      const strip = [];
      for (let column = 0; column < 3; column++) {
        const across = column - 1, envelope = Math.sin(t * Math.PI), point = start.clone().addScaledVector(direction, t)
          .addScaledVector(side, across * width * envelope).addScaledVector(up, fold * envelope * (1 - Math.abs(across) * .75) - (underside ? Math.min(.0025, length * .025) * envelope : 0));
        strip.push(positions.length / 3); positions.push(...point.toArray()); uvs.push(column / 2, t);
      }
      grid.push(strip);
    }
    const face = (a, b, c) => indices.push(...(underside ? [a, c, b] : [a, b, c]));
    for (let column = 0; column < 2; column++) {
      face(0, grid[0][column + 1], grid[0][column]); face(grid[1][column], grid[1][column + 1], 1);
      face(grid[0][column], grid[0][column + 1], grid[1][column]); face(grid[0][column + 1], grid[1][column + 1], grid[1][column]);
    }
    grids.push(grid);
  }
  for (const column of [0, 2]) {
    const upper = [0, ...grids[0].map(row => row[column]), 1], lower = [0, ...grids[1].map(row => row[column]), 1];
    const face = (a, b, c) => indices.push(...(column === 0 ? [a, c, b] : [a, b, c]));
    for (let row = 0; row < 3; row++) { if (row > 0) face(upper[row], lower[row], upper[row + 1]); if (row < 2) face(upper[row + 1], lower[row], lower[row + 1]); }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

function palmTrunkGeometry() {
  const centres = [[0, 0, 0], [0, .050726, 0], [0, .271189, -.0804], [-.10385, .659438, -.07188], [0, .948186, .002567]];
  const curve = new THREE.CatmullRomCurve3(centres.map(p => new THREE.Vector3(...p)), false, 'centripetal');
  const rows = 48, sides = 16, positions = [], uvs = [], indices = [];
  for (let row = 0; row <= rows; row++) {
    const t = row / rows, centre = curve.getPoint(t), radius = .082 * (1 - .56 * t);
    // Raised growth collars and longitudinal bark ribs are continuous trunk
    // geometry; no rings float over or penetrate the original tree.
    const collar = 1 + .078 * Math.cos(t * Math.PI * 32) * Math.sin(Math.PI * t);
    for (let side = 0; side < sides; side++) {
      const angle = side / sides * Math.PI * 2, bark = 1 + .042 * Math.sin(angle * 5 + t * 13);
      positions.push(centre.x + Math.cos(angle) * radius * collar * bark, centre.y, centre.z + Math.sin(angle) * radius * collar * bark); uvs.push(side / sides, t);
    }
  }
  for (let row = 0; row < rows; row++) for (let side = 0; side < sides; side++) {
    const a = row * sides + side, b = row * sides + (side + 1) % sides, c = a + sides, d = b + sides;
    indices.push(a, c, b, b, c, d);
  }
  for (const row of [0, rows]) {
    const centre = curve.getPoint(row / rows), id = positions.length / 3; positions.push(...centre.toArray()); uvs.push(.5, .5);
    for (let side = 0; side < sides; side++) { const a = row * sides + side, b = row * sides + (side + 1) % sides; indices.push(...(row === 0 ? [id, a, b] : [id, b, a])); }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); return geometry;
}

export function refineHabitatPalmModel(model) {
  model.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.geometry.computeBoundingBox(); const bounds = mesh.geometry.boundingBox.clone();
    const isLeaf = mesh.name.startsWith('leafs');
    mesh.geometry = fitGeometryBounds(isLeaf ? palmCanopyGeometry() : palmTrunkGeometry(), bounds);
    mesh.geometry.userData.detail = isLeaf ? 'pinnate-palm-fronds-individual-folded-leaflets-continuous-rachis' : 'continuous-palm-trunk-growth-collars-bark';
  });
  return model;
}

function collectSurface(root, geometries, material, name) {
  if (!geometries.length) return;
  const geometry = mergeGeometries(geometries); geometries.forEach(part => part.dispose());
  const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
}

function leafColor(geometry, shade) {
  const color = new THREE.Color(shade), values = new Float32Array(geometry.attributes.position.count * 3);
  const uv=geometry.attributes.uv;
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    const t=uv.getY(i),edge=Math.abs(uv.getX(i)-.5)*2;
    color.clone().multiplyScalar(.91+.10*t+.05*edge).toArray(values,i*3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3)); return geometry;
}

function fitModelToSource(model, source) {
  source.updateMatrixWorld(true); model.updateMatrixWorld(true);
  const target = new THREE.Box3().setFromObject(source, true), current = new THREE.Box3().setFromObject(model, true), from = current.getSize(new THREE.Vector3()), to = target.getSize(new THREE.Vector3());
  if ([from.x, from.y, from.z].some(value => value <= 1e-8)) throw new RangeError('A habitat model must have a solid extent');
  model.scale.copy(to.divide(from)); model.position.copy(target.min).sub(current.min.multiply(model.scale)); model.updateMatrixWorld(true);
  // Placement subsequently sets the returned root's scale. Keep this fit in an
  // inner transform so that the production placement cannot overwrite it.
  const placed = new THREE.Group(); placed.add(model);
  placed.userData.detail = 'authored-footprint-bottom-anchor-preserved'; return placed;
}

const surfaceNoise=(x,y,seed=19)=>{
  let value=Math.imul(x+seed,374761393)+Math.imul(y+31,668265263);
  value=Math.imul(value^value>>>13,1274126177);return((value^value>>>16)>>>0)/4294967296;
};

function organicSurfaceMaps(kind, size = 128) {
  const albedo = new Uint8Array(size * size * 4), relief = new Uint8Array(albedo.length), roughness = new Uint8Array(albedo.length);
  const noise=surfaceNoise;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const random = noise(x,y,19), grain = (random - .5) * (kind === 'earth' ? .23 : .032);
    const fiber = kind === 'stalk' ? (noise(x,0,71)-.5)*.022 : 0;
    const u=x/size,v=y/size;
    let color=245*(1+grain+fiber),height=128+(random-.5)*12;
    if(kind==='earth'){
      // Irregular overlapping aggregates have a physical 3–18 mm scale.
      // Voronoi cells use jittered centres, so there is no square soil weave.
      const cellX=u*29,cellY=v*29,ix=Math.floor(cellX),iy=Math.floor(cellY);let nearest=2;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const px=ix+dx,py=iy+dy,wx=(px+29)%29,wy=(py+29)%29;
        nearest=Math.min(nearest,Math.hypot(cellX-px-noise(wx,wy,3),cellY-py-noise(wx,wy,7)));
      }
      const aggregate=Math.max(0,1-nearest*1.45),coarse=(Math.sin(u*Math.PI*6+Math.cos(v*Math.PI*4))*.5+.5)*.10;
      color=135+aggregate*68+coarse*100+(random-.5)*53;
      height=62+aggregate*118+(random-.5)*64;
    }else if(kind==='bark'){
      const furrow=Math.abs(Math.sin((u*19+Math.sin(v*Math.PI*4+u*8)*.14+Math.sin(v*Math.PI*14)*.06)*Math.PI));
      const ridges=Math.max(0,(furrow-.25)/.75),flakes=noise(Math.floor(u*37),Math.floor(v*29),49);
      const collars=Math.max(0,Math.cos((v*19+.12*Math.sin(u*Math.PI*8))*Math.PI*2))**18;
      color=141+ridges*83+(flakes-.5)*29+(random-.5)*18-collars*20;height=74+ridges*120+(random-.5)*24-collars*36;
    }else if(kind==='endgrain'){
      const px=(u-.5)*2,py=(v-.5)*2,angle=Math.atan2(py,px),radius=Math.hypot(px,py);
      const ring=Math.sin((radius+.015*Math.sin(angle*7)+.012*Math.sin(angle*13))*Math.PI*31);
      const split=Math.exp(-(Math.sin(angle*3.0+.6)**2)*950)*Math.max(0,(radius-.32)/.68);
      color=219+ring*13-split*83+(random-.5)*9;height=130+ring*18-split*52;
    }else if(kind==='cap'){
      const mottle=Math.sin(u*Math.PI*6+Math.cos(v*Math.PI*8))*Math.cos(v*Math.PI*7+u*5);
      color=235+mottle*13+(random-.5)*5;height=128+mottle*6+(random-.5)*8;
    }
    const offset = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) {albedo[offset+c]=Math.round(Math.max(0,Math.min(255,color)));relief[offset+c]=Math.round(height);roughness[offset+c]=kind==='earth'?235+Math.round(random*18):223;}
    albedo[offset+3]=relief[offset+3]=roughness[offset+3]=255;
  }
  const texture = (data, colorSpace) => {
    const map=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);map.colorSpace=colorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;
    map.generateMipmaps=true;map.minFilter=THREE.LinearMipmapLinearFilter;map.anisotropy=4;map.needsUpdate=true;return map;
  };
  return {map:texture(albedo,THREE.SRGBColorSpace),bumpMap:texture(relief,THREE.NoColorSpace),roughnessMap:texture(roughness,THREE.NoColorSpace)};
}

export function createHabitatSoilMaterial(color, wet = false) {
  const maps=organicSurfaceMaps('earth',256),material=naturalMaterial('soil',{color,roughness:wet?.72:.98,bumpScale:wet?.0015:.0036});
  for(const name of ['map','bumpMap','roughnessMap']){material[name].dispose();material[name]=maps[name];}
  material.name=wet?'Habitat_moist_fine_granular_earth':'Habitat_dry_fine_granular_earth';return material;
}

export function createHabitatBarkMaterial(color) {
  const material=new THREE.MeshStandardMaterial({...organicSurfaceMaps('bark',256),color,roughness:.96,bumpScale:.004,metalness:0});
  material.name='Habitat_irregular_fibrous_bark';material.userData.naturalSurface='bark';return useGeneratedAlbedo(material,'bark');
}

export function createHabitatSoilGeometry(size) {
  size.forEach(requirePositive);
  const [width,height,depth]=size,columns=Math.ceil(width/.048),rows=Math.ceil(depth/.048),positions=[],uv=[],indices=[];
  for(let row=0;row<=rows;row++)for(let column=0;column<=columns;column++){
    const x=column/columns,z=row/rows,edge=Math.min(x,1-x,z,1-z),clod=surfaceNoise(column,row,83);
    // Relief is recessed into the existing slab. Its edges, maximum support
    // height and occupied envelope remain exactly the original ground volume.
    positions.push((x-.5)*width,height/2-Math.min(1,edge*35)*(.002+clod*.010),(z-.5)*depth);uv.push(x,z);
  }
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
    const a=row*(columns+1)+column,b=a+1,c=a+columns+1,d=c+1;indices.push(a,c,b,b,c,d);
  }
  const perimeter=[];
  for(let column=0;column<=columns;column++)perimeter.push(column);
  for(let row=1;row<=rows;row++)perimeter.push(row*(columns+1)+columns);
  for(let column=columns-1;column>=0;column--)perimeter.push(rows*(columns+1)+column);
  for(let row=rows-1;row>0;row--)perimeter.push(row*(columns+1));
  const base=positions.length/3;
  for(const id of perimeter){positions.push(positions[id*3],-height/2,positions[id*3+2]);uv.push(uv[id*2],uv[id*2+1]);}
  const centre=positions.length/3;positions.push(0,-height/2,0);uv.push(.5,.5);
  for(let i=0;i<perimeter.length;i++){
    const next=(i+1)%perimeter.length,a=perimeter[i],b=perimeter[next],c=base+i,d=base+next;
    indices.push(a,b,c,b,d,c,centre,c,d);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();
  geometry.userData.detail='closed-recessed-loam-aggregates-original-ground-envelope';return geometry;
}

function fungusMaterial(color, stalk = false) {
  return new THREE.MeshStandardMaterial({...organicSurfaceMaps(stalk?'stalk':'cap'),color,metalness:0,roughness:stalk?.94:.82,bumpScale:stalk?.00014:.00018});
}

function foliageMaterials() {
  return {
    leaf:naturalMaterial('leaf', {color:0xffffff, roughness:.74, vertexColors:true}),
    stem:naturalMaterial('bark', {color:0x9ba16a, roughness:.91,bumpScale:.0005}),
    paleLeaf:naturalMaterial('leaf', {color:0xffffff, roughness:.63, vertexColors:true}),
  };
}

function createShrub() {
  const root = new THREE.Group(), leaves = [], stems = [], m = foliageMaterials();
  for (let branch = 0; branch < 9; branch++) {
    const angle = branch * 2.399963 + .13, reach = .30 + .08 * Math.sin(branch * 2.1), height = .64 + .17 * Math.cos(branch * 1.9);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(angle) * .09, height * .48, Math.sin(angle) * .09), new THREE.Vector3(Math.cos(angle) * reach, height, Math.sin(angle) * reach)]);
    stems.push(closedStemGeometry(curve, .020, .0045, 7, 6));
    for (let level = 0; level < 6; level++) for (const sign of [-1, 1]) {
      const t = .18 + level * .145, base = curve.getPoint(t), leafAngle = angle + sign * (.76 + .11 * level), length = .25 - level * .016;
      const end = base.clone().add(new THREE.Vector3(Math.cos(leafAngle) * length, .065 - level * .007, Math.sin(leafAngle) * length));
      leaves.push(leafColor(compactLeafGeometry(base, end, .048 + .012 * Math.sin(level + branch), .018), level % 3 === 0 ? 0xadc880 : branch % 2 ? 0x719451 : 0x91ad69));
    }
    const tip = curve.getPoint(1), end = tip.clone().add(new THREE.Vector3(Math.cos(angle) * .10, .07, Math.sin(angle) * .10));
    leaves.push(leafColor(compactLeafGeometry(tip, end, .032, .009), 0xa5be72));
  }
  collectSurface(root, stems, m.stem, 'Shrub_branching_woody_stems'); collectSurface(root, leaves, m.leaf, 'Shrub_opposite_closed_lanceolate_leaves'); return root;
}

function createGrass(broad) {
  const root = new THREE.Group(), leaves = [], petioles = [], m = foliageMaterials(), count = broad ? 13 : 31;
  for (let i = 0; i < count; i++) {
    const angle = i * 2.399963, height = .36 + .44 * (.5 + .5 * Math.sin(i * 1.78)), reach = .20 + .25 * (.5 + .5 * Math.cos(i * 2.31));
    const start = new THREE.Vector3(Math.cos(angle) * .045, 0, Math.sin(angle) * .045);
    const end = new THREE.Vector3(Math.cos(angle) * reach, height, Math.sin(angle) * reach);
    if (broad) {
      const stemEnd = start.clone().lerp(end, .18); petioles.push(closedStemGeometry(new THREE.LineCurve3(start, stemEnd), .009, .006, 2, 6));
      const leaf = createBotanicalLeafGeometry(), direction = end.clone().sub(stemEnd), length = direction.length();
      const transform = new THREE.Matrix4().compose(stemEnd, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()), new THREE.Vector3(length * .55, length, length * .35));
      const points=leaf.attributes.position;
      for(let vertex=0;vertex<points.count;vertex++){
        const t=points.getY(vertex);points.setY(vertex,t-.10*t**3);points.setZ(vertex,points.getZ(vertex)+.15*t**3);
      }
      leaf.applyMatrix4(transform);leaf.computeVertexNormals();leaves.push(leafColor(leaf, i % 3 ? 0x83a45e : 0xafbc79));
    } else leaves.push(leafColor(compactLeafGeometry(start, end, .012 + .007 * (i % 3), .016), i % 4 === 0 ? 0xc5ba82 : 0x8ba461));
  }
  collectSurface(root, petioles, m.stem, 'Broadleaf_grass_attached_petioles'); collectSurface(root, leaves, m.paleLeaf, broad ? 'Broadleaf_grass_folded_arching_blades' : 'Fine_grass_tapered_differing_blades'); return root;
}

function createMushroomCluster() {
  const root = new THREE.Group(), caps = [], stalks = [], gills = [], capMaterial = fungusMaterial(0xb68a5b), stalkMaterial = fungusMaterial(0xf0e6ce,true), gillMaterial = fungusMaterial(0xc6bca4,true);
  for (const [x, z, height, radius, lean] of [[-.23, -.06, .64, .23, .05],[.10, .13, .88, .31, -.065],[.25, -.21, .45, .17, .045]]) {
    const stem = new THREE.CatmullRomCurve3([new THREE.Vector3(x, 0, z), new THREE.Vector3(x + lean * .35, height * .45, z + .015), new THREE.Vector3(x + lean, height * .80, z)]);
    stalks.push(closedStemGeometry(stem, radius * .24, radius * .15, 8, 8));
    const profile = [[0,.42],[.18,.41],[.42,.36],[.66,.26],[.84,.15],[.95,.065],[1,.008],[.99,-.014],[.91,-.026],[.70,-.043],[.43,-.07],[.16,-.076],[0,-.068]];
    const cap = latheProfile(profile.reverse(), radius, 32); cap.translate(x + lean, height * .80, z); caps.push(cap);
    const grooves = new THREE.CylinderGeometry(radius * .91, radius * .17, radius * .008, 32, 1, false); grooves.translate(x + lean, height * .80 - radius * .05, z); gills.push(grooves);
    for (let gill = 0; gill < 18; gill++) {
      const angle = gill / 18 * Math.PI * 2, start = new THREE.Vector3(x + lean + Math.cos(angle) * radius * .18,height * .80 - radius * .076,z + Math.sin(angle) * radius * .18);
      const end = new THREE.Vector3(x + lean + Math.cos(angle) * radius * .87,height * .80 - radius * .034,z + Math.sin(angle) * radius * .87);
      gills.push(closedStemGeometry(new THREE.LineCurve3(start,end),radius * .005,radius * .007,2,4));
    }
  }
  collectSurface(root, caps, capMaterial, 'Mushrooms_round_caps_thick_rolled_margin'); collectSurface(root, stalks, stalkMaterial, 'Mushrooms_curved_fibrous_stalks'); collectSurface(root, gills, gillMaterial, 'Mushrooms_recessed_underside'); return root;
}

function createWaterLily() {
  const root = new THREE.Group(), points = [], uv = [], indices = [], sectors = 56, rings = 10, thetaStart = .14, span = Math.PI * 2 - .28;
  // A radial slit meets a real, shallow dish-shaped leaf. The thin edge and
  // underside form a closed shell; the former multi-color blossom is removed.
  for (const underside of [false, true]) {
    const offset = points.length / 3; points.push(0, .018 - (underside ? .002 : 0), 0); uv.push(.5, .5);
    for (let ring = 1; ring <= rings; ring++) for (let sector = 0; sector <= sectors; sector++) {
      const t = ring / rings, angle = thetaStart + sector / sectors * span, r = .49 * t * (1 + .035 * Math.sin(angle * 5) * t);
      const vein = .0015 * Math.exp(-(Math.sin(angle * 9) ** 2) * 60) * t * (1-t);
      const y = .018 + .024 * t * t + .006 * Math.cos(angle * 5) * t ** 4 + vein - (underside ? .002 : 0);
      points.push(Math.cos(angle) * r, y, Math.sin(angle) * r); uv.push(Math.cos(angle) * t / 2 + .5, Math.sin(angle) * t / 2 + .5);
    }
    const face = (a, b, c) => indices.push(...(underside ? [a, c, b] : [a, b, c]));
    for (let sector = 0; sector < sectors; sector++) face(offset, offset + 1 + sector + 1, offset + 1 + sector);
    for (let ring = 1; ring < rings; ring++) for (let sector = 0; sector < sectors; sector++) {
      const a = offset + 1 + (ring - 1) * (sectors + 1) + sector, b = a + 1, c = a + sectors + 1, d = c + 1; face(a, b, c); face(b, d, c);
    }
  }
  const stride = 1 + rings * (sectors + 1), connect = (a, b) => indices.push(a, b, a + stride, b, b + stride, a + stride);
  for (let sector = 0; sector < sectors; sector++) connect(1 + (rings - 1) * (sectors + 1) + sector, 2 + (rings - 1) * (sectors + 1) + sector);
  for (const sector of [0, sectors]) {
    const ids = [0, ...Array.from({length:rings}, (_, ring) => 1 + ring * (sectors + 1) + sector)];
    for (let ring = 0; ring < rings; ring++) sector === 0 ? connect(ids[ring + 1], ids[ring]) : connect(ids[ring], ids[ring + 1]);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
  const leaf = new THREE.Mesh(geometry, naturalMaterial('leaf', {color:0xb4cc8e, roughness:.42})); leaf.name = 'Floating_leaf_radial_slit_curved_closed_rim'; root.add(leaf); return root;
}

function createFallenLog() {
  const root = new THREE.Group(), bark = createHabitatBarkMaterial(0x796349), heartwood = new THREE.MeshStandardMaterial({...organicSurfaceMaps('endgrain',256),color:0xc2a375,roughness:.86,bumpScale:.0009}), curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0,.17,-.5),new THREE.Vector3(.03,.19,0),new THREE.Vector3(-.01,.16,.5)]);
  const trunk = closedStemGeometry(curve, .16, .14, 16, 20), p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), centre = curve.getPoint(Math.max(0, Math.min(1, z + .5))), phase = Math.atan2(y - centre.y, x - centre.x);
    const grain = 1 + .05 * Math.sin(phase * 11 + z * 4) + .027 * Math.cos(phase * 23 - z * 9);
    p.setXY(i, centre.x + (x - centre.x) * grain, centre.y + (y - centre.y) * grain);
  }
  trunk.computeVertexNormals(); const mesh = new THREE.Mesh(trunk, bark); mesh.name = 'Fallen_log_irregular_bark_grooved_trunk'; root.add(mesh);
  for (const [z, radius] of [[-.501,.147],[.501,.129]]) {
    const section = new THREE.CylinderGeometry(radius, radius, .003, 36, 1, false); section.rotateX(Math.PI / 2); section.translate(z < 0 ? 0 : -.01, z < 0 ? .17 : .16, z);
    const end = new THREE.Mesh(section, heartwood); end.name = 'Fallen_log_complete_endgrain_cut'; root.add(end);
  }
  const branchCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(.025,.21,-.12),new THREE.Vector3(.16,.32,-.09),new THREE.Vector3(.26,.35,-.13)]);
  const branch = new THREE.Mesh(closedStemGeometry(branchCurve, .064, .038, 6, 9), bark); branch.name = 'Fallen_log_broken_attached_branch'; root.add(branch); return root;
}

export function refineHabitatOrganicModel(source, name) {
  if(name==='mushroom_tanGroup'){
    // Saved adult poses and the narrow leaf/mushroom passage use these exact
    // three authored caps and stems. A whole-cluster bounding box is not an
    // interaction contract: moving a cap inside it removes a real foothold.
    const root=new THREE.Group(),parts=[],material=fungusMaterial(0xffffff,true);material.vertexColors=true;source.updateMatrixWorld(true);
    source.traverse(mesh=>{if(mesh.isMesh){
      const geometry=mesh.geometry.clone();geometry.applyMatrix4(mesh.matrixWorld);parts.push(geometry);
      const color=new THREE.Color(mesh.material.name==='colorTan'?0xb68a5b:0xf0e6ce),values=new Float32Array(geometry.attributes.position.count*3);
      for(let i=0;i<geometry.attributes.position.count;i++)color.toArray(values,i*3);geometry.setAttribute('color',new THREE.BufferAttribute(values,3));
    }});
    const geometry=mergeGeometries(parts);parts.forEach(part=>part.dispose());geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,material);mesh.name='Mushrooms_authored_supported_caps_and_stems';root.add(mesh);return root;
  }
  const create = name === 'plant_bushDetailed' ? createShrub : name === 'grass_leafsLarge' ? () => createGrass(true) : name === 'grass_large' ? () => createGrass(false) : name === 'mushroom_tanGroup' ? createMushroomCluster : name === 'lily_large' ? createWaterLily : name === 'log' ? createFallenLog : null;
  return create ? fitModelToSource(create(), source) : source;
}
