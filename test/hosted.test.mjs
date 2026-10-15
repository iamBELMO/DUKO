import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { handleApi } from '../lib/hosted.ts';
import { makeDeck } from '../src/cards.ts';
import { assertInvariants } from '../src/engine.ts';

function setup(){
  const sqlite=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  const db={prepare(sql){let args=[];return {
    bind(...values){args=values;return this;},
    async first(){await Promise.resolve();return sqlite.prepare(sql).get(...args)||null;},
    async all(){await Promise.resolve();return {results:sqlite.prepare(sql).all(...args)};},
    async run(){await Promise.resolve();return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}
  };}};
  let now=1_792_000_000_000;
  const origin='https://duko.test';
  async function request(path,body,person,extra={}){
    const result=await handleApi(new Request(origin+path,{
      method:body===undefined?'GET':'POST',
      headers:{...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...(person?{Cookie:person.cookie,'X-Duko-Client':person.client}:{}),...extra},
      body:body===undefined?undefined:JSON.stringify(body),
    }),db,()=>now);
    return {status:result.status,data:await result.json(),cookie:result.headers.get('set-cookie')?.split(';')[0]};
  }
  async function person(name){
    const result=await request('/api/session',{name});assert.equal(result.status,200);
    const p={id:result.data.playerId,cookie:result.cookie,client:randomUUID(),view:null};
    p.post=async(path,body={})=>request(path,body,p);
    p.connect=async()=>{const r=await p.post('/api/connect',{clientId:p.client});assert.equal(r.status,200);return p.refresh();};
    p.refresh=async()=>{const r=await request('/api/state',undefined,p);assert.equal(r.status,200,JSON.stringify(r.data));p.view=r.data.view;return p.view;};
    p.envelope=(type,fields={})=>({commandId:randomUUID(),roundId:p.view.roundId,command:{type,...(!['READY','START','BURN'].includes(type)?{actionId:p.view.private.actionId}:{}),...fields}});
    p.send=async(type,fields={},envelope=p.envelope(type,fields))=>{const r=await p.post('/api/command',{envelope});assert.equal(r.status,200,JSON.stringify(r.data));p.view=r.data.view;return r.data.receipt;};
    return p;
  }
  async function table(count){
    const players=[];for(let i=0;i<count;i++)players.push(await person('player-'+i));
    const made=await players[0].post('/api/rooms/create');const code=made.data.code;
    for(const p of players.slice(1))assert.equal((await p.post('/api/rooms/join',{code})).status,200);
    for(const p of players){await p.connect();await p.send('READY',{ready:true});}
    await players[0].refresh();assert.equal((await players[0].send('START')).ok,true);
    for(const p of players)await p.refresh();
    return {players,code};
  }
  return {db,sqlite,request,person,table,time:()=>now,advance:ms=>now+=ms,close:()=>sqlite.close()};
}

