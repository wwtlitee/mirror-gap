import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {fileURLToPath} from 'node:url';

const DIRECTORIES=['public','src','scripts','tests','workers','licenses','config'];
const FILES=['.gitignore','README.md','CHANGELOG.md','package.json','package-lock.json','server.mjs','THIRD_PARTY_NOTICES.md','wrangler.coop.jsonc'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const within=(root,target)=>{const relative=path.relative(root,target);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};

/** Export an explicit source allowlist. Runtime saves, credentials and local evidence are never enumerated. */
export async function exportEntrySource({sourceRoot=process.cwd(),out}={}){
  if(typeof out!=='string'||!out.trim())throw Error('An output directory is required');
  const root=await fs.realpath(sourceRoot),destination=path.resolve(out);
  if(within(root,destination))throw Error('Source export must be outside source');
  try{await fs.lstat(destination);throw Error('Output already exists');}catch(error){if(error.code!=='ENOENT')throw error;}
  const parent=await fs.realpath(path.dirname(destination));
  if(within(root,parent))throw Error('Source export must be outside source');
  const target=path.join(parent,path.basename(destination)),entries=[];
  async function inspect(relative){
    const full=path.join(root,relative),stat=await fs.lstat(full);
    if(stat.isSymbolicLink())throw Error('Refusing symbolic link in source: '+relative);
    if(!within(root,await fs.realpath(full)))throw Error('Source path escaped root: '+relative);
    if(stat.isDirectory()){
      for(const name of (await fs.readdir(full)).sort()){
        if(name.startsWith('.'))throw Error('Unexpected hidden source: '+path.join(relative,name));
        await inspect(path.join(relative,name));
      }
    }else if(stat.isFile())entries.push(relative);
    else throw Error('Unsupported source entry: '+relative);
  }
  for(const directory of DIRECTORIES)await inspect(directory);
  for(const file of FILES)await inspect(file);
  // Publish only this reviewed CI definition, never enumerate hidden project data.
  try{await fs.lstat(path.join(root,'.github/workflows/ci.yml'));await inspect('.github/workflows/ci.yml');}catch(error){if(error.code!=='ENOENT')throw error;}
  // An explicit project license, when present, belongs with its source.
  for(const file of ['LICENSE','LICENSE.md'])try{await fs.lstat(path.join(root,file));await inspect(file);}catch(error){if(error.code!=='ENOENT')throw error;}
  const info=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
  const version=info.productVersion??info.version;
  if(typeof version!=='string'||!/^\d+\.\d+\.\d+[a-z]?$/.test(version))throw Error('Missing product version');
  const files={};await fs.mkdir(target);
  for(const relative of entries.sort()){
    const original=path.join(root,relative),copied=path.join(target,relative),before=sha(await fs.readFile(original));
    await fs.mkdir(path.dirname(copied),{recursive:true});await fs.copyFile(original,copied,constants.COPYFILE_EXCL);
    const bytes=await fs.readFile(copied),digest=sha(bytes);
    if(before!==digest||digest!==sha(await fs.readFile(original)))throw Error('Source changed during export: '+relative);
    files[relative.split(path.sep).join('/')]={bytes:bytes.length,sha256:digest};
  }
  const manifest={format:1,product:'Mirror Gap',productVersion:version,createdAt:new Date().toISOString(),files};
  const serialized=JSON.stringify(manifest,null,2)+'\n';
  await fs.writeFile(path.join(target,'source-manifest.json'),serialized,{flag:'wx'});
  return {out:target,productVersion:version,fileCount:entries.length,bytes:Object.values(files).reduce((sum,file)=>sum+file.bytes,0),manifestSha256:sha(serialized)};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--out')throw Error('Usage: node scripts/export-entry-source.mjs --out <new directory outside source>');
  console.log(JSON.stringify(await exportEntrySource({out:args[1]})));
}
