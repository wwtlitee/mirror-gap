import { FOOD_TOP, FOOD_PROPS, GARDEN_TOP } from './habitat-layout.mjs';
import {RESOURCE_BY_ID,createResourceShape} from './resource-spec.mjs';
// Detail belongs to the furniture. Everything here joins the static material
// batches; adding stitching, joinery and seeds does not add a draw call each.
export function buildInteriorDetails({ THREE, box, cylinder, sphere, path, platform, addMesh, leaf, material: m, groups }) {
  const { rest, feed, work, garden, entry, flight } = groups;
  const cloth = new THREE.MeshStandardMaterial({ color: 0x506e69, roughness: 1 });
  const paper = new THREE.MeshStandardMaterial({ color: 0xc9bea2, roughness: .94 });
  const pulp = new THREE.MeshStandardMaterial({ color: 0xb96d60, roughness: .65 });
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * Math.PI * 2;
    box([.025, .25, .025], [-4.27 + Math.cos(a) * 1.50, .25, -2.68 + Math.sin(a) * 1.50], m.bronze, rest);
  }
  // The split fig sits directly on its own plate, away from the berries.
  feed.add(createResourceShape(THREE,RESOURCE_BY_ID.fig,{surface:pulp,rind:m.pot,seed:paper}));
  const water=FOOD_PROPS.water;
  for(const [dx,dz,r] of [[-.07,.02,.055],[.08,-.07,.027]]){const ripple=addMesh(new THREE.TorusGeometry(r,.002,3,24),m.gold,[water.x+dx,FOOD_TOP+water.radius*.30+.001,water.z+dz],feed);ripple.rotation.x=-Math.PI/2;}
  // Open notebook with page edges, a ceramic cup handle and real monitor vents.
  for (const side of [-1, 1]) {
    const page = box([.31, .018, .43], [-1.97 + side * .16, 1.365, -3.25], paper, work); page.rotation.z = side * .075;
    for (let line = 0; line < 6; line++) box([.21, .0015, .006], [-1.97 + side * .16, 1.388, -3.40 + line * .048], m.darkWood, work);
  }
  path([[-1.97, 1.39, -3.46], [-1.97, 1.37, -3.25], [-1.97, 1.39, -3.03]], .012, m.gold, work, 4);
  for (let i = 0; i < 14; i++) box([.055, .009, .02], [-1.79 + i * .085, 2.74, -3.603], m.dark, work);
  for (const x of [-2.33, .25]) for (let row = 0; row < 3; row++) for (const dx of [-.14, .14]) {
    sphere(.011, [x + dx, .31 + row * .34, -2.88], m.bronze, work);
  }
  // Woven rug fringe and skirting add close-camera detail without filling the air.
  for (let i = 0; i < 72; i++) {
    const a = i / 72 * Math.PI * 2;
    path([[.2 + Math.cos(a) * 2.11, .049, .88 + Math.sin(a) * 2.11], [.2 + Math.cos(a) * 2.20, .036, .88 + Math.sin(a) * 2.20]], .006, m.pillow, flight, 3);
  }
  for (const y of [.41, .47]) path([[-5.69, y, 2.8], [-5.69, y, -4.03], [5.72, y, -4.03]], .013, m.bronze, rest, 4);
}
