import path from 'node:path';
import {readFile as filesystemReadFile,realpath} from 'node:fs/promises';

const ADDON_PREFIX='three/addons/';
const identifierStart=/[\p{ID_Start}$_]/u,identifierPart=/[\p{ID_Continue}$_]/u;
const expressionKeywords=new Set(['return','throw','case','default','delete','void','typeof','instanceof','in','of','yield','await','else','do']);
const controlKeywords=new Set(['if','while','for','switch','catch','with']);
const operators=['===','!==','>>>','**=','&&=','||=','??=','...','=>','==','!=','<=','>=','++','--','&&','||','??','?.','+=','-=','*=','/=','%=','**','<<','>>'];

// A small lexical reader: data strings/comments/regex are never parsed as code.
// Template expressions recurse into code, but their raw GLSL/text stays opaque.
function tokenize(source){
  if(typeof source!=='string')throw new TypeError('Module source must be a string');
  const tokens=[],parens=[];
  let index=0,expressionMayStart=true;
  function fail(message){throw new SyntaxError(`${message} at offset ${index}`);}
  function emit(kind,value,start){
    const previous=tokens.at(-1);
    tokens.push({kind,value,start});
    if(value==='('){parens.push(controlKeywords.has(previous?.value));expressionMayStart=true;}
    else if(value===')')expressionMayStart=parens.pop()??false;
    else if(kind==='identifier')expressionMayStart=previous?.value!=='.'&&previous?.value!=='?.'&&expressionKeywords.has(value);
    else if(kind==='string'||kind==='number'||kind==='regex'||value===']'||value==='++'||value==='--')expressionMayStart=false;
    else expressionMayStart=value!=='.'&&value!=='?.';
  }
  function escape(){
    if(index>=source.length)fail('Unterminated escape');
    const value=source[index++];
    if(value==='\n')return '';
    if(value==='\r'){if(source[index]==='\n')index++;return '';}
    const simple={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0'};
    if(Object.hasOwn(simple,value)){
      if(value==='0'&&/[0-9]/.test(source[index]??''))fail('Legacy octal escape is invalid in ESM');
      return simple[value];
    }
    if(value==='x'||value==='u'){
      if(value==='u'&&source[index]==='{'){
        const end=source.indexOf('}',++index),hex=source.slice(index,end);
        if(end<0||!hex||!/^[\da-f]+$/i.test(hex)||Number.parseInt(hex,16)>0x10ffff)fail('Invalid Unicode escape');
        index=end+1;return String.fromCodePoint(Number.parseInt(hex,16));
      }
      const count=value==='x'?2:4,hex=source.slice(index,index+count);
      if(hex.length!==count||!/^[\da-f]+$/i.test(hex))fail('Invalid string escape');
      index+=count;return String.fromCharCode(Number.parseInt(hex,16));
    }
    if(/[1-9]/.test(value))fail('Legacy numeric escape is invalid in ESM');
    return value;
  }
  function string(){
    const start=index,quote=source[index++];let value='';
    while(index<source.length){
      const character=source[index++];
      if(character===quote){emit('string',value,start);return;}
      if(character==='\\')value+=escape();
      else if(character==='\r'||character==='\n')fail('Unterminated module string');
      else value+=character;
    }
    fail('Unterminated module string');
  }
  function regex(){
    const start=index++;let inClass=false;
    while(index<source.length){
      const character=source[index++];
      if(character==='\\'){index++;continue;}
      if(character==='\n'||character==='\r')fail('Unterminated regular expression');
      if(character==='[')inClass=true;
      else if(character===']')inClass=false;
      else if(character==='/'&&!inClass){
        while(index<source.length&&identifierPart.test(source[index]))index++;
        emit('regex','',start);return;
      }
    }
    fail('Unterminated regular expression');
  }
  function template(){
    const start=index++,marker=tokens.length;let value='',hasExpression=false;
    emit('punct','template-start',start);
    while(index<source.length){
      const character=source[index++];
      if(character==='`'){
        if(!hasExpression)tokens[marker]={kind:'string',value,start};
        else emit('punct','template-end',index-1);
        expressionMayStart=false;return;
      }
      if(character==='\\')value+=escape();
      else if(character==='$'&&source[index]==='{'){
        hasExpression=true;index++;emit('punct','${',index-2);code(true);emit('punct','}',index-1);
      }else value+=character;
    }
    fail('Unterminated template');
  }
  function code(stopAtBrace=false){
    let braces=0;
    while(index<source.length){
      const character=source[index],next=source[index+1];
      if(/\s/.test(character)){index++;continue;}
      if(character==='/'&&next==='/'){index+=2;while(index<source.length&&!/[\n\r]/.test(source[index]))index++;continue;}
      if(character==='/'&&next==='*'){
        const end=source.indexOf('*/',index+2);if(end<0)fail('Unterminated comment');index=end+2;continue;
      }
      if(character==='"'||character==="'"){string();continue;}
      if(character==='`'){template();continue;}
      if(character==='/'&&expressionMayStart){regex();continue;}
      const start=index;
      if(identifierStart.test(character)){
        index++;while(index<source.length&&identifierPart.test(source[index]))index++;
        emit('identifier',source.slice(start,index),start);continue;
      }
      if(/[0-9]/.test(character)){
        index++;while(index<source.length&&/[\w.]/.test(source[index]))index++;
        emit('number',source.slice(start,index),start);continue;
      }
      if(character==='}'&&stopAtBrace&&braces===0){index++;return;}
      if(character==='{')braces++;
      else if(character==='}')braces--;
      const operator=operators.find(value=>source.startsWith(value,index));
      index+=operator?.length??1;emit('punct',operator??character,start);
    }
    if(stopAtBrace)fail('Unterminated template expression');
  }
  code();return tokens;
}

function moduleSpecifiers(tokens){
  const found=new Set();
  for(let index=0;index<tokens.length;index++){
    const token=tokens[index],previous=tokens[index-1]?.value,next=tokens[index+1];
    if(token.kind!=='identifier'||previous==='.'||previous==='?.')continue;
    if(token.value==='import'){
      if(next?.kind==='string'){found.add(next.value);continue;}
      if(next?.value==='('){
        const literal=tokens[index+2],end=tokens[index+3]?.value;
        if(literal?.kind==='string'&&(end===')'||end===','))found.add(literal.value);
        continue;
      }
      if(next?.value==='.')continue;
    }else if(token.value!=='export'||!['{','*'].includes(next?.value))continue;
    let braces=0;
    for(let cursor=index+1;cursor<tokens.length;cursor++){
      const current=tokens[cursor];
      if(current.value===';')break;
      if(current.value==='{')braces++;
      else if(current.value==='}')braces--;
      if(braces===0&&current.value==='from'&&tokens[cursor+1]?.kind==='string'){
        found.add(tokens[cursor+1].value);break;
      }
      if(cursor>index+1&&braces===0&&['import','export'].includes(current.value))break;
    }
  }
  return [...found];
}

export function extractModuleSpecifiers(source){return moduleSpecifiers(tokenize(source));}

function failure(code,message,details={}){return Object.assign(new Error(message),{code,...details});}
function inside(root,filename){
  const relative=path.relative(root,filename);
  return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);
}
function resolveDependency(specifier,referrer){
  if(specifier==='three')return null;
  let target;
  if(specifier.startsWith(ADDON_PREFIX))target=specifier.slice(ADDON_PREFIX.length);
  else if(specifier.startsWith('./')||specifier.startsWith('../'))target=path.posix.join(path.posix.dirname(referrer),specifier);
  else throw failure('THREE_ADDON_UNSUPPORTED_DEPENDENCY',`Unsupported addon dependency ${JSON.stringify(specifier)} in ${referrer}`);
  if(!target||/[\\%?#\x00-\x1f:]/.test(specifier)||path.posix.isAbsolute(target)||path.win32.isAbsolute(target)){
    throw failure('THREE_ADDON_UNSAFE_PATH',`Unsafe addon path ${JSON.stringify(specifier)} in ${referrer}`);
  }
  const relative=path.posix.normalize(target);
  if(relative==='..'||relative.startsWith('../'))throw failure('THREE_ADDON_UNSAFE_PATH',`Addon dependency escapes root: ${specifier} in ${referrer}`);
  if(path.posix.extname(relative)!=='.js')throw failure('THREE_ADDON_UNSUPPORTED_DEPENDENCY',`Non-JavaScript addon dependency ${JSON.stringify(specifier)} in ${referrer}`);
  return relative;
}

/** Read only reachable addon JS. The caller owns copying and cleanup.
 * Injected readers receive absolute logical paths and 'utf8'; their physical
 * storage is caller-controlled. Native I/O additionally checks realpath fences.
 */
export async function collectThreeAddonClosure({addonRoot,entrySpecifiers,readFile=filesystemReadFile}={}){
  if(typeof addonRoot!=='string'||!addonRoot)throw new TypeError('addonRoot must be a nonempty path');
  if(!Array.isArray(entrySpecifiers)||!Array.from(entrySpecifiers).every(value=>typeof value==='string'))throw new TypeError('entrySpecifiers must be an array of strings');
  if(typeof readFile!=='function')throw new TypeError('readFile must be a function');
  const root=path.resolve(addonRoot),nativeReader=readFile===filesystemReadFile,visited=new Set();
  let physicalRoot;
  if(nativeReader){
    try{physicalRoot=await realpath(root);}
    catch(cause){throw failure('THREE_ADDON_READ_FAILED',`Cannot read addon root ${root}`,{cause});}
  }
  async function visit(relative,referrer,specifier){
    if(visited.has(relative))return;
    const filename=path.resolve(root,...relative.split('/'));
    if(!inside(root,filename))throw failure('THREE_ADDON_UNSAFE_PATH',`Addon dependency escapes root: ${specifier} in ${referrer}`);
    visited.add(relative);
    let source;
    try{
      if(nativeReader){
        const physicalFile=await realpath(filename);
        if(!inside(physicalRoot,physicalFile))throw failure('THREE_ADDON_UNSAFE_PATH',`Addon symlink escapes root: ${relative}`);
      }
      source=await readFile(filename,'utf8');
      if(typeof source!=='string')throw new TypeError('readFile must return UTF-8 text');
    }catch(cause){
      if(cause.code==='THREE_ADDON_UNSAFE_PATH')throw cause;
      throw failure('THREE_ADDON_READ_FAILED',`Cannot read addon dependency ${specifier} from ${referrer} (${relative})`,{cause});
    }
    let tokens;
    try{tokens=tokenize(source);}
    catch(cause){throw failure('THREE_ADDON_PARSE_FAILED',`Cannot scan addon module ${relative}: ${cause.message}`,{cause});}
    const dependencies=[];
    for(let index=0;index<tokens.length;index++){
      if(tokens[index].value==='new'&&tokens[index+1]?.value==='URL'&&tokens[index+2]?.value==='('){
        const argument=tokens[index+3];
        dependencies.push({module:relative,specifier:argument?.kind==='string'?argument.value:'<computed>',line:source.slice(0,tokens[index].start).split(/\r\n|[\r\n]/).length});
      }
    }
    if(dependencies.length)throw failure('THREE_ADDON_RESOURCE_DEPENDENCY',`Non-import new URL dependencies require explicit handling in ${relative}`,{dependencies});
    for(const dependency of moduleSpecifiers(tokens)){
      const resolved=resolveDependency(dependency,relative);
      if(resolved!==null)await visit(resolved,relative,dependency);
    }
  }
  for(const entry of entrySpecifiers){
    if(entry==='three'||!entry.startsWith(ADDON_PREFIX))continue;
    const relative=resolveDependency(entry,'<entry>');
    await visit(relative,'<entry>',entry);
  }
  return [...visited].sort();
}
