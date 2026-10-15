// Native Web Animations / FLIP. Effects never decide or submit a game move.
const ease='cubic-bezier(0.22, 1, 0.36, 1)';
const live=new Set();
export const reducedMotion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function animate(element,frames,options={}){
  if(!element?.animate||reducedMotion())return null;
  const animation=element.animate(frames,{duration:420,easing:ease,...options});
  live.add(animation);animation.finished.catch(()=>{}).finally(()=>live.delete(animation));return animation;
}
export function clearEffects(){
  for(const animation of live)animation.cancel();live.clear();
  document.querySelectorAll('.effect-card,.ember,.score-float').forEach(el=>el.remove());
}
export function captureCards(){
  const map=new Map();
  document.querySelectorAll('[data-motion-key]').forEach(el=>map.set(el.dataset.motionKey,{rect:el.getBoundingClientRect()}));
  return map;
}
function emberBurst(rect){
  for(let i=0;i<9;i++){
    const particle=document.createElement('i');particle.className='ember';particle.setAttribute('aria-hidden','true');
    particle.style.left=(rect.left+rect.width/2)+'px';particle.style.top=(rect.top+rect.height/2)+'px';document.body.append(particle);
    const angle=i*Math.PI*2/9,dx=Math.cos(angle)*(30+i%3*13),dy=Math.sin(angle)*48-24;
    const animation=animate(particle,[{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${dx}px,${dy}px) scale(.15)`,opacity:0}],{duration:470+i*15});
    animation?.finished.catch(()=>{}).finally(()=>particle.remove());
  }
}
function flyPublicCard(element,from,to){
  // Clone only the NEW public fire card, never a previously revealed private card.
  const ghost=element.cloneNode(true);ghost.className='playing-card effect-card'+(element.classList.contains('red')?' red':'')+(element.classList.contains('joker-card')?' joker-card':'');
  for(const attr of [...ghost.attributes])if(attr.name.startsWith('data-')||attr.name==='id')ghost.removeAttribute(attr.name);
  ghost.disabled=true;ghost.setAttribute('aria-hidden','true');ghost.tabIndex=-1;
  Object.assign(ghost.style,{left:to.left+'px',top:to.top+'px',width:to.width+'px',height:to.height+'px'});document.body.append(ghost);
  const x=from.left-to.left,y=from.top-to.top;
  const animation=animate(ghost,[{transform:`translate(${x}px,${y}px) rotate(-10deg)`,opacity:.95},{transform:`translate(${x*.45}px,${y*.45-48}px) rotate(5deg)`,opacity:1,offset:.45},{transform:'translate(0,0) rotate(0)',opacity:0}],{duration:340});
  animation?.finished.catch(()=>{}).finally(()=>ghost.remove());
}
export function animateCards(before,oldView,view,{newView=false,pageChanged=false}={}){
  if(reducedMotion()||document.hidden)return;
  // Read all geometry first, then animate; pointer moves do not call this function.
  const items=[...document.querySelectorAll('[data-motion-key]')].map(el=>({el,key:el.dataset.motionKey,rect:el.getBoundingClientRect(),transform:getComputedStyle(el).transform}));
  const deck=items.find(x=>x.key==='deck'),fire=items.find(x=>x.key==='fire');
  const dealing=newView&&view?.phase==='INITIAL_PEEK'&&oldView?.roundId!==view.roundId;
  const revealed=newView&&view?.phase==='ROUND_END'&&oldView?.phase!=='ROUND_END';
  const drawn=newView&&view?.private.drawn&&(!oldView?.private.drawn||oldView.private.actionId!==view.private.actionId);
  for(const [index,item] of items.entries()){
    const {el,key,rect}=item,end=item.transform==='none'?'':item.transform;
    if(dealing&&el.dataset.slot&&deck){
      animate(el,[{transform:`translate(${deck.rect.left-rect.left}px,${deck.rect.top-rect.top}px) rotate(18deg) scale(.65)`,opacity:0},{transform:`${end} translateY(-4px)`,opacity:1,offset:.8},{transform:end||'none',opacity:1}],{duration:470,delay:index*32,fill:'backwards'});
    }else if(revealed&&el.dataset.slot){
      animate(el,[{transform:`${end} perspective(700px) rotateY(90deg)`,opacity:0},{transform:`${end} perspective(700px) rotateY(0)`,opacity:1}],{duration:480,delay:index*45,fill:'backwards'});
    }else if(drawn&&key==='drawn'){
      const origin=before.get(view.private.drawnSource==='fire'?'fire':'deck')?.rect||deck?.rect;
      if(origin)animate(el,[{transform:`translate(${origin.left-rect.left}px,${origin.top-rect.top}px) perspective(700px) rotateY(90deg) scale(.92)`,opacity:0},{transform:'translate(0,0) perspective(700px) rotateY(0)',opacity:1}],{duration:430});
    }else if(before.has(key)){
      const previous=before.get(key).rect,dx=previous.left-rect.left,dy=previous.top-rect.top;
      if(Math.abs(dx)+Math.abs(dy)>2)animate(el,[{transform:`translate(${dx}px,${dy}px) ${end}`},{transform:end||'none'}],{duration:300});
    }
  }
  if(newView&&view?.burn&&oldView?.burn?.id!==view.burn.id&&fire){
    let source=before.get('drawn')?.rect;
    if(!source&&oldView)for(const player of view.players)for(const slot of player.slots){
      const oldSlot=oldView.players.find(p=>p.id===player.id)?.slots.find(s=>s.slotId===slot.slotId);
      if(oldSlot?.occupied&&(oldSlot.version!==slot.version||!slot.occupied))source??=before.get(slot.slotId)?.rect;
    }
    if(source)flyPublicCard(fire.el,source,fire.rect);
    emberBurst(fire.rect);
    animate(document.querySelector('.table-surface'),[{transform:'translateX(0)'},{transform:'translateX(2px)'},{transform:'translateX(-2px)'},{transform:'translateX(0)'}],{duration:190});
  }
  if(revealed){
    for(const score of view.result.scores){
      const seat=document.querySelector('[data-player="'+score.playerId+'"]');if(!seat)continue;
      const label=document.createElement('span');label.className='score-float';label.dir='ltr';label.textContent=(score.total>=0?'+':'')+score.total;label.setAttribute('aria-hidden','true');seat.append(label);
      const animation=animate(label,[{transform:'translateY(10px)',opacity:0},{transform:'translateY(-8px)',opacity:1,offset:.3},{transform:'translateY(-35px)',opacity:0}],{duration:1500,delay:450});
      animation?.finished.catch(()=>{}).finally(()=>label.remove());
    }
  }
  if(pageChanged)animate(document.querySelector('main'),[{transform:'translateY(10px) scale(.99)',opacity:0},{transform:'translateY(0) scale(1)',opacity:1}],{duration:400});
}
export function animateResults(root){
  if(reducedMotion())return;
  root.querySelectorAll('[data-total]').forEach((el,i)=>{
    const total=Number(el.dataset.total),start=performance.now()+i*75;
    el.setAttribute('aria-label',total+' نقطة');
    function frame(now){if(!el.isConnected)return;const progress=Math.max(0,Math.min(1,(now-start)/650));el.textContent=String(Math.round(total*(1-(1-progress)**3)));if(progress<1)requestAnimationFrame(frame);}
    requestAnimationFrame(frame);
  });
  root.querySelectorAll('.result-bar').forEach((el,i)=>animate(el,[{transform:'scaleX(0)'},{transform:'scaleX(1)'}],{duration:650,delay:i*75,fill:'backwards'}));
  animate(root.querySelector('.result-head.winner .crown'),[{transform:'translateY(-15px) rotate(-12deg) scale(.8)',opacity:0},{transform:'translateY(0) rotate(0) scale(1)',opacity:1}],{duration:650});
  animate(root.querySelector('.result-head.runner-up'),[{transform:'translateX(0)'},{transform:'translateX(3px)'},{transform:'translateX(-3px)'},{transform:'translateX(0)'}],{duration:230});
}
export function pressFeedback(button){
  animate(button,[{transform:'scale(.97)'},{transform:'scale(1)'}],{duration:220});
  if(reducedMotion())return;
  const ripple=document.createElement('span');ripple.className='button-ripple';ripple.setAttribute('aria-hidden','true');button.append(ripple);
  animate(ripple,[{transform:'scale(.2)',opacity:.25},{transform:'scale(2)',opacity:0}],{duration:400})?.finished.catch(()=>{}).finally(()=>ripple.remove());
}
export function rejectInput(element){animate(element,[{transform:'translateX(0)'},{transform:'translateX(5px)'},{transform:'translateX(-5px)'},{transform:'translateX(0)'}],{duration:250});}
export function animateTab(element,oldTab,nextTab){animate(element,[{transform:oldTab==='join'?'translateX(-100%)':'translateX(0)'},{transform:nextTab==='join'?'translateX(-100%)':'translateX(0)'}],{duration:300});}
