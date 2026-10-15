import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { createRoom, RuleError } from '../src/engine.ts';
import { RoomActor } from '../src/room-actor.ts';
import type { Envelope, ReceiptHistory } from '../src/room-actor.ts';
import type { RoomState } from '../src/models.ts';
import { cleanName, validEnvelope } from './schema.mjs';
import { think } from './bots.mjs';

type Row = Record<string, unknown>;
export interface Database {
  prepare(query: string): {
    bind(...values: unknown[]): ReturnType<Database['prepare']>;
    first<T = Row>(): Promise<T | null>;
    all<T = Row>(): Promise<{ results: T[] }>;
    run(): Promise<{ meta: { changes?: number } }>;
  };
}
interface Session {
  token_hash: string; player_id: string; name: string;
  room_code: string | null; client_id: string | null; expires_at: number; last_seen: number;
}
interface StoredRoom {
  state: RoomState; receipts: ReceiptHistory; bots: string[]; members: string[];
  botMemory: [string, { cards: [string, unknown][]; [key: string]: unknown }][];
}
interface RoomRow { code: string; payload: string; version: number; updated_at: number }
const DAY = 86_400_000;
const COOKIE = 'duko_session';
const BOT_NAMES = ['ليان', 'عمر', 'نور', 'سيف', 'جود'];
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const failure = (code: string, status = 400) => Object.assign(new Error(code), { code, status });
const response = (data: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
});
function roomFrom(stored: StoredRoom, code: string) {
  return {
    code, actor: new RoomActor(stored.state, undefined, stored.receipts),
    bots: new Set(stored.bots), members: new Set(stored.members),
    // Bot memory contains authorized observations only, never the secret deck.
    botMemory: new Map(stored.botMemory.map(([id, memory]) => [id, { ...memory, cards: new Map(memory.cards) }])),
  };
}
type LiveRoom = ReturnType<typeof roomFrom>;
function storeRoom(room: LiveRoom): StoredRoom {
  return {
    state: room.actor.serverSnapshot(), receipts: room.actor.receiptHistory(), bots: [...room.bots],
    botMemory: [...room.botMemory].map(([id, memory]) => [id, { ...memory, cards: [...memory.cards] }]),
    members: [...room.members],
  };
}
function projection(room: LiveRoom, playerId: string, now: number) {
  const view = room.actor.view(playerId, now);
  return { ...view, roomCode: room.code, players: view.players.map(p => ({ ...p, bot: room.bots.has(p.id) })) };
}
function roster(room: LiveRoom) {
  return room.actor.serverSnapshot().players.map(({ id, name, ready, connected }) => ({ id, name, ready, connected }));
}
function applyPresence(room: LiveRoom, present: Session[], now: number) {
  const connected = new Set(present.filter(p => p.last_seen > now - 22_000).map(p => p.player_id));
  for (const p of room.actor.serverSnapshot().players) room.actor.setPresence(p.id, room.bots.has(p.id) || connected.has(p.id));
}
function advance(room: LiveRoom, now: number) {
  room.actor.tick(now);
  for (const id of room.bots) {
    const state = room.actor.serverSnapshot();
    if (['LOBBY', 'ROUND_END'].includes(state.phase)) {
      if (!state.players.find(p => p.id === id)?.ready) room.actor.dispatch(id, {
        commandId: randomUUID(), roundId: state.roundId, command: { type: 'READY', ready: true },
      }, now);
    } else {
      const command = think(room, id, now);
      if (command) room.actor.dispatch(id, command, now);
    }
  }
}

