const url=new URL('./locale-en.json',import.meta.url);
const dictionary=typeof process!=='undefined'&&Boolean(process.versions?.node)?JSON.parse(await(await import('node:fs/promises')).readFile(url,'utf8')):await(await fetch(url)).json();
const escape=value=>Array.from(value,c=>'\\^$.*+?()[]{}|'.includes(c)?'\\'+c:c).join('');
const phrases=new RegExp(Object.keys(dictionary).sort((a,b)=>b.length-a.length).map(escape).join('|'),'gu');
export function translateText(value,language='en'){
 if(language!=='en'||typeof value!=='string')return value;
 if(Object.hasOwn(dictionary,value))return dictionary[value];
 return value.replace(/第\s*(\d+)\s*天/g,'Day $1').replace(phrases,key=>dictionary[key]);
}
export function setupLocalization(){
 let language='zh';try{language=localStorage.getItem('drosophila-language')==='en'?'en':'zh';}catch{}
 const originals=new WeakMap(),attributes=['title','aria-label','placeholder','content'];
 const excluded=node=>node.parentElement?.closest('script,style,[data-no-locale]');
 function text(node){
  if(excluded(node))return;
  const previous=originals.get(node),current=node.nodeValue;
  const source=previous&&current===previous.rendered?previous.source:current;
  const rendered=translateText(source,language);originals.set(node,{source,rendered});
  if(current!==rendered)node.nodeValue=rendered;
 }
 function element(node){
  if(node.matches('script,style,[data-no-locale]')||node.closest('[data-no-locale]'))return;
  let saved=originals.get(node);if(!saved){saved={};originals.set(node,saved);}
  for(const attr of attributes){if(!node.hasAttribute(attr))continue;const current=node.getAttribute(attr),old=saved[attr];
   const source=old&&current===old.rendered?old.source:current,rendered=translateText(source,language);
   saved[attr]={source,rendered};if(current!==rendered)node.setAttribute(attr,rendered);
  }
 }
 function walk(root){
  if(root.nodeType===Node.TEXT_NODE){text(root);return;}
  if(root.nodeType!==Node.ELEMENT_NODE)return;
  element(root);const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){const node=walker.currentNode;if(node.nodeType===Node.TEXT_NODE)text(node);else element(node);}
 }
 const options={subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:attributes};
 const observer=new MutationObserver(records=>{
  observer.disconnect();
  // Only changed nodes are translated; no full-page scans in the render loop.
  const roots=new Set();for(const record of records){if(record.type==='childList')for(const node of record.addedNodes)roots.add(node);else if(record.type==='attributes')element(record.target);else roots.add(record.target);}
  for(const node of roots)if(node.isConnected)walk(node);
  observer.observe(document.documentElement,options);
 });
 function apply(){
  observer.disconnect();document.documentElement.lang=language==='en'?'en':'zh-CN';walk(document.documentElement);
  for(const button of document.querySelectorAll('[data-language]'))button.setAttribute('aria-pressed',String(button.dataset.language===language));
  observer.observe(document.documentElement,options);
 }
 for(const button of document.querySelectorAll('[data-language]'))button.addEventListener('click',()=>{
  language=button.dataset.language==='en'?'en':'zh';try{localStorage.setItem('drosophila-language',language);}catch{}apply();
 });
 apply();return {get language(){return language;},dispose(){observer.disconnect();}};
}
