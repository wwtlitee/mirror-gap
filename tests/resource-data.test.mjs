import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readResourceSurfaces} from '../public/resource-data.mjs';
import {FOOD_IDS} from '../public/food-stock.mjs';

test('split resource assets preserve exact stored values and remain bounded per download',async()=>{
 const base=new URL('../public/assets/resource-surfaces.json',import.meta.url),index=JSON.parse(await fs.readFile(base,'utf8'));
 assert.equal(index.format,'resource-surfaces-v2');
 const resources=await readResourceSurfaces(base);
 assert.deepEqual(resources.map(r=>r.id),[...FOOD_IDS,'water-bowl','shallow-pool']);
 for(const [i,entry]of index.files.entries()){
  const bytes=await fs.readFile(new URL(entry.file,base));
  assert.ok(bytes.length<16*1024*1024,entry.id+' per-resource download budget');
  assert.deepEqual(resources[i],JSON.parse(bytes.toString('utf8')));
  assert.ok(resources[i].faces.length>0&&resources[i].faces.length%9===0);
  assert.ok(resources[i].faces.every(Number.isFinite));
 }
});