/** Database compare-and-swap, not in-memory isolate locks, serializes every room. */
async function editRoom<T>(db: Database, code: string, nowFn: () => number,
  operation: (room: LiveRoom, time: number) => T,
  guard?: { token: string; client?: string | null },
) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const row = await db.prepare('SELECT code,payload,version,updated_at FROM duko_rooms WHERE code=?').bind(code).first<RoomRow>();
    if (!row) throw failure('ROOM_NOT_FOUND', 404);
    const time = nowFn();
    if (time - row.updated_at > 7 * DAY) throw failure('ROOM_NOT_FOUND', 404);
    const stored: StoredRoom = JSON.parse(row.payload);
    const room = roomFrom(stored, code);
    const present = await db.prepare('SELECT player_id,last_seen FROM duko_sessions WHERE room_code=? AND expires_at>?').bind(code, time).all<Session>();
    applyPresence(room, present.results, time);
    room.actor.tick(time);
    const result = operation(room, time);
    advance(room, time);
    const payload = JSON.stringify(storeRoom(room));
    if (payload === row.payload) return { result, room, time, version: row.version };
    let query = 'UPDATE duko_rooms SET payload=?,version=version+1,updated_at=? WHERE code=? AND version=?';
    const values: unknown[] = [payload, time, code, row.version];
    if (guard) {
      query += ' AND EXISTS(SELECT 1 FROM duko_sessions WHERE token_hash=? AND room_code=? AND expires_at>?' + (guard.client ? ' AND client_id=?' : '') + ')';
      values.push(guard.token, code, time);
      if (guard.client) values.push(guard.client);
    }
    const updated = await db.prepare(query).bind(...values).run();
    if (updated.meta.changes === 1) return { result, room, time, version: row.version + 1 };
    // A competing request committed first. Reload the state and durable receipts.
    if (guard) {
      const current = await db.prepare('SELECT room_code,client_id FROM duko_sessions WHERE token_hash=?').bind(guard.token).first<Session>();
      if (current?.room_code !== code) throw failure('ROOM_NOT_FOUND', 404);
      if (guard.client && current.client_id !== guard.client) throw failure('SESSION_REPLACED', 409);
    }
  }
  throw failure('ROOM_BUSY', 409);
}
async function rate(db: Database, key: string, maximum: number, now: number, window = 10_000) {
  const row = await db.prepare('INSERT INTO duko_rates(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END RETURNING count')
    .bind(key, now + window, now, now, now + window).first<{ count: number }>();
  if (row && row.count > maximum) throw failure('RATE_LIMITED', 429);
}
async function sessionFor(request: Request, db: Database, time: number, required = true) {
  const token = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  const session = token && token.length < 150 ? await db.prepare('SELECT * FROM duko_sessions WHERE token_hash=? AND expires_at>?').bind(digest(token), time).first<Session>() : null;
  if (!session && required) throw failure('SESSION_EXPIRED', 401);
  return session || null;
}
async function heartbeat(db: Database, session: Session, time: number) {
  if (time - session.last_seen > 4_000) {
    await db.prepare('UPDATE duko_sessions SET last_seen=? WHERE token_hash=? AND last_seen<?').bind(time, session.token_hash, time - 4_000).run();
    session.last_seen = time;
  }
}
function requireClient(request: Request, session: Session) {
  const client = request.headers.get('x-duko-client');
  if (!client || client !== session.client_id) throw failure('SESSION_REPLACED', 409);
  return client;
}
function requireMember(room: LiveRoom, session: Session) {
  if (!room.members.has(session.player_id)) throw failure('ROOM_NOT_FOUND', 404);
}
function requireHost(room: LiveRoom, session: Session) {
  requireMember(room, session);
  if (room.actor.serverSnapshot().hostId !== session.player_id) throw failure('HOST_ONLY', 403);
}
function removeMember(room: LiveRoom, playerId: string) {
  room.members.delete(playerId);
  const humans = roster(room).filter(p => room.members.has(p.id) && !room.bots.has(p.id));
  if (!humans.length) return;
  let state = room.actor.serverSnapshot();
  if (state.phase === 'ROUND_END') { room.actor.resetLobby(); state = room.actor.serverSnapshot(); }
  if (state.phase === 'LOBBY') room.actor.setLobbyPlayers(roster(room).filter(p => room.members.has(p.id) || room.bots.has(p.id)),
    humans.some(p => p.id === state.hostId) ? state.hostId : humans[0].id);
  else {
    room.actor.setPresence(playerId, false);
    if (state.hostId === playerId) room.actor.transferHost(humans[0].id);
  }
}
function code() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

