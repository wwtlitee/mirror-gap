import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {FOOD_PIECES,portionTag,visiblePieces} from './food-stock.mjs';
import {naturalizeImportedMaterial} from './natural-materials.mjs';

const EPS=1e-8;
const pointKey=v=>v.slice(0,3).map(n=>n.toFixed(5)).join(',');
const dot=(n,v)=>n[0]*v[0]+n[1]*v[1]+n[2]*v[2];
function readTriangles(mesh){
 const {position:p,normal:n,uv,color}=mesh.geometry.attributes,index=mesh.geometry.index;
 const normalMatrix=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld),v=new THREE.Vector3(),normal=new THREE.Vector3();
 return Array.from({length:(index?index.count:p.count)/3},(_,i)=>({cap:false,vertices:[0,1,2].map(k=>{
  const j=index?index.getX(i*3+k):i*3+k;v.fromBufferAttribute(p,j).applyMatrix4(mesh.matrixWorld);
  if(n)normal.fromBufferAttribute(n,j).applyMatrix3(normalMatrix).normalize();else normal.set(0,1,0);
  return [...v.toArray(),...normal.toArray(),uv?.getX(j)??0,uv?.getY(j)??0,color?.getX(j)??1,color?.getY(j)??1,color?.getZ(j)??1];
 })}));
}
function edibleTriangle(mesh,triangle,definition){return mesh.userData.edible===true||(mesh.userData.edible!==false&&(!definition.edibleU||triangle.vertices.every(v=>definition.edibleU.some(u=>Math.abs(v[6]-u)<.001))));}
function geometry(triangles){
 const vertices=triangles.flatMap(t=>t.vertices),g=new THREE.BufferGeometry();
 for(const [name,start,size]of [['position',0,3],['normal',3,3],['uv',6,2]])g.setAttribute(name,new THREE.Float32BufferAttribute(vertices.flatMap(v=>v.slice(start,start+size)),size));
 if(vertices.every(v=>v.length>=11))g.setAttribute('color',new THREE.Float32BufferAttribute(vertices.flatMap(v=>v.slice(8,11)),3));
 return g;
}

function storedTriangle(triangle){
 // The meshes are stored in world-space Float32 coordinates. A valid double
 // precision sliver at a cut can collapse or reverse when those coordinates
 // round (especially a tiny seed on a fruit several metres from the origin).
 const cross=vertices=>{const [a,b,c]=vertices,u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];};
 const vertices=triangle.vertices.map(vertex=>vertex.map((value,i)=>i<3?Math.fround(value):value)),normal=cross(vertices);
 if(dot(normal,normal)<=1e-18||dot(normal,cross(triangle.vertices))<=0)return null;
 // Caps have an exact plane normal. Rounding can tilt an almost collinear
 // boundary sliver off that plane while leaving its squared area nonzero.
 if(triangle.cap&&dot(normal,vertices[0].slice(3,6))<=0)return null;
 return {...triangle,vertices};
}

