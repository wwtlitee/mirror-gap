import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {foodMaterial} from './natural-materials.mjs';

// Recipes are dimensionless until placeResourceModel normalizes the complete
// object. Edible semantics, colors and the eight-piece stock contract survive
// the exact same geometry in the renderer and the resource baker.
function recipe(geometryOnly) {
  const root = new T.Group();
  const material = geometryOnly ? new T.MeshBasicMaterial({vertexColors:true}) : foodMaterial(0xffffff,{vertexColors:true});
  const add = (geometry, color, position=[0,0,0], scale=[1,1,1], edible=true, name='Ingredient') => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    const p=g.attributes.position, colors=new Float32Array(p.count*3), tone=new T.Color(color);
    for(let i=0;i<p.count;i++) {
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i),fine=Math.sin(x*37+y*53+z*29),coarse=Math.sin(x*9.7+z*7.3)*Math.cos(y*21+z*4);
      let detail=.94+.055*fine+.035*coarse,localTone=tone;
      if(name==='Bread_crust'&&Math.abs(g.attributes.normal?.getY(i)??1)<.65)localTone=new T.Color(0xe5d2a5);
      if(/bun|Bread|Pizza_crust|Pizza_dough/i.test(name))detail*=.92+.10*Math.cos(x*6+z*8)+.04*Math.sin(x*23-z*17);
      if(/lettuce/i.test(name))detail*=.90+.12*Math.sin(x*15+z*11)+.09*Math.cos(x*24-z*13);
      if(name==='Seared_patty')detail*=.88+.14*Math.sin(x*29-z*33)*Math.cos(x*13+z*17);
      if(name==='Pizza_cheese'){
        const roast=Math.sin(x*23+z*17)+.5*Math.cos(z*37-x*11)+.35*Math.sin(x*51-z*31);
        const browned=T.MathUtils.smoothstep(roast,.55,1.5);
        localTone=tone.clone().lerp(new T.Color(0x9d5426),browned*.78);
      }
      colors.set([localTone.r*detail,localTone.g*detail,localTone.b*detail],i*3);
    }
    g.setAttribute('color',new T.BufferAttribute(colors,3));
    const mesh=new T.Mesh(g,material); mesh.name=name; mesh.position.set(...position);mesh.scale.set(...scale);
    mesh.userData={edible,resourcePart:edible?'food':'container-or-stem',ingredient:name}; root.add(mesh); return mesh;
  };
  return {root,material,add};
}

function deform(geometry,transform) {
  const p=geometry.attributes.position;
  for(let i=0;i<p.count;i++)p.setXYZ(i,...transform(p.getX(i),p.getY(i),p.getZ(i)));
  geometry.computeVertexNormals();return geometry;
}