export async function handleApi(request: Request, db: Database, nowFn: () => number = Date.now): Promise<Response> {
  try {
    if (!db) throw failure('SERVER_UNAVAILABLE', 503);
    const url = new URL(request.url), time = nowFn(), path = url.pathname, method = request.method;
    if (method === 'GET' && path === '/api/health') {
      await db.prepare('SELECT 1 AS ok').first();
      return response({ ok: true, version: '0.5.0', hosted: true });
    }
    let payload: Record<string, unknown> = {};
    if (method === 'POST') {
      if (request.headers.get('origin') !== url.origin) throw failure('BAD_ORIGIN', 403);
      if (!request.headers.get('content-type')?.startsWith('application/json')) throw failure('BAD_REQUEST', 415);
      if (Number(request.headers.get('content-length') || 0) > 8192) throw failure('BAD_REQUEST', 413);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 8192) throw failure('BAD_REQUEST', 413);
      try { payload = JSON.parse(raw); } catch { throw failure('BAD_REQUEST'); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw failure('BAD_REQUEST');
    } else if (method !== 'GET') throw failure('NOT_FOUND', 404);
    const existing = await sessionFor(request, db, time, false);
    if (path === '/api/me' && method === 'GET') return response({
      session: existing ? { playerId: existing.player_id, name: existing.name, roomCode: existing.room_code } : null,
      shareOrigin: url.origin, hosted: true,
    });
    if (path === '/api/session' && method === 'POST') {
      const name = cleanName(payload.name);
      if (!name) throw failure('NAME_REQUIRED');
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      await rate(db, 'session:' + digest(ip), 30, time, 60_000);
      if (existing) {
        if (!existing.room_code) await db.prepare('UPDATE duko_sessions SET name=?,last_seen=? WHERE token_hash=?').bind(name, time, existing.token_hash).run();
        return response({ ok: true, playerId: existing.player_id, name: existing.room_code ? existing.name : name });
      }
      const token = randomBytes(32).toString('base64url'), id = randomUUID();
      await db.prepare('INSERT INTO duko_sessions(token_hash,player_id,name,room_code,client_id,expires_at,last_seen) VALUES(?,?,?,NULL,NULL,?,?)').bind(digest(token), id, name, time + 30 * DAY, time).run();
      await db.prepare('DELETE FROM duko_sessions WHERE token_hash IN(SELECT token_hash FROM duko_sessions WHERE expires_at<? LIMIT 100)').bind(time).run();
      await db.prepare('DELETE FROM duko_rooms WHERE code IN(SELECT code FROM duko_rooms WHERE updated_at<? LIMIT 50)').bind(time - 7 * DAY).run();
      await db.prepare('DELETE FROM duko_rates WHERE key IN(SELECT key FROM duko_rates WHERE expires_at<? LIMIT 100)').bind(time - DAY).run();
      return response({ ok: true, playerId: id, name }, 200, {
        'Set-Cookie': COOKIE + '=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000' + (url.protocol === 'https:' ? '; Secure' : ''),
      });
    }
    const session = existing;
    if (!session) throw failure('SESSION_EXPIRED', 401);
    if (method === 'POST') await rate(db, 'actions:' + session.player_id, 70, time);
    await heartbeat(db, session, time);
    if (path === '/api/rooms/create' && method === 'POST') {
      if (session.room_code) throw failure('ALREADY_IN_ROOM');
      const roomCode = code();
      const claimed = await db.prepare('UPDATE duko_sessions SET room_code=? WHERE token_hash=? AND room_code IS NULL').bind(roomCode, session.token_hash).run();
      if (claimed.meta.changes !== 1) throw failure('ALREADY_IN_ROOM');
      try {
        const state = createRoom(randomUUID(), [{ id: session.player_id, name: session.name }]);
        const initial: StoredRoom = { state, bots: [], botMemory: [], receipts: [], members: [session.player_id] };
        await db.prepare('INSERT INTO duko_rooms(code,payload,version,updated_at) VALUES(?,?,0,?)').bind(roomCode, JSON.stringify(initial), time).run();
      } catch (error) {
        await db.prepare('UPDATE duko_sessions SET room_code=NULL WHERE token_hash=? AND room_code=?').bind(session.token_hash, roomCode).run();
        throw error;
      }
      return response({ ok: true, code: roomCode });
    }
    if (path === '/api/rooms/join' && method === 'POST') {
      const roomCode = typeof payload.code === 'string' ? payload.code.toUpperCase() : '';
      if (!/^[A-Z2-9]{6}$/.test(roomCode)) throw failure('INVALID_ROOM_CODE');
      if (session.room_code && session.room_code !== roomCode) throw failure('ALREADY_IN_ROOM');
      const claim = await db.prepare('UPDATE duko_sessions SET room_code=? WHERE token_hash=? AND (room_code IS NULL OR room_code=?)').bind(roomCode, session.token_hash, roomCode).run();
      if (claim.meta.changes !== 1) throw failure('ALREADY_IN_ROOM');
      try {
        await editRoom(db, roomCode, nowFn, room => {
          if (room.members.has(session.player_id)) return;
          const state = room.actor.serverSnapshot();
          if (state.phase !== 'LOBBY') throw failure('ROUND_IN_PROGRESS');
          if (state.players.length >= 6) throw failure('ROOM_FULL');
          room.actor.setLobbyPlayers([...roster(room), { id: session.player_id, name: session.name, ready: false, connected: true }], state.hostId);
          room.members.add(session.player_id);
        }, { token: session.token_hash });
      } catch (error) {
        if (!session.room_code) await db.prepare('UPDATE duko_sessions SET room_code=NULL WHERE token_hash=? AND room_code=?').bind(session.token_hash, roomCode).run();
        throw error;
      }
      return response({ ok: true, code: roomCode });
    }
    if (path === '/api/rooms/leave' && method === 'POST') {
      const oldCode = session.room_code;
      await db.prepare('UPDATE duko_sessions SET room_code=NULL,client_id=NULL WHERE token_hash=? AND room_code=?').bind(session.token_hash, oldCode).run();
      if (oldCode) {
        try {
          const edited = await editRoom(db, oldCode, nowFn, room => removeMember(room, session.player_id));
          if (!edited.room.members.size) await db.prepare('DELETE FROM duko_rooms WHERE code=? AND version=?').bind(oldCode, edited.version).run();
        } catch (error) { if ((error as { code?: string }).code !== 'ROOM_NOT_FOUND') throw error; }
      }
      return response({ ok: true });
    }
    const roomCode = session.room_code;
    if (!roomCode) throw failure('ROOM_NOT_FOUND', 404);
    if (path === '/api/connect' && method === 'POST') {
      if (typeof payload.clientId !== 'string' || !/^[a-zA-Z0-9_-]{12,100}$/.test(payload.clientId)) throw failure('BAD_REQUEST');
      await db.prepare('UPDATE duko_sessions SET client_id=?,last_seen=? WHERE token_hash=? AND room_code=?').bind(payload.clientId, time, session.token_hash, roomCode).run();
      return response({ ok: true });
    }
    if (path === '/api/state' && method === 'GET') {
      const client = requireClient(request, session);
      const changed = await editRoom(db, roomCode, nowFn, room => requireMember(room, session), { token: session.token_hash, client });
      return response({ type: 'view', view: projection(changed.room, session.player_id, changed.time) });
    }
    if (path === '/api/command' && method === 'POST') {
      const client = requireClient(request, session);
      if (!validEnvelope(payload.envelope)) throw failure('BAD_REQUEST');
      const changed = await editRoom(db, roomCode, nowFn, (room, at) => {
        requireMember(room, session);
        return room.actor.dispatch(session.player_id, payload.envelope as Envelope, at);
      }, { token: session.token_hash, client });
      return response({ receipt: { type: 'receipt', ...changed.result }, view: projection(changed.room, session.player_id, changed.time) });
    }
    if (method === 'POST' && ['/api/rooms/bot', '/api/rooms/remove-bot', '/api/rooms/reset', '/api/rooms/host'].includes(path)) {
      await editRoom(db, roomCode, nowFn, room => {
        requireHost(room, session);
        const state = room.actor.serverSnapshot();
        if (path === '/api/rooms/host') {
          const target = state.players.find(p => p.id === payload.playerId && room.members.has(p.id) && p.connected);
          if (!target || room.bots.has(target.id)) throw failure('BAD_REQUEST');
          room.actor.transferHost(target.id); return;
        }
        if (path === '/api/rooms/reset') {
          room.actor.resetLobby();
          room.actor.setLobbyPlayers(roster(room).filter(p => room.members.has(p.id) || room.bots.has(p.id)), session.player_id); return;
        }
        if (state.phase !== 'LOBBY') throw failure('LOBBY_ONLY');
        if (path === '/api/rooms/bot') {
          if (state.players.length >= 6) throw failure('ROOM_FULL');
          const id = 'bot-' + randomUUID();
          const name = BOT_NAMES.find(n => !state.players.some(p => p.name === n)) || 'لاعب آلي';
          room.bots.add(id);
          room.actor.setLobbyPlayers([...roster(room), { id, name, connected: true, ready: true }], state.hostId);
        } else {
          if (typeof payload.playerId !== 'string' || !room.bots.has(payload.playerId)) throw failure('BAD_REQUEST');
          room.bots.delete(payload.playerId); room.botMemory.delete(payload.playerId);
          room.actor.setLobbyPlayers(roster(room).filter(p => p.id !== payload.playerId), state.hostId);
        }
      }, { token: session.token_hash });
      return response({ ok: true });
    }
    throw failure('NOT_FOUND', 404);
  } catch (error) {
    if (error instanceof RuleError) return response({ ok: false, code: error.code }, 400);
    const issue = error as { status?: number; code?: string };
    if (!issue.status) console.error('DUKO request failed', error instanceof Error ? error.message : 'unknown');
    return response({ ok: false, code: issue.status ? issue.code : 'SERVER_ERROR' }, issue.status || 500);
  }
}
