import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {resolvePlaywrightModule} from '../scripts/playwright-module.mjs';
const missing=()=>{throw Object.assign(Error('missing'),{code:'ERR_MODULE_NOT_FOUND'});};

test('explicit local module is honored without trying other providers',async()=>{
 const explicit=pathToFileURL(path.resolve('example/index.mjs')).href;
 assert.equal(await resolvePlaywrightModule({moduleUrl:explicit,fileExists:async()=>true,resolvePackage:()=>assert.fail('fallback')}),explicit);
 await assert.rejects(resolvePlaywrightModule({moduleUrl:'https://example.com/code.mjs',fileExists:()=>assert.fail('network')}),/local file/);
 await assert.rejects(resolvePlaywrightModule({moduleUrl:explicit,fileExists:async()=>false,resolvePackage:()=>assert.fail('fallback')}),/PLAYWRIGHT_MODULE_URL/);
});
test('the project package is preferred to developer bundled tools',async()=>{
 assert.equal(await resolvePlaywrightModule({moduleUrl:undefined,resolvePackage:()=> 'file:///project/playwright/index.mjs',fileExists:()=>assert.fail('fallback')}),'file:///project/playwright/index.mjs');
});
test('an existing developer bundle is located from the current home directory',async()=>{
 const home=path.resolve('test-home'),expected=path.join(home,'.codex','skills','develop-web-game','node_modules','playwright','index.mjs');
 assert.equal(await resolvePlaywrightModule({moduleUrl:undefined,homeDirectory:home,resolvePackage:missing,fileExists:async file=>file===expected}),pathToFileURL(expected).href);
});
test('missing modules give install instructions without downloading or hiding broken package metadata',async()=>{
 await assert.rejects(resolvePlaywrightModule({moduleUrl:undefined,resolvePackage:missing,fileExists:async()=>false}),/npm install.*playwright/);
 await assert.rejects(resolvePlaywrightModule({moduleUrl:undefined,resolvePackage:()=>{throw Error('broken metadata');},fileExists:()=>assert.fail('fallback')}),/broken metadata/);
});