function closedRadial(radius,{segments=64,rings=6,outline=(x,z)=>[x,z],top,bottom}) {
  const positions=[],uv=[],indices=[],surfaces=[];
  for(const upper of [true,false]){
    const height=upper?top:bottom,center=positions.length/3;
    positions.push(0,height(0,0,0),0);uv.push(.5,.5);const rows=[];
    for(let ring=1;ring<=rings;ring++){
      const row=[];for(let side=0;side<segments;side++){
        const a=side/segments*Math.PI*2,t=ring/rings,[x,z]=outline(Math.cos(a)*radius*t,Math.sin(a)*radius*t,a,t);
        row.push(positions.length/3);positions.push(x,height(t,a,x,z),z);uv.push(x/radius/2+.5,z/radius/2+.5);
      }rows.push(row);
    }
    const face=(a,b,c)=>indices.push(...(upper?[a,b,c]:[a,c,b]));
    for(let side=0;side<segments;side++){const next=(side+1)%segments;face(center,rows[0][next],rows[0][side]);}
    for(let ring=0;ring<rows.length-1;ring++)for(let side=0;side<segments;side++){
      const next=(side+1)%segments,a=rows[ring][side],b=rows[ring][next],c=rows[ring+1][side],d=rows[ring+1][next];face(a,b,c);face(b,d,c);
    }
    surfaces.push(rows.at(-1));
  }
  const wall=surfaces.map(row=>row.map(id=>{const next=positions.length/3;positions.push(...positions.slice(id*3,id*3+3));uv.push(...uv.slice(id*2,id*2+2));return next;}));
  for(let side=0;side<segments;side++){const next=(side+1)%segments,a=wall[0][side],b=wall[0][next],c=wall[1][side],d=wall[1][next];indices.push(a,b,c,b,d,c);}
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

function curvedLeaf(radius,y,phase=0) {
  const curve=(t,a)=>y+.018*(1-t*t)+.072*Math.sin(a*9+phase)*t**4+.022*Math.sin(a*21+phase*.7)*t**5+.013*Math.sin(a*4+t*10)*t*t;
  return closedRadial(radius,{segments:144,rings:8,outline:(x,z,a)=>{const edge=1+.105*Math.sin(a*9+phase)+.036*Math.sin(a*21+phase*.7);return [x*edge,z*edge];},top:(t,a)=>curve(t,a)+.004,bottom:(t,a)=>curve(t,a)-.004});
}

function roundedFoodProfile(points,segments=64) {
  const geometry=new T.LatheGeometry(points.map(([r,y])=>new T.Vector2(r,y)),segments),p=geometry.attributes.position,index=geometry.index,faces=[];
  for(let i=0;i<index.count;i+=3){const ids=[0,1,2].map(k=>index.getX(i+k)),[a,b,c]=ids.map(id=>new T.Vector3().fromBufferAttribute(p,id));if(b.sub(a).cross(c.sub(a)).lengthSq()>1e-20)faces.push(...ids);}
  geometry.setIndex(faces);geometry.computeVertexNormals();return geometry;
}

function banana(geometryOnly) {
  const {root,add}=recipe(geometryOnly),positions=[],uv=[],indices=[],rows=40,sides=20;
  for(let row=0;row<=rows;row++) {
    const t=row/rows, y=.32*Math.sin(Math.PI*t),z=(t-.5)*1.9;
    const radius=.018+.115*Math.pow(Math.sin(Math.PI*t),.45);
    for(let side=0;side<=sides;side++) {
      const a=side/sides*Math.PI*2,r=radius*(1+.085*Math.cos(a*5));
      // A real peel ridge has a small broad crown rather than a perfectly
      // round mathematical summit. Keep that crown in the shared mesh so a
      // newborn's six tarsi can remain supported while it turns to feed.
      const skinY=Math.min(.412,y+Math.sin(a)*r*.82);
      positions.push(Math.cos(a)*r,skinY,z);uv.push(side/sides,t);
      if(row<rows&&side<sides){const n=row*(sides+1)+side;indices.push(n,n+1,n+sides+1,n+1,n+sides+2,n+sides+1);}
    }
  }
  for(const row of [0,rows]) {
    const t=row/rows,c=positions.length/3;positions.push(0,.32*Math.sin(Math.PI*t),(t-.5)*1.9);uv.push(.5,t);
    for(let s=0;s<sides;s++){const a=row*(sides+1)+s,b=a+1;indices.push(...(row===0?[c,b,a]:[c,a,b]));}
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
  add(g,0xe2bd49,[0,0,0],[1,1,1],true,'Banana_ribbed_skin');
  add(new T.CylinderGeometry(.018,.023,.10,12),0x806038,[0,.025,-.99],[1,1,1],false,'Banana_stem').rotation.x=Math.PI/2;
  add(new T.SphereGeometry(.026,12,8),0x655335,[0,0,.97],[1,.75,.65],false,'Banana_flower_tip');
  root.name='Detailed_banana';return root;
}

function burger(geometryOnly) {
  const {root,add}=recipe(geometryOnly);
  add(deform(roundedFoodProfile([[0,0],[.58,0],[.66,.013],[.71,.035],[.739,.075],[.737,.13],[.709,.164],[.63,.181],[0,.181]]),(x,y,z)=>{const a=Math.atan2(z,x),edge=1+.009*Math.sin(a*7);return [x*edge,y+.0025*Math.sin(x*17+z*14),z*edge];}),0xb77832,[0,0,0], [1,1,1],true,'Bottom_bun_crust');
  add(deform(new T.CylinderGeometry(.72,.72,.045,64,2),(x,y,z)=>[x,y+.004*Math.sin(x*19)*Math.cos(z*23),z]),0xe1b36c,[0,.1975,0],[1,1,1],true,'Bread_crumb');
  add(deform(new T.CylinderGeometry(.72,.75,.17,96,6),(x,y,z)=>{const a=Math.atan2(z,x),edge=1+.027*Math.sin(a*13)+.013*Math.sin(a*27)+.006*Math.sin(y*71+a*17);return [x*edge,y+.006*Math.sin(x*31+z*19)+.004*Math.cos(x*13-z*27),z*edge];}),0x5b3021,[0,.305,0],[1,1,1],true,'Seared_patty');
  const cheeseGeometry=deform(new RoundedBoxGeometry(1.31,.04,1.30,4,.016),(x,y,z)=>{const corner=(Math.abs(x)/.655)**4*(Math.abs(z)/.65)**4;return [x,y-.064*corner+.003*Math.sin(x*8+z*6),z];});
  const cheese=add(cheeseGeometry,0xdea044,[0,.410,0],[1,1,1],true,'Cheese_slice');cheese.rotation.y=.18;
  add(curvedLeaf(.79,.454,.4),0x4e812d,[0,0,0],[1,1,1],true,'Ruffled_lettuce');
  add(deform(new T.CylinderGeometry(.66,.66,.07,64,2),(x,y,z)=>{const edge=1+.009*Math.cos(Math.atan2(z,x)*7);return [x*edge,y+.002*Math.sin(x*14-z*17),z*edge];}),0xbb4931,[0,.52,0],[1,1,1],true,'Tomato_slice');
  add(deform(new T.CylinderGeometry(.72,.74,.09,64,2),(x,y,z)=>[x,y+.003*Math.sin(x*12+z*15),z]),0xbd8039,[0,.60,0],[1,1,1],true,'Top_bun_rim');
  const dome=new T.SphereGeometry(1,64,32,0,Math.PI*2,0,Math.PI/2),cap=new T.CircleGeometry(1,64);cap.rotateX(Math.PI/2);
  const closedDome=mergeGeometries([dome,cap]);dome.dispose();cap.dispose();
  add(deform(closedDome,(x,y,z)=>[x*.73,y*.34+.004*Math.sin(x*11+z*9),z*.73]),0xc68a40,[0,.645,0],[1,1,1],true,'Domed_sesame_bun');
  for(let i=0;i<92;i++) {
    const a=i*2.399963+.1*Math.sin(i*3.7),r=.69*Math.sqrt((i+.5)/92),x=Math.cos(a)*r,z=Math.sin(a)*r,y=.645+.34*Math.sqrt(1-r*r/(.73*.73))+.004*Math.sin(x/.73*11+z/.73*9);
    const seed=add(new T.SphereGeometry(1,8,6),0xf0dca9,[x,y+.0035,z],[.009+(i%3)*.002,.004,.019+(i%4)*.002],true,'Sesame_seed');seed.rotation.y=a+.4*Math.sin(i);
  }
  root.name='Detailed_burger';return root;
}

function closedSector(radius,height,start,arc) {
  // Subdivide the interior as well as the rim. A cylinder fan has only one
  // centre vertex, so its cheese becomes eight flat boards despite deformation.
  const positions=[],uv=[],indices=[],surfaces=[],rings=14,segments=24;
  for(const upper of [true,false]){
    const centre=positions.length/3,y=(upper?1:-1)*height/2,rows=[];
    positions.push(0,y,0);uv.push(.5,.5);
    for(let ring=1;ring<=rings;ring++){
      const row=[];for(let side=0;side<=segments;side++){
        const a=start+arc*side/segments,r=radius*ring/rings,x=Math.sin(a)*r,z=Math.cos(a)*r;
        row.push(positions.length/3);positions.push(x,y,z);uv.push(x/radius/2+.5,z/radius/2+.5);
      }rows.push(row);
    }
    const face=(a,b,c)=>indices.push(...(upper?[a,b,c]:[a,c,b]));
    for(let side=0;side<segments;side++)face(centre,rows[0][side],rows[0][side+1]);
    for(let ring=0;ring<rings-1;ring++)for(let side=0;side<segments;side++){
      const a=rows[ring][side],b=rows[ring][side+1],c=rows[ring+1][side],d=rows[ring+1][side+1];face(a,c,b);face(b,c,d);
    }
    surfaces.push([centre,...rows.map(row=>row[0]),...rows.at(-1).slice(1),...rows.slice(0,-1).reverse().map(row=>row.at(-1))]);
  }
  const walls=surfaces.map(row=>row.map(id=>{const copy=positions.length/3;positions.push(...positions.slice(id*3,id*3+3));uv.push(...uv.slice(id*2,id*2+2));return copy;}));
  for(let i=0;i<walls[0].length;i++){
    const next=(i+1)%walls[0].length,a=walls[0][i],b=walls[0][next],c=walls[1][i],d=walls[1][next];indices.push(a,c,b,b,c,d);
  }
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

function closedTube(curve,segments,radius,sides,phase=0) {
  const tube=new T.TubeGeometry(curve,segments,radius,sides,false),p=tube.attributes.position;
  for(let row=0;row<=segments;row++){
    const t=row/segments,center=curve.getPointAt(t),puff=1+.11*Math.sin(t*Math.PI*3+phase)+.045*Math.cos(t*Math.PI*7+phase*.7);
    for(let side=0;side<=sides;side++){const i=row*(sides+1)+side,point=new T.Vector3().fromBufferAttribute(p,i).sub(center).multiplyScalar(puff).add(center);p.setXYZ(i,...point.toArray());}
  }tube.computeVertexNormals();
  const positions=[],normals=[],uv=[];
  for(const [row,direction]of [[0,-1],[segments,1]]) {
    const center=curve.getPointAt(row/segments),normal=curve.getTangentAt(row/segments).multiplyScalar(direction);
    for(let side=0;side<sides;side++) {
      const a=new T.Vector3().fromBufferAttribute(p,row*(sides+1)+side),b=new T.Vector3().fromBufferAttribute(p,row*(sides+1)+side+1);
      const vertices=[center,a,b];
      if(a.clone().sub(center).cross(b.clone().sub(center)).dot(normal)<0)vertices.reverse();
      for(const v of vertices){positions.push(...v.toArray());normals.push(...normal.toArray());uv.push(.5,.5);}
    }
  }
  const caps=new T.BufferGeometry();caps.setAttribute('position',new T.Float32BufferAttribute(positions,3));caps.setAttribute('normal',new T.Float32BufferAttribute(normals,3));caps.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  const open=tube.toNonIndexed(),result=mergeGeometries([open,caps]);tube.dispose();open.dispose();caps.dispose();return result;
}

function pizza(geometryOnly) {
  const {root,material,add}=recipe(geometryOnly);
  const random=seed=>{const value=Math.sin(seed*12.9898+78.233)*43758.5453;return value-Math.floor(value);};
  const surface=(x,z)=>.134+.010*Math.sin(x*17+z*11)*Math.cos(z*13-x*7)+.005*Math.sin(x*39-z*29);
  for(let slice=0;slice<8;slice++) {
    const start=slice*Math.PI/4+.003,end=(slice+1)*Math.PI/4-.003,parts=[];
    const capture=(g,color,p=[0,0,0],scale=[1,1,1],name='Pizza_ingredient')=>{const mesh=add(g,color,p,scale,true,name);mesh.updateMatrix();mesh.geometry.applyMatrix4(mesh.matrix);parts.push(mesh.geometry);mesh.removeFromParent();};
    capture(deform(closedSector(1,.11,start,end-start),(x,y,z)=>{const a=Math.atan2(x,z),contour=1+.008*Math.sin(a*13)+.004*Math.cos(a*29);return [x*contour,y+.003*Math.sin(x*19+z*14),z*contour];}),0xc89549,[0,.055,0],[1,1,1],'Pizza_dough');
    capture(deform(closedSector(.945,.010,start,end-start),(x,y,z)=>[x,y+.004*Math.sin(x*27+z*19),z]),0xa64123,[0,.111,0],[1,1,1],'Pizza_tomato_sauce');
    capture(deform(closedSector(.905,.018,start,end-start),(x,y,z)=>{const a=Math.atan2(x,z),r=Math.hypot(x,z),spread=1+.018*Math.sin(a*19)*r*r;return [x*spread,y+surface(x,z)-.009,z*spread];}),0xe4bf69,[0,0,0],[1,1,1],'Pizza_cheese');
    const edge=[];for(let k=0;k<=18;k++){const a=start+(end-start)*k/18,r=.96+.010*Math.sin(a*11)+.005*Math.cos(a*23);edge.push(new T.Vector3(Math.sin(a)*r,.112+.007*Math.sin(a*9)+.004*Math.cos(a*17),Math.cos(a)*r));}
    capture(closedTube(new T.CatmullRomCurve3(edge),18,.060,12,slice*.73),0xb97c36,[0,0,0],[1,1,1],'Pizza_crust');
    for(let k=0;k<3+(slice%3===0?1:0);k++){
      const seed=slice*17+k*7,r=.32+random(seed+2)*.44,radius=.069+random(seed+8)*.024,margin=Math.asin(radius/r)+.04,a=T.MathUtils.lerp(start+margin,end-margin,random(seed+5)),x=Math.sin(a)*r,z=Math.cos(a)*r;
      const pepperoni=closedRadial(radius,{segments:32,rings:5,outline:(px,pz,angle)=>{const edge=1+.035*Math.sin(angle*7+seed);return [px*edge,pz*edge];},top:(t,angle)=>.001+.012*t**4+.0018*t*Math.sin(angle*5+seed),bottom:t=>-.004+.006*t**4});
      const color=new T.Color(0xb85338).lerp(new T.Color(0x823c29),random(seed+11)*.26);
      capture(pepperoni,color,[x,surface(x,z)+.006,z],[1,1,1],'Pepperoni_soft_cupped_edge');
      for(let fat=0;fat<4;fat++){
        const fa=seed+fat*2.4,fr=radius*(.22+fat*.15),fx=x+Math.cos(fa)*fr,fz=z+Math.sin(fa)*fr;
        capture(new T.SphereGeometry(1,8,6),0xd0a078,[fx,surface(x,z)+.009,fz],[.004,.0018,.006],'Pepperoni_fat_fleck');
      }
    }
    for(let k=0;k<3;k++){
      const seed=slice*23+k*11,r=.29+random(seed+4)*.49,margin=.17,a=T.MathUtils.lerp(start+margin,end-margin,random(seed+9)),x=Math.sin(a)*r,z=Math.cos(a)*r;
      capture(new T.SphereGeometry(.037,12,8),0x677338,[x,surface(x,z)+.008,z],[.78+random(seed)*.4,.40,1],'Olive_piece');
      const blisterRadius=.045+random(seed+12)*.030;
      capture(new T.SphereGeometry(1,16,10),0xaf6c30,[Math.sin(a+.045)*r,surface(x,z)-.001,Math.cos(a+.045)*r],[blisterRadius,.011,blisterRadius*.74],'Cheese_toasted_blister');
    }
    const merged=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());const mesh=new T.Mesh(merged,material);mesh.name=`slice${slice+1}`;mesh.userData.edible=true;root.add(mesh);
  }
  root.name='Detailed_eight_slice_pizza';return root;
}

function fries(geometryOnly) {
  const {root,add}=recipe(geometryOnly);
  // Separate walls and a floor make a real open paper carton. Non-edible
  // geometry never receives a foodPiece tag and persists at zero stock.
  for(const x of [-.40,.40])add(new RoundedBoxGeometry(.024,.78,.51,2,.008),0xb84239,[x,.39,0],[1,1,1],false,'Carton_side');
  for(const z of [-.27,.27])add(new RoundedBoxGeometry(.82,.67,.024,2,.008),0xc45041,[0,.335,z],[1,1,1],false,'Carton_front_back');
  add(new T.BoxGeometry(.80,.024,.53),0xa7332d,[0,.012,0],[1,1,1],false,'Carton_floor');
  for(let i=0;i<12;i++) {
    const x=-.30+(i%4)*.20,z=-.17+Math.floor(i/4)*.17,h=.72+(i%3)*.10;
    const chip=add(deform(new RoundedBoxGeometry(.085,h,.085,3,.011),(px,py,pz)=>[px+.009*Math.sin(py*7+i)*py/h,py,pz+.004*Math.sin(py*9+i)]),i%3?0xdca847:0xe3b859,[x,.34+h*.5,z],[1,1,1],true,'Whole_fries');chip.rotation.z=(i%4-1.5)*.12;chip.rotation.x=(Math.floor(i/4)-1)*.055;
  }
  root.name='Detailed_fries_and_carton';return root;
}

function triangleLayer(thickness,kind='bread') {
  const n=kind==='leaf'?32:16,positions=[],uv=[],indices=[],surfaces=[];
  for(const upper of [true,false]){
    const rows=[];for(let row=0;row<=n;row++){
      const strip=[];for(let col=0;col<=n-row;col++){
        const bx=-.6+col/n*1.2,bz=.5-row/n*1.2,edge=Math.exp(-Math.min(row,col,n-row-col)/n*28);
        const leaf=kind==='leaf',x=bx+(leaf?.017*edge*Math.sin(bz*29):.002*Math.sin(bz*13)),z=bz+(leaf?.016*edge*Math.sin(bx*31):.002*Math.cos(bx*11));
        let wave=.0025*Math.sin(x*19+z*11)*Math.cos(z*23-x*7);
        if(leaf)wave=.012*Math.sin(x*23+z*7)+.015*edge*Math.sin(z*29-x*5);
        if(kind==='cheese')wave=.006*Math.sin(x*5+z*7)-.016*edge*(.5+.5*Math.sin(x*4-z*3));
        if(kind==='tomato')wave=.009*Math.sin(x*12+z*5)+.006*Math.cos(z*17-x*8);
        const shell=kind==='leaf'?.001:kind==='cheese'?.002:.008;
        strip.push(positions.length/3);positions.push(x,(upper?thickness+shell:-shell)+wave,z);uv.push(col/n,row/n);
      }rows.push(strip);
    }
    const face=(a,b,c)=>indices.push(...(upper?[a,b,c]:[a,c,b]));
    for(let row=0;row<n;row++)for(let col=0;col<n-row;col++){
      const a=rows[row][col],b=rows[row][col+1],c=rows[row+1][col];face(a,b,c);
      if(col<n-row-1)face(b,rows[row+1][col+1],c);
    }
    const boundary=[...rows[0],...rows.slice(1).map(strip=>strip.at(-1)),...rows.slice(1,-1).reverse().map(strip=>strip[0])];surfaces.push(boundary);
  }
  // Four rows on each cut face give the crumb real, shallow irregular pores.
  // The top / bottom coordinates remain shared with the closed wall boundary.
  const walls=[];for(let level=0;level<=4;level++){
    const t=level/4,row=[];for(let i=0;i<surfaces[0].length;i++){
      const a=surfaces[1][i],b=surfaces[0][i],next=surfaces[0][(i+1)%surfaces[0].length];
      const x=positions[a*3],z=positions[a*3+2],dx=positions[next*3]-positions[b*3],dz=positions[next*3+2]-positions[b*3+2],length=Math.hypot(dx,dz);
      const dent=(kind==='bread'||kind==='crumb')?-.003*(.5+.5*Math.sin(i*2.71+level*1.13))*Math.sin(Math.PI*t):0;
      row.push(positions.length/3);positions.push(x-dz/length*dent,T.MathUtils.lerp(positions[a*3+1],positions[b*3+1],t),z+dx/length*dent);uv.push(i/surfaces[0].length,t);
    }walls.push(row);
  }
  const corners=walls.map(row=>[0,n,n*2].map(i=>{const id=row[i],copy=positions.length/3;positions.push(...positions.slice(id*3,id*3+3));uv.push(...uv.slice(id*2,id*2+2));return copy;}));
  for(let level=0;level<4;level++)for(let i=0;i<walls[0].length;i++){
    const next=(i+1)%walls[0].length,corner=i%n===0?i/n:-1,a=corner<0?walls[level][i]:corners[level][corner],b=walls[level][next],c=corner<0?walls[level+1][i]:corners[level+1][corner],d=walls[level+1][next];indices.push(c,a,d,d,a,b);
  }
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

function sandwich(geometryOnly) {
  const {root,add}=recipe(geometryOnly);
  const bread=()=>{
    const shape=new T.Shape();shape.moveTo(-.54,-.5);shape.lineTo(.51,-.5);
    shape.quadraticCurveTo(.6,-.5,.54,-.44);shape.lineTo(-.54,.64);
    shape.quadraticCurveTo(-.6,.70,-.6,.61);shape.lineTo(-.6,-.44);shape.quadraticCurveTo(-.6,-.5,-.54,-.5);
    const geometry=new T.ExtrudeGeometry(shape,{depth:.108,bevelEnabled:true,bevelSize:.013,bevelThickness:.012,bevelSegments:3,curveSegments:8,steps:2});
    geometry.rotateX(-Math.PI/2);
    return deform(geometry,(x,y,z)=>[x,y+.003*Math.sin(x*13+z*9)+.002*Math.cos(z*17-x*7),z]);
  };
  for(const y of [0,.243]) {
    add(bread(),0xca9859,[0,y,0],[1,1,1],true,'Bread_crust');
  }
  add(triangleLayer(.004,'leaf'),0x4f8134,[0,.130,0],[1.025,1.7,1.025],true,'Sandwich_lettuce');
  add(triangleLayer(.011,'cheese'),0xdbad42,[0,.163,0],[.99,1,.99],true,'Sandwich_cheese');
  // Separate tomato rounds expose red skins and seed chambers along the cut
  // edge. The old triangle-shaped tomato was an opaque uniform red plank.
  for(const [index,[x,z,radius]]of [[-.31,.25,.255],[.06,.26,.255],[-.32,-.13,.255]].entries()){
    const slice=closedRadial(radius,{segments:48,rings:6,outline:(px,pz,a)=>{const r=1+.018*Math.sin(a*7+index);return [px*r,pz*r];},top:(t,a)=>.032+.003*Math.sin(a*7)*t,bottom:()=>-.035});
    add(slice,0xa92f23,[x,.206,z],[1,1,1],true,'Sandwich_tomato');
    for(let cell=0;cell<5;cell++){
      const angle=cell*Math.PI*2/5,dx=x+Math.cos(angle)*radius*.56,dz=z+Math.sin(angle)*radius*.56;
      const pulp=add(new T.SphereGeometry(1,12,8),0xcf6547,[dx,.239,dz],[radius*.20,.003,radius*.30],true,'Tomato_seed_chamber');pulp.rotation.y=-angle;
      add(new T.SphereGeometry(1,8,6),0xe2b76d,[dx,.242,dz],[.010,.0025,.005],true,'Tomato_seed');
    }
  }
  root.name='Detailed_layered_sandwich';return root;
}

export function createDetailedFoodModel(definition,{geometryOnly=false}={}) {
  const builders={banana,burger,pizza,fries,sandwich};
  return builders[definition.id]?.(geometryOnly)??null;
}

export function createDetailedFig(materials) {
  const root=new T.Group();root.name='Detailed_pear_shaped_half_fig';
  const layerMaterial=source=>{const material=source.clone();material.color.set(0xffffff);material.vertexColors=true;material.onBeforeCompile=source.onBeforeCompile;material.customProgramCacheKey=source.customProgramCacheKey;return material;};
  const rind=layerMaterial(materials.rind??materials.surface),flesh=layerMaterial(materials.surface),seed=layerMaterial(materials.seed??materials.surface);
  const add=(g,m,color,p=[0,0,0],scale=[1,1,1],name='Fig_part')=>{
    const geometry=g.index?g.toNonIndexed():g;if(geometry!==g)g.dispose();
    const position=geometry.attributes.position,colors=new Float32Array(position.count*3),tone=new T.Color(color);
    for(let i=0;i<position.count;i++){const x=position.getX(i),y=position.getY(i),z=position.getZ(i),detail=.91+.065*Math.sin(x*210+z*149)+.045*Math.cos(z*91+y*183);colors.set([tone.r*detail,tone.g*detail,tone.b*detail],i*3);}
    geometry.setAttribute('color',new T.BufferAttribute(colors,3));const mesh=new T.Mesh(geometry,m);mesh.position.set(...p);mesh.scale.set(...scale);mesh.name=name;mesh.userData={edible:true,resourcePart:'food',ingredient:name};root.add(mesh);return mesh;
  };
  const outline=(x,z,a,t)=>{
    const neck=Math.max(0,Math.sin(a));
    return [x*(1-.56*neck**1.7*t)*(1+.012*Math.cos(a*9)),z*1.04+.055*neck**8*t];
  };
  const cut=(t,a)=>.008+.020*Math.sin(a)*t;
  add(closedRadial(.17,{segments:96,rings:12,outline,top:(t,a)=>cut(t,a)-.028*(1-T.MathUtils.smoothstep(t,.96,1)),bottom:(t,a)=>cut(t,a)-.076*Math.sqrt(Math.max(.001,1-t*t))-.0015}),rind,0x493145,[0,0,0],[1,1,1],'Fig_rind_half');
  add(closedRadial(.168,{segments:96,rings:16,outline,top:(t,a)=>cut(t,a)+.0015-.018*(1-T.MathUtils.smoothstep(t,.87,.93)),bottom:(t,a)=>cut(t,a)-.020}),rind,0xdfc999,[0,0,0],[1,1,1],'Fig_pith_rim');
  const fleshHeight=(t,a)=>cut(t,a)+.002-.008*(1-t)**3+.0015*Math.sin(a*31+t*13)*Math.sin(Math.PI*t);
  add(closedRadial(.151,{segments:96,rings:14,outline,top:fleshHeight,bottom:(t,a)=>cut(t,a)-.009}),flesh,0x8e2436,[0,0,0],[1,1,1],'Fig_flesh_dome');
  for(let i=0;i<180;i++){
    const a=i*2.399963+.08*Math.sin(i*3.1),t=Math.sqrt((i+.4)/180)*.93,r=t*.151,[x,z]=outline(Math.cos(a)*r,Math.sin(a)*r,a,t),size=.0011+(i%4)*.00025;
    const grain=add(new T.SphereGeometry(1,8,6),seed,i%3===0?0xe1b879:0xc59461,[x,fleshHeight(t,a)+.00055,z],[size,.0008,size*2.1],'Fig_seed');grain.rotation.y=Math.PI/2-a;
  }
  for(let i=0;i<96;i++){
    const a=i*2.399963,t=.17+(i%11)*.064,r=t*.151,[x,z]=outline(Math.cos(a)*r,Math.sin(a)*r,a,t);
    const fibre=add(new T.SphereGeometry(1,10,6),flesh,i%3?0xb03f43:0x76202c,[x,fleshHeight(t,a)+.0002,z],[.0022,.0014,.010+(i%3)*.002],'Fig_radial_pulp');fibre.rotation.y=Math.PI/2-a;
  }
  // This fruit has no size entry in RESOURCE_DEFINITIONS. Fit its complete
  // detailed half to the former actual envelope, without moving its resource.
  root.updateMatrixWorld(true);const before=new T.Box3().setFromObject(root,true),extent=before.getSize(new T.Vector3());
  const oldSeedRadius=Math.sqrt(.5/23)*.125,oldTop=.0578*Math.sqrt(1-(oldSeedRadius/.17)**2)+.002+.0032;
  const targetMin=new T.Vector3(-.17,-.0578,-.1955),targetSize=new T.Vector3(.34,oldTop+.0578,.391),factor=targetSize.clone().divide(extent);
  const offset=targetMin.clone().sub(before.min.clone().multiply(factor));
  const fit=new T.Matrix4().set(factor.x,0,0,offset.x,0,factor.y,0,offset.y,0,0,factor.z,offset.z,0,0,0,1);
  // One position write keeps the radial axis exact. Chained Float32 transforms
  // introduce sub-EPS offsets that can reverse a sliver at a stock cut plane.
  for(const mesh of root.children){mesh.updateMatrix();mesh.geometry.applyMatrix4(fit.clone().multiply(mesh.matrix));mesh.position.set(0,0,0);mesh.rotation.set(0,0,0);mesh.scale.set(1,1,1);}
  return root;
}
