const STEPS=[
  ['先看看它','Meet your companion','用第三人称跟着它，或点「我的果蝇 → 近看它」观察。拖动环顾，滚轮缩放。','Follow it in third person, or use My companion → Look closer. Drag to look around; scroll to zoom.'],
  ['照顾，然后等它自己行动','Care, then watch','左侧可以补充食物、清水和整理床铺。准备完成后，它仍要自己靠近、接触；观察到实际恢复才会留下结果。','Prepare food, water or bedding on the left. It still needs to approach and make contact. Results come from actual recovery.'],
  ['让日子留下习惯','Give habits time','在「我的果蝇」查看成长和习惯。关闭页面或切到后台时生活暂停；到「设置 → 存档与备份」保存一份备份。','Find growth and habits in My companion. Life pauses when the page closes or goes into the background. Export a backup in Settings → Save & backup.']
];
export function setupHomeOnboarding(){
  const english=()=>document.documentElement.lang==='en';
  const dialog=document.createElement('dialog');dialog.id='home-intro';dialog.dataset.noLocale='';dialog.setAttribute('aria-labelledby','home-intro-title');
  dialog.innerHTML='<p class="companion-eyebrow" id="home-intro-step"></p><h2 id="home-intro-title"></h2><p id="home-intro-copy"></p><div class="companion-actions"><button type="button" id="home-intro-skip"></button><button type="button" id="home-intro-next"></button></div>';
  document.body.append(dialog);
  const replay=document.createElement('button');replay.type='button';replay.id='home-intro-replay';replay.dataset.noLocale='';document.querySelector('#settings-about-links').append(replay);
  let step=0,identityId=null,returnFocus=null;
  const el=id=>dialog.querySelector('#'+id);
  function render(){const en=english(),s=STEPS[step];replay.textContent=en?'Getting started':'重新看看入门说明';el('home-intro-step').textContent=`${step+1} / ${STEPS.length}`;el('home-intro-title').textContent=s[en?1:0];el('home-intro-copy').textContent=s[en?3:2];el('home-intro-skip').textContent=en?'Skip':'跳过';el('home-intro-next').textContent=step===STEPS.length-1?(en?'Ready':'开始观察'):(en?'Next':'下一步');}
  function close(){if(identityId)try{localStorage.setItem('mirror-gap-intro-v1:'+identityId,'seen');}catch{/* Intro preferences must never block adoption. */}dialog.close();returnFocus?.focus();}
  function open(id){identityId=id??null;step=0;returnFocus=document.activeElement;render();dialog.showModal();}
  function adopted(event){const id=event.detail?.id;if(!id)return;let seen=false;try{seen=localStorage.getItem('mirror-gap-intro-v1:'+id)==='seen';}catch{}if(!seen)open(id);}
  function replayIntro(){document.querySelector('#settings-dialog').close();open();}
  el('home-intro-next').addEventListener('click',()=>{if(step===STEPS.length-1)close();else{step++;render();}});
  el('home-intro-skip').addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  const languageObserver=new MutationObserver(render);
  languageObserver.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  replay.addEventListener('click',replayIntro);window.addEventListener('companion-adopted',adopted);render();
  return {dispose(){window.removeEventListener('companion-adopted',adopted);languageObserver.disconnect();dialog.remove();replay.remove();}};
}
