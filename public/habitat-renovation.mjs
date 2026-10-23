import { BOOKCASE } from './habitat-layout.mjs';
import {naturalMaterial} from './natural-materials.mjs';

// Shared dimensions are also consumed by collision geometry. Glass has a broad
// open front and an open roof: the resident is free to enter and leave.
export function buildHabitatRenovation({THREE,box:rawBox,cylinder,sphere,path,addMesh,leaf,material:m,groups:{entry,nook,perch,work}}){
  const box=(size,p,mat,parent)=>parent===nook?rawBox([size[2],size[1],size[0]],[-p[2]-1.53,p[1],p[0]+5.95],mat,parent):rawBox(size,p,mat,parent);
  const pages=new THREE.MeshStandardMaterial({color:0xe0d2af,roughness:.96});
  const mark=(mesh,name)=>{mesh.name=name;mesh.userData.detailRole=name;return mesh;};
  // A full-height bookcase with real side panels, shelf thickness and page blocks.
  const bc=BOOKCASE,left=bc.min[0],right=bc.max[0],back=bc.max[2],front=bc.min[2];
  box([right-left,3.30,.08],[(left+right)/2,1.69,back-.04],m.darkWood,nook);
  for(const x of [left+.055,right-.055])box([.11,3.30,back-front],[x,1.69,(back+front)/2],m.wood,nook);
  for(const y of bc.levels)box([right-left,.09,back-front],[(left+right)/2,y-.045,(back+front)/2],m.wood,nook);
  for(const y of [1.03,1.84,2.65])box([.075,.72,.8],[-4.38,y+.36,3.68],m.darkWood,nook);
  const covers=[0x526358,0x7c4e3e,0x354d60,0x9b8655].map(color=>naturalMaterial('cloth',{color,roughness:.88}));
  for(let shelf=0;shelf<4;shelf++)for(let i=0;i<9;i++){
    if(i===4||shelf===1&&i>3)continue; // An open reading/hiding bay, not a wall of books.
    const x=left+.22+i*.235,h=.38+((i*7+shelf*3)%5)*.05,y=bc.levels[shelf],z=3.79;
    const paper=mark(box([.15,h,.43],[x,y+h/2,z],pages,nook),'Book_page_block');
    paper.userData.pageDimensions=[.15,h,.43];
    for(const dx of [-.083,.083])mark(box([.017,h+.025,.46],[x+dx,y+h/2,z],covers[(i+shelf)%4],nook),'Book_hard_cover');
    // An elliptical, rounded spine connects the two cloth-covered boards.
    // Its outer extent is the old spine's extent, rather than a larger book.
    const spine=new THREE.Mesh(new THREE.CylinderGeometry(1,1,h+.025,18),covers[(i+shelf)%4]);
    spine.scale.set(.0125,1,.09);spine.position.set(-(z-.23)-1.53,y+h/2,x+5.95);
    spine.castShadow=spine.receiveShadow=true;nook.add(spine);mark(spine,'Book_rounded_spine');
    for(const dy of [.08,h-.08])mark(box([.13,.012,.004],[x,y+dy,z-.245],m.gold,nook),'Book_spine_foil_band');
    mark(box([.092,.08,.003],[x,y+h*.55,z-.246],m.darkWood,nook),'Book_recessed_title_panel');
  }
}
