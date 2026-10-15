import { burnMatches, makeDeck, scoreCard, secureEntropy, shuffle } from "./cards.ts";
import type { Card, Command, Entropy, Phase, Player, RoomState, Rules, Slot, SlotRef, TargetRef } from "./models.ts";

export const DEFAULT_RULES: Rules = {
  initialPeekMs: 6000, powerPeekMs: 3000, burnWindowMs: 1500, turnMs: 30000,
  burnMatch: "rank", discarderCanBurn: true, chainBurns: true,
};
export class RuleError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function requireRule(condition: unknown, code: string): asserts condition {
  if (!condition) throw new RuleError(code);
}
function player(s: RoomState, id: string): Player {
  const p = s.players.find(p => p.id === id);
  requireRule(p, "NOT_A_MEMBER");
  return p;
}
function slot(s: RoomState, playerId: string, ref: SlotRef): Slot & { card: Card } {
  const found = player(s, playerId).slots.find(x => x.id === ref.slotId);
  requireRule(found && found.card && found.version === ref.version, "STALE_SLOT");
  return found as Slot & { card: Card };
}
function otherSlot(s: RoomState, actorId: string, ref: TargetRef) {
  requireRule(ref.playerId !== actorId, "TARGET_MUST_BE_ANOTHER_PLAYER");
  return slot(s, ref.playerId, ref);
}
function writeSlot(s: RoomState, target: Slot, card: Card | null) {
  target.card = card;
  target.version++;
  s.grants = s.grants.filter(g => g.slotId !== target.id);
}
function swapSlots(s: RoomState, a: Slot, b: Slot) {
  const card = a.card;
  writeSlot(s, a, b.card);
  writeSlot(s, b, card);
}
function reveal(s: RoomState, viewerId: string, ownerId: string, target: Slot, now: number) {
  s.grants = s.grants.filter(g => !(g.viewerId === viewerId && g.slotId === target.id));
  s.grants.push({ viewerId, playerId: ownerId, slotId: target.id, version: target.version, expiresAt: now + s.rules.powerPeekMs });
}
function setAction(s: RoomState, entropy: Entropy) { s.actionId = entropy.id(); }
function needTurn(s: RoomState, actorId: string, actionId: string, phase: Phase, now: number) {
  requireRule(s.players[s.actorIndex]?.id === actorId, "NOT_YOUR_TURN");
  requireRule(s.phase === phase, "WRONG_PHASE");
  requireRule(s.actionId === actionId, "STALE_ACTION");
  requireRule(s.turnDeadlineAt !== null && now < s.turnDeadlineAt, "TURN_EXPIRED");
}
function needPower(s: RoomState, rank: number) {
  requireRule(s.power?.rank === rank, "WRONG_POWER");
  return s.power!;
}

