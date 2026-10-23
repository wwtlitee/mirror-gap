import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {extractModuleSpecifiers,collectThreeAddonClosure} from '../scripts/three-addon-closure.mjs';

const root=path.resolve('virtual-three-addons');
function virtualFiles(files){
  const reads=[];
  return {reads,async readFile(filename){
    const relative=path.relative(root,filename).split(path.sep).join('/');reads.push(relative);
    if(!Object.hasOwn(files,relative))throw Object.assign(new Error(`missing ${relative}`),{code:'ENOENT'});
    return files[relative];
  }};
}

test('extracts multiline static, side-effect, dynamic literal and export-from imports in source order',()=>{
  const source=`import {A,\n B as C} from 'three/addons/loaders/A.js';
    import 'three'; export * from './star.js'; export {Q as R} from './named.js';
    await import(/* split */'./lazy.js', {with:{type:'javascript'}});
    import './side.js'; import('./lazy.js'); import(variable); import('./computed-'+name);`;
  assert.deepEqual(extractModuleSpecifiers(source),['three/addons/loaders/A.js','three','./star.js','./named.js','./lazy.js','./side.js']);
});

test('ignores comments, data strings, regex literals and property calls while retaining imports in expressions',()=>{
  const source=String.raw`// import 'false-comment';
    /* export * from 'false-block'; */
    const text="import('false-string')";
    const matcher=/import\(['"]false-regex['"]\)/gi;
    object.import('false-property'); object?.import('false-optional');
    const ratio=value / import('./division.js') / other;
    export const from='false-export-value';
    if (ready) /export.*from['"]false-control['"]/.test(text);
    import('./real.js');`;
  assert.deepEqual(extractModuleSpecifiers(source),['./division.js','./real.js']);
});

test('handles escaped literal specifiers and constant dynamic templates, not template data',()=>{
  const source="const data=`import('false-template')`; import(`./constant.js`); import('three\\u002faddons\\x2futils/A.js'); const x=`value ${await import('./expression.js')}`;";
  assert.deepEqual(extractModuleSpecifiers(source),['./constant.js','three/addons/utils/A.js','./expression.js']);
});

test('distinguishes default regex expressions from division on keyword-named properties',()=>{
  const source="export default /import('false-default')/; const value=object.return / import('./property-division.js') / other;";
  assert.deepEqual(extractModuleSpecifiers(source),['./property-division.js']);
});

test('collects only the requested import closure, handles cycles and deduplicates sorted output',async()=>{
  const files=virtualFiles({'loaders/A.js':"import 'three'; import '../utils/B.js'; export * from '../utils/B.js'",'utils/B.js':"import('../loaders/A.js'); import './C.js'",'utils/C.js':'export const value=1;','libs/unused.js':"import './never.js'"});
  const result=await collectThreeAddonClosure({addonRoot:root,entrySpecifiers:['three/addons/loaders/A.js','three/addons/loaders/A.js','three'],readFile:files.readFile});
  assert.deepEqual(result,['loaders/A.js','utils/B.js','utils/C.js']);
  assert.equal(files.reads.length,3);assert.ok(!files.reads.includes('libs/unused.js'));
});

test('accepts aliases back into the addon prefix and normalized relative paths inside its boundary',async()=>{
  const files=virtualFiles({'a.js':"export * from 'three/addons/sub/b.js'",'sub/b.js':"import '../sub/../c.js'",'c.js':'import "three";'});
  assert.deepEqual(await collectThreeAddonClosure({addonRoot:root,entrySpecifiers:['three/addons/a.js'],readFile:files.readFile}),['a.js','c.js','sub/b.js']);
});

test('missing actual dependencies fail with the referring module and dependency',async()=>{
  const files=virtualFiles({'a.js':"import './missing.js'"});
  await assert.rejects(collectThreeAddonClosure({addonRoot:root,entrySpecifiers:['three/addons/a.js'],readFile:files.readFile}),error=>error.code==='THREE_ADDON_READ_FAILED'&&/missing\.js/.test(error.message)&&/a\.js/.test(error.message));
});

test('entry and nested traversal, encoded separators and Windows paths cannot escape the root',async()=>{
  for(const entry of ['three/addons/../escape.js','three/addons//absolute.js','three/addons/%2e%2e/escape.js','three/addons/C:/escape.js','three/addons/a\\escape.js']){
    const files=virtualFiles({});
    await assert.rejects(collectThreeAddonClosure({addonRoot:root,entrySpecifiers:[entry],readFile:files.readFile}),error=>error.code==='THREE_ADDON_UNSAFE_PATH');
    assert.deepEqual(files.reads,[]);
  }
  const files=virtualFiles({'sub/a.js':"import '../../escape.js'"});
  await assert.rejects(collectThreeAddonClosure({addonRoot:root,entrySpecifiers:['three/addons/sub/a.js'],readFile:files.readFile}),error=>error.code==='THREE_ADDON_UNSAFE_PATH');
  assert.deepEqual(files.reads,['sub/a.js']);
});

