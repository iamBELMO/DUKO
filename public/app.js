import { cardFace, suitSvg, suitNames } from './card-art.js';
import { createSoundManager } from './sounds.js';
import { captureCards, animateCards, animateResults, animateTab, clearEffects, pressFeedback, rejectInput, reducedMotion } from './effects.js';
import { HostedConnection } from './connection.js';
import { makeCardSource, cardSourceValid, planCardDrop } from './card-gestures.js';
const clientId=crypto.randomUUID();
const $ = s => document.querySelector(s);
const escape = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const suits = {hearts:'♥',diamonds:'♦',clubs:'♣',spades:'♠'};
const colors = ['#4070ed','#bc70d5','#ea895b','#2d9fba','#dd6686','#6a83d6'];
const paths = {
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01"/>',
  sound:'<path d="m11 5-6 4H2v6h3l6 4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute:'<path d="m11 5-6 4H2v6h3l6 4zM17 9l5 6m0-6-5 6"/>',
  arrow:'<path d="M19 12H5m6-6-6 6 6 6"/>',
  copy:'<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/>',
  flame:'<path d="M12 3c1 5-4 5-4 9 0 1 1 2 2 2-2-5 4-3 5-7 1 4 5 7 4 11-1 3-4 4-7 4-5 0-8-3-7-7 0-5 5-8 7-12z"/>',
  eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  crown:'<path d="m3 7 5 4 4-7 4 7 5-4-2 12H5zM5 22h14"/>',
  exit:'<path d="M9 4H4v16h5m5-13 5 5-5 5m-7-5h12"/>',
  install:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  telegram:'<path d="m21 3-5 18-6-7-7-3 18-8ZM10 14l11-11M10 14l-1 6 4-3"/>'
};
const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.help)+'</svg>';
const errors = {
  NAME_REQUIRED:'اكتب اسمك أولاً.', ROOM_NOT_FOUND:'ما لقينا الغرفة. تأكد من الرمز.',
  INVALID_ROOM_CODE:'رمز الغرفة من ٦ خانات.', ROOM_FULL:'الطاولة مكتملة، ٦ لاعبين.',
  ROUND_IN_PROGRESS:'الجولة بدأت. استنى الشلّة ترجع للانتظار.',
  PLAYERS_NOT_READY:'لازم الكل يكون متصل وجاهز.', PLAYER_COUNT:'بدنا لاعبين اثنين على الأقل.',
  HOST_ONLY:'هذا الخيار لصاحب الغرفة.', NOT_YOUR_TURN:'استنى دورك.',
  STALE_BURN:'انحسم الحرق؛ ما عليك عقوبة.', STALE_SLOT:'الورقة تغيّرت. اختار من جديد.',
  ALREADY_ATTEMPTED:'إلك محاولة واحدة بهالرمية.', STALE_ACTION:'تغيّر الدور؛ حدّثنا الطاولة.',
  WRONG_PHASE:'انتهت هالخطوة.', TURN_EXPIRED:'انتهى وقت دورك.',
  ALREADY_PEEKED:'بتقدر تشوف هدفاً واحداً بالـ١٠.', DISCARDER_CANNOT_BURN:'ما بتحرق ورا رميتك.',
  SESSION_EXPIRED:'انتهت جلستك. ادخل باسمك من جديد.', ALREADY_IN_ROOM:'إنت موجود بغرفة. اطلع منها أولاً.',
  RATE_LIMITED:'على مهلك شوي، جرّب بعد لحظة.', LOBBY_ONLY:'هذا الخيار متاح قبل بداية الجولة.',
  ROUND_NOT_FINISHED:'استنى نهاية الجولة.', CABO_ALREADY_CALLED:'دوكو معلنة من قبل.',
  BAD_ORIGIN:'افتح اللعبة من نفس رابط الطاولة.', SERVER_BUSY:'الطاولات مشغولة. جرّب لاحقاً.',
  BAD_REQUEST:'ما تم الطلب. جرّب مرة ثانية.', SERVER_ERROR:'صار خطأ بالاتصال. عم نحدّث الطاولة.'
};
function remembered(key, fallback='') {try{return localStorage.getItem(key)??fallback;}catch{return fallback;}}
const ui = {
  profile:null,view:null,name:remembered('duko-name'),code:new URLSearchParams(location.search).get('room')||'',
  tab:new URLSearchParams(location.search).has('room')?'join':'create',busy:false,wsUp:false,connecting:false,
  mode:null,selected:null,modal:null,dismissedRound:null,offset:0,ping:null,shareOrigin:location.origin,
  sound:remembered('duko-sound')==='on',replaced:false,changed:new Set(),deal:false,offline:false,burnSelection:null,paintedView:null,paintedRevision:null,paintedPage:null,paintedHtml:null,modalKey:null,modalContent:null,copiedUntil:0
};
let ws=null,retryTimer=null,retryDelay=700,toastTimer=null,installPrompt=null;
let dragState=null,suppressPointerClick=false,renderDeferred=false;
const pending=new Map();
const serverTime=()=>Date.now()+ui.offset;
const me=()=>ui.view?.players.find(p=>p.id===ui.view.me);
const busy=()=>ui.busy||pending.size>0;
function toast(message,error=false){
  const el=$('#toast');el.textContent=message;el.className='show'+(error?' error':'');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3400);
}
const sounds=createSoundManager(()=>ui.sound);
function tone(kind='tap'){sounds.play(({tap:'click',burn:'fire',error:'lose'})[kind]||kind,{haptic:['burn','win'].includes(kind)&&!reducedMotion()});}
async function api(path,body){
  const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:{'X-Duko-Client':clientId,...(body===undefined?{}:{'Content-Type':'application/json'})},signal:AbortSignal.timeout(10000),body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
  const data=await response.json();
  if(!response.ok)throw Object.assign(new Error(errors[data.code]||'تعذر الاتصال. جرّب مرة ثانية.'),{code:data.code,status:response.status});
  return data;
}
function send(type,fields={}){
  if(!ui.wsUp||!ws||ws.readyState!==WebSocket.OPEN){toast('الاتصال مقطوع. لحظة وبنرجع.',true);return Promise.resolve(false);}
  const turn=!['READY','START','BURN'].includes(type);
  const id=crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  const envelope={commandId:id,roundId:ui.view.roundId,command:{type,...(turn?{actionId:ui.view.private.actionId}:{}),...fields}};
  return new Promise(resolve=>{
    pending.set(id,{envelope,resolve,tries:0});
    ws.send(JSON.stringify({type:'command',envelope}));
    const expire=()=>{
      const p=pending.get(id);if(!p)return;
      if(type!=='BURN'&&p.tries<1&&ui.wsUp){p.tries++;ws.send(JSON.stringify({type:'command',envelope}));p.timer=setTimeout(expire,1800);return;}
      pending.delete(id);resolve(false);if(ui.wsUp)ws.send(JSON.stringify({type:'sync'}));render();
    };
    pending.get(id).timer=setTimeout(expire,1800);render();
  });
}
function onView(v){
  const old=ui.view;
  if(old&&old.roomId===v.roomId&&v.revision<old.revision)return;
  if(ui.ping===null)ui.offset=v.serverNow-Date.now();
  ui.changed=new Set();ui.deal=old?.roundId!==v.roundId&&v.phase==='INITIAL_PEEK';
  if(old&&old.roundId===v.roundId)for(const p of v.players)for(const s of p.slots){
    const previous=old.players.find(x=>x.id===p.id)?.slots.find(x=>x.slotId===s.slotId);
    if(previous&&(previous.version!==s.version||!!previous.face!==!!s.face))ui.changed.add(s.slotId);
  }
  ui.view=v;
  if(old?.phase!==v.phase||old?.turnPlayerId!==v.turnPlayerId){
    const keepBurn=ui.burnSelection&&cardSourceValid(v,ui.burnSelection,serverTime());
    ui.mode=keepBurn?'BURN':null;ui.selected=keepBurn?ui.burnSelection.ref:null;if(!keepBurn)ui.burnSelection=null;
  }
  if(!v.burn?.canAttempt&&ui.mode==='BURN')ui.mode=null;
  if(ui.selected&&!v.players.some(p=>p.slots.some(s=>s.slotId===ui.selected.slotId&&s.version===ui.selected.version&&s.occupied)))ui.selected=null;
  if(ui.burnSelection&&!cardSourceValid(v,ui.burnSelection,serverTime())){ui.burnSelection=null;ui.selected=null;}
  if(dragState&&!cardSourceValid(v,dragState.source,serverTime()))finishCardDrag(false);
  if(old?.roundId!==v.roundId)ui.dismissedRound=null;
  if(v.phase==='ROUND_END'&&old?.phase!=='ROUND_END'){tone(v.result.winners.includes(v.me)?'win':'lose');}
  if(v.turnPlayerId===v.me&&old?.turnPlayerId!==v.me)tone();
  if(ui.deal)tone('deal');
  else if(v.private.drawn&&(!old?.private.drawn||old.private.actionId!==v.private.actionId))tone('draw');
  else if(v.burn&&old?.burn?.id!==v.burn.id)tone('discard');
  else if(ui.changed.size&&v.phase==='POWER')tone('flip');
  render();
}
function connect(){
  if(!ui.profile?.roomCode)return;
  clearTimeout(retryTimer);
  if(ws){ws.onclose=null;ws.close();}
  ui.connecting=true;ui.replaced=false;
  ws=new HostedConnection(api,clientId);
  ws.onopen=()=>{ui.wsUp=true;ui.connecting=false;retryDelay=700;ws.send(JSON.stringify({type:'ping',clientTime:Date.now()}));render();};
  ws.onmessage=event=>{
    let message;try{message=JSON.parse(event.data);}catch{return;}
    if(message.type==='view')onView(message.view);
    if(message.type==='pong'){
      ui.ping=Math.max(0,Date.now()-message.clientTime);
      ui.offset=message.serverTime-(message.clientTime+Date.now())/2;updateTimers();
    }
    if(message.type==='receipt'){
      const p=pending.get(message.commandId);if(p){clearTimeout(p.timer);pending.delete(message.commandId);p.resolve(message.ok);}
      if(!message.ok)toast(errors[message.code]||'ما تمّت الحركة؛ جرّب من جديد.',!['STALE_BURN','STALE_SLOT'].includes(message.code));
      else if(message.code==='BURN_PENALTY'){toast('حرق غلط! انضافت إلك ورقة مقلوبة.',true);tone('error');}
      else if(message.code==='BURN_ACCEPTED'){toast('حرق صحيح! ورقة أقل.');tone('burn');}
      else tone();
      ui.selected=null;ui.mode=null;ui.burnSelection=null;render();
    }
    if(message.type==='error')toast(errors[message.code]||'تعذر تنفيذ الطلب.',true);
  };
  ws.onclose=event=>{
    if(dragState)finishCardDrag(false);
    ui.wsUp=false;ui.connecting=false;
    if(event.code===4001){ui.replaced=true;toast('انفتحت جلستك بتبويب ثاني.',true);render();return;}
    if(event.code===4002)return;
    if(event.code===4003){ui.profile=null;ui.view=null;render();return;}
    if(event.code===4004){ui.view=null;ui.profile.roomCode=null;api('/api/rooms/leave',{}).catch(()=>{});toast('انتهت الغرفة. افتح طاولة جديدة.');render();return;}
    render();
    if(ui.profile?.roomCode){retryTimer=setTimeout(connect,retryDelay);retryDelay=Math.min(8000,retryDelay*1.7);}
  };
  ws.onerror=()=>{};
}
function avatar(player,small=false){
  const active=small&&ui.view?.turnPlayerId===player.id;
  return '<span class="avatar '+(active?'avatar-active':'')+'" style="--av:'+colors[(player.seat||0)%colors.length]+'">'+escape((player.name||'؟').slice(0,1))+'<i class="seat-connection '+(!player.connected?'away':'')+'" aria-label="'+(player.connected?'متصل':'غير متصل')+'"></i>'+(active?'<svg class="avatar-timer" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" pathLength="100" data-turn-arc="'+ui.view.turnDeadlineAt+'"/></svg>':'')+'</span>';
}
function telegramBanner(){return '<a class="telegram-banner" href="https://t.me/iamBELMO" target="_blank" rel="noopener noreferrer" aria-label="انضم إلى قناة BELMO على تيليجرام — يفتح في تبويب جديد"><span class="telegram-banner-icon">'+icon('telegram')+'</span><span class="telegram-banner-copy"><b>الشلّة بتكمّل على تيليجرام</b><small>انضمّ لقناتي</small></span><span class="telegram-handle" dir="ltr">@iamBELMO <span aria-hidden="true">↗</span></span></a>';}
function navbar(){
  return '<header class="topbar"><div class="brand"><span class="brand-mark">♠</span><div>دوكو<small>DUKO CLUB</small></div></div><div class="nav-right">'+
    (ui.view?'<div class="connection '+(!ui.wsUp?'off':'')+'"><i class="status-dot"></i><span>'+(ui.wsUp?'متصل'+(ui.ping!==null?' · '+Math.round(ui.ping)+'ms':''):'عم نرجع…')+'</span></div>':'<span class="eyebrow">LET’S PLAY</span>')+
    '<a class="telegram-nav" href="https://t.me/iamBELMO" target="_blank" rel="noopener noreferrer" aria-label="BELMO على تيليجرام — يفتح في تبويب جديد">'+icon('telegram')+'<span>تيليجرام</span></a><button class="icon-btn" data-action="sound" aria-label="'+(ui.sound?'كتم الصوت':'تشغيل الصوت')+'">'+icon(ui.sound?'sound':'mute')+'</button><button class="icon-btn" data-action="help" aria-label="طريقة اللعب">'+icon('help')+'</button></div></header>';
}
const footer=()=>'<footer class="footer"><div class="footer-brand"><strong>DUKO CLUB</strong><span>ورق، ضحكة، وشلّة.</span></div><a class="telegram-link" href="https://t.me/iamBELMO" target="_blank" rel="noopener noreferrer">'+icon('telegram')+'<span>تواصل معي على تيليجرام<small dir="ltr">@iamBELMO ↗</small></span></a><button class="btn ghost small" data-action="install">'+icon('install')+' على تلفونك</button></footer>';
const front=cardFace;
function card({face=null,occupied=true,slotId='',version=0,owner='',index=0,eligible=false,selected=false,action='',hero=false,dragKind='',angle=0,arc=0}={}){
  const display=face?front(face):null;
  const cls='playing-card '+(!occupied?'empty':face?(display.red?'red':''):'card-back')+(display?.joker?' joker-card':'')+
    (eligible?' eligible':'')+(selected?' selected':'')+(dragKind?' draggable-card':'');
  const label=!occupied?'مكان فارغ':face?(face.rank==='JOKER'?'جوكر':String(face.rank)+' '+(suitNames[face.suit]||'')):'ورقة مقلوبة '+(index+1);
  const attrs=action?' data-action="'+action+'"':slotId?' data-slot="'+escape(slotId)+'" data-owner="'+escape(owner)+'" data-version="'+version+'"':'';
  const motionKey=slotId||({'draw':'deck','fire-target':'fire','held-drawn':'drawn'})[action];
  return '<button type="button" class="'+cls+'" style="--i:'+index+';--angle:'+angle+'deg;--arc:'+arc+'px"'+attrs+(motionKey?' data-motion-key="'+escape(motionKey)+'"':'')+(dragKind?' data-drag-kind="'+dragKind+'"':'')+' draggable="false" aria-label="'+escape(label)+'" '+(slotId?'aria-pressed="'+selected+'" ':'')+(!eligible?'disabled':'')+'>'+
    (!occupied?'<span class="empty-mark">·</span>':display?display.html:'<span class="card-back-logo">'+suitSvg('spades')+'<small>DUKO</small></span><span class="back-sheen" aria-hidden="true"></span>')+
    (slotId?'<span class="slot-no">'+(index+1)+'</span>':'')+'</button>';
}
function home(){
  return '<main class="home-grid"><section class="hero-copy"><div class="eyebrow"><span class="hero-dot"></span> DUKO · GAME NIGHT</div><h1>جمعة الشلّة،<br><span>ولّعها دوكو.</span></h1><p>احفظ ورقك، خبّي خطتك، واسبقهم بالحرق.<br>كل اللي بدك إياه… اسمك وشلّتك.</p><div class="hero-badges"><span class="pill">'+icon('users')+' ٢–٦ لاعبين</span><span class="pill">غرف خاصة</span><span class="pill">حرق سريع</span></div><div class="hero-art" aria-hidden="true"><div class="art-orbit"></div>'+card({face:{rank:7,suit:'clubs'},hero:true})+card({face:{rank:'K',suit:'hearts'},hero:true})+card({hero:true})+'<span class="float-star">✦</span><span class="art-caption">ذاكرة. سرعة. شويّة حظ.</span></div></section>'+
    '<section class="entry-panel"><div class="panel-head"><span class="entry-symbol" aria-hidden="true">♠</span><div class="eyebrow">TAKE YOUR SEAT</div><h2>كلّها ورقة… وتفرق.</h2><p>افتح غرفة جديدة، أو انضمّ لصحابك برمز الدعوة.</p></div>'+
    (ui.offline?'<div class="offline-banner">الاتصال انقطع. جرّب تحديث الصفحة بعد لحظة.</div>':'')+
    '<label class="field-label" for="player-name">شو نناديك؟</label><input id="player-name" class="text-input" maxlength="24" autocomplete="nickname" placeholder="اسمك على الطاولة" value="'+escape(ui.name)+'">'+
    '<div class="tabs" data-tab="'+ui.tab+'"><span class="tab-indicator" aria-hidden="true"></span><button class="tab '+(ui.tab==='create'?'active':'')+'" data-action="tab-create" aria-pressed="'+(ui.tab==='create')+'">طاولة جديدة</button><button class="tab '+(ui.tab==='join'?'active':'')+'" data-action="tab-join" aria-pressed="'+(ui.tab==='join')+'">معي رمز غرفة</button></div>'+
    (ui.tab==='join'?'<label class="field-label" for="room-code">رمز الغرفة</label><div class="code-entry"><div class="code-boxes" aria-hidden="true">'+Array.from({length:6},(_,i)=>'<span>'+escape(ui.code[i]||'·')+'</span>').join('')+'</div><input id="room-code" class="text-input join-code" maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="رمز الغرفة من ست خانات" value="'+escape(ui.code)+'"></div>':'')+
    '<button class="btn gold full primary" data-action="'+(ui.tab==='create'?'create':'join')+'" '+(ui.busy?'disabled':'')+'>'+(ui.busy?'بنجهّز مكانك…':ui.tab==='create'?'افتح الطاولة':'ادخل على الشلّة')+icon('arrow')+'</button>'+
    '<div class="or-line">أول مرة بتلعب؟</div><button class="btn full ghost practice-button" data-action="practice" '+(ui.busy?'disabled':'')+'>'+icon('plus')+' تسخينة مع لاعبين آليين</button><p class="entry-note">بدون حساب أو تسجيل · بس اسمك وورقك</p></section></main>';
}
function roomTop(subtitle=''){
  const v=ui.view;
  return '<div class="room-top"><div><h1>'+(v.phase==='LOBBY'?'طاولة الشلّة':'طاولة دوكو')+'</h1><p>'+escape(subtitle)+'</p></div><button class="code-chip" data-action="invite" aria-label="نسخ دعوة الغرفة"><strong>'+escape(v.roomCode)+'</strong>'+(Date.now()<ui.copiedUntil?'<span class="copy-done">تم النسخ ✓</span>':icon('copy'))+'</button></div>';
}
function readiness(){
  const v=ui.view,m=me(),host=v.hostId===v.me;
  const canStart=v.players.length>=2&&v.players.filter(p=>p.id!==v.me).every(p=>p.connected&&p.ready)&&ui.wsUp;
  return '<button class="btn '+(m.ready?'':'gold')+'" data-action="ready" '+(!ui.wsUp||busy()?'disabled':'')+'>'+(m.ready?'✓ جاهز':'أنا جاهز')+'</button>'+
    (host?'<button class="btn gold start-game" data-action="start" '+(!canStart||busy()?'disabled':'')+'>'+(v.phase==='ROUND_END'?'الجولة الجايّة':'ابدأ الجولة')+icon('arrow')+'</button>':'<p class="host-wait">'+(m.ready?'جاهز ✓ · بانتظار صاحب الغرفة يبدأ الجولة':'اضغط «أنا جاهز» عشان صاحب الغرفة يقدر يبدأ')+'</p>');
}
function lobby(){
  const v=ui.view,host=v.hostId===v.me;
  return roomTop(host?'إنت صاحب الغرفة 👑 · لما يجهزوا صحابك ابدأ الجولة.':'صاحب الغرفة: '+v.players.find(p=>p.id===v.hostId)?.name+' 👑 · اضغط أنا جاهز وانتظر البداية.')+
    (!ui.wsUp?'<div class="offline-banner">'+(ui.replaced?'جلستك مفتوحة بتبويب ثاني.':'عم نرجّع الاتصال…')+'</div>':'')+
    '<main class="lobby-grid"><section class="panel"><div class="panel-title"><h2>مين عالطاولة؟</h2><span class="pill"><bdi dir="ltr">'+v.players.length+' / 6</bdi></span></div><div class="seat-list">'+
    v.players.map(p=>'<div class="seat">'+avatar(p)+'<div class="seat-info"><div class="seat-name"><b>'+escape(p.name)+'</b>'+(p.id===v.me?'<span class="tiny muted">(إنت)</span>':'')+(p.id===v.hostId?'<span style="color:var(--gold)">'+icon('crown')+'</span>':'')+'</div><div class="seat-sub">'+(p.bot?'لاعب آلي':p.connected?'على الطاولة':'بانتظار الاتصال')+'</div></div><span class="ready-pill '+(!p.ready?'waiting':'')+'">'+(p.ready?'جاهز ✓':'عم يجهّز')+'</span>'+(host&&!p.bot&&p.id!==v.me&&p.connected?'<button class="btn ghost small transfer-host" data-action="host" data-id="'+escape(p.id)+'" title="نقل إدارة الغرفة لهذا اللاعب">'+icon('crown')+' نقل الإدارة</button>':'')+(host&&p.bot?'<button class="icon-btn" data-action="remove-bot" data-id="'+escape(p.id)+'" aria-label="إزالة اللاعب الآلي">'+icon('close')+'</button>':'')+'</div>').join('')+
    (v.players.length<6?'<div class="seat empty">'+icon('users')+' في مكان لباقي الشلّة</div>':'')+'</div><div class="lobby-actions">'+readiness()+
    (host&&v.players.length<6?'<button class="btn ghost" data-action="bot" '+(ui.busy?'disabled':'')+'>'+icon('plus')+' لاعب آلي</button>':'')+'</div></section>'+
    '<aside class="panel"><div class="panel-title"><h2>قوانين الطاولة</h2><span class="intro-suits">♠</span></div><div class="rule-list"><div class="rule-row"><span>ورق البداية</span><b>٤ لكل لاعب</b></div><div class="rule-row"><span>المعاينة</span><b>ورقتا اليمين</b></div><div class="rule-row"><span>الحرق</span><b>نفس الرتبة</b></div><div class="rule-row"><span>وقت الدور</span><b>٣٠ ثانية</b></div><div class="rule-row"><span>الفائز</span><b>أقل مجموع</b></div><div class="rule-row"><span>إنهاء الجولة</span><b>إعلان دوكو</b></div></div><p class="side-note">المفاجأة مش بالورقة اللي معك…<br><strong>بالورقة اللي متذكّر وينها.</strong></p><button class="btn ghost full" data-action="invite">'+icon('copy')+' انسخ رابط الدعوة</button><div class="spacer"></div><button class="btn ghost small full" data-action="leave">'+icon('exit')+' اطلع من الغرفة</button></aside></main>';
}
function targetStillThere(){
  const power=ui.view?.private.power,t=power?.inspected;
  return t&&ui.view.players.find(p=>p.id===t.playerId)?.slots.some(s=>s.slotId===t.slotId&&s.version===t.version&&s.occupied);
}
function eligible(owner,slot){
  const v=ui.view;if(!slot.occupied||!ui.wsUp||busy())return false;
  const mine=owner===v.me;
  if(ui.mode==='BURN')return mine&&!!v.burn?.canAttempt;
  if(mine&&v.burn?.canAttempt)return true;
  if(v.turnPlayerId!==v.me)return mine&&!!v.burn?.canAttempt;
  if(v.phase==='TURN_START')return mine&&ui.mode==='FIRE';
  if(v.phase==='DRAWN')return mine;
  if(v.phase!=='POWER')return false;
  const power=v.private.power;
  if(power.rank===7)return mine;
  if(power.rank===8)return !mine;
  if(power.rank===9)return mine||!!ui.selected;
  if(power.rank===10)return power.stage==='DECIDE_10'&&targetStillThere()?mine:!mine;
  return false;
}
function hand(player,own=false){
  const count=player.slots.length;
  return '<div class="hand '+(own?'own-hand':'')+'" dir="ltr" style="--count:'+count+';--hand-width:'+Math.max(84,Math.min(750,count*86))+'px">'+player.slots.map((s,i)=>card({face:s.face,occupied:s.occupied,slotId:s.slotId,version:s.version,owner:player.id,index:i,angle:own?(i-(count-1)/2)*Math.min(3,16/Math.max(1,count-1)):0,arc:own?Math.abs(i-(count-1)/2)*2:0,eligible:eligible(player.id,s),selected:ui.selected?.slotId===s.slotId,dragKind:own&&makeCardSource(ui.view,'own',{slotId:s.slotId,version:s.version},serverTime())?'own':''})).join('')+'</div>';
}
function instructions(){
  const v=ui.view;
  if(!ui.wsUp)return ['بنرجع عالطاولة…',ui.replaced?'افتح تبويباً واحداً للعبة.':'مكانك وورقك محفوظين. استنى رجوع الاتصال.'];
  if(ui.mode==='BURN')return ui.burnSelection?['ارمِ ورقتك على النار','اسحب الورقة للنار، أو اضغط النار لتأكيد الحرق.']:['اختار ورقة من عندك للحرق','اسحبها للنار. لازم نفس الرتبة؛ الغلط بيزيدك ورقة.'];
  if(v.phase==='INITIAL_PEEK')return ['احفظ ورقتي اليمين','معك '+Math.max(0,Math.ceil((v.previewEndsAt-serverTime())/1000))+' ثوانٍ. أوراق اليسار مجهولة.'];
  if(v.phase==='ROUND_END')return ['خلصت الجولة','شوف النتيجة، وخلي الشلّة تستعد للجولة الجايّة.'];
  if(v.turnPlayerId!==v.me){const p=v.players.find(p=>p.id===v.turnPlayerId);return ['الدور على '+(p?.name||'صاحبك'),v.burn?.canAttempt?'عندك نفس الرتبة؟ امسك ورقتك واسحبها للنار.':'راقب النار، وتذكّر أماكن الورق.'];}
  if(v.phase==='TURN_START')return ui.mode==='FIRE'?['اختار ورقة من عندك','اضغط عليها، أو اسحب ورقة النار فوقها للاستبدال.']:['دورك… العبها صح','امسك من الرزمة أو النار. اسحب المسحوبة فوق ورقتك لتبدّلها.'];
  if(v.phase==='DRAWN')return [v.private.drawnSource==='fire'?'ورقة النار بإيدك.':'بدّلها… أو ارميها.','اسحب المسحوبة فوق ورقتك للاستبدال، أو إلى النار. الضغط على ورقتك بيبدّلها كمان.'];
  if(v.phase==='WAIT_BURN')return ['لحظة الحرق','للجميع، حتى صاحب الرمية. كل حرق صحيح بيفتح فرصة جديدة.'];
  const power=v.private.power;
  if(power?.rank===7)return ['كرامة ٧ · شوف من عندك','اضغط الورقة اللي بدك تتذكرها.'];
  if(power?.rank===8)return ['كرامة ٨ · نظرة على ورقهم','اختار ورقة عند أي لاعب ثاني.'];
  if(power?.rank===9)return ui.selected?['هسا اختار ورقة عند صاحبك','التبديل أعمى، وما حدا بشوف الورقتين.']:['كرامة ٩ · بدّلها وانت ساكت','اختار ورقة من عندك، وبعدها ورقة من عند غيرك.'];
  if(power?.rank===10)return power.stage==='DECIDE_10'&&targetStillThere()?['عجبتك الورقة؟','اضغط ورقة من عندك لتعطيه إياها، أو خلّيها معه.']:['كرامة ١٠ · شوف وقرّر','اختار ورقة عند لاعب ثاني لتشوفها أولاً.'];
  return ['دوكو','الطاولة إلكم.'];
}
function dock(){
  const v=ui.view,mine=v.turnPlayerId===v.me,words=instructions();
  const disabled=!ui.wsUp||busy()?'disabled':'';
  let buttons='';
  if(v.phase==='TURN_START'&&mine)buttons='<button class="btn gold" data-action="draw" '+disabled+'>اسحب ورقة <kbd>D</kbd></button><button class="btn" data-action="take-fire" '+(!v.fireTop||v.burn?'disabled':disabled)+'>امسك النار <kbd>F</kbd></button>'+(!v.cabo?'<button class="btn ghost" data-action="cabo" '+disabled+'>أعلن دوكو <kbd>K</kbd></button>':'');
  if(v.phase==='DRAWN'&&mine)buttons='<button class="btn" data-action="discard" '+disabled+'>'+icon('flame')+' ارمي المسحوبة</button>';
  if(v.phase==='POWER'&&mine)buttons='<button class="btn ghost" data-action="skip" '+disabled+'>'+(v.private.power?.rank===10&&v.private.power.stage==='DECIDE_10'?'خلّيها معه':'تخطّي الكرامة')+'</button>';
  if(v.phase==='ROUND_END')buttons='<button class="btn gold" data-action="result">النتيجة '+icon('crown')+'</button>';
  if(v.burn?.canAttempt)buttons='<button class="btn burn-button '+(ui.mode==='BURN'?'on':'')+'" data-action="burn" '+disabled+'>'+icon('flame')+' حرق سريع</button>'+buttons;
  if(ui.mode==='FIRE'||ui.mode==='BURN')buttons+='<button class="btn ghost small" data-action="cancel">إلغاء</button>';
  return '<div class="action-dock"><div class="action-message"><strong id="action-title">'+escape(words[0])+'</strong><p>'+escape(words[1])+'</p></div><div class="action-buttons">'+buttons+'</div></div>';
}
function game(){
  const v=ui.view,m=me(),mine=v.turnPlayerId===v.me,other=v.players.filter(p=>p.id!==v.me);
  const sorted=[...other].sort((a,b)=>(a.seat-m.seat+v.players.length)%v.players.length-(b.seat-m.seat+v.players.length)%v.players.length);
  const canDraw=mine&&v.phase==='TURN_START'&&ui.wsUp&&!busy();
  const canFire=canDraw&&!!v.fireTop&&!v.burn&&m.slots.some(s=>s.occupied);
  const seatPositions=sorted.length===1?[[50,2]]:sorted.length===2?[[28,4],[72,4]]:sorted.length===3?[[16,19],[50,0],[84,19]]:sorted.length===4?[[12,38],[32,0],[68,0],[88,38]]:[[10,43],[26,3],[50,0],[74,3],[90,43]];
  const holding=mine&&v.phase==='DRAWN'&&!!v.private.drawn&&ui.wsUp&&!busy();
  const canBurn=!!v.burn?.canAttempt&&!!ui.burnSelection&&ui.wsUp&&!busy();
  return roomTop('احفظ مكانها… حتى لو تبدّلت القصة.')+
    (!ui.wsUp?'<div class="offline-banner">'+(ui.replaced?'جلستك مفتوحة بتبويب ثاني.':'الاتصال انقطع. عم نحاول نرجع، لا تسكّر الصفحة.')+'</div>':'')+
    (v.cabo&&v.phase!=='ROUND_END'?'<div class="cabo-banner">♠ <strong>'+escape(v.players.find(p=>p.id===v.cabo.callerId)?.name)+'</strong> أعلن دوكو · كل لاعب إله دوره الأخير</div>':'')+
    '<main class="table-wrap"><div class="table-hud"><span class="phase-label">♠ '+(v.phase==='INITIAL_PEEK'?'المعاينة الأولى':v.phase==='ROUND_END'?'انكشفت الأوراق':'اللعبة شغّالة')+'</span><span class="turn-label '+(mine?'mine':'')+'">'+(v.phase==='INITIAL_PEEK'?'<b data-clock="'+v.previewEndsAt+'">6</b> ثوانٍ':v.phase==='ROUND_END'?'أقل مجموع بيفوز':(mine?'دورك':'دور '+escape(v.players.find(p=>p.id===v.turnPlayerId)?.name||''))+' · <b data-clock="'+v.turnDeadlineAt+'"></b>')+'</span></div>'+
    '<div class="table-surface"><span class="table-light" aria-hidden="true"></span><div class="opponents">'+sorted.map((p,i)=>'<section data-player="'+p.id+'" class="opponent '+(v.turnPlayerId===p.id?'active':'')+'" style="--seat-x:'+seatPositions[i][0]+'%;--seat-y:'+seatPositions[i][1]+'%"><div class="opponent-head">'+avatar(p,true)+'<span class="opponent-name">'+escape(p.name)+'<small>'+(p.bot?'آلي · ':'')+(v.turnPlayerId===p.id?'عم يفكّر':p.connected?'على الطاولة':'انقطع الاتصال')+'</small></span><span class="card-count" aria-label="عدد الأوراق">'+p.slots.filter(s=>s.occupied).length+'</span></div>'+hand(p)+'</section>').join('')+'</div>'+
    '<div class="center-play"><div class="card-zone deck-stack">'+card({action:'draw',eligible:canDraw})+'<span class="deck-count">'+v.deckCount+'</span><span class="pile-label">الرزمة</span></div>'+
    '<div class="card-zone fire-zone '+(v.burn?'fire-glow':'')+'" data-drop="fire"><span class="fire-stack" aria-hidden="true" data-stack="'+Math.min(2,Math.max(0,(v.fireCount||0)-1))+'"></span>'+card({face:v.fireTop,occupied:!!v.fireTop,action:'fire-target',eligible:canFire||holding||canBurn,dragKind:canFire?'fire':''})+'<span class="pile-label">'+icon('flame')+' النار</span><span class="drop-hint">ارمِ هون</span></div>'+
    (v.private.drawn?'<div class="card-zone drawn-zone">'+card({face:v.private.drawn,eligible:holding,action:'held-drawn',dragKind:holding?'drawn':''})+'<span class="pile-label">'+(v.private.drawnSource==='fire'?'من النار · بإيدك':'مسحوبتك · إلك لحالك')+'</span><span class="drag-hint">اسحبني للاستبدال</span></div>':'')+'</div>'+
    '<section data-player="'+m.id+'" class="me-area '+(mine?'active':'')+'"><div class="my-label">'+avatar(m,true)+'<strong>'+escape(m.name)+' · إنت</strong><span class="tiny muted">'+m.slots.filter(s=>s.occupied).length+' ورقات</span></div>'+hand(m,true)+
    (v.phase==='INITIAL_PEEK'?'<div class="preview-banner">'+icon('eye')+' احفظ ورقتي اليمين</div>':'')+'</section></div>'+
    (v.burn?'<div class="burn-strip">'+icon('flame')+'<span>'+((v.burn.sequence||0)>0?'حرق متتابع ×'+v.burn.sequence:'الحرق للجميع')+'</span><div class="burn-meter"><span data-burn-end="'+v.burn.endsAt+'"></span></div><span data-burn-seconds></span></div>':'')+
    dock()+'<div class="table-bottom"><div class="legend-powers"><span><b>7</b> شوف إلك</span><span><b>8</b> شوف لغيرك</span><span><b>9</b> بدّل</span><span><b>10</b> شوف وخذ</span></div><button class="btn ghost small" data-action="leave">'+icon('exit')+' مغادرة</button></div></main>';
}
function resultModal(){
  const v=ui.view,result=v.result,won=result.winners.includes(v.me);
  const names=result.winners.map(id=>v.players.find(p=>p.id===id)?.name).join(' و '),scores=[...result.scores].sort((a,b)=>a.total-b.total);
  const max=Math.max(1,...scores.map(s=>Math.abs(s.total)));
  return '<div class="result-head '+(won?'winner':'runner-up')+'">'+(won?'<div class="confetti" aria-hidden="true">'+Array.from({length:20},(_,i)=>'<i style="--n:'+i+'"></i>').join('')+'</div>':'')+'<span class="crown" aria-hidden="true">'+icon('crown')+'</span><div class="eyebrow">THE TABLE HAS SPOKEN</div><h2>'+(won?'حلوة منك! إنت فزت.':'راحت لـ'+escape(names))+'</h2><p>'+(result.winners.length>1?'تعادل بأقل مجموع':'أقل مجموع… وأحلى فوز')+'</p></div>'+
    '<div class="round-summary"><span>'+v.players.length+' لاعبين</span><span>أقل مجموع <b dir="ltr">'+scores[0].total+'</b></span><span>جولة دوكو</span></div><div class="results">'+scores.map((s,i)=>{const p=v.players.find(p=>p.id===s.playerId),place=scores.findIndex(x=>x.total===s.total)+1;return '<div class="result-row '+(result.winners.includes(p.id)?'win':'')+'"><span class="place medal-'+place+'" aria-label="المركز '+place+'">'+place+'</span>'+avatar(p)+'<span class="player-name">'+escape(p.name)+(p.id===v.me?' <small>إنت</small>':'')+'<span class="result-track"><i class="result-bar" style="width:'+Math.max(8,Math.abs(s.total)/max*100)+'%"></i></span></span><span class="points" data-total="'+s.total+'">'+s.total+'</span></div>';}).join('')+'</div>'+
    (result.reason==='DECK_EXHAUSTED'?'<p>انحسبت الجولة لأن ورق السحب خلص.</p>':'')+
    '<div class="result-actions">'+readiness()+'</div><div class="spacer"></div><div class="result-actions"><button class="btn ghost small" data-action="close-modal">شوف الطاولة</button>'+(v.hostId===v.me?'<button class="btn ghost small" data-action="reset">تعديل الغرفة</button>':'')+'</div>';
}
function renderModal(){
  let content='';
  const showingResult=ui.view?.phase==='ROUND_END'&&ui.dismissedRound!==ui.view.roundId;
  if(ui.modal==='help')content='<div class="eyebrow">HOW TO DUKO</div><h2>الورق قليل… الحركات كثيرة.</h2><p>كل واحد معه ٤ ورقات مقلوبة. بالبداية بتشوف ورقتي اليمين فقط. بدورك امسك ورقة من الرزمة أو النار، ثم اسحبها فوق ورقة من عندك للاستبدال، أو رجّعها على النار. هدفك توصل لأقل مجموع.</p><div class="help-grid"><div class="help-power"><b>7</b><p>شوف ورقة من عندك.</p></div><div class="help-power"><b>8</b><p>شوف ورقة عند لاعب ثاني.</p></div><div class="help-power"><b>9</b><p>بدّل ورقة من عندك مع غيرك، بدون كشف.</p></div><div class="help-power"><b>10</b><p>شوف ورقة عند غيرك، وخذها إذا عجبتك مقابل ورقة من عندك.</p></div></div><p><b>الكرامة</b> تتفعّل فقط لما تسحبها من الرزمة وترميها مباشرة. <b>الحرق</b>: لما أي شخص يرمي، الجميع بيقدروا يحرقوا، حتى صاحب الرمية. اسحب ورقتك للنار أو اختارها ثم اضغط النار. نفس الرتبة تكفي؛ السيرفر بيحسم أول حرق صحيح وبيفتح حرقاً جديداً للجميع. الغلط بيزيدك ورقة؛ الطلب المتأخر ما عليه عقوبة. ورقة مأخوذة من النار ما بتفعّل كرامة عند رميها.</p><div class="score-line"><span>الجوكر / الشيخ الأحمر / الآس</span><b>−2 / −1 / 0</b></div><div class="score-line"><span>الأرقام من 2 إلى 10</span><b>نفس الرقم</b></div><div class="score-line"><span>الولد / البنت / الشيخ الأسود</span><b>11 / 13 / 13</b></div><p>أعلن <b>دوكو</b> ببداية دورك. الكل غيرك إله دور أخير، وبعدها أقل مجموع بيفوز. صفر أوراق مش نهاية تلقائية.</p>';
  else if(ui.modal==='cabo')content='<span class="crown">♠</span><h2>جاهز تعلن دوكو؟</h2><p>إعلانك بيستبدل دورك. باقي اللاعبين إلهم دور أخير واحد، وبعده بنكشف الورق وبنحسب النقاط.</p><div class="result-actions"><button class="btn gold" data-action="confirm-cabo">أعلن دوكو</button><button class="btn ghost" data-action="close-modal">لسه بدري</button></div>';
  else if(ui.modal==='leave')content='<h2>بدك تطلع من الطاولة؟</h2><p>'+(ui.view?.phase==='LOBBY'?'بتقدر ترجع برمز الغرفة.':'إذا الجولة شغّالة، ورقك بيضل مكانه ودورك بيكمل تلقائياً بالمهلة.')+'</p><div class="result-actions"><button class="btn danger" data-action="confirm-leave">اطلع من الغرفة</button><button class="btn ghost" data-action="close-modal">خلّيني هون</button></div>';
  else if(ui.modal==='install')content='<div class="eyebrow">TAKE YOUR SEAT ANYWHERE</div><h2>دوكو على تلفونك</h2><p>على الآيفون: افتح رابط HTTPS في Safari، ومن قائمة المشاركة اختار «إضافة إلى الشاشة الرئيسية».</p><p>على Android: افتح رابط اللعبة في Chrome، واختار تثبيت التطبيق أو الإضافة للشاشة الرئيسية من القائمة إذا ظهر الخيار.</p><p class="install-note">اللعب مع الشلّة يحتاج اتصال إنترنت. الرابط ثابت وما في داعي يضل اللابتوب شغّال.</p>';
  else if(showingResult)content=resultModal();
  const root=$('#modal-root'),key=content?(ui.modal||(showingResult?'result:'+ui.view.roundId:'')):null;
  if(ui.modalContent===content)return;
  const changed=ui.modalKey!==key,focus=document.activeElement?.dataset?.action;
  root.innerHTML=content?'<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="دوكو" tabindex="-1"><button class="icon-btn modal-close" data-action="close-modal" aria-label="إغلاق">'+icon('close')+'</button>'+content+'</section></div>':'';
  ui.modalKey=key;ui.modalContent=content;
  $('#app').inert=!!content;
  if(content){if(changed)root.querySelector('.modal').focus({preventScroll:true});else if(focus)root.querySelector('[data-action="'+focus+'"]')?.focus({preventScroll:true});if(showingResult&&changed)animateResults(root);}
}
function render(){
  if(dragState){renderDeferred=true;return;}
  renderDeferred=false;
  const html='<div class="shell">'+telegramBanner()+navbar()+(ui.view?(ui.view.phase==='LOBBY'?lobby():game()):home())+footer()+'</div>';
  const revision=ui.view?ui.view.roomId+':'+ui.view.roundId+':'+ui.view.revision:null;
  if(html===ui.paintedHtml){ui.paintedView=ui.view;ui.paintedRevision=revision;renderModal();updateTimers();return;}
  const before=captureCards(),old=ui.paintedView,page=ui.view?(ui.view.phase==='LOBBY'?'lobby':'table'):'home',previousTab=$('.tabs')?.dataset.tab;
  const active=document.activeElement,focus=active?.dataset?.slot?{key:'data-slot',value:active.dataset.slot}:active?.dataset?.action?{key:'data-action',value:active.dataset.action}:null;
  const newView=revision!==ui.paintedRevision;
  clearEffects();
  $('#app').innerHTML=html;ui.paintedHtml=html;
  renderModal();
  if(focus&&!ui.modalKey)$('#app').querySelector('['+focus.key+'="'+focus.value+'"]')?.focus({preventScroll:true});
  animateCards(before,old,ui.view,{newView,pageChanged:page!==ui.paintedPage});
  if(previousTab&&previousTab!==ui.tab)animateTab($('.tab-indicator'),previousTab,ui.tab);
  ui.paintedView=ui.view;ui.paintedRevision=revision;ui.paintedPage=page;
  updateTimers();
}
function updateTimers(){
  const time=serverTime();
  document.querySelectorAll('[data-clock]').forEach(el=>el.textContent=Math.max(0,Math.ceil((Number(el.dataset.clock)-time)/1000)));
  document.querySelectorAll('[data-burn-end]').forEach(el=>{
    const remaining=Math.max(0,Number(el.dataset.burnEnd)-time);
    el.style.transform='scaleX('+Math.min(1,remaining/(ui.view?.rules.burnWindowMs||1500))+')';
    const seconds=$('[data-burn-seconds]');if(seconds)seconds.textContent=(remaining/1000).toFixed(1)+'s';
  });
  document.querySelectorAll('[data-turn-arc]').forEach(el=>el.style.strokeDashoffset=String(100-Math.max(0,Math.min(1,(Number(el.dataset.turnArc)-time)/(ui.view?.rules.turnMs||30000)))*100));
  if(ui.view?.phase==='INITIAL_PEEK'){
    const text=$('.action-message p');if(text)text.textContent='معك '+Math.max(0,Math.ceil((ui.view.previewEndsAt-time)/1000))+' ثوانٍ. أوراق اليسار مجهولة.';
  }
  let expired=false;
  if(ui.view)for(const p of ui.view.players)for(const s of p.slots)if(s.face&&s.revealUntil!==null&&s.revealUntil<=time){s.face=null;s.revealUntil=null;expired=true;}
  if(ui.view?.burn&&ui.view.burn.endsAt<=time){ui.view.burn=null;ui.burnSelection=null;if(ui.mode==='BURN'){ui.mode=null;ui.selected=null;}expired=true;}
  if(expired){clearEffects();if(dragState)finishCardDrag(false);render();}
}
async function enter(kind){
  if(ui.busy)return;
  ui.name=$('#player-name')?.value.trim()||ui.name.trim();
  ui.code=$('#room-code')?.value.trim().toUpperCase()||ui.code.trim().toUpperCase();
  if(!ui.name){toast('شو نناديك؟ اكتب اسمك أولاً.',true);$('#player-name')?.focus();return;}
  if(kind==='join'&&!/^[A-Z2-9]{6}$/.test(ui.code)){toast('رمز الغرفة من ٦ خانات.',true);$('#room-code')?.focus();rejectInput($('.code-entry'));return;}
  ui.busy=true;render();
  let failed=false;
  try{
    const session=await api('/api/session',{name:ui.name});
    try{localStorage.setItem('duko-name',session.name);}catch{}
    const room=await api(kind==='join'?'/api/rooms/join':'/api/rooms/create',kind==='join'?{code:ui.code}:{});
    ui.profile={...session,roomCode:room.code};
    if(kind==='practice'){await api('/api/rooms/bot',{});await api('/api/rooms/bot',{});}
    ui.code=room.code;history.replaceState(null,'','/?room='+room.code);
    connect();
  }catch(error){failed=true;toast(error.message,true);}finally{ui.busy=false;render();if(failed&&kind==='join'){$('#room-code')?.focus();rejectInput($('.code-entry'));}}
}
async function onCard(element){
  if(busy()||!ui.view)return;
  const owner=element.dataset.owner,ref={slotId:element.dataset.slot,version:Number(element.dataset.version)};
  const v=ui.view,mine=owner===v.me;
  const powerTargetsOther=v.phase==='POWER'&&(v.private.power?.rank===8||(v.private.power?.rank===10&&v.private.power.stage!=='DECIDE_10'));
  if(ui.mode==='BURN'||(v.burn?.canAttempt&&mine&&(v.turnPlayerId!==v.me||v.phase==='WAIT_BURN'||powerTargetsOther))){
    if(mine){ui.burnSelection=makeCardSource(v,'own',ref,serverTime());ui.selected=ui.burnSelection?ref:null;ui.mode='BURN';render();}return;
  }
  if(v.turnPlayerId!==v.me)return;
  if(v.phase==='TURN_START'&&ui.mode==='FIRE'&&mine)return send('TAKE_FIRE',{own:ref});
  if(v.phase==='DRAWN'&&mine)return send('REPLACE_DRAWN',{own:ref});
  if(v.phase!=='POWER')return;
  const power=v.private.power,target={playerId:owner,...ref};
  if(power.rank===7&&mine)return send('POWER_7',{own:ref});
  if(power.rank===8&&!mine)return send('POWER_8',{target});
  if(power.rank===9){if(mine){ui.selected=ref;render();}else if(ui.selected)return send('POWER_9',{own:ui.selected,target});}
  if(power.rank===10){
    if(power.stage==='DECIDE_10'&&targetStillThere()){if(mine)return send('POWER_10_SWAP',{own:ref});}
    else if(!mine)return send('POWER_10_PEEK',{target});
  }
}
function dropTargetAt(x,y){
  const hit=document.elementFromPoint(x,y);
  const slot=hit?.closest('[data-slot]');
  if(slot)return {element:slot,target:{kind:'own',owner:slot.dataset.owner,ref:{slotId:slot.dataset.slot,version:Number(slot.dataset.version)}}};
  const fire=hit?.closest('[data-drop="fire"]');
  return fire?{element:fire,target:{kind:'fire'}}:null;
}
function clearCardDrag(){
  const d=dragState;if(!d)return null;
  dragState=null;
  if(d.frame)cancelAnimationFrame(d.frame);
  d.ghost?.remove();d.element.classList.remove('drag-origin');
  document.body.classList.remove('dragging-cards');
  document.querySelectorAll('.drop-active,.drop-ready').forEach(el=>el.classList.remove('drop-active','drop-ready'));
  try{if(document.body.hasPointerCapture(d.pointerId))document.body.releasePointerCapture(d.pointerId);}catch{}
  return d;
}
function finishCardDrag(commit){
  const d=clearCardDrag();if(!d)return;
  if(d.moved){
    suppressPointerClick=true;
    const target=dropTargetAt(d.x,d.y);
    const move=commit&&ui.wsUp&&!busy()?planCardDrop(ui.view,d.source,target?.target,serverTime()):null;
    if(move){ui.selected=null;ui.burnSelection=null;ui.mode=null;void send(move.type,move.fields);}
    else if(commit)toast(cardSourceValid(ui.view,d.source,serverTime())?'رجعت الورقة مكانها. فلّتها فوق ورقتك أو في النار حسب الحركة.':'تغيّرت الطاولة؛ الورقة رجعت مكانها.');
  }
  if(renderDeferred||d.moved)render();
}
document.addEventListener('pointerdown',event=>{
  if(event.button!==0||!event.isPrimary)return;
  suppressPointerClick=false;sounds.unlock();
  const element=event.target.closest('[data-drag-kind]');
  if(!element||element.disabled||busy()||!ui.wsUp||ui.modal||dragState)return;
  const ref=element.dataset.slot?{slotId:element.dataset.slot,version:Number(element.dataset.version)}:null;
  const source=makeCardSource(ui.view,element.dataset.dragKind,ref,serverTime());
  if(!source)return;
  dragState={source,element,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,moved:false,ghost:null};
});
document.addEventListener('pointermove',event=>{
  const d=dragState;if(!d||d.pointerId!==event.pointerId)return;
  if(!cardSourceValid(ui.view,d.source,serverTime())){finishCardDrag(false);return;}
  d.x=event.clientX;d.y=event.clientY;
  if(!d.moved&&Math.hypot(d.x-d.startX,d.y-d.startY)<7)return;
  event.preventDefault();
  if(!d.moved){
    d.moved=true;
    const rect=d.element.getBoundingClientRect();
    d.width=rect.width;d.height=rect.height;
    d.ghost=d.element.cloneNode(true);
    d.ghost.className='playing-card drag-ghost '+(d.element.classList.contains('card-back')?'card-back':'')+(d.element.classList.contains('red')?' red':'')+(d.element.classList.contains('joker-card')?' joker-card':'');
    for(const attr of [...d.ghost.attributes])if(attr.name.startsWith('data-')||attr.name==='id')d.ghost.removeAttribute(attr.name);
    d.ghost.disabled=true;d.ghost.setAttribute('aria-hidden','true');d.ghost.setAttribute('tabindex','-1');
    d.ghost.style.width=rect.width+'px';d.ghost.style.height=rect.height+'px';
    d.ghost.querySelector('.slot-no')?.remove();
    document.body.append(d.ghost);d.element.classList.add('drag-origin');document.body.classList.add('dragging-cards');
    try{document.body.setPointerCapture(event.pointerId);}catch{}
    if(d.source.kind==='drawn'||d.source.kind==='fire')document.querySelectorAll('.own-hand .playing-card:not(.empty)').forEach(el=>el.classList.add('drop-ready'));
    if(d.source.kind!=='fire')document.querySelector('[data-drop="fire"]')?.classList.add('drop-ready');
  }
  if(!d.frame)d.frame=requestAnimationFrame(()=>{
    d.frame=null;if(dragState!==d||!d.ghost)return;
    const target=dropTargetAt(d.x,d.y);
    const active=planCardDrop(ui.view,d.source,target?.target,serverTime())?target.element:null;
    d.activeTarget?.classList.remove('drop-active');active?.classList.add('drop-active');d.activeTarget=active;
    d.ghost.style.transform='translate3d('+(d.x-d.width/2)+'px,'+(d.y-d.height*.78)+'px,0) rotate(-5deg)';
  });
},{passive:false});
document.addEventListener('pointerup',event=>{
  const d=dragState;if(!d||d.pointerId!==event.pointerId)return;
  d.x=event.clientX;d.y=event.clientY;
  if(d.moved){event.preventDefault();finishCardDrag(true);return;}
  const valid=cardSourceValid(ui.view,d.source,serverTime());
  clearCardDrag();suppressPointerClick=true;
  // Handle the tap once before a deferred room repaint replaces its DOM target.
  if(valid&&d.element.isConnected)d.element.click();
  if(renderDeferred)render();
});
document.addEventListener('pointercancel',event=>{if(dragState?.pointerId===event.pointerId)finishCardDrag(false);});
document.addEventListener('lostpointercapture',event=>{if(dragState?.pointerId===event.pointerId)finishCardDrag(false);});
document.addEventListener('click',event=>{
  if(suppressPointerClick&&event.detail>0){suppressPointerClick=false;event.preventDefault();event.stopImmediatePropagation();}
},true);
document.addEventListener('contextmenu',event=>{if(event.target.closest('[data-drag-kind]'))event.preventDefault();});
window.addEventListener('blur',()=>{if(dragState)finishCardDrag(false);});
document.addEventListener('input',event=>{if(event.target.id==='player-name')ui.name=event.target.value;if(event.target.id==='room-code'){event.target.value=event.target.value.toUpperCase().replace(/[^A-Z2-9]/g,'');ui.code=event.target.value;document.querySelectorAll('.code-boxes span').forEach((el,i)=>el.textContent=ui.code[i]||'·');}});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){if(dragState)finishCardDrag(false);ui.modal=null;ui.mode=null;ui.selected=null;ui.burnSelection=null;if(ui.view?.phase==='ROUND_END')ui.dismissedRound=ui.view.roundId;render();return;}
  if(event.key==='Tab'&&ui.modalKey){const nodes=[...$('#modal-root').querySelectorAll('button:not(:disabled),a[href],input')];const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement?.classList.contains('modal'))){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}return;}
  if(event.key==='Enter'&&!ui.view&&['player-name','room-code'].includes(event.target.id)){enter(ui.tab);return;}
  if(event.repeat||event.ctrlKey||event.altKey||event.metaKey||ui.modalKey||busy()||event.target.closest('input,textarea,[contenteditable="true"]'))return;
  const action={d:'draw',f:'take-fire',b:'burn',k:'cabo'}[event.key.toLowerCase()];
  const button=action?document.querySelector('.action-dock [data-action="'+action+'"]'):null;
  if(button&&!button.disabled){event.preventDefault();button.click();}
});
document.addEventListener('click',async event=>{
  const cardElement=event.target.closest('[data-slot]');if(cardElement&&!cardElement.disabled)return onCard(cardElement);
  const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
  const action=button.dataset.action;sounds.unlock();pressFeedback(button);
  try{
    if(action==='tab-create'||action==='tab-join'){ui.tab=action==='tab-create'?'create':'join';render();}
    else if(['create','join','practice'].includes(action))await enter(action);
    else if(action==='help'){ui.modal='help';renderModal();}
    else if(action==='sound'){ui.sound=!ui.sound;try{localStorage.setItem('duko-sound',ui.sound?'on':'off');}catch{}tone();render();}
    else if(action==='close-modal'){ui.modal=null;if(ui.view?.phase==='ROUND_END')ui.dismissedRound=ui.view.roundId;renderModal();}
    else if(action==='bot'){ui.busy=true;render();await api('/api/rooms/bot',{});}
    else if(action==='host'){await api('/api/rooms/host',{playerId:button.dataset.id});toast('انتقلت إدارة الغرفة.');ws?.send(JSON.stringify({type:'sync'}));}
    else if(action==='remove-bot')await api('/api/rooms/remove-bot',{playerId:button.dataset.id});
    else if(action==='ready')await send('READY',{ready:!me().ready});
    else if(action==='start'){if(!me().ready&&!await send('READY',{ready:true}))return;await send('START');}
    else if(action==='draw')await send('DRAW_DECK');
    else if(action==='take-fire')await send('DRAW_FIRE');
    else if(action==='fire-target'){
      const source=ui.burnSelection||makeCardSource(ui.view,'drawn',null,serverTime());
      const move=planCardDrop(ui.view,source,{kind:'fire'},serverTime());
      if(move)await send(move.type,move.fields);
      else if(ui.view.phase==='TURN_START'&&ui.view.turnPlayerId===ui.view.me)await send('DRAW_FIRE');
    }
    else if(action==='held-drawn')toast('اسحب المسحوبة فوق ورقة من عندك، أو اضغط الورقة اللي بدك تستبدلها.');
    else if(action==='discard')await send('DISCARD_DRAWN');
    else if(action==='skip')await send('SKIP_POWER');
    else if(action==='burn'){ui.mode=ui.mode==='BURN'?null:'BURN';ui.selected=null;ui.burnSelection=null;render();}
    else if(action==='cancel'){ui.mode=null;ui.selected=null;ui.burnSelection=null;render();}
    else if(action==='cabo'){ui.modal='cabo';renderModal();}
    else if(action==='confirm-cabo'){ui.modal=null;renderModal();await send('CABO');}
    else if(action==='result'){ui.dismissedRound=null;renderModal();}
    else if(action==='reset'){await api('/api/rooms/reset',{});ui.dismissedRound=null;ui.modal=null;}
    else if(action==='leave'){ui.modal='leave';renderModal();}
    else if(action==='confirm-leave'){
      await api('/api/rooms/leave',{});clearTimeout(retryTimer);if(ws){ws.onclose=null;ws.close();}ws=null;
      for(const p of pending.values()){clearTimeout(p.timer);p.resolve(false);}pending.clear();
      ui.view=null;ui.profile.roomCode=null;ui.wsUp=false;ui.modal=null;ui.mode=null;history.replaceState(null,'','/');render();
    }else if(action==='invite'){
      const info=await api('/api/me');ui.shareOrigin=location.origin;
      const url=ui.shareOrigin+'/?room='+ui.view.roomCode;
      if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(url);ui.copiedUntil=Date.now()+2200;toast('انسخنا الرابط. ابعته للشلّة!');setTimeout(()=>{if(ui.view)render();},2300);}
      else window.prompt('انسخ رابط الدعوة وابعته للشلّة:',url);
    }else if(action==='install'){
      if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;}
      else{ui.modal='install';renderModal();}
    }
  }catch(error){toast(error.message||'تعذر الاتصال.',true);}
  finally{ui.busy=false;render();}
});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&ui.view){clearEffects();if(dragState)finishCardDrag(false);for(const p of ui.view.players)for(const s of p.slots)if(s.revealUntil!==null)s.face=null;render();}
  else if(ui.wsUp)ws.send(JSON.stringify({type:'sync'}));
});
let heroFrame=null,heroBox=null;
document.addEventListener('pointerover',event=>{const art=event.target.closest('.hero-art');if(art&&!art.contains(event.relatedTarget))heroBox=art.getBoundingClientRect();});
document.addEventListener('pointermove',event=>{const art=event.target.closest('.hero-art');if(!art||!heroBox||reducedMotion()||heroFrame||event.pointerType==='touch')return;const x=(event.clientX-heroBox.left)/heroBox.width-.5,y=(event.clientY-heroBox.top)/heroBox.height-.5;heroFrame=requestAnimationFrame(()=>{art.style.setProperty('--tilt-x',(-y*6)+'deg');art.style.setProperty('--tilt-y',(x*8)+'deg');heroFrame=null;});});
document.addEventListener('pointerout',event=>{const art=event.target.closest('.hero-art');if(art&&!art.contains(event.relatedTarget)){art.style.setProperty('--tilt-x','0deg');art.style.setProperty('--tilt-y','0deg');}});
setInterval(updateTimers,100);
setInterval(()=>{if(ui.wsUp)ws.send(JSON.stringify({type:'ping',clientTime:Date.now()}));},12000);
window.addEventListener('online',()=>{if(ui.profile?.roomCode&&!ui.wsUp)connect();});
async function boot(){
  try{const data=await api('/api/me');ui.profile=data.session;ui.shareOrigin=data.shareOrigin;ui.offline=false;
    if(ui.profile){ui.name=ui.profile.name;if(ui.profile.roomCode)connect();}
  }catch{ui.offline=true;}
  render();
  if('serviceWorker'in navigator&&window.isSecureContext)navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
boot();