// Reconstruct each actual boundary loop. Sorting every intersection around one
// center incorrectly bridges pizza toppings, holes and disconnected components.
function capsFromSegments(segments,inward){
 const nodes=new Map(),edges=new Map();
 const node=v=>{const key=pointKey(v);if(!nodes.has(key))nodes.set(key,{v,edges:[]});return key;};
 for(const [a,b]of segments){const ka=node(a),kb=node(b);if(ka===kb)continue;const key=[ka,kb].sort().join('|');if(edges.has(key))continue;const edge={a:ka,b:kb,used:false};edges.set(key,edge);nodes.get(ka).edges.push(edge);nodes.get(kb).edges.push(edge);}
 const loops=[];
 for(const edge of edges.values()){
  if(edge.used)continue;const start=edge.a,path=[],seen=new Set();let key=start,current=edge;
  while(current&&!current.used){path.push(nodes.get(key).v);seen.add(key);current.used=true;key=current.a===key?current.b:current.a;if(key===start)break;if(seen.has(key))break;current=nodes.get(key).edges.find(e=>!e.used);}
  // Some imported layers omit their hidden bottom face. Close that open
  // chain within its connected component, never across separate toppings.
  if(path.length>=3){if(key!==start)path.push(nodes.get(key).v);loops.push(path);}
 }
 const normal=new THREE.Vector3(...inward).negate(),u=new THREE.Vector3(0,1,0);if(Math.abs(normal.y)>.9)u.set(1,0,0);u.cross(normal).normalize();const v=new THREE.Vector3().crossVectors(normal,u);
 const project=p=>new THREE.Vector2(dot(u.toArray(),p),dot(v.toArray(),p));
 const contours=loops.map(points=>({points,flat:points.map(project),parent:null,depth:0}));
 const inside=(p,poly)=>{let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;};
 for(const c of contours){const area=Math.abs(THREE.ShapeUtils.area(c.flat));c.parent=contours.filter(other=>other!==c&&Math.abs(THREE.ShapeUtils.area(other.flat))>area+EPS&&inside(c.flat[0],other.flat)).sort((a,b)=>Math.abs(THREE.ShapeUtils.area(a.flat))-Math.abs(THREE.ShapeUtils.area(b.flat)))[0]??null;}
 for(const c of contours){for(let p=c.parent;p;p=p.parent)c.depth++;}
 const result=[];
 for(const c of contours){if(c.depth%2)continue;const holes=contours.filter(h=>h.parent===c&&h.depth%2),points=[c,...holes].flatMap(c=>c.points);
  for(const ids of THREE.ShapeUtils.triangulateShape(c.flat,holes.map(h=>h.flat))){const vertices=ids.map(i=>[...points[i].slice(0,3),...normal.toArray(),0,0]);const a=new THREE.Vector3(...vertices[0].slice(0,3)),b=new THREE.Vector3(...vertices[1].slice(0,3)),d=new THREE.Vector3(...vertices[2].slice(0,3));if(b.sub(a).cross(d.sub(a)).dot(normal)<0)vertices.reverse();result.push({vertices,cap:true});}
 }
 return result;
}
function clipClosed(triangles,plane){
 const result=[],segments=[];
 for(const t of triangles){const polygon=[],cross=[];
  for(let i=0;i<3;i++){const a=t.vertices[i],b=t.vertices[(i+1)%3],da=dot(plane.normal,a)-plane.offset,db=dot(plane.normal,b)-plane.offset,ia=da>=-EPS,ib=db>=-EPS;
   if(ia)polygon.push(a);if(ia!==ib){const amount=da/(da-db),p=a.map((x,k)=>x+(b[k]-x)*amount);polygon.push(p);cross.push(p);}
  }
  if(cross.length===2)segments.push(cross);
  for(let i=1;i<polygon.length-1;i++)result.push({vertices:[polygon[0],polygon[i],polygon[i+1]],cap:t.cap,neighbor:t.neighbor});
 }
 return result.concat(capsFromSegments(segments,plane.normal).map(t=>({...t,neighbor:plane.neighbor})));
}
function connectedParts(triangles){
 const parents=triangles.map((_,i)=>i),owners=new Map();
 const root=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
 triangles.forEach((t,i)=>{for(const v of t.vertices){const key=pointKey(v);if(owners.has(key))parents[root(i)]=root(owners.get(key));else owners.set(key,i);}});
 const groups=new Map();triangles.forEach((t,i)=>{const r=root(i);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(t);});return [...groups.values()];
}
export function splitFood(model,definition){
 model.updateMatrixWorld(true);const sources=[];model.traverse(mesh=>{if(mesh.isMesh){const triangles=readTriangles(mesh);if(['pizza','fries'].includes(definition.id))sources.push({mesh,triangles});else for(const part of connectedParts(triangles))sources.push({mesh,triangles:part});}});
 const group=new THREE.Group();group.userData.resourceId=definition.id;group.name=`portions-${definition.id}`;
 const add=(triangles,material,piece,edible,neighbor=-1)=>{triangles=triangles.map(storedTriangle).filter(Boolean);if(!triangles.length)return;const mesh=new THREE.Mesh(geometry(triangles),material);mesh.name=`${definition.id}-${piece<0?'container':`piece-${piece}`}`;mesh.userData={edible,foodId:definition.id};if(piece>=0)Object.assign(mesh.userData,{foodPiece:piece,foodNeighbor:neighbor,foodTag:portionTag(definition.id,piece,neighbor)});mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);};
 if(definition.id==='pizza'){
  // This asset already contains eight closed radial slices. Preserve them.
  const seen=new Set();for(const {mesh,triangles}of sources){const match=/^slice([1-8])$/.exec(mesh.name);if(!match)throw Error('Pizza slice asset contract changed');const piece=Number(match[1])-1;seen.add(piece);add(triangles,mesh.material,piece,true);}if(seen.size!==8)throw Error('Pizza must contain eight slices');
 }else if(definition.id==='fries'){
  const chips=[];
  for(const {mesh,triangles}of sources){const edible=triangles.filter(t=>edibleTriangle(mesh,t,definition));add(triangles.filter(t=>!edibleTriangle(mesh,t,definition)),mesh.material,-1,false);for(const part of connectedParts(edible))chips.push({triangles:part,material:mesh.material,y:Math.min(...part.flatMap(t=>t.vertices.map(v=>v[1])))});}
  // Whole chips, never slices through the carton. The accessible served chips
  // go first, so the final portion still contains food the fly can reach.
  chips.sort((a,b)=>a.y-b.y);if(chips.length<8)throw Error('Fries need eight independent edible pieces');chips.forEach((chip,i)=>add(chip.triangles,chip.material,i%FOOD_PIECES,true));
 }else{
  const bounds=new THREE.Box3();for(const {mesh,triangles}of sources)for(const t of triangles)if(edibleTriangle(mesh,t,definition))for(const v of t.vertices)bounds.expandByPoint(new THREE.Vector3(...v.slice(0,3)));
  const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()),axis=size.x>=size.z?0:2;
  const radial=['apple','fig'].includes(definition.id),cutMaterial=naturalizeImportedMaterial(new THREE.MeshStandardMaterial({color:definition.id==='fig'?0xc97979:definition.id==='burger'?0xd7aa72:0xffe9b5,roughness:.86}));
  const immutable=sources.filter(({mesh,triangles})=>mesh.userData.edible===false&&triangles.every(t=>!edibleTriangle(mesh,t,definition)));
  for(const {mesh,triangles}of immutable)add(triangles,mesh.material,-1,false);
  for(let piece=0;piece<FOOD_PIECES;piece++){
   const stockIndex=index=>['banana','sandwich'].includes(definition.id)?[7,5,3,1,0,2,4,6][index]:index,stockPiece=stockIndex(piece);
   let planes;
   if(radial){const a=piece*Math.PI/4,b=(piece+1)*Math.PI/4;planes=[[-Math.sin(a),0,Math.cos(a)],[Math.sin(b),0,-Math.cos(b)]].map((normal,side)=>({normal,offset:dot(normal,center.toArray()),neighbor:(piece+(side?1:7))%8}));}
   else {const min=bounds.min.getComponent(axis),width=size.getComponent(axis)/8;planes=[];if(piece>0){const normal=[0,0,0];normal[axis]=1;planes.push({normal,offset:min+piece*width,neighbor:stockIndex(piece-1)});}if(piece<7){const normal=[0,0,0];normal[axis]=-1;planes.push({normal,offset:-(min+(piece+1)*width),neighbor:stockIndex(piece+1)});}}
   for(const source of sources){if(immutable.includes(source))continue;const {mesh,triangles}=source;let clipped=triangles;for(const plane of planes)clipped=clipClosed(clipped,plane);for(const edible of [true,false])add(clipped.filter(t=>!t.cap&&edibleTriangle(mesh,t,definition)===edible),mesh.material,stockPiece,edible);for(const neighbor of new Set(clipped.filter(t=>t.cap).map(t=>t.neighbor)))add(clipped.filter(t=>t.cap&&t.neighbor===neighbor),cutMaterial,stockPiece,true,neighbor);}
  }
 }
 // Batch only within a portion and affordance; the carton stays immutable.
 const batches=new Map();for(const mesh of group.children){const key=`${mesh.userData.foodPiece??-1}:${mesh.userData.foodNeighbor??-1}:${mesh.material.uuid}:${mesh.userData.edible}`;if(!batches.has(key))batches.set(key,[]);batches.get(key).push(mesh);}
 for(const meshes of batches.values()){if(meshes.length<2)continue;const g=mergeGeometries(meshes.map(m=>m.geometry));if(!g)continue;const m=new THREE.Mesh(g,meshes[0].material);m.userData={...meshes[0].userData};m.name=meshes[0].name;m.castShadow=true;m.receiveShadow=true;group.add(m);for(const old of meshes){old.removeFromParent();old.geometry.dispose();}}
 for(const g of new Set(sources.map(s=>s.mesh.geometry)))g.dispose();return group;
}
export function updateFoodPortions(meshes,stock){for(const mesh of meshes)if(mesh.userData.foodTag)mesh.visible=mesh.userData.foodPiece<visiblePieces(mesh.userData.foodId,stock)&&(mesh.userData.foodNeighbor<0||mesh.userData.foodNeighbor>=visiblePieces(mesh.userData.foodId,stock));}
