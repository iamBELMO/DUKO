// Runtime markup and interaction checks, without a browser or a preview server.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { cardFace, suitSvg, suitNames } from '../public/card-art.js';
import { makeCardSource, cardSourceValid, planCardDrop } from '../public/card-gestures.js';
import { createApiClient } from '../public/api-client.js';
import { makeDeck } from '../src/cards.ts';
import { createRoom, reduceCommand, advanceTime, assertInvariants } from '../src/engine.ts';
import { RoomActor } from '../src/room-actor.ts';
const NOW=6001;
function fixture(count=2){
  let n=0;const entropy={id:()=>`ui-${++n}`,int:max=>(n++*17)%max};
  let state=createRoom('ui-room',Array.from({length:count},(_,i)=>({id:'p'+i,name:i?'صاحب '+i:'محمد <script>bad</script>'})));
  for(const p of state.players)state=reduceCommand(state,p.id,{type:'READY',ready:true},0,entropy).state;
  state=reduceCommand(state,'p0',{type:'START'},0,entropy).state;
  state=advanceTime(state,NOW,entropy);state.actorIndex=0;
  // Put one matching rank on fire while conserving every card in the deck.
  const own=state.players[0].slots.find(s=>state.deck.some(c=>c.rank===s.card.rank));
  const index=state.deck.findIndex(c=>c.rank===own.card.rank);
  [state.discard[0],state.deck[index]]=[state.deck[index],state.discard[0]];
  assertInvariants(state);
  return {room:new RoomActor(state,entropy),slot:own.id};
}
function app(room){
  const clicks=[],commands=[];
  const root={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[],focus(){}};
  const document={addEventListener(type,handler){if(type==='click')clicks.push(handler);},querySelector:()=>root,querySelectorAll:()=>[],hidden:false};
  const context=vm.createContext({crypto:{randomUUID},URL,URLSearchParams,createApiClient,location:{href:'https://duko.test/',search:'',origin:'https://duko.test'},localStorage:{getItem:()=>null},document,window:{addEventListener(){}},setInterval(){},setTimeout(){},clearTimeout(){},Date:class extends Date{static now(){return NOW;}},WebSocket:{OPEN:1},cardFace,suitSvg,suitNames,makeCardSource,cardSourceValid,planCardDrop,createSoundManager:()=>({play(){},unlock(){}}),reducedMotion:()=>true,pressFeedback(){},captureCards:()=>new Map(),clearEffects(){},animateCards(){},animateTab(){},animateResults(){},rejectInput(){},HostedConnection:class{},navigator:{},history:{replaceState(){}},apiSend:async(type,fields={})=>{
    const view=room.view('p0',NOW),receipt=room.dispatch('p0',{commandId:randomUUID(),roundId:view.roundId,command:{type,actionId:view.private.actionId,...fields}},NOW);
    commands.push({type,fields,receipt});context.inspect.ui.view=room.view('p0',NOW);return receipt.ok;
  }});
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/boot\(\);\s*$/,'globalThis.inspect={ui,home,lobby,game,card,front,eligible,telegramBanner,resultModal,onCard,render};render=()=>{};send=apiSend;');
  vm.runInContext(source,context);
  const {ui}=context.inspect;ui.view=room.view('p0',NOW);ui.view.roomCode='ABC234';ui.wsUp=true;
  const click=async action=>clicks.at(-1)({target:{closest:selector=>selector==='[data-action]'?{dataset:{action},disabled:false}:null}});
  return {...context.inspect,click,commands};
}

test('every card face renders crisp vector suits, correct pip count, and no internal identifiers',()=>{
  for(const card of makeDeck()){
    const {html,red,joker}=cardFace(card);
    assert.ok(!html.includes(card.id));assert.ok(!html.includes('undefined'));
    assert.equal(red,['hearts','diamonds'].includes(card.suit));assert.equal(joker,card.rank==='JOKER');
    if(typeof card.rank==='number')assert.equal((html.match(/--px:/g)||[]).length,card.rank);
    if(card.suit)assert.ok(html.includes('class="suit-icon"'));
  }
});

test('2–6 seat markup keeps hidden faces private, escapes names, and exposes Duko and Telegram',()=>{
  for(let count=2;count<=6;count++){
    const {room}=fixture(count),screen=app(room),html=screen.game();
    assert.equal((html.match(/class="opponent /g)||[]).length,count-1);
    assert.equal((html.match(/data-slot=/g)||[]).length,count*4);
    assert.ok(!html.includes('<script>bad</script>'));assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('أعلن دوكو'));assert.ok(!html.includes('كابو'));
    assert.ok(screen.telegramBanner().includes('https://t.me/iamBELMO'));
    for(const card of room.serverSnapshot().deck)assert.ok(!html.includes('\"'+card.id+'\"'));
  }
});

test('UI tap on fire holds it, returning it enables self-burn through the real engine',async()=>{
  const {room,slot}=fixture(),screen=app(room);
  await screen.click('take-fire');assert.equal(screen.commands.at(-1).type,'DRAW_FIRE');
  assert.equal(screen.ui.view.private.drawnSource,'fire');assert.equal(screen.ui.view.fireTop,null);
  assert.ok(screen.game().includes('من النار · بإيدك'));assert.ok(screen.game().includes('class="playing-card empty eligible'));
  await screen.click('discard');assert.equal(screen.ui.view.phase,'WAIT_BURN');assert.equal(screen.ui.view.activePower,null);
  const own=screen.ui.view.players[0].slots.find(s=>s.slotId===slot);
  assert.equal(screen.eligible('p0',own),true);
  await screen.onCard({dataset:{owner:'p0',slot,version:own.version}});
  assert.ok(screen.ui.burnSelection);assert.ok(screen.game().includes('selected'));
  await screen.click('fire-target');assert.equal(screen.commands.at(-1).receipt.code,'BURN_ACCEPTED');
  assert.equal(screen.ui.view.burn.sequence,1);assert.equal(screen.ui.view.burn.canAttempt,true);
  assert.equal(screen.ui.view.players[0].slots.filter(s=>s.occupied).length,3);assertInvariants(room.serverSnapshot());
});

test('held fire drag replaces the selected board card and leaves no extra drawn card',async()=>{
  const {room}=fixture(),screen=app(room);await screen.click('take-fire');
  const view=screen.ui.view,target=view.players[0].slots[3],held=room.serverSnapshot().drawn.card.id;
  const command=planCardDrop(view,makeCardSource(view,'drawn',null,NOW),{kind:'own',owner:view.me,ref:{slotId:target.slotId,version:target.version}},NOW);
  assert.equal(command.type,'REPLACE_DRAWN');
  const receipt=room.dispatch('p0',{commandId:randomUUID(),roundId:view.roundId,command:{type:command.type,actionId:view.private.actionId,...command.fields}},NOW);
  assert.equal(receipt.ok,true);assert.equal(room.serverSnapshot().players[0].slots[3].card.id,held);assert.equal(room.serverSnapshot().drawn,null);assertInvariants(room.serverSnapshot());
});

test('power selection still permits dragging the discarder’s own cards into fire',()=>{
  const {room}=fixture(),screen=app(room),v=screen.ui.view;
  v.phase='POWER';v.private.power={rank:8,stage:'SELECT'};v.burn={id:'burn-ui',canAttempt:true,endsAt:NOW+1500};
  for(const slot of v.players[0].slots){assert.equal(screen.eligible(v.me,slot),true);assert.equal(makeCardSource(v,'own',{slotId:slot.slotId,version:slot.version},NOW).purpose,'burn');}
});