test('unsupported addon bare imports and non-JavaScript resources are reported',async()=>{
  for(const dependency of ['unbundled-package','./resource.wasm','https://example.invalid/a.js']){
    const files=virtualFiles({'a.js':`import '${dependency}'`});
    await assert.rejects(collectThreeAddonClosure({addonRoot:root,entrySpecifiers:['three/addons/a.js'],readFile:files.readFile}),error=>error.code==='THREE_ADDON_UNSUPPORTED_DEPENDENCY'&&error.message.includes(dependency));
  }
});

test('new URL dependencies are explicitly reported instead of silently omitted',async()=>{
  for(const source of ["const resource=new URL('./worker.wasm',import.meta.url);","const resource=new URL(workerName,import.meta.url);"]){
    const files=virtualFiles({'a.js':source});
    await assert.rejects(collectThreeAddonClosure({addonRoot:root,entrySpecifiers:['three/addons/a.js'],readFile:files.readFile}),error=>error.code==='THREE_ADDON_RESOURCE_DEPENDENCY'&&error.dependencies.length===1&&error.dependencies[0].module==='a.js');
  }
  const files=virtualFiles({'a.js':'const example="new URL(\'false.wasm\',import.meta.url)";'});
  assert.deepEqual(await collectThreeAddonClosure({addonRoot:root,entrySpecifiers:['three/addons/a.js'],readFile:files.readFile}),['a.js']);
});

test('validates caller values and does not modify entry arrays',async()=>{
  assert.throws(()=>extractModuleSpecifiers(null),TypeError);
  await assert.rejects(collectThreeAddonClosure({addonRoot:root,entrySpecifiers:'not-an-array'}),TypeError);
  const entries=Object.freeze(['three/addons/a.js']),files=virtualFiles({'a.js':'export {}'});
  assert.deepEqual(await collectThreeAddonClosure({addonRoot:root,entrySpecifiers:entries,readFile:files.readFile}),['a.js']);
});

test('default filesystem I/O reads a real closure and rejects symlink escape',async()=>{
  const fixture=await fs.mkdtemp(path.join(os.tmpdir(),'three-addon-closure-'));
  try{
    const addonRoot=path.join(fixture,'addons'),outside=path.join(fixture,'outside');
    await fs.mkdir(addonRoot);await fs.mkdir(outside);
    await fs.writeFile(path.join(addonRoot,'a.js'),"import './b.js'",'utf8');await fs.writeFile(path.join(addonRoot,'b.js'),'export {};','utf8');
    assert.deepEqual(await collectThreeAddonClosure({addonRoot,entrySpecifiers:['three/addons/a.js']}),['a.js','b.js']);
    await fs.writeFile(path.join(outside,'secret.js'),'export {};','utf8');
    await fs.symlink(outside,path.join(addonRoot,'link'),process.platform==='win32'?'junction':'dir');
    await fs.writeFile(path.join(addonRoot,'a.js'),"import './link/secret.js'",'utf8');
    await assert.rejects(collectThreeAddonClosure({addonRoot,entrySpecifiers:['three/addons/a.js']}),error=>error.code==='THREE_ADDON_UNSAFE_PATH');
  }finally{
    assert.equal(path.dirname(path.resolve(fixture)),path.resolve(os.tmpdir()));assert.ok(path.basename(fixture).startsWith('three-addon-closure-'));
    await fs.rm(fixture,{recursive:true,force:true});
  }
});

test('actual used addons retain loader, exporter, controls and postprocessing relative dependencies',async()=>{
  const entries=['loaders/GLTFLoader.js','exporters/GLTFExporter.js','controls/OrbitControls.js','environments/RoomEnvironment.js','postprocessing/EffectComposer.js','postprocessing/RenderPass.js','postprocessing/ShaderPass.js','postprocessing/OutputPass.js','objects/Reflector.js','geometries/RoundedBoxGeometry.js','utils/BufferGeometryUtils.js'];
  const result=await collectThreeAddonClosure({addonRoot:path.resolve('node_modules/three/examples/jsm'),entrySpecifiers:entries.map(name=>'three/addons/'+name)});
  for(const name of [...entries,'utils/SkeletonUtils.js','postprocessing/Pass.js','shaders/CopyShader.js'])assert.ok(result.includes(name),name);
  assert.equal(result.some(name=>name.startsWith('libs/')),false);
  assert.deepEqual(result,[...new Set(result)].sort());
});