// Called by the room/lobby service after assigning authenticated member ids.
// Membership is immutable during a round. Reconnection uses the same member id.
export function createRoom(id: string, roster: { id: string; name: string }[], rules: Partial<Rules> = {}): RoomState {
  requireRule(roster.length >= 1 && roster.length <= 6, "PLAYER_COUNT");
  requireRule(new Set(roster.map(p => p.id)).size === roster.length, "DUPLICATE_PLAYER");
  const merged = { ...DEFAULT_RULES, ...rules };
  for (const ms of [merged.initialPeekMs, merged.powerPeekMs, merged.burnWindowMs, merged.turnMs]) {
    requireRule(Number.isFinite(ms) && ms > 0, "INVALID_DURATION");
  }
  requireRule(["rank", "rank-and-color", "rank-and-suit"].includes(merged.burnMatch), "INVALID_MATCH_RULE");
  return {
    id, hostId: roster[0]!.id, rules: merged, phase: "LOBBY", revision: 0, roundId: null,
    players: roster.map((p, seat) => ({ ...p, seat, connected: true, ready: false, slots: [] })),
    deck: [], discard: [], actorIndex: 0, actionId: null, turnDeadlineAt: null,
    previewEndsAt: null, drawn: null, power: null, burn: null, cabo: null, grants: [], result: null,
  };
}
function startRound(s: RoomState, now: number, entropy: Entropy) {
  requireRule(s.players.length >= 2 && s.players.length <= 6, "PLAYER_COUNT");
  requireRule(s.players.every(p => p.ready && p.connected), "PLAYERS_NOT_READY");
  // Existing saved rounds finish with their rules. Their next round adopts Duko.
  if (s.rules.chainBurns === undefined) s.rules = { ...s.rules, discarderCanBurn: true, chainBurns: true };
  s.roundId = entropy.id();
  s.deck = shuffle(makeDeck(entropy), entropy);
  s.discard = [];
  s.drawn = s.power = s.burn = s.cabo = s.result = null;
  s.grants = [];
  s.actionId = s.turnDeadlineAt = null;
  s.previewEndsAt = now + s.rules.initialPeekMs;
  for (const p of s.players) p.slots = Array.from({ length: 4 }, () => ({ id: entropy.id(), version: 0, card: null }));
  // Deal in rounds. Array indices 2 and 3 are physically the rightmost two.
  for (let i = 0; i < 4; i++) for (const p of s.players) p.slots[i]!.card = s.deck.pop()!;
  for (const p of s.players) for (const x of p.slots.slice(2)) {
    s.grants.push({ viewerId: p.id, playerId: p.id, slotId: x.id, version: x.version, expiresAt: s.previewEndsAt });
  }
  s.discard.push(s.deck.pop()!); // Initial face-up card: no power and no burn window.
  s.actorIndex = entropy.int(s.players.length);
  s.phase = "INITIAL_PEEK";
}
function beginTurn(s: RoomState, now: number, entropy: Entropy) {
  s.phase = "TURN_START";
  s.turnDeadlineAt = now + s.rules.turnMs;
  s.drawn = s.power = null;
  setAction(s, entropy);
}
function finishRound(s: RoomState, reason: "CABO" | "DECK_EXHAUSTED") {
  // A merely drawn, not exchanged, card never belongs to the player's board.
  if (s.drawn) s.discard.push(s.drawn.card);
  const scores = s.players.map(p => ({ playerId: p.id, total: p.slots.reduce((sum, x) => sum + (x.card ? scoreCard(x.card) : 0), 0) }));
  const lowest = Math.min(...scores.map(x => x.total));
  s.result = { reason, scores, winners: scores.filter(x => x.total === lowest).map(x => x.playerId) };
  s.phase = "ROUND_END";
  s.drawn = s.power = s.burn = null;
  s.actionId = s.turnDeadlineAt = s.previewEndsAt = null;
  s.grants = [];
  for (const p of s.players) p.ready = false;
}
function advanceTurn(s: RoomState, now: number, entropy: Entropy) {
  requireRule(!s.burn && !s.power && !s.drawn, "INTERNAL_PENDING_ACTION");
  if (s.cabo) {
    const nextId = s.cabo.remainingPlayerIds.shift();
    if (!nextId) { finishRound(s, "CABO"); return; }
    s.actorIndex = s.players.findIndex(p => p.id === nextId);
  } else {
    s.actorIndex = (s.actorIndex + 1) % s.players.length;
  }
  beginTurn(s, now, entropy);
}
function endDecision(s: RoomState, now: number, entropy: Entropy) {
  s.power = null;
  s.actionId = null;
  s.phase = "WAIT_BURN";
  if (!s.burn) advanceTurn(s, now, entropy);
}
function takeDeck(s: RoomState, entropy: Entropy): Card | null {
  if (!s.deck.length && s.discard.length > 1) {
    const top = s.discard.pop()!;
    s.deck = shuffle(s.discard, entropy);
    s.discard = [top];
  }
  return s.deck.pop() ?? null;
}
function drawDeck(s: RoomState, actorId: string, entropy: Entropy) {
  const card = takeDeck(s, entropy);
  if (!card) { finishRound(s, "DECK_EXHAUSTED"); return; }
  s.drawn = { playerId: actorId, card, source: "deck" };
  s.phase = "DRAWN";
  setAction(s, entropy);
}
function drawFire(s: RoomState, actorId: string, entropy: Entropy) {
  requireRule(s.discard.length > 0 && !s.burn, "FIRE_UNAVAILABLE");
  s.drawn = { playerId: actorId, card: s.discard.pop()!, source: "fire" };
  s.phase = "DRAWN";
  setAction(s, entropy);
}
function putInFire(s: RoomState, card: Card, actorId: string, directFromDeck: boolean, now: number, entropy: Entropy) {
  s.discard.push(card);
  const id = entropy.id();
  s.burn = { id, chainId: id, sequence: 0, target: card, discarderId: actorId, endsAt: now + s.rules.burnWindowMs, attemptedBy: [] };
  if (directFromDeck && (card.rank === 7 || card.rank === 8 || card.rank === 9 || card.rank === 10)) {
    s.power = { rank: card.rank, actorId, stage: "SELECT", inspected: null };
    s.phase = "POWER";
    setAction(s, entropy);
  } else {
    endDecision(s, now, entropy);
  }
}
function discardDrawn(s: RoomState, actorId: string, now: number, entropy: Entropy) {
  requireRule(s.drawn?.playerId === actorId, "NO_DRAWN_CARD");
  const card = s.drawn!.card;
  const fromDeck = s.drawn!.source !== "fire";
  s.drawn = null;
  putInFire(s, card, actorId, fromDeck, now, entropy);
}

