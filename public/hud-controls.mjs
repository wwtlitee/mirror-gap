export function setupHud(){
 const panels=[['neural-drawer','neural-drawer-toggle','neural-drawer-close'],['habitat-tools','habitat-tools-toggle','habitat-tools-close']];
 const set=(id,open)=>{const [name,toggle,close]=panels.find(p=>p[0]===id),panel=document.getElementById(name),trigger=document.getElementById(toggle);if(open)for(const [other,otherToggle]of panels){if(other===id)continue;document.getElementById(other).hidden=true;document.getElementById(other).inert=true;document.getElementById(otherToggle).setAttribute('aria-expanded','false');}panel.hidden=!open;panel.inert=!open;trigger.setAttribute('aria-expanded',String(open));if(open)document.getElementById(close).focus();else trigger.focus();};
 for(const [id,toggle,close]of panels){document.getElementById(toggle).addEventListener('click',()=>set(id,document.getElementById(id).hidden));document.getElementById(close).addEventListener('click',()=>set(id,false));}
 document.addEventListener('keydown',e=>{if(e.key!=='Escape'||document.querySelector('dialog[open]'))return;for(const [id]of panels)if(!document.getElementById(id).hidden){set(id,false);e.preventDefault();break;}});
 for(const [selector,content]of [['.hud-status','#needs'],['.hud-brain','.brain-viewport']]){
  const panel=document.querySelector(selector),heading=panel.querySelector('.section-heading'),button=document.createElement('button');button.className='hud-collapse';button.type='button';button.setAttribute('aria-label',selector==='.hud-status'?'展开或收起身体状态':'展开或收起脑图');
  const target=panel.querySelector(content);target.id ||= 'hud-brain-content';button.setAttribute('aria-controls',target.id);
  const setCollapsed=value=>{if(!value&&matchMedia('(max-width:700px)').matches){document.querySelectorAll('.hud-status,.hud-brain').forEach(other=>{if(other!==panel&&!other.classList.contains('is-collapsed'))other.querySelector('.hud-collapse')?.click();});}panel.classList.toggle('is-collapsed',value);button.textContent=value?'展开':'收起';button.setAttribute('aria-expanded',String(!value));};
  button.addEventListener('click',()=>setCollapsed(!panel.classList.contains('is-collapsed')));heading.append(button);const narrow=matchMedia('(max-width:700px)');narrow.addEventListener('change',e=>{if(e.matches)setCollapsed(true);});setCollapsed(narrow.matches);
 }
}
