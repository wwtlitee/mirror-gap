import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {exportEntrySource} from '../scripts/export-entry-source.mjs';

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mirror-source-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=path.join(root,'source');await fs.mkdir(source);
  const write=async(file,text)=>{const target=path.join(source,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,text);};
  for(const dir of ['public','src','scripts','tests','workers','licenses','config'])await write(`${dir}/example.mjs`,'export const value=1;\n');
  for(const file of ['README.md','CHANGELOG.md','package-lock.json','server.mjs','THIRD_PARTY_NOTICES.md','wrangler.coop.jsonc','.gitignore'])await write(file,'fixture\n');
  await write('package.json',JSON.stringify({version:'8.5.0',productVersion:'8.5.0'}));
  return {source,out:path.join(root,'export'),write,root};
}

test('exports only reviewable source and hashes the actual copied bytes',async t=>{
  const f=await fixture(t);
  for(const file of ['.env','runtime/private.json','pdoc/log/memory.md','output/auth.log','dist/app.mjs','node_modules/private/key','wrangler.jsonc','delivery-8.4.0.json'])await f.write(file,'never export');
  const receipt=await exportEntrySource({sourceRoot:f.source,out:f.out});
  assert.equal(receipt.productVersion,'8.5.0');
  const manifest=JSON.parse(await fs.readFile(path.join(f.out,'source-manifest.json'),'utf8'));
  assert.equal(Object.keys(manifest.files).length,15);
  for(const [file,entry]of Object.entries(manifest.files)){
    const bytes=await fs.readFile(path.join(f.out,file));
    assert.equal(entry.bytes,bytes.length);assert.equal(entry.sha256,createHash('sha256').update(bytes).digest('hex'));
  }
  assert.deepEqual((await fs.readdir(f.out)).sort(),['.gitignore','CHANGELOG.md','README.md','THIRD_PARTY_NOTICES.md','config','licenses','package-lock.json','package.json','public','scripts','server.mjs','source-manifest.json','src','tests','workers','wrangler.coop.jsonc'].sort());
});

test('never overwrites an existing delivery or exports into its source',async t=>{
  const f=await fixture(t);await fs.mkdir(f.out);await fs.writeFile(path.join(f.out,'keep'),'original');
  await assert.rejects(exportEntrySource({sourceRoot:f.source,out:f.out}),/already exists/);
  assert.equal(await fs.readFile(path.join(f.out,'keep'),'utf8'),'original');
  await assert.rejects(exportEntrySource({sourceRoot:f.source,out:path.join(f.source,'output','export')}),/outside source/);
});

test('rejects unexpected hidden files and symlink escape before creating output',async t=>{
  const f=await fixture(t);await f.write('public/.env','secret');
  await assert.rejects(exportEntrySource({sourceRoot:f.source,out:f.out}),/hidden source/);
  await assert.rejects(fs.stat(f.out),{code:'ENOENT'});
  await fs.rm(path.join(f.source,'public','.env'));
  await fs.mkdir(path.join(f.root,'outside'));
  await fs.symlink(path.join(f.root,'outside'),path.join(f.source,'public','linked'),'junction');
  await assert.rejects(exportEntrySource({sourceRoot:f.source,out:f.out}),/symbolic link/);
  await assert.rejects(fs.stat(f.out),{code:'ENOENT'});
});

test('includes only the explicit entry workflow from hidden metadata',async t=>{
  const f=await fixture(t);await f.write('.github/workflows/ci.yml','name: entry\n');
  await f.write('.github/private.env','must stay local');
  await exportEntrySource({sourceRoot:f.source,out:f.out});
  assert.equal(await fs.readFile(path.join(f.out,'.github/workflows/ci.yml'),'utf8'),'name: entry\n');
  await assert.rejects(fs.stat(path.join(f.out,'.github/private.env')),{code:'ENOENT'});
});