function handleBurn(s: RoomState, actorId: string, command: Extract<Command, { type: "BURN" }>, now: number, entropy: Entropy): string {
  const w = s.burn;
  requireRule(w && w.id === command.burnId && now < w.endsAt, "STALE_BURN");
  requireRule(s.rules.discarderCanBurn || actorId !== w.discarderId, "DISCARDER_CANNOT_BURN");
  requireRule(!w.attemptedBy.includes(actorId), "ALREADY_ATTEMPTED");
  const selected = slot(s, actorId, command.own); // stale slot is NOT a wrong-card penalty
  w.attemptedBy.push(actorId);
  if (!burnMatches(selected.card, w.target, s.rules.burnMatch)) {
    const penalty = takeDeck(s, entropy);
    if (!penalty) { finishRound(s, "DECK_EXHAUSTED"); return "ROUND_ENDED_NO_PENALTY_CARD"; }
    // Face down, unknown even to its owner. Existing positions keep their ids.
    player(s, actorId).slots.unshift({ id: entropy.id(), version: 0, card: penalty });
    return "BURN_PENALTY";
  }
  const burned = selected.card;
  s.discard.push(burned);
  writeSlot(s, selected, null);
  if (s.rules.chainBurns) {
    // First commit wins this window. Every successful burn creates a NEW race.
    // Preserve the original turn/power; burning never activates a power card.
    s.burn = { id: entropy.id(), chainId: w.chainId ?? w.id, sequence: (w.sequence ?? 0) + 1,
      target: burned, discarderId: actorId, endsAt: now + s.rules.burnWindowMs, attemptedBy: [] };
  } else {
    s.burn = null;
    if (s.phase === "WAIT_BURN") advanceTurn(s, now, entropy);
  }
  return "BURN_ACCEPTED";
}

/** Pure, synchronous, all-or-nothing transition. Never await inside this function. */
export function reduceCommand(state: RoomState, actorId: string, command: Command, now: number, entropy: Entropy = secureEntropy): { state: RoomState; code: string } {
  const s: RoomState = structuredClone(state);
  player(s, actorId);
  let code = "OK";
  if (command.type === "READY") {
    requireRule(s.phase === "LOBBY" || s.phase === "ROUND_END", "WRONG_PHASE");
    player(s, actorId).ready = command.ready;
  } else if (command.type === "START") {
    requireRule(s.phase === "LOBBY" || s.phase === "ROUND_END", "WRONG_PHASE");
    requireRule(s.hostId === actorId, "HOST_ONLY");
    startRound(s, now, entropy);
  } else if (command.type === "BURN") {
    code = handleBurn(s, actorId, command, now, entropy);
  } else {
    const expected: Phase = ["DRAW_DECK", "DRAW_FIRE", "TAKE_FIRE", "CABO"].includes(command.type) ? "TURN_START"
      : ["REPLACE_DRAWN", "DISCARD_DRAWN"].includes(command.type) ? "DRAWN" : "POWER";
    needTurn(s, actorId, command.actionId, expected, now);
    switch (command.type) {
      case "DRAW_DECK": drawDeck(s, actorId, entropy); break;
      case "DRAW_FIRE": drawFire(s, actorId, entropy); break;
      case "DISCARD_DRAWN": discardDrawn(s, actorId, now, entropy); break;
      case "REPLACE_DRAWN": {
        const selected = slot(s, actorId, command.own);
        requireRule(s.drawn?.playerId === actorId, "NO_DRAWN_CARD");
        const old = selected.card;
        writeSlot(s, selected, s.drawn!.card);
        s.drawn = null;
        putInFire(s, old, actorId, false, now, entropy);
        break;
      }
      case "TAKE_FIRE": {
        const selected = slot(s, actorId, command.own);
        requireRule(s.discard.length > 0 && !s.burn, "FIRE_UNAVAILABLE");
        const old = selected.card;
        writeSlot(s, selected, s.discard.pop()!);
        putInFire(s, old, actorId, false, now, entropy);
        break;
      }
      case "POWER_7": {
        needPower(s, 7);
        reveal(s, actorId, actorId, slot(s, actorId, command.own), now);
        endDecision(s, now, entropy);
        break;
      }
      case "POWER_8": {
        needPower(s, 8);
        reveal(s, actorId, command.target.playerId, otherSlot(s, actorId, command.target), now);
        endDecision(s, now, entropy);
        break;
      }
      case "POWER_9": {
        needPower(s, 9);
        swapSlots(s, slot(s, actorId, command.own), otherSlot(s, actorId, command.target));
        endDecision(s, now, entropy);
        break;
      }
      case "POWER_10_PEEK": {
        const power = needPower(s, 10);
        // Only ONE target may be inspected. Retarget only when the old card changed.
        if (power.stage === "DECIDE_10" && power.inspected) {
          const old = player(s, power.inspected.playerId).slots.find(x => x.id === power.inspected!.slotId);
          requireRule(!old?.card || old.version !== power.inspected.version, "ALREADY_PEEKED");
        }
        const selected = otherSlot(s, actorId, command.target);
        reveal(s, actorId, command.target.playerId, selected, now);
        power.stage = "DECIDE_10";
        power.inspected = { ...command.target };
        setAction(s, entropy);
        break;
      }
      case "POWER_10_SWAP": {
        const power = needPower(s, 10);
        requireRule(power.stage === "DECIDE_10" && power.inspected, "PEEK_FIRST");
        swapSlots(s, slot(s, actorId, command.own), otherSlot(s, actorId, power.inspected!));
        endDecision(s, now, entropy);
        break;
      }
      case "SKIP_POWER": endDecision(s, now, entropy); break;
      case "CABO": {
        requireRule(!s.cabo, "CABO_ALREADY_CALLED");
        s.cabo = {
          callerId: actorId,
          remainingPlayerIds: Array.from({ length: s.players.length - 1 }, (_, i) => s.players[(s.actorIndex + i + 1) % s.players.length]!.id),
        };
        advanceTurn(s, now, entropy); // Caller gives up this turn. Everyone else gets exactly one.
        break;
      }
      default: throw new RuleError("UNKNOWN_COMMAND");
    }
  }
  s.revision = state.revision + 1;
  assertInvariants(s);
  return { state: s, code };
}

