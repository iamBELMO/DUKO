import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { createApiClient, roomLink } from '../public/api-client.js';

const pageUrl = 'https://iambelmo.github.io/DUKO/?room=ABC234';
const apiOrigin = 'https://duko-club-belmo.max083522.chatgpt.site';
const memory = () => { const values = new Map(); return { getItem:key=>values.get(key), setItem:(key,value)=>values.set(key,value), removeItem:key=>values.delete(key), values }; };

test('Pages invitations and leave URLs preserve the repository path', () => {
  assert.equal(roomLink(pageUrl, 'DEF567'), 'https://iambelmo.github.io/DUKO/?room=DEF567');
  assert.equal(roomLink(pageUrl), 'https://iambelmo.github.io/DUKO/');
  assert.equal(roomLink('https://duko.test/', 'ABC234'), 'https://duko.test/?room=ABC234');
});

test('Pages transport retains a tab session across reloads without cookies or exposing its token', async () => {
  const token = 't'.repeat(43), storage = memory(), calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url, options});
    return Response.json(url.endsWith('/api/session') ? {ok:true, playerId:'p', sessionToken:token} : {session:{playerId:'p'}});
  };
  const client = createApiClient({clientId:'c', pageUrl, apiOrigin, storage, fetchImpl});
  const result = await client.request('/api/session', {name:'محمد'});
  assert.equal('sessionToken' in result.data, false);
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.mode, 'cors');
  assert.equal(calls[0].options.redirect, 'error');
  const resumed = createApiClient({clientId:'d', pageUrl, apiOrigin, storage, fetchImpl});
  await resumed.request('/api/me');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer ' + token);
  assert.equal(calls[1].url, apiOrigin + '/api/me');
  assert.ok(!calls[1].url.includes(token));
  await assert.rejects(resumed.request('//evil.test/api/me'));
  assert.equal(calls.length, 2);
});

test('same-origin players keep cookie authentication and never consume stored Pages credentials', async () => {
  const storage = {getItem(){throw new Error('Do not read cross-origin credentials');}}, calls=[];
  const client=createApiClient({clientId:'c',pageUrl:apiOrigin+'/',storage,fetchImpl:async(url,options)=>{calls.push(options);return Response.json({session:null});}});
  await client.request('/api/me');
  assert.equal(calls[0].credentials, 'same-origin');
  assert.equal(calls[0].headers.Authorization, undefined);
});

test('expired Pages credentials are cleared and blocked storage falls back to memory', async () => {
  const storage=memory(), calls=[],token='x'.repeat(43);
  const fetchImpl=async(url, options)=>{calls.push(options);return url.endsWith('/api/session')?Response.json({sessionToken:token}):Response.json({code:'SESSION_EXPIRED'},{status:401});};
  const client=createApiClient({clientId:'c',pageUrl,apiOrigin,storage,fetchImpl});
  await client.request('/api/session',{});assert.equal(storage.values.size,1);
  await client.request('/api/state');assert.equal(storage.values.size,0);
  await client.request('/api/me');assert.equal(calls.at(-1).headers.Authorization,undefined);
  const unavailable={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
  const fallback=createApiClient({clientId:'c',pageUrl,apiOrigin,storage:unavailable,fetchImpl});
  await fallback.request('/api/session',{});await fallback.request('/api/state');
  assert.equal(calls.at(-1).headers.Authorization,'Bearer '+token);
});

test('Pages entry point loads the real game with repository-relative files and a scoped manifest', () => {
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.ok(html.includes('name="duko-api-origin" content="'+apiOrigin+'"'));
  assert.ok(html.includes('src="./public/app.js"'));
  assert.ok(html.includes('dir="rtl"'));
  assert.ok(!html.includes('http-equiv="refresh"'));
  for(const match of html.matchAll(/(?:href|src)="([^\"]+)"/g)){
    assert.ok(match[1].startsWith('./'));
    assert.ok(existsSync(new URL('../'+match[1],import.meta.url)),match[1]);
  }
  const manifest=JSON.parse(readFileSync(new URL('../manifest.webmanifest',import.meta.url)));
  assert.equal(manifest.scope,'./');assert.equal(manifest.start_url,'./');
  for(const icon of manifest.icons)assert.ok(existsSync(new URL('../'+icon.src,import.meta.url)));
});

test('service worker caches only its own public shell, never API calls or another project', () => {
  for(const pages of [false,true]){
    const handlers={},home=pages?'https://iambelmo.github.io/DUKO/':apiOrigin+'/', cached=[];
    const context=vm.createContext({URL,Response,encodeURIComponent,
      self:{registration:{scope:home},location:new URL(home+(pages?'pages-sw.js':'sw.js')),DUKO_ASSET_DIRECTORY:pages?'./public/':'./',addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting(){},clients:{claim(){}}},
      caches:{open:async()=>({addAll:async assets=>cached.push(...assets),put(){}}),match:async()=>null},
      fetch:async()=>new Response('shell'),
    });
    vm.runInContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),context);
    let installed;handlers.install({waitUntil:p=>installed=p});
    // The handler must decline requests before touching the network or caches.
    const check=url=>{let handled=false;handlers.fetch({request:{url,method:'GET'},respondWith(){handled=true;}});return handled;};
    assert.equal(check(apiOrigin+'/api/state'),false);
    assert.equal(check('https://iambelmo.github.io/corefix/'),false);
    assert.equal(check(home+(pages?'public/':'')+'app.js'),true);
    assert.ok(installed instanceof Promise || typeof installed?.then==='function');
  }
});
