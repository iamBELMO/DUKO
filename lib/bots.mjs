import { randomUUID } from 'node:crypto';
import { scoreCard } from '../src/cards.ts';

// Bots learn from EXACTLY the same projections as humans. No serverSnapshot here.
export function think(room, playerId, now) {
  const actor = room.actor;
  const v = actor.view(playerId, now);
  let memory = room.botMemory.get(playerId);
  if (!memory || memory.roundId !== v.roundId) {
    memory = { roundId: v.roundId, cards: new Map(), due: now + 500, turns: 0, turnId: null };
    room.botMemory.set(playerId, memory);
  }
  for (const p of v.players) for (const s of p.slots) {
    const old = memory.cards.get(s.slotId);
    if (!s.occupied || (old && old.version !== s.version)) memory.cards.delete(s.slotId);
    if (s.face) memory.cards.set(s.slotId, { version: s.version, face: s.face });
  }
  if (now < memory.due) return null;
  memory.due = now + 650 + Math.random() * 450;
  const me = v.players.find(p => p.id === playerId);
  const own = me.slots.filter(s => s.occupied);
  const others = v.players.filter(p => p.id !== playerId).flatMap(p => p.slots.filter(s => s.occupied).map(s => ({ ...s, playerId: p.id })));
  const reference = s => ({ slotId: s.slotId, version: s.version });
  const target = s => ({ ...reference(s), playerId: s.playerId });
  const known = s => memory.cards.get(s.slotId)?.face;
  const value = s => known(s) ? scoreCard(known(s)) : 6;
  const worst = [...own].sort((a,b) => value(b) - value(a))[0];
  const unknown = own.find(s => !known(s));
  const command = (type, fields = {}) => ({ commandId: randomUUID(), roundId: v.roundId, command: { type, ...fields } });
  const turn = (type, fields = {}) => command(type, { actionId: v.private.actionId, ...fields });
  if (v.burn?.canAttempt && v.fireTop) {
    const matching = own.find(s => known(s)?.rank === v.fireTop.rank);
    if (matching) return command('BURN', { burnId: v.burn.id, own: reference(matching) });
  }
  if (v.turnPlayerId !== playerId) return null;
  if (v.phase === 'TURN_START') {
    if (memory.turnId !== v.private.actionId) { memory.turns++; memory.turnId = v.private.actionId; }
    if (!v.cabo && (!own.length || (memory.turns >= 3 && own.every(known) && own.reduce((s,c) => s + value(c), 0) <= 9) || memory.turns >= 9)) return turn('CABO');
    if (v.fireTop && worst && scoreCard(v.fireTop) < value(worst) - 2) return turn('TAKE_FIRE', { own: reference(worst) });
    return turn('DRAW_DECK');
  }
  if (v.phase === 'DRAWN') {
    const incoming = v.private.drawn;
    if (incoming?.rank === 7 && unknown) return turn('DISCARD_DRAWN');
    if (incoming && worst && scoreCard(incoming) < value(worst)) return turn('REPLACE_DRAWN', { own: reference(worst) });
    return turn('DISCARD_DRAWN');
  }
  if (v.phase !== 'POWER') return null;
  const power = v.private.power;
  if (power.rank === 7 && own.length) return turn('POWER_7', { own: reference(unknown || worst) });
  const other = [...others].sort((a,b) => value(a) - value(b))[0];
  if (power.rank === 8 && other) return turn('POWER_8', { target: target(other) });
  if (power.rank === 9 && worst && other) return turn('POWER_9', { own: reference(worst), target: target(other) });
  if (power.rank === 10) {
    const inspected = others.find(s => s.slotId === power.inspected?.slotId && s.version === power.inspected?.version);
    if ((power.stage === 'SELECT' || !inspected) && other) return turn('POWER_10_PEEK', { target: target(other) });
    if (inspected && worst && value(inspected) < value(worst)) return turn('POWER_10_SWAP', { own: reference(worst) });
  }
  return turn('SKIP_POWER');
}