test('hosted privacy, durable duplicate receipts, lost-tab rejection, and a full Cabo round',async()=>{
  const app=setup();try{
    const {players:[a,b]}=await app.table(2);
    for(const p of [a,b]){
      assert.deepEqual(p.view.players.find(x=>x.id===p.id).slots.map(s=>!!s.face),[false,false,true,true]);
      assert.ok(p.view.players.filter(x=>x.id!==p.id).every(x=>x.slots.every(s=>s.face===null)));
      assert.equal('deck'in p.view,false);assert.equal('receipts'in p.view,false);
    }
    app.advance(6001);await a.refresh();await b.refresh();
    const active=a.view.turnPlayerId===a.id?a:b,other=active===a?b:a;
    const before=active.view.deckCount,env=active.envelope('DRAW_DECK');
    const draws=await Promise.all([active.send(null,{},env),active.send(null,{},env),active.send(null,{},env)]);
    assert.ok(draws.every(r=>r.ok));await active.refresh();await other.refresh();
    assert.equal(active.view.deckCount,before-1);assert.ok(active.view.private.drawn);assert.equal(other.view.private.drawn,null);
    const oldClient=active.client;active.client=randomUUID();await active.connect();
    assert.equal((await app.request('/api/state',undefined,{...active,client:oldClient})).data.code,'SESSION_REPLACED');
    assert.equal((await active.send(null,{},env)).ok,true);assert.equal(active.view.deckCount,before-1);
    await active.send('DISCARD_DRAWN');if(active.view.phase==='POWER')await active.send('SKIP_POWER');
    app.advance(1501);await other.refresh();assert.equal(other.view.turnPlayerId,other.id);
    assert.equal((await other.send('CABO')).ok,true);await active.refresh();
    await active.send('DRAW_DECK');await active.send('DISCARD_DRAWN');
    if(active.view.phase==='POWER')await active.send('SKIP_POWER');
    app.advance(1501);await active.refresh();await other.refresh();
    assert.equal(active.view.phase,'ROUND_END');assert.equal(other.view.result.reason,'CABO');
    assert.equal(active.view.result.scores.length,2);
    const bad=await app.request('/api/session',{name:'csrf'},null,{Origin:'https://evil.test'});assert.equal(bad.status,403);
  }finally{app.close();}
});

test('concurrent joins enforce capacity and roll back unsuccessful membership claims',async()=>{
  const app=setup();try{
    const host=await app.person('host');const made=await host.post('/api/rooms/create');
    const guests=[];for(let i=0;i<7;i++)guests.push(await app.person('guest'+i));
    const results=await Promise.all(guests.map(p=>p.post('/api/rooms/join',{code:made.data.code})));
    assert.equal(results.filter(r=>r.status===200).length,5);
    assert.equal(results.filter(r=>r.data.code==='ROOM_FULL').length,2);
    await host.connect();assert.equal(host.view.players.length,6);
    for(let i=0;i<guests.length;i++)if(results[i].status!==200){
      const me=await app.request('/api/me',undefined,guests[i]);assert.equal(me.data.session.roomCode,null);
    }
    assert.equal(new Set(host.view.players.map(p=>p.id)).size,6);
  }finally{app.close();}
});

test('hosted fire draw is private and idempotent, then returns without firing a power',async()=>{
  const app=setup();try{
    const {players:[a,b],code}=await app.table(2);app.advance(6001);await a.refresh();await b.refresh();
    const actor=a.view.turnPlayerId===a.id?a:b,other=actor===a?b:a;
    const face=actor.view.fireTop,before=actor.view.deckCount,envelope=actor.envelope('DRAW_FIRE');
    const results=await Promise.all([actor.send(null,{},envelope),actor.send(null,{},envelope)]);
    assert.ok(results.every(r=>r.ok));await actor.refresh();await other.refresh();
    assert.deepEqual(actor.view.private.drawn,face);assert.equal(actor.view.private.drawnSource,'fire');
    assert.equal(actor.view.fireCount,0);assert.equal(actor.view.deckCount,before);
    assert.equal(other.view.private.drawn,null);assert.equal(other.view.private.drawnSource,null);
    assert.equal((await other.send('DRAW_FIRE',{actionId:actor.view.private.actionId})).ok,false);
    assert.equal((await actor.send('DISCARD_DRAWN')).ok,true);assert.equal(actor.view.activePower,null);
    assert.deepEqual(actor.view.fireTop,face);assert.equal(actor.view.burn.canAttempt,true);
    assertInvariants(JSON.parse(app.sqlite.prepare('SELECT payload FROM duko_rooms WHERE code=?').get(code).payload).state);
  }finally{app.close();}
});