/** Server-only clock path. A scheduler must call it, even when nobody sends actions. */
export function advanceTime(state: RoomState, now: number, entropy: Entropy = secureEntropy): RoomState {
  const s: RoomState = structuredClone(state);
  let changed = false;
  const grants = s.grants.filter(g => g.expiresAt > now);
  if (grants.length !== s.grants.length) { s.grants = grants; changed = true; }
  if (s.phase === "INITIAL_PEEK" && s.previewEndsAt !== null && now >= s.previewEndsAt) {
    s.previewEndsAt = null;
    beginTurn(s, now, entropy);
    changed = true;
  }
  if (s.burn && now >= s.burn.endsAt) {
    s.burn = null;
    if (s.phase === "WAIT_BURN") advanceTurn(s, now, entropy);
    changed = true;
  }
  if (["TURN_START", "DRAWN", "POWER"].includes(s.phase) && s.turnDeadlineAt !== null && now >= s.turnDeadlineAt) {
    const actorId = s.players[s.actorIndex]!.id;
    if (s.phase === "TURN_START") drawDeck(s, actorId, entropy);
    if (s.phase === "DRAWN") discardDrawn(s, actorId, now, entropy);
    if (s.phase === "POWER") endDecision(s, now, entropy); // Automatic decline of optional power.
    changed = true;
  }
  if (!changed) return state;
  s.revision = state.revision + 1;
  assertInvariants(s);
  return s;
}

export function assertInvariants(s: RoomState) {
  if (s.phase === "LOBBY") return;
  const cards = [...s.deck, ...s.discard, ...s.players.flatMap(p => p.slots.flatMap(x => x.card ? [x.card] : [])), ...(s.drawn ? [s.drawn.card] : [])];
  requireRule(cards.length === 54 && new Set(cards.map(c => c.id)).size === 54, "INVARIANT_CARD_CONSERVATION");
  const slotIds = s.players.flatMap(p => p.slots.map(x => x.id));
  requireRule(new Set(slotIds).size === slotIds.length, "INVARIANT_SLOT_IDS");
  requireRule((s.phase === "DRAWN") === Boolean(s.drawn), "INVARIANT_DRAWN_PHASE");
  requireRule((s.phase === "POWER") === Boolean(s.power), "INVARIANT_POWER_PHASE");
  if (s.burn) requireRule(s.discard.at(-1)?.id === s.burn.target.id, "INVARIANT_FIRE_TOP");
  if (s.phase === "ROUND_END") requireRule(s.result && !s.burn && !s.drawn && !s.power, "INVARIANT_FINAL");
}
