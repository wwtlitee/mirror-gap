const node=typeof process!=='undefined'&&Boolean(process.versions?.node);
const fs=node?await import('node:fs'):null;
const cryptoNode=node?await import('node:crypto'):null;
const texts=new Map(),digests=new Map();
if(!node){
 const paths=['functional-calibration.json','motor-calibration.json','functional-connectome.json','functional-connectome.sha256','mushroom-connectome.json','../public/assets/connectome.json','../public/assets/connectome.sha256'];
 await Promise.all(paths.map(async path=>{
  const url=new URL(path,import.meta.url),r=await fetch(url);if(!r.ok)throw Error('无法加载神经资源：'+path);
  const raw=await r.text();texts.set(url.href,raw);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
  digests.set(raw,Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join(''));
 }));
}
export function readFileSync(url,encoding){
 if(node)return fs.readFileSync(url,encoding);
 const text=texts.get(String(url));if(text===undefined)throw Error('神经资源未加载：'+url);return text;
}
export function sha256(raw){return node?cryptoNode.createHash('sha256').update(raw).digest('hex'):digests.get(raw);}
export function randomSeed(){return node?cryptoNode.randomBytes(4).readUInt32LE():crypto.getRandomValues(new Uint32Array(1))[0];}