test('database race: exactly one correct burn wins, late contender receives no penalty',async()=>{
  const app=setup();try{
    const {players:[a,b,c],code}=await app.table(3);
    app.advance(6001);await a.refresh();
    const row=app.sqlite.prepare('SELECT payload FROM duko_rooms WHERE code=?').get(code);
    const stored=JSON.parse(row.payload),state=stored.state,pool=makeDeck();
    const take=(rank,suit)=>{const i=pool.findIndex(c=>c.rank===rank&&(!suit||c.suit===suit));assert.ok(i>=0);return pool.splice(i,1)[0];};
    state.actorIndex=0;state.actionId=randomUUID();state.turnDeadlineAt=app.time()+30000;
    const picks=[[2,3,4,6],[5,7,8,9],[5,10,'J','Q']];
    state.players.forEach((p,i)=>p.slots.forEach((s,j)=>{s.card=take(picks[i][j]);s.version++;}));
    const next=take(5);state.discard=[take('K','spades')];state.deck=[...pool,next];state.grants=[];state.revision++;
    assertInvariants(state);
    app.sqlite.prepare('UPDATE duko_rooms SET payload=?,version=version+1 WHERE code=?').run(JSON.stringify(stored),code);
    await a.refresh();await a.send('DRAW_DECK');await a.send('DISCARD_DRAWN');await b.refresh();await c.refresh();
    const envelope=p=>{const own=p.view.players.find(x=>x.id===p.id).slots[0];return p.envelope('BURN',{burnId:p.view.burn.id,own:{slotId:own.slotId,version:own.version}});};
    const results=await Promise.all([b.send(null,{},envelope(b)),c.send(null,{},envelope(c))]);
    assert.equal(results.filter(r=>r.code==='BURN_ACCEPTED').length,1);
    assert.equal(results.filter(r=>r.code==='STALE_BURN').length,1);
    await b.refresh();const sizes=b.view.players.filter(p=>p.id!==a.id).map(p=>p.slots.filter(s=>s.occupied).length).sort();
    assert.deepEqual(sizes,[3,4]);
    const loser=results[0].code==='STALE_BURN'?b:c;await loser.refresh();
    assert.equal((await loser.send(null,{},envelope(loser))).code,'BURN_ACCEPTED');
    await b.refresh();assert.deepEqual(b.view.players.filter(p=>p.id!==a.id).map(p=>p.slots.filter(s=>s.occupied).length),[3,3]);
    assert.equal(b.view.burn.sequence,2);
    assertInvariants(JSON.parse(app.sqlite.prepare('SELECT payload FROM duko_rooms WHERE code=?').get(code).payload).state);
  }finally{app.close();}
});

test('host transfer, room isolation, and bot memory survive separate requests',async()=>{
  const app=setup();try{
    const a=await app.person('laptop'),b=await app.person('phone'),outsider=await app.person('other');
    const {data:{code}}=await a.post('/api/rooms/create');await b.post('/api/rooms/join',{code});
    await outsider.post('/api/rooms/create');await a.connect();await b.connect();await outsider.connect();
    assert.equal((await b.post('/api/rooms/host',{playerId:b.id})).status,403);
    assert.equal((await a.post('/api/rooms/host',{playerId:b.id})).status,200);
    await b.refresh();assert.equal(b.view.hostId,b.id);assert.equal(outsider.view.players.length,1);
    assert.equal((await b.post('/api/rooms/bot')).status,200);await b.refresh();assert.equal(b.view.players.filter(p=>p.bot).length,1);
    await a.send('READY',{ready:true});await b.send('READY',{ready:true});await b.send('START');
    // Poll the server clock with entirely new actors each request; bots retain their memory.
    for(let i=0;i<25;i++){app.advance(500);await a.refresh();await b.refresh();}
    const saved=JSON.parse(app.sqlite.prepare('SELECT payload FROM duko_rooms WHERE code=?').get(code).payload);
    assert.ok(saved.botMemory.length>0);assert.ok(saved.botMemory[0][1].cards.length>=2);
    assert.equal('botMemory'in b.view,false);
    const malformed=await b.post('/api/command',{envelope:null});assert.equal(malformed.status,400);
    assert.equal((await a.post('/api/rooms/leave')).status,200);
  }finally{app.close();}
});
