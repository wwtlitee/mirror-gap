import fs from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';

const exists=async file=>{try{return (await fs.stat(file)).isFile();}catch(error){if(['ENOENT','ENOTDIR'].includes(error.code))return false;throw error;}};

/** Resolve locally installed tooling. This helper never installs packages or starts a browser. */
export async function resolvePlaywrightModule({moduleUrl=process.env.PLAYWRIGHT_MODULE_URL,
 resolvePackage=specifier=>import.meta.resolve(specifier),fileExists=exists,homeDirectory=homedir()}={}){
 if(moduleUrl!==undefined){
  if(typeof moduleUrl!=='string'||!moduleUrl.trim())throw Error('PLAYWRIGHT_MODULE_URL must name a local file');
  let url;
  try{url=path.isAbsolute(moduleUrl)?pathToFileURL(moduleUrl):new URL(moduleUrl);}catch{throw Error('PLAYWRIGHT_MODULE_URL must name a local file');}
  if(url.protocol!=='file:'||url.search||url.hash)throw Error('PLAYWRIGHT_MODULE_URL must name a local file');
  if(!await fileExists(fileURLToPath(url)))throw Error('PLAYWRIGHT_MODULE_URL does not point to an existing module');
  return url.href;
 }
 try{return resolvePackage('playwright');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
 const bundled=path.join(homeDirectory,'.codex','skills','develop-web-game','node_modules','playwright','index.mjs');
 if(await fileExists(bundled))return pathToFileURL(bundled).href;
 throw Error('Playwright is not installed. Run npm install --no-save --package-lock=false playwright, or set PLAYWRIGHT_MODULE_URL to its local entry module.');
}

export async function loadPlaywright(){return import(await resolvePlaywrightModule());}
