import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const remote=process.env.RELEASE_VERIFY_URL;
const output=process.env.RELEASE_VERIFY_OUTPUT??'output/natural-home-v8.1.0/local-assets.json';
const manifest=JSON.parse(await fs.readFile('dist/release-manifest.json','utf8'));
const packageInfo=JSON.parse(await fs.readFile('package.json','utf8'));
const version=packageInfo.productVersion??packageInfo.version;
const report={version,builtAt:manifest.builtAt,remote:remote??null,checks:[],resources:[],collisionSources:0};
let browser=null,browserPage=null;
function check(name,value){assert.ok(value,name);report.checks.push(name);}
async function getRemote(file){
  const url=new URL(file,remote);url.searchParams.set('build',manifest.builtAt);
  const response=await fetch(url,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200,`HTTP ${file}`);return Buffer.from(await response.arrayBuffer());
}
async function getRemoteInfo(file){
  if(!browserPage){const bytes=await getRemote(file);return {bytes:bytes.length,sha256:sha(bytes)};}
  return browserPage.evaluate(async({file,build})=>{
    const url=new URL(file,location.origin);url.searchParams.set('build',build);
    const response=await fetch(url,{cache:'no-store'});if(response.status!==200)throw Error(`HTTP ${response.status} ${file}`);
    const bytes=await response.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes);
    return {bytes:bytes.byteLength,sha256:Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')};
  },{file,build:manifest.builtAt});
}
try{
  if(remote&&process.env.RELEASE_VERIFY_BROWSER==='1'){
    const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'file:///C:/Users/39215/.codex/skills/develop-web-game/node_modules/playwright/index.mjs');
    browser=await chromium.launch({headless:true});browserPage=await browser.newPage();
    await browserPage.goto(new URL('release-manifest.json',remote).href);report.transport='isolated browser fetch and Web Crypto';
  }
  check('manifest matches product version',manifest.version===version);
  check('strict SemVer maps the full product revision',packageInfo.version===version.replace(/([a-z])$/,'-$1'));
  check('package lock matches package SemVer',JSON.parse(await fs.readFile('package-lock.json','utf8')).packages[''].version===packageInfo.version);
  if(remote){const live=browserPage?await browserPage.evaluate(async()=>await(await fetch('/release-manifest.json',{cache:'no-store'})).json()):JSON.parse(await getRemote('release-manifest.json'));check('remote release is the verified build',live.version===version&&live.builtAt===manifest.builtAt&&JSON.stringify(live.resources)===JSON.stringify(manifest.resources));}
  const entries=Object.entries(manifest.resources);
  // Keep the verification traffic bounded; compare bytes independently from
  // the server's manifest, including the binary contact geometry.
  for(let offset=0;offset<entries.length;offset+=4){
    const batch=await Promise.all(entries.slice(offset,offset+4).map(async([file,expected])=>{
      const local=remote?null:await fs.readFile(path.join('dist',file));
      const actual=remote?await getRemoteInfo(file):{bytes:local.length,sha256:sha(local)};
      assert.equal(actual.bytes,expected.bytes,`size ${file}`);assert.equal(actual.sha256,expected.sha256,`SHA256 ${file}`);
      return {file,...actual,matched:true};
    }));report.resources.push(...batch);
  }
  const geometry=JSON.parse(await fs.readFile('public/assets/room-collision.json','utf8'));
  check('collision package matches product version',geometry.version===version);
  for(const [file,expected]of Object.entries(geometry.sources)){assert.equal(sha(await fs.readFile(path.join('public',file))),expected,`collision source ${file}`);report.collisionSources++;}
  check('collision binary has the expected float32 face length',(await fs.stat('public/assets/room-collision.bin')).size===geometry.triangles*10*4);
  check('dist collision binary matches baked public source',sha(await fs.readFile('public/assets/room-collision.bin'))===sha(await fs.readFile('dist/assets/room-collision.bin')));
  report.passed=true;
}catch(error){report.passed=false;report.failure=error.stack;process.exitCode=1;}finally{await browser?.close();}
await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:report.passed,version,builtAt:report.builtAt,resources:report.resources.length,collisionSources:report.collisionSources,failure:report.failure??null,output}));
