// Preserve every baked coordinate while keeping individual downloadable
// assets bounded. The legacy array remains readable for delivered baselines.
export async function readResourceSurfaces(url=new URL('./assets/resource-surfaces.json',import.meta.url)){
 const node=typeof process!=='undefined'&&Boolean(process.versions?.node);
 const read=async location=>{
  if(node)return JSON.parse(await (await import('node:fs/promises')).readFile(location,'utf8'));
  const response=await fetch(location);if(!response.ok)throw Error(`Resource geometry HTTP ${response.status}`);
  return response.json();
 };
 const index=await read(url);if(Array.isArray(index))return index;
 if(index?.format!=='resource-surfaces-v2'||!Array.isArray(index.files)||!index.files.length||index.files.length>32)throw Error('Invalid resource geometry manifest');
 const ids=new Set();
 return Promise.all(index.files.map(async entry=>{
  if(!/^[a-z][a-z-]*$/.test(entry.id)||entry.file!==`resource-surfaces/${entry.id}.json`||ids.has(entry.id))throw Error('Invalid resource geometry entry');
  ids.add(entry.id);const resource=await read(new URL(entry.file,url));
  if(resource?.id!==entry.id)throw Error('Resource geometry identity mismatch');
  return resource;
 }));
}
