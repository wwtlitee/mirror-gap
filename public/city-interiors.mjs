// Recessed rooms on the two nearby towers. All boxes join the shared material batches.
export function addStreetInteriors(data,add){
 let rooms=0;
 let owner;
 const box=(material,x,y,z,w,h,d,detailRole='room-construction')=>add({kind:'box',material,x,y,z,w,h,d,owner,detailRole});
 for(const building of data.buildings.filter(b=>b.id.startsWith('avenue-'))){
  owner=building.id;
  const residential=building.use==='residential',height=residential?188:144;
  for(let floor=0;floor<Math.floor((height-16)/5);floor++)for(const side of [-1,1]){
   const y=15+floor*5,z=building.z+side*21,lit=((floor*13+(side+1)*7)%11)>(residential?3:4);
   const wall=lit?(residential?'roomWarm':'roomOffice'):'roomDark';
   box(wall,44.7,y+2,z,.18,4,7.4);
   box('roomFloor',43.4,y,z,2.8,.18,7.5);box(wall,43.4,y+4.1,z,2.8,.16,7.5);
   for(const edge of [-1,1])box('metal',43.4,y+2,z+edge*3.75,2.8,4.1,.16);
   box('metal',41.98,y+2,z,.12,4.1,.10);
   box('roomGlazing',41.94,y+2,z,.025,3.92,7.38);
   if(residential){
    box('roomFurniture',44.02,y+.62,z,.9,.65,3.4);box('roomFurniture',44.5,y+1,z,.32,1.0,3.4);
    for(const dz of [-1.1,0,1.1]){
     box('roomCurtain',43.97,y+.945,z+dz,.70,.105,1.04,'sofa-seat-cushion');
     box('roomCurtain',44.31,y+1.1,z+dz,.13,.63,1.04,'sofa-back-cushion');
    }
    for(const dz of [-1.6,1.6])box('roomFurniture',44.02,y+.90,z+dz,.90,.28,.15,'sofa-armrest');
    for(const dz of [-1.3,1.3])box('metal',44.15,y+.24,z+dz,.14,.12,.14,'sofa-foot');
    box('roomFloor',42.6,y+.45,z,.7,.13,1.9);
    for(const dz of [-.7,.7])box('metal',42.6,y+.21,z+dz,.065,.34,.065,'coffee-table-leg');
    add({kind:'curtain',material:'roomCurtain',x:42.05,y:y+2,z:z+2.7,w:.13,h:3.9,d:1.6,owner,detailRole:'curtain-folds'});
    box('metal',42.10,y+4.02,z+2.7,.08,.08,1.68,'curtain-rail');
    if(lit){box('roomLamp',43.8,y+1.9,z-2.65,.45,.45,.52);box('metal',43.8,y+1.54,z-2.65,.06,.28,.06,'table-lamp-stem');box('roomFloor',43.8,y+1.37,z-2.65,.36,.05,.36,'table-lamp-base');}
   }else{
    for(const offset of [-1.9,1.9]){
     box('roomFloor',43.5,y+1.1,z+offset,1.3,.14,2.4);
     for(const dx of [-.48,.48])for(const dz of [-.95,.95])box('metal',43.5+dx,y+.53,z+offset+dz,.07,1.02,.07,'office-desk-leg');
     box('roomFurniture',43.1,y+.73,z+offset,.6,.16,.8,'office-chair-seat');
     box('roomFurniture',43.34,y+.94,z+offset,.12,.34,.8,'office-chair-back');
     box('metal',43.1,y+.42,z+offset,.10,.50,.10,'office-chair-support');
     box('metal',43.1,y+.19,z+offset,.56,.06,.62,'office-chair-base');
     box(lit?'roomScreen':'roomDark',44.0,y+1.55,z+offset,.10,.68,.9);
     box('metal',44.01,y+1.25,z+offset,.055,.19,.09,'monitor-neck');
     box('roomFurniture',43.89,y+1.19,z+offset,.40,.045,.38,'monitor-foot');
     box('roomFurniture',43.31,y+1.19,z+offset,.42,.04,1.02,'office-keyboard');
     for(const dz of [-.37,-.18,0,.18,.37])box('pale',43.31,y+1.215,z+offset+dz,.37,.013,.025,'keyboard-key-row');
    }
    if(lit)box('roomLamp',43.5,y+3.96,z,.16,.04,4.6);
   }
   rooms++;
  }
 }
 return rooms;
}
