import {placeFeet} from './foot-placement.mjs';
import * as THREE from 'three';
import { landingReadiness } from './environment-spec.mjs';
import { batchArticulatedMeshes } from './mesh-batching.mjs';
import {appearancePalette} from './companion-appearance.mjs';
import {VERSION} from './world-spec.mjs';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

// Natural adult-form anatomy uses the same thorax origin, feet and mouth anchors.
// This is an articulated engineering model, not a biological development model.
export function createMirrorGapCharacter(seed=null) {
  const phenotype=appearancePalette(seed);
  const root = new THREE.Group();
  root.name = 'Drosophila_natural_adult';
  root.userData = {
    version: VERSION,
    source: 'Natural Drosophila-inspired adult anatomy; procedural engineering reconstruction',
    construction: 'Continuous cuticle, hexagonal corneal cells and articulated natural anatomy',
    coordinateSystem: '+Z forward, thorax-centred root, standing sole approximately Y=-0.355',
    bodyLength: 1.49,
    nominalExtendedWingspan: 2.34,
    appearance:{seed,...phenotype},
  };
  const body = new THREE.Group(); body.name = 'Thorax_pitch_and_bank'; root.add(body);

  const color=(h,s,l)=>new THREE.Color().setHSL(h,s,l);
  const p=phenotype;
  const materials = {
    thorax: new THREE.MeshStandardMaterial({color:color(p.shellHue,p.shellSaturation,p.shellLight),roughness:.66,metalness:0}),
    head: new THREE.MeshStandardMaterial({color:color(p.shellHue,.39,p.headLight),roughness:.69,metalness:0}),
    dark: new THREE.MeshStandardMaterial({color:0x30251d,roughness:.81,metalness:0}),
    abdomen: new THREE.MeshStandardMaterial({color:color(p.shellHue,.44,p.abdomenLight),roughness:.64,metalness:0,vertexColors:true}),
    band: new THREE.MeshStandardMaterial({color:color(p.shellHue,.35,p.bandLight),roughness:.75,metalness:0}),
    leg: new THREE.MeshStandardMaterial({color:color(p.shellHue,.43,.39),roughness:.68,metalness:0}),
    bristle: new THREE.MeshStandardMaterial({color:0x2c241c,roughness:.88,metalness:0}),
    eyeBase: new THREE.MeshStandardMaterial({color:color(p.eyeHue,p.eyeSaturation,p.eyeLight),roughness:.38,metalness:0}),
    eye: new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.31,metalness:0}),
    wing: new THREE.MeshPhysicalMaterial({color:color(p.wingHue,.12,.84),transparent:true,opacity:p.wingOpacity,roughness:.28,metalness:0,clearcoat:.12,clearcoatRoughness:.4,side:THREE.DoubleSide,depthWrite:false}),
    vein: new THREE.MeshStandardMaterial({color:color(p.shellHue,.28,p.veinLight),roughness:.73,metalness:0,transparent:true,opacity:.68,depthWrite:false}),
    blur: new THREE.MeshBasicMaterial({color:0xb7b4a6,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}),
  };
  for(const [name,material]of Object.entries(materials))material.name=`Natural_${name}`;
  // A small deterministic, mipmapped data texture supplies cuticle microstructure.
  // Its pixels and model structure can be inspected without a DOM/canvas.
  const skinSize=128,skinPixels=new Uint8Array(skinSize*skinSize*4);
  for(let y=0;y<skinSize;y++)for(let x=0;x<skinSize;x++){
    const grain=(Math.imul(x+17,374761393)^Math.imul(y+31,668265263))>>>0;
    const value=182+(grain%55);skinPixels.set([value,value,value,255],(y*skinSize+x)*4);
  }
  const skinTexture=new THREE.DataTexture(skinPixels,skinSize,skinSize);
  skinTexture.wrapS=skinTexture.wrapT=THREE.RepeatWrapping;skinTexture.repeat.set(3,3);
  skinTexture.generateMipmaps=true;skinTexture.minFilter=THREE.LinearMipmapLinearFilter;skinTexture.magFilter=THREE.LinearFilter;skinTexture.needsUpdate=true;
  for(const material of [materials.thorax,materials.head]){material.roughnessMap=skinTexture;material.bumpMap=skinTexture;material.bumpScale=.00065;}
  const detailGroups=[];
  function fineDetails(parent,name,level='near'){
    const group=new THREE.Group();group.name=name;group.userData.detailLevel=level;parent.add(group);detailGroups.push(group);return group;
  }

  function mesh(geometry, material, name, parent = body) {
    const object = new THREE.Mesh(geometry, material);
    object.name = name; object.castShadow = true; object.receiveShadow = true;
    parent.add(object); return object;
  }
  function ellipsoid(position, radii, material, name, parent = body, widthSegments=12, heightSegments=8) {
    const object = mesh(new THREE.SphereGeometry(1,widthSegments,heightSegments), material, name, parent);
    object.position.set(...position); object.scale.set(...radii); return object;
  }
  function tube(points, radius, material, name, parent = body, segments = 12) {
    const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
    return mesh(new THREE.TubeGeometry(curve, segments, radius, 4, false), material, name, parent);
  }
  function segment(from, to, radius, material, name, parent = body, endRadius = radius * 0.74) {
    const start = new THREE.Vector3(...from), finish = new THREE.Vector3(...to);
    const direction = finish.clone().sub(start);
    const object = mesh(new THREE.CylinderGeometry(endRadius, radius, direction.length(), 6), material, name, parent);
    object.position.copy(start).add(finish).multiplyScalar(0.5);
    object.quaternion.setFromUnitVectors(UP, direction.normalize()); return object;
  }

  // A single smooth mesonotum replaces disconnected armour facets. Its envelope
  // retains the existing thorax origin and wing/leg attachment coordinates.
  const shell=mesh(new THREE.SphereGeometry(1,36,24),materials.thorax,'Continuous_mesothoracic_cuticle');
  shell.position.set(0,.015,.006);shell.scale.set(.224,.195,.277);
  ellipsoid([0,.079,-.221],[.132,.102,.105],materials.thorax,'Scutellum',body,20,12);
  ellipsoid([0,-.114,.015],[.148,.062,.192],materials.head,'Thoracic_sternum');
  for(const side of [-1,1])tube([[side*.04,.181,.185],[side*.145,.155,.078],[side*.182,.091,-.03]],.0018,materials.band,'Thoracic_suture',body,14);
  ellipsoid([0, -0.014, 0.253], [0.077, 0.078, 0.089], materials.dark, 'Narrow_neck');
  const head = new THREE.Group(); head.name = 'Separate_head'; head.position.set(0, 0.040, 0.365); body.add(head);
  ellipsoid([0, 0, 0], [0.190, 0.157, 0.193], materials.head, 'Head_capsule', head,24,16);
  ellipsoid([0, -0.047, 0.190], [0.065, 0.058, 0.031], materials.leg, 'Face_and_clypeus', head);

  // Regular, domed hexagonal corneal cells follow the ellipsoidal outer surface;
  // the lower-resolution red base remains when microscopic detail is hidden.
  function compoundCornea(){
    const positions=[],colors=[],indices=[],base=materials.eyeBase.color.clone();let cells=0;
    const cellRadius=.058,rowStep=.091,columnStep=Math.sqrt(3)*cellRadius;
    const surface=(y,z,raised=0)=>[.128*(Math.sqrt(Math.max(.001,1-y*y-z*z))+raised),.156*y,.150*z];
    for(let row=-9;row<=9;row++)for(let column=-10;column<=10;column++){
      const y=row*rowStep,z=(column+(Math.abs(row)%2)*.5)*columnStep;if(y*y+z*z>.79)continue;
      const start=positions.length/3,tone=.91+((row*13+column*17+2000)%11)*.012;
      positions.push(...surface(y,z,.014));colors.push(...base.clone().multiplyScalar(tone).toArray());
      for(let point=0;point<6;point++){
        const angle=point/6*TAU+Math.PI/6;
        positions.push(...surface(y+Math.sin(angle)*cellRadius*.93,z+Math.cos(angle)*cellRadius*.93));
        colors.push(...base.clone().multiplyScalar(tone*.91).toArray());
      }
      for(let point=0;point<6;point++)indices.push(start,start+1+(point+1)%6,start+1+point);cells++;
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.userData.ommatidialCells=cells;return geometry;
  }
  const eyeGeometry=compoundCornea();root.userData.ommatidialCellsPerEye=eyeGeometry.userData.ommatidialCells;
  for (const side of [-1, 1]) {
    const eyeRoot=new THREE.Group();eyeRoot.name=`${side<0?'Left':'Right'}_compound_eye`;eyeRoot.position.set(side*.145,.022,.032);eyeRoot.rotation.y=side*.17;head.add(eyeRoot);
    ellipsoid([0,0,0],[.128,.156,.150],materials.eyeBase,'Compound_eye_base',eyeRoot);
    const detail=fineDetails(eyeRoot,'Hexagonal_ommatidia');
    mesh(eyeGeometry,materials.eye,'Domed_hexagonal_cornea',detail).scale.x=side;
    const brow=fineDetails(head,`${side<0?'Left':'Right'}_orbital_setae`,'mid');
    for(let i=0;i<4;i++){const y=.03+i*.025;segment([side*.096,y,.126],[side*.11,y+.040,.164],.0011,materials.bristle,'Orbital_bristle',brow);}
  }
  // Three ocelli and paired palps are anatomical structures, with no light source.
  for (const [x, y, z] of [[0, 0.149, 0.003], [-0.030, 0.141, -0.016], [0.030, 0.141, -0.016]]) {
    ellipsoid([x, y, z], [0.009, 0.008, 0.009], materials.dark, 'Ocellus', head);
  }
  for(const side of [-1,1])ellipsoid([side*.038,-.073,.185],[.012,.023,.035],materials.leg,'Maxillary_palp',head);

  const mouth = new THREE.Group(); mouth.name = 'Folded_proboscis'; mouth.position.set(0, -0.082, 0.184); head.add(mouth);
  segment([0, 0, 0], [0, -0.038, 0.024], 0.015, materials.leg, 'Proboscis_stem', mouth);
  for (const side of [-1,1]) {
    ellipsoid([side*.012, -.043, .030], [.014,.012,.024], materials.head, 'Paired_labellar_lobe', mouth);
    for(let groove=0;groove<4;groove++)segment([side*.012,-.054,.013+groove*.009],[side*.023,-.052,.013+groove*.009],.0014,materials.bristle,'Labellar_groove',mouth);
  }

  const antennae = [];
  for (const side of [-1, 1]) {
    const antenna = new THREE.Group(); antenna.name = `${side < 0 ? 'Left' : 'Right'}_short_antenna`;
    antenna.position.set(side * 0.047, 0.035, 0.167); head.add(antenna);
    segment([0, 0, 0], [side * 0.011, -0.002, 0.028], 0.014, materials.head, 'Scape_and_pedicel', antenna);
    ellipsoid([side * 0.016, -0.005, 0.052], [0.021, 0.029, 0.033], materials.leg, 'Antennal_funiculus', antenna);
    const arista = [[side * 0.021, 0.013, 0.062], [side * 0.053, 0.066, 0.092], [side * 0.096, 0.112, 0.110]];
    tube(arista, 0.0026, materials.bristle, 'Arista', antenna, 8);
    for (let index = 0; index < 6; index++) {
      const amount = index / 6;
      const origin = [side * (0.029 + amount * 0.056), 0.028 + amount * 0.065, 0.071 + amount * 0.029];
      for (const branch of [-1, 1]) {
        const endpoint = [origin[0] + side * branch * .024*p.bristleLength, origin[1] + 0.014, origin[2] - branch * 0.011];
        segment(origin, endpoint, 0.0009, materials.bristle, 'Arista_branch', antenna);
      }
    }
    antennae.push({ group: antenna, side });
    antenna.scale.set(p.antennaLength,1,p.antennaLength);
  }

  // The continuous abdomen carries dark dorsal tergite bands, not metallic rings.
  const abdomen = new THREE.Group(); abdomen.name = 'Horizontal_segmented_abdomen'; body.add(abdomen);
  const abdominalSegments = [
    { z: -0.250, radius: 0.179, length: 0.123 },
    { z: -0.360, radius: 0.181, length: 0.125 },
    { z: -0.470, radius: 0.164, length: 0.119 },
    { z: -0.580, radius: 0.130, length: 0.110 },
    { z: -0.680, radius: 0.086, length: 0.097 },
  ];
  const abdomenCurve=new THREE.CatmullRomCurve3([
    new THREE.Vector3(.10,0,0),...abdominalSegments.map(({radius},i)=>new THREE.Vector3(radius,.070+i*.108,0)),
    new THREE.Vector3(.035,.60,0),new THREE.Vector3(.002,.65,0),
  ]);
  const profile=abdomenCurve.getPoints(52).map(v=>new THREE.Vector2(Math.max(.002,v.x),v.y));
  function abdomenRadiusAt(axial){
    for(let i=1;i<profile.length;i++)if(profile[i].y>=axial){
      const a=profile[i-1],b=profile[i];
      return THREE.MathUtils.lerp(a.x,b.x,THREE.MathUtils.clamp((axial-a.y)/(b.y-a.y),0,1));
    }
    return profile.at(-1).x;
  }
  const cuticleGeometry=new THREE.LatheGeometry(profile,40),abdomenPositions=cuticleGeometry.attributes.position,abdomenColors=[];
  for(let i=0;i<abdomenPositions.count;i++){
    const axial=abdomenPositions.getY(i),dorsal=abdomenPositions.getZ(i)>-.012;
    const band=abdominalSegments.some((_,segment)=>Math.abs(axial-(.102+segment*.108))<p.bandWidth/2);
    const shade=band&&dorsal?.34:1;abdomenColors.push(shade,shade,shade);
  }
  cuticleGeometry.setAttribute('color',new THREE.Float32BufferAttribute(abdomenColors,3));
  const cuticle=mesh(cuticleGeometry,materials.abdomen,'Continuous_tapered_abdomen',abdomen);
  cuticle.rotation.x=-Math.PI/2;cuticle.scale.z=.75;cuticle.position.set(0,-.024,-.185);
  // Shallow dorsal sclerite rims provide real segmentation without altering the
  // smooth collision-scale body envelope or introducing complete toroidal rings.
  abdominalSegments.forEach((_,i)=>{
    const t=.102+i*.108;
    const rimProfile=[[-.005,.0002],[0,.0011],[.006,.0002]].map(([offset,raised])=>new THREE.Vector2(abdomenRadiusAt(t+offset)+raised,t+offset));
    const plate=mesh(new THREE.LatheGeometry(rimProfile,24,-Math.PI/2,Math.PI),materials.band,`Dorsal_tergite_rim_${i+1}`,abdomen);
    plate.rotation.x=-Math.PI/2;plate.scale.z=.75;plate.position.copy(cuticle.position);
  });
  // Key macrochaetae stay geometric at every distance; minute hairs are a
  // separately batched near-view layer rather than hundreds of draw calls.
  for (let index = 0; index < 10; index++) {
    const side = index % 2 ? 1 : -1;
    const z = 0.13 - Math.floor(index / 2) * 0.054;
    segment([side * 0.12, 0.160, z], [side * (.12+.029*p.bristleLength), 0.206, z - 0.024], 0.0012, materials.bristle, 'Thoracic_bristle');
  }
  const thoracicHairs=fineDetails(body,'Thoracic_microsetae');
  const hairCount=p.bristleDensity>.5?54:42;
  for(let i=0;i<hairCount;i++){
    const angle=i*2.39996,x=Math.cos(angle)*.155,z=(i/hairCount-.5)*.36;
    const y=.015+.195*Math.sqrt(Math.max(.01,1-(x/.224)**2-((z-.006)/.277)**2));
    segment([x,y,z],[x*1.05,y+.015*p.bristleLength,z-.007],.00055,materials.bristle,'Cuticle_microseta',thoracicHairs);
  }

  const legs = [];
  const legPlans = [
    { z: 0.169, knee: [0.143, -0.047, 0.074], ankle: [0.245, -0.222, 0.224], foot: [0.294, -0.260, 0.290] },
    { z: 0.007, knee: [0.196, -0.054, 0.015], ankle: [0.333, -0.226, 0.012], foot: [0.390, -0.260, -0.016] },
    { z: -0.157, knee: [0.153, -0.056, -0.131], ankle: [0.253, -0.224, -0.289], foot: [0.304, -0.260, -0.347] },
  ];
  for (const side of [-1, 1]) for (let index = 0; index < 3; index++) {
    const plan = legPlans[index];
    const leg = new THREE.Group(); leg.name = `${side < 0 ? 'Left' : 'Right'}_leg_${index + 1}`;
    leg.position.set(side * 0.145, -0.090, plan.z); body.add(leg);
    const knee = [plan.knee[0] * side, plan.knee[1], plan.knee[2]];
    const ankle = [plan.ankle[0] * side, plan.ankle[1], plan.ankle[2]];
    const foot = [plan.foot[0] * side, plan.foot[1], plan.foot[2]];
    ellipsoid([side*.010,-.008,.002],[.021,.024,.020],materials.leg,'Coxa',leg);
    ellipsoid(knee.map(value=>value*.21),[.017,.020,.017],materials.leg,'Trochanter',leg);
    segment([0, 0, 0], knee, 0.014, materials.leg, 'Femur', leg, 0.010);
    const lower = new THREE.Group(); lower.name = 'Tibia_joint'; lower.position.set(...knee); leg.add(lower);
    const ankleLocal = ankle.map((value, axis) => value - knee[axis]);
    const footLocal = foot.map((value, axis) => value - knee[axis]);
    lower.userData.footLocal=footLocal;
    segment([0, 0, 0], ankleLocal, 0.0068, materials.leg, 'Tibia', lower, 0.0048);
    segment(ankleLocal, footLocal, 0.0044, materials.bristle, 'Tarsus', lower, 0.0025);
    for (const prong of [-1, 1]) segment(footLocal, [footLocal[0] + side * 0.014, footLocal[1] + 0.002, footLocal[2] + prong * 0.008], 0.0021, materials.dark, 'Minute_tarsal_claw', lower);
    for(const toe of [-1,1])ellipsoid([footLocal[0],footLocal[1]-.004,footLocal[2]+toe*.009],[.011,.006,.008],materials.head,'Paired_adhesive_pad',lower);
    const tibialSetae=fineDetails(lower,'Tibial_microsetae');
    for(let hair=1;hair<=3;hair++){
      const origin=ankleLocal.map(value=>value*hair/4);
      segment(origin,[origin[0]+side*.013,origin[1]-.009,origin[2]-.005],.0006,materials.bristle,'Tibial_sensillum',tibialSetae);
    }
    const upperDirection=new THREE.Vector3(...[[.025,-.11,.09],[.035,-.10,-.10],[.06,-.065,-.17]][index]);upperDirection.x*=side;
    const lowerDirection=new THREE.Vector3(...[[-.02,.07,-.15],[-.025,.07,-.17],[-.025,-.025,-.21]][index]);lowerDirection.x*=side;
    const tuckUpper=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...knee).normalize(),upperDirection.normalize());
    const tuckLower=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...ankleLocal).normalize(),lowerDirection.normalize().applyQuaternion(tuckUpper.clone().invert()));
    legs.push({ group: leg, lower, side, index, tuckUpper, tuckLower });
  }

  // Exactly one anatomical wing pair. The shallow afterimages are a rendering
  // effect and are named as such in the export hierarchy; they are not hindwings.
  const outline = new THREE.Shape();
  outline.moveTo(0, 0);
  outline.bezierCurveTo(0.260, -0.055, 0.665, -0.040, 0.915, 0.106);
  outline.bezierCurveTo(1.102, 0.230, 0.944, 0.462, 0.611, 0.463);
  outline.bezierCurveTo(0.306, 0.445, 0.077, 0.160, 0, 0);
  const wingGeometry = new THREE.ShapeGeometry(outline, 20);
  wingGeometry.rotateX(-Math.PI / 2);
  const wingHeight=(x,z)=>.008*Math.sin(Math.PI*THREE.MathUtils.clamp(x/1.10,0,1))*Math.sin(Math.PI*THREE.MathUtils.clamp(z/.47,0,1));
  const wingPositions=wingGeometry.attributes.position;
  for(let i=0;i<wingPositions.count;i++)wingPositions.setY(i,wingHeight(wingPositions.getX(i),-wingPositions.getZ(i)));
  wingGeometry.computeVertexNormals();
  const wings = [];
  for (const side of [-1, 1]) {
    const wing = new THREE.Group(); wing.name = `${side < 0 ? 'Left' : 'Right'}_single_membrane_wing`;
    wing.position.set(side * 0.158, 0.136, -0.078); wing.rotation.y = side * 1.035; body.add(wing);
    const membrane = mesh(wingGeometry, materials.wing, 'Thin_wing_membrane', wing);
    membrane.scale.x = side; membrane.castShadow = false; membrane.renderOrder = 3;
    const outlinePoints = outline.getPoints(48).map(point => [side * point.x, wingHeight(point.x,point.y), -point.y]);
    tube(outlinePoints, 0.0013, materials.vein, 'Costal_wing_margin', wing, 48).castShadow = false;
    const veinPaths = [
      [[0, 0], [0.34, 0.01], [0.70, 0.054], [0.951, 0.169]],
      [[0, 0], [0.35, 0.145], [0.72, 0.253], [0.968, 0.298]],
      [[0, 0], [0.31, 0.225], [0.62, 0.363], [0.774, 0.430]],
      [[0.08, 0.06], [0.22, 0.233], [0.420, 0.391]],
      [[0.39, 0.156], [0.438, 0.079]],
      [[0.59, 0.232], [0.602, 0.354]],
      [[0.18, 0.014], [0.24, 0.079], [0.35, 0.145]],
      [[0.35, 0.145], [0.46, 0.212], [0.59, 0.232]],
      [[0.70, 0.054], [0.76, 0.153], [0.72, 0.253]],
      [[0.22, 0.233], [0.35, 0.249], [0.46, 0.212]],
      [[0.602, 0.354], [0.711, 0.360], [0.82, 0.319]],
    ];
    veinPaths.forEach((points, index) => {
      tube(points.map(([x, z]) => [side*x,wingHeight(x,z)+.001,-z]),index<3?.0019:.0012,materials.vein,`Natural_wing_vein_${index+1}`,wing,index<4?12:6).castShadow=false;
    });
    const afterimages = new THREE.Group(); afterimages.name = 'Non_anatomical_motion_afterimages'; afterimages.visible = false; wing.add(afterimages);
    for (const offset of [-0.13, 0.13]) {
      const blur = mesh(wingGeometry, materials.blur, 'Wing_motion_afterimage', afterimages);
      blur.scale.x = side; blur.rotation.z = side * offset; blur.castShadow = false; blur.renderOrder = 2;
    }
    wings.push({ group: wing, afterimages, side });
  }
  for (const side of [-1, 1]) {
    const haltere = new THREE.Group(); haltere.name = `${side < 0 ? 'Left' : 'Right'}_haltere`; body.add(haltere);
    segment([side * 0.171, 0.012, -0.183], [side * 0.232, 0.007, -0.248], 0.0026, materials.leg, 'Haltere_stalk', haltere);
    ellipsoid([side * 0.238, 0.010, -0.254], [0.012, 0.017, 0.020], materials.abdomen, 'Haltere_knob', haltere);
  }

  // Spiracles, ventral plates and fine abdominal setae complete the natural body.
  const abdominalHairs=fineDetails(abdomen,'Abdominal_microsetae');
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
    const z = -.25 - i * .105, radius = abdominalSegments[i].radius;
    ellipsoid([side * radius * .94, -.012, z], [.009, .012, .016], materials.dark, 'Abdominal_spiracle', abdomen);
    for (let j = 0; j < 3; j++) {
      const y = .035 + j * .022;
      segment([side * radius * .75, y, z], [side * (radius * .75 + .023*p.bristleLength), y + .028, z - .025], .0007, materials.bristle, 'Abdominal_sensillum', abdominalHairs);
    }
  }
  for (const { lower, side, index } of legs) {
    const plan = legPlans[index];
    for (let j = 1; j < 5; j++) {
      const t = j / 5;
      const position = plan.ankle.map((v, axis) => (v + (plan.foot[axis] - v) * t - plan.knee[axis]) * (axis === 0 ? side : 1));
      ellipsoid(position, [.006, .004, .006], materials.leg, 'Tarsomere_joint', lower);
    }
  }
  Object.values(materials).forEach(material => { if (material.transparent) material.forceSinglePass = true; });
  const batching = batchArticulatedMeshes(root);
  root.userData.batching = batching;
  // The feeding tip is articulated to the same world-space food contact used
  // by metabolism. Keep it separate from the static mouth-part batches.
  const feedingMouth=new THREE.Group();feedingMouth.position.copy(mouth.position);head.add(feedingMouth);feedingMouth.visible=false;
  const feedingStem=new THREE.Mesh(new THREE.CylinderGeometry(.008,.011,1,6),materials.leg);
  const feedingTip=new THREE.Mesh(new THREE.SphereGeometry(1,10,6),materials.head);feedingTip.scale.set(.021,.010,.019);
  feedingMouth.add(feedingStem,feedingTip);
  const feedingDirection=new THREE.Vector3(),feedingWorldTip=new THREE.Vector3();
  const glyphSize=32,pixels=new Uint8Array(glyphSize*glyphSize*4);
  const glyph=(x,y)=>x>=7&&x<=24&&((y>=6&&y<=9)||(y>=22&&y<=25)||(y>=9&&y<=22&&Math.abs(x-y)<2));
  for(let y=0;y<glyphSize;y++)for(let x=0;x<glyphSize;x++){
    const white=glyph(x,y),outline=white||[-1,0,1].some(dx=>[-1,0,1].some(dy=>glyph(x+dx,y+dy)));
    const i=(y*glyphSize+x)*4;pixels.set([white?238:20,white?239:24,white?219:25,outline?255:0],i);
  }
  const sleepTexture=new THREE.DataTexture(pixels,glyphSize,glyphSize);sleepTexture.needsUpdate=true;
  sleepTexture.magFilter=THREE.LinearFilter;sleepTexture.minFilter=THREE.LinearFilter;
  const sleepLetters=Array.from({length:3},(_,i)=>{
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:sleepTexture,transparent:true,depthWrite:false,depthTest:false,opacity:0}));
    sprite.name=`Sleep_Z_${i}`;sprite.visible=false;sprite.renderOrder=10;root.add(sprite);return sprite;
  });
  let sleepBlend=0;
  let time = 0;
  let flightBlend = 0, stride = 0, legTuck = 0;
  let disposed = false;
  function update(actor = {}, delta = 1 / 60) {
    if (disposed) return;
    const dt = Math.min(0.1, Math.max(0, Number.isFinite(delta) ? delta : 0));
    // Freeze every articulated part and the visual wing trails when paused.
    if (dt === 0 && root.userData.pose) return;
    time += dt;
    const state = actor && typeof actor === 'object' ? actor : {};
    const flying = state.contact === false || state.mode === 'travel' || (Number.isFinite(state.contactSeconds) && state.contactSeconds < .16);
    const resting = !flying && state.behavior === 'rest';
    sleepBlend=THREE.MathUtils.damp(sleepBlend,resting?1:0,3,dt);
    sleepLetters.forEach((sprite,i)=>{
      const phase=(time*.32+i/3)%1;
      sprite.visible=resting;sprite.material.opacity=resting?Math.sin(phase*Math.PI)*.85:0;
      sprite.position.set(.16+phase*.26,.48+phase*.7,.36);
      sprite.scale.setScalar(.20+phase*.13);
    });
    const activeTarget=state.action==='eat'?state.feedingTarget:state.behavior==='drink'?state.drinkingTarget:null;
    const foodTarget=!flying&&Array.isArray(activeTarget)&&activeTarget.length===3&&activeTarget.every(Number.isFinite)?activeTarget:null;
    const eating = Boolean(foodTarget);
    const velocity = Array.isArray(state.velocity) && state.velocity.length === 3 && state.velocity.every(Number.isFinite) ? state.velocity : [0, 0, 0];
    const speed = Math.hypot(...velocity);
    stride += Math.hypot(velocity[0],velocity[2])*dt*TAU/.055;
    const landing = flying ? (state.contact ? 0 : landingReadiness(state)) : 1;
    legTuck=THREE.MathUtils.damp(legTuck,flying?1-landing:0,14,dt);
    flightBlend = THREE.MathUtils.damp(flightBlend, flying ? 1 : 0, 12, dt);
    const targetPitch = flying ? (Number.isFinite(state.pitch) ? THREE.MathUtils.clamp(state.pitch, -0.32, 0.35) : 0.10 + Math.min(speed, 3) * 0.025) : 0;
    const targetBank = flying && Number.isFinite(state.bank) ? THREE.MathUtils.clamp(state.bank, -0.40, 0.40) : 0;
    body.rotation.x = THREE.MathUtils.damp(body.rotation.x, targetPitch, 10, dt);
    body.rotation.z = THREE.MathUtils.damp(body.rotation.z, targetBank, 10, dt);
    const feedingCrouch=eating?THREE.MathUtils.clamp((root.position.y-.04*(root.scale.x/.22)-foodTarget[1])/root.scale.x,0,.20):0;
    const targetBodyY=flying?Math.sin(time*19)*.004:-.031-.11*sleepBlend-feedingCrouch;
    body.position.y=root.userData.pose?THREE.MathUtils.damp(body.position.y,targetBodyY,12,dt):targetBodyY;
    body.position.z=root.userData.pose?THREE.MathUtils.damp(body.position.z,eating?.20:0,12,dt):(eating?.20:0);
    if(!flying)body.rotation.x-=.045*sleepBlend*(1-Math.exp(-10*dt));
    head.rotation.y = foodTarget || flying || resting || ['observe','watch','play','toilet'].includes(state.behavior) ? 0 : Math.sin(time * 0.91) * (resting ? 0.008 : 0.040);
    head.rotation.x=THREE.MathUtils.damp(head.rotation.x,eating?.22:0,12,dt);
    abdomen.rotation.x = Math.sin(time * 3.0) * 0.004;
    mouth.rotation.x = eating ? .70 + Math.sin(time * 5.2) * .07 : 0;
    mouth.scale.y = 1;
    const phaseOffset = Number.isFinite(state.flightPhase) ? state.flightPhase : 0;
    // A small displayed sweep plus faint trails remains readable at 60 Hz;
    // this is animation, not a claim to resolve physiological wingbeat rates.
    const wingPhase = time * TAU * 31 + phaseOffset;
    wings.forEach(({ group, afterimages, side }) => {
      group.rotation.y = side * THREE.MathUtils.lerp(1.035, 0.025, flightBlend);
      group.rotation.z = side * (Math.sin(wingPhase) * 0.48 * flightBlend + 0.025 * (1 - flightBlend));
      group.rotation.x = -0.010 + flightBlend * 0.035;
      afterimages.visible = flightBlend > 0.12;
    });
    materials.blur.opacity = 0.025 * flightBlend;
    materials.wing.opacity = THREE.MathUtils.lerp(p.wingOpacity,p.wingOpacity*.74,flightBlend);
    const grooming = !flying && ['groom','bathe','idle-groom'].includes(state.behavior);
    const walking=!flying&&state.behavior==='walk';
    legs.forEach(({ group, lower, side, index, tuckUpper, tuckLower }) => {
      group.rotation.set(0,0,0);lower.rotation.set(0,0,0);
      if (walking) {
        const step = Math.sin(stride + (index % 2 === (side > 0 ? 0 : 1) ? 0 : Math.PI));
        group.rotation.x = step * .28; lower.rotation.x = Math.max(0, step) * .34;
        group.rotation.y=side*step*.06;
      }
      if (grooming && index === 0) {
        group.rotation.z = side * (0.44 + Math.sin(time * 8.2 + side) * 0.055);
        group.rotation.y = -side * 0.17;
        lower.rotation.x = -0.35 + Math.sin(time * 8.2) * 0.08;
      }
      group.quaternion.slerp(tuckUpper,legTuck);lower.quaternion.slerp(tuckLower,legTuck);
    });
    const feet=!flying?placeFeet(root,body,legs,{walking,stride,grooming,time}):[];
    if(state.behavior==='idle'){head.rotation.y=.06*Math.sin(time*.65);head.rotation.x=.02*Math.sin(time*.43);}
    if(grooming)head.rotation.x=.055*Math.sin(time*7);
    if(state.behavior==='toilet')abdomen.rotation.x=.12+Math.sin(time*4)*.025;
    mouth.visible=!foodTarget;feedingMouth.visible=Boolean(foodTarget);
    if(foodTarget){
      root.updateMatrixWorld(true);feedingDirection.set(...foodTarget);feedingMouth.worldToLocal(feedingDirection);
      feedingDirection.clampLength(0,.40);
      const length=feedingDirection.length();feedingStem.position.copy(feedingDirection).multiplyScalar(.5);
      feedingStem.scale.y=length;feedingStem.quaternion.setFromUnitVectors(UP,feedingDirection.clone().normalize());
      feedingTip.position.copy(feedingDirection);feedingMouth.updateMatrixWorld(true);feedingTip.getWorldPosition(feedingWorldTip);
    }
    root.userData.pose={flying,walking,grooming,resting,sleepBlend,bodyHeight:body.position.y,feedingCrouch,feedingLength:foodTarget?feedingDirection.length()*root.scale.x:0,stride,landing,legTuck,feet,feedingTarget:foodTarget,feedingTip:foodTarget?feedingWorldTip.toArray():null};
    antennae.forEach(({ group, side }) => {
      group.rotation.y = Math.sin(time * 5.1 + side) * (resting ? 0.010 : 0.032);
      group.rotation.x = Math.sin(time * 3.6 + side) * 0.015;
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    sleepTexture.dispose();
    skinTexture.dispose();
    const geometries = new Set(), usedMaterials = new Set();
    root.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) usedMaterials.add(material);
    });
    geometries.forEach(geometry => geometry.dispose()); usedMaterials.forEach(material => material.dispose());
  }
  let detailLevel='near';
  function setDetailLevel(level){
    if(disposed)return;
    if(!['near','mid','far'].includes(level))throw new RangeError('Unknown natural model detail level');
    detailLevel=level;root.userData.detailLevel=level;
    for(const group of detailGroups)group.visible=level==='near'||level==='mid'&&group.userData.detailLevel==='mid';
  }
  function setDetailByPixels(pixels){
    if(!Number.isFinite(pixels)||pixels<0)return;
    // Hysteresis avoids shimmer while following a tiny fly near a threshold.
    if(detailLevel==='near'&&pixels<76)setDetailLevel(pixels<20?'far':'mid');
    else if(detailLevel==='mid'&&pixels>=96)setDetailLevel('near');
    else if(detailLevel==='mid'&&pixels<20)setDetailLevel('far');
    else if(detailLevel==='far'&&pixels>=26)setDetailLevel(pixels>=96?'near':'mid');
  }
  setDetailLevel('near');
  root.userData.rigAnchors={head:head.position.toArray(),mouth:mouth.position.toArray(),legHips:legs.map(({group})=>group.position.toArray()),bodyLength:1.49};
  return { root, update, dispose, setDetailLevel, setDetailByPixels };
}
