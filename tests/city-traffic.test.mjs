import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {trafficPaths} from '../public/city-traffic-paths.mjs';
const city=JSON.parse(fs.readFileSync(new URL('../public/assets/night-city.json',import.meta.url)));
test('ten minutes of traffic remain inside their lanes and clear of building boxes',()=>{
 for(let t=0;t<=600;t+=.5){const paths=trafficPaths(t);assert.equal(paths.cars.length,8);assert.equal(paths.hover.length,2);assert.equal(paths.robots.length,12);
  for(const [kind,list]of Object.entries(paths))for(const p of list){const [x,y,z]=p.position;assert.ok(p.position.every(Number.isFinite));if(kind==='robots')assert.equal(Math.abs(x),33);else assert.ok(Math.abs(x)+1.5<32);if(kind==='hover')assert.ok(y>33&&y<43);
   for(const b of city.parts){if(b.kind!=='box'||b.rx||b.ry||b.rz)continue;const overlaps=Math.abs(x-b.x)<b.w/2+(kind==='robots'?.5:1.5)&&Math.abs(z-b.z)<b.d/2+(kind==='robots'?.6:2.4)&&y+1>b.y-b.h/2&&y-.4<b.y+b.h/2;assert.ok(!overlaps,`${kind} intersects ${b.owner} at ${t}`);}
  }
  for(let i=0;i<8;i++)for(let j=i+1;j<8;j++){const a=paths.cars[i].position,b=paths.cars[j].position;assert.ok(Math.abs(a[0]-b[0])>2.5||Math.abs(a[2]-b[2])>5);}
 }
});
test('motion advances and invalid time has a stable origin',()=>{assert.notDeepEqual(trafficPaths(0),trafficPaths(3));assert.deepEqual(trafficPaths(NaN),trafficPaths(0));});
