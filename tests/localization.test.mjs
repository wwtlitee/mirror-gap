import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {translateText} from '../public/localization.mjs';
import {NEED_METERS} from '../public/need-display.mjs';
import {ZONES} from '../public/world-spec.mjs';
import {REGION_PURPOSES} from '../public/region-life.mjs';
const hasChinese=value=>/[\u3400-\u9fff]/u.test(value);
test('static UI, status hints and room descriptions have English translations',()=>{
 const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const texts=[...html.matchAll(/>([^<>]+)</g)].map(m=>m[1].trim()).filter(v=>hasChinese(v)&&v!=='中');
 const attrs=[...html.matchAll(/(?:aria-label|placeholder|title)="([^"]+)"/g)].map(m=>m[1]).filter(v=>v!=='Language / 语言');
 const labels=[...texts,...attrs,...Object.values(NEED_METERS).flatMap(m=>[m.label,m.hint]),...ZONES.flatMap(z=>[z.name,z.description,z.label]),...Object.values(REGION_PURPOSES)];
 for(const text of labels)assert.equal(hasChinese(translateText(text)),false,text);
});
test('dynamic values and scientific identifiers survive translation, Chinese is untouched',()=>{
 assert.equal(translateText('第110天 08:30'),'Day 110 08:30');
 assert.equal(translateText('正在吃汉堡'),'Eating Burger');
 assert.equal(translateText('DNa02 · 左'),'DNa02 · L');
 assert.equal(translateText('上厕所 · 厕所气味'),'Use the toilet · Toilet scent');
 assert.equal(translateText('果蝇之家','zh'),'果蝇之家');
 assert.equal(translateText('生活已保存，恢复快照暂未更新'),'Life saved; recovery snapshots have not updated');
});
