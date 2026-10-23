// Real metre coordinates and the existing apartment viewpoint are retained.
export const NATURAL_STREET_VIEW = Object.freeze({scale:.1,groundY:-1.8,sourceWindow:[-40,50,-65]});
export function createNaturalStreetLayout() {
 const parts=[],buildings=[],trees=[];
 const box=(material,x,y,z,w,h,d,extra={})=>parts.push({kind:'box',material,x,y,z,w,h,d,...extra});
 box('stone',0,-.3,-40,360,1,720);box('asphalt',0,1.15,-40,64,.08,680);
 for(const side of [-1,1]){box('concrete',side*34.1,1.25,-40,4.2,.14,680);box('pale',side*32.1,1.34,-40,.22,.08,680);box('paint',side*30.5,1.21,-40,.15,.025,680);}
 for(let z=-376;z<300;z+=10){box('paint',0,1.21,z,.22,.025,4);for(const x of [-10,10])box('paint',x,1.21,z,.15,.025,3);}
 box('asphalt',75,1.17,-180,150,.08,20);for(let z=-187;z<=-173;z+=2)box('paint',15,1.225,z,8,.02,.8);
 const footprints=[
  ['Avenue_office',64,-108,34,44,76,'facade0',false],['Avenue_apartments',64,4,34,44,84,'facade1',false],
  ['Brick_civic_house',86,-245,26,36,43,'facade3',true],['Garden_shops',81,-50,27,35,38,'facade1',true],
  ['Terrace_apartments',165,86,39,47,67,'facade3',false],['Neighbourhood_office',129,-190,36,44,52,'facade0',false],
  ['Distant_apartments',125,-310,30,36,71,'facade1',false],['Distant_roof_house',119,190,29,38,60,'facade3',true],
 ];
 for(const [id,x,z,w,d,h,material,pitched]of footprints){
  const front=x-w/2;buildings.push({id,x,z,w,d,h,front,pitched});box(material,x,1.2+h/2,z,w,h,d,{owner:id});box('stone',x,2,z,w+.35,1.6,d+.35,{owner:id});
  if(pitched)parts.push({kind:'roof',material:'roofTile',x,y:1.2+h+3,z,w:w+1.4,h:6,d:d+1.4,owner:id});
  else{box('roof',x,1.2+h+.24,z,w+.5,.48,d+.5,{owner:id});for(const side of [-1,1]){box('concrete',x+side*(w/2-.22),1.2+h+.85,z,.44,1.25,d,{owner:id});box('concrete',x,1.2+h+.85,z+side*(d/2-.22),w,1.25,.44,{owner:id});}box('roof',x+w*.17,1.2+h+1.5,z-d*.16,4,2.5,6,{owner:id});}
  const floors=Math.floor((h-6)/3.5),bays=Math.max(3,Math.floor((d-4)/5.3));
  for(let floor=0;floor<floors;floor++)for(let bay=0;bay<bays;bay++){
   const y=5.8+floor*3.5,pz=z-d/2+3.6+bay*(d-7.2)/Math.max(1,bays-1),lit=(floor*7+bay*3+id.length)%5<2;
   box('windowFrame',front-.08,y,pz,.22,2.65,3.30,{owner:id});box(lit?'windowWarm':'windowDark',front-.22,y,pz,.07,2.22,2.81,{owner:id});box('windowFrame',front-.29,y,pz,.06,2.22,.07,{owner:id});box('pale',front-.24,y-1.33,pz,.56,.14,3.56,{owner:id});
  }
  box('windowFrame',front-.12,3.6,z,.24,4.8,3.3,{owner:id});box('windowDark',front-.28,3.6,z,.08,4.4,2.8,{owner:id});box('roof',front-.8,6.1,z,2,.22,4.5,{owner:id});box('concrete',front-1.2,1.4,z,2.5,.35,4.8,{owner:id});
 }
 for(let i=0;i<15;i++){
  const z=-340+i*43,x=i%2?34.5:-34.5;trees.push({x,z,height:5+(i%3)*.55,radius:1.7+(i%4)*.16});box('soil',x,1.38,z,2.6,.15,2.6);
  for(const side of [-1,1]){box('pale',x+side*1.4,1.45,z,.15,.25,2.8);box('pale',x,1.45,z+side*1.4,2.8,.25,.15);}
  parts.push({kind:'cylinder',material:'metal',x:x+(x>0?1:-1),y:4.3,z:z+8,w:.13,h:6,d:.13});box('metal',x+(x>0?.45:-.45),7.2,z+8,1.3,.13,.18);box('lamp',x,7.1,z+8,.7,.09,.35);
 }
 return {parts,buildings,trees,road:{from:-380,to:300,width:64},view:NATURAL_STREET_VIEW};
}
