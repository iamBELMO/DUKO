import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCardSource, cardSourceValid, planCardDrop } from '../public/card-gestures.js';
import { createRoom, assertInvariants } from '../src/engine.ts';
import { RoomActor } from '../src/room-actor.ts';

const NOW=6001;
function table(){
  let n=0;
  const entropy={id:()=>`gesture-${++n}`,int:max=>(n++*17)%max};
  const room=new RoomActor(createRoom('gesture-room',[{id:'a',name:'A'},{id:'b',name:'B'}]),entropy);
  let commandId=0;
  const command=(id,type,fields={},time=NOW)=>room.dispatch(id,{commandId:`move-${++commandId}`,roundId:room.view(id,time).roundId,command:{type,actionId:room.view(id,time).private.actionId,...fields}},time);
  command('a','READY',{ready:true},0);command('b','READY',{ready:true},0);command('a','START',{},0);room.tick(NOW);
  return {room,command};
}
const ref=(v,index=0)=>{const s=v.players.find(p=>p.id===v.me).slots[index];return {slotId:s.slotId,version:s.version};};
const target=(v,index=0)=>({kind:'own',owner:v.me,ref:ref(v,index)});

test('drawn-card drag replaces any occupied own slot through the real engine',()=>{
  for(let index=0;index<4;index++){
    const {room,command}=table();command('a','DRAW_DECK');
    const v=room.view('a',NOW),before=room.serverSnapshot();
    const source=makeCardSource(v,'drawn',null,NOW);
    const move=planCardDrop(v,source,target(v,index),NOW);
    assert.equal(move.type,'REPLACE_DRAWN');
    assert.equal(command('a',move.type,move.fields).ok,true);
    const after=room.serverSnapshot();
    assert.equal(after.players[0].slots[index].card.id,before.drawn.card.id);
    assert.equal(after.discard.at(-1).id,before.players[0].slots[index].card.id);
    assert.equal(after.players[0].slots.length,4);assertInvariants(after);
    assert.equal(room.view('b',NOW).private.drawn,null);
  }
});

test('dragging an own card to fire while holding a draw replaces it atomically',()=>{
  const {room,command}=table();command('a','DRAW_DECK');
  const v=room.view('a',NOW),source=makeCardSource(v,'own',ref(v,2),NOW);
  const move=planCardDrop(v,source,{kind:'fire'},NOW);
  assert.deepEqual(move,{type:'REPLACE_DRAWN',fields:{own:ref(v,2)}});
  assert.equal(command('a',move.type,move.fields).ok,true);assertInvariants(room.serverSnapshot());
});

test('drawn card can be dropped into fire without selecting an own slot',()=>{
  const {room,command}=table();command('a','DRAW_DECK');
  const v=room.view('a',NOW),source=makeCardSource(v,'drawn',null,NOW);
  const move=planCardDrop(v,source,{kind:'fire'},NOW);
  assert.deepEqual(move,{type:'DISCARD_DRAWN',fields:{}});
  assert.equal(command('a',move.type,move.fields).ok,true);assert.equal(room.serverSnapshot().drawn,null);
});

test('fire-card drag swaps only into an occupied own slot',()=>{
  const {room,command}=table(),v=room.view('a',NOW),source=makeCardSource(v,'fire',null,NOW);
  assert.equal(planCardDrop(v,source,{...target(v),owner:'b'},NOW),null);
  assert.equal(planCardDrop(v,source,{kind:'fire'},NOW),null);
  assert.equal(planCardDrop(v,source,{...target(v),ref:{slotId:'missing',version:0}},NOW),null);
  const before=room.serverSnapshot(),move=planCardDrop(v,source,target(v,1),NOW);
  assert.equal(move.type,'TAKE_FIRE');assert.equal(command('a',move.type,move.fields).ok,true);
  assert.equal(room.serverSnapshot().players[0].slots[1].card.id,before.discard.at(-1).id);
});

test('a gesture cannot cross rounds, turns, slot versions, or player ownership',()=>{
  const {room,command}=table();command('a','DRAW_DECK');const v=room.view('a',NOW);
  const source=makeCardSource(v,'drawn',null,NOW);
  assert.equal(planCardDrop({...v,roundId:'another'},source,target(v),NOW),null);
  assert.equal(planCardDrop({...v,private:{...v.private,actionId:'another'}},source,target(v),NOW),null);
  assert.equal(planCardDrop({...v,turnPlayerId:'b'},source,target(v),NOW),null);
  assert.equal(planCardDrop(v,source,{...target(v),ref:{...ref(v),version:999}},NOW),null);
  assert.equal(makeCardSource(v,'own',{slotId:v.players[1].slots[0].slotId,version:0},NOW),null);
  assert.equal(makeCardSource({...v,phase:'ROUND_END'},'drawn',null,NOW),null);
});

test('burn drags retain the exact burn window and reject expired or replaced windows',()=>{
  const {room,command}=table();command('a','DRAW_DECK');command('a','DISCARD_DRAWN');
  const v=room.view('b',NOW),source=makeCardSource(v,'own',ref(v),NOW);
  assert.ok(source);assert.equal(source.purpose,'burn');
  assert.equal(planCardDrop(v,source,{kind:'fire'},NOW).type,'BURN');
  assert.equal(cardSourceValid(v,source,v.burn.endsAt),false);
  assert.equal(planCardDrop({...v,burn:{...v.burn,id:'new-burn'}},source,{kind:'fire'},NOW),null);
  assert.equal(planCardDrop({...v,burn:{...v.burn,canAttempt:false}},source,{kind:'fire'},NOW),null);
  assert.equal(planCardDrop(v,source,target(v,1),NOW),null);
});

test('burn mismatch is judged by the server and adds exactly one hidden penalty',()=>{
  const {room,command}=table();command('a','DRAW_DECK');command('a','DISCARD_DRAWN');
  const state=room.serverSnapshot(),v=room.view('b',NOW);
  const index=state.players[1].slots.findIndex(s=>s.card.rank!==state.burn.target.rank);
  assert.ok(index>=0);
  const source=makeCardSource(v,'own',ref(v,index),NOW),move=planCardDrop(v,source,{kind:'fire'},NOW);
  const receipt=command('b',move.type,move.fields);
  assert.equal(receipt.code,'BURN_PENALTY');
  const after=room.view('b',NOW);
  assert.equal(after.players[1].slots.length,5);assert.equal(after.players[1].slots[0].face,null);
  assert.equal(cardSourceValid(after,source,NOW),false);assertInvariants(room.serverSnapshot());
});

test('cancelled or off-table drops produce no command and expose no card identity',()=>{
  const {room,command}=table();command('a','DRAW_DECK');const v=room.view('a',NOW);
  const source=makeCardSource(v,'own',ref(v),NOW);
  assert.equal(planCardDrop(v,source,null,NOW),null);
  assert.equal(planCardDrop(v,source,{kind:'deck'},NOW),null);
  assert.equal('face' in source,false);assert.equal('card' in source,false);
});
