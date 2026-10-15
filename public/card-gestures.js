// Translate a physical gesture into the same versioned command as a button.
// This module never guesses card faces or changes the authoritative game state.
const ownSlot=(view,ref)=>view?.players.find(p=>p.id===view.me)?.slots.find(s=>s.slotId===ref?.slotId&&s.version===ref?.version&&s.occupied);
const ownsTurn=view=>view?.turnPlayerId===view?.me;
const burnOpen=(view,now)=>!!view?.burn?.canAttempt&&now<view.burn.endsAt;

export function makeCardSource(view,kind,ref=null,now=Date.now()) {
  if(!view?.roundId)return null;
  const base={kind,roundId:view.roundId,actionId:view.private.actionId};
  if(kind==='drawn'&&ownsTurn(view)&&view.phase==='DRAWN'&&view.private.drawn)return base;
  if(kind==='fire'&&ownsTurn(view)&&view.phase==='TURN_START'&&view.fireTop)return base;
  if(kind==='own'&&ownSlot(view,ref)) {
    if(burnOpen(view,now))return {...base,purpose:'burn',burnId:view.burn.id,ref:{...ref}};
    if(ownsTurn(view)&&view.phase==='DRAWN'&&view.private.drawn)return {...base,purpose:'replace',ref:{...ref}};
  }
  return null;
}

export function cardSourceValid(view,source,now=Date.now()) {
  if(!source||!view||source.roundId!==view.roundId)return false;
  const current=makeCardSource(view,source.kind,source.ref,now);
  if(!current)return false;
  if(source.kind==='own'&&source.purpose==='burn')return current.purpose==='burn'&&source.burnId===current.burnId;
  return source.actionId===current.actionId&&source.purpose===current.purpose;
}

export function planCardDrop(view,source,target,now=Date.now()) {
  if(!cardSourceValid(view,source,now)||!target)return null;
  if(target.kind==='own'&&target.owner===view.me&&ownSlot(view,target.ref)) {
    if(source.kind==='drawn')return {type:'REPLACE_DRAWN',fields:{own:{...target.ref}}};
    if(source.kind==='fire')return {type:'TAKE_FIRE',fields:{own:{...target.ref}}};
  }
  if(target.kind==='fire') {
    if(source.kind==='drawn')return {type:'DISCARD_DRAWN',fields:{}};
    if(source.kind==='own'&&source.purpose==='replace')return {type:'REPLACE_DRAWN',fields:{own:{...source.ref}}};
    if(source.kind==='own'&&source.purpose==='burn')return {type:'BURN',fields:{burnId:source.burnId,own:{...source.ref}}};
  }
  return null;
}
