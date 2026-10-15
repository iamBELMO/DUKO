import test from "node:test";
import assert from "node:assert/strict";
import { makeDeck, scoreCard } from "../src/cards.ts";
import { advanceTime, assertInvariants, createRoom, reduceCommand } from "../src/engine.ts";
import { RoomActor } from "../src/room-actor.ts";
import { viewFor } from "../src/privacy.ts";
import type { Card, Command, Entropy, Rank, RoomState, SlotRef, Suit, TargetRef } from "../src/models.ts";

function seeded(): Entropy {
  let id = 0, n = 12345;
  return { id: () => `test-${++id}`, int: max => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n % max; } };
}
type Pick = [Rank, Suit?];
const NOW = 6001;
function readyRoom(count: number, entropy: Entropy) {
  let s = createRoom("test-room", Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Player ${i}` })));
  for (const p of s.players) s = reduceCommand(s, p.id, { type: "READY", ready: true }, 0, entropy).state;
  return reduceCommand(s, "p0", { type: "START" }, 0, entropy).state;
}
function fixture(hands: Pick[][], draws: Pick[] = [], fire: Pick = ["Q", "spades"]) {
  const entropy = seeded();
  let s = advanceTime(readyRoom(hands.length, entropy), 6000, entropy);
  const pool = makeDeck(entropy);
  function take([rank, suit]: Pick): Card {
    const i = pool.findIndex(c => c.rank === rank && (suit === undefined || c.suit === suit));
    assert.ok(i >= 0, `Fixture ran out of ${rank} ${suit}`);
    return pool.splice(i, 1)[0]!;
  }
  s.players.forEach((p, i) => { p.slots = hands[i]!.map(pick => ({ id: entropy.id(), version: 0, card: take(pick) })); });
  const upcoming = draws.map(take);
  s.discard = [take(fire)];
  s.deck = [...pool, ...upcoming.reverse()];
  s.grants = [];
  s.actorIndex = 0;
  assertInvariants(s);
  return { game: new RoomActor(s, entropy), entropy, state: s };
}
const baseHands: Pick[][] = [ [[2], [3], [4], [5]], [[6], [7], [8], [9]] ];
function ref(game: RoomActor, id: string, index = 0): SlotRef {
  const x = game.view(id, NOW).players.find(p => p.id === id)!.slots[index]!;
  return { slotId: x.slotId, version: x.version };
}
function target(game: RoomActor, id: string, index = 0): TargetRef { return { playerId: id, ...ref(game, id, index) }; }
let requestCounter = 0;
function send(game: RoomActor, id: string, type: Command["type"], fields: Record<string, unknown> = {}, now = NOW) {
  const view = game.view(id, now);
  const command = { type, actionId: view.private.actionId, ...fields } as Command;
  return game.dispatch(id, { commandId: `request-${++requestCounter}`, roundId: view.roundId, command }, now);
}
function ok(game: RoomActor, id: string, type: Command["type"], fields: Record<string, unknown> = {}, now = NOW) {
  const receipt = send(game, id, type, fields, now);
  assert.equal(receipt.ok, true, receipt.code);
  return receipt;
}
function direct(game: RoomActor) { ok(game, "p0", "DRAW_DECK"); ok(game, "p0", "DISCARD_DRAWN"); }
function liveCount(game: RoomActor, id: string) { return game.view(id, NOW).players.find(p => p.id === id)!.slots.filter(x => x.occupied).length; }

test("exact user scoring: every rank, both king colors, and negative values", () => {
  for (const c of makeDeck(seeded())) {
    const expected = c.rank === "JOKER" ? -2 : c.rank === "A" ? 0 : c.rank === "J" ? 11 : c.rank === "Q" ? 13 : c.rank === "K" ? (["hearts", "diamonds"].includes(c.suit!) ? -1 : 13) : c.rank;
    assert.equal(scoreCard(c), expected);
  }
});

test("2–6 players: 54 conserved unique cards; only the physical right two initially visible", () => {
  for (let count = 2; count <= 6; count++) {
    const entropy = seeded();
    const s = readyRoom(count, entropy);
    assertInvariants(s);
    assert.equal(s.deck.length, 54 - count * 4 - 1);
    assert.equal(s.burn, null);
    for (const p of s.players) {
      const view = viewFor(s, p.id, 1);
      assert.deepEqual(view.players.find(x => x.id === p.id)!.slots.map(x => x.face !== null), [false, false, true, true]);
      assert.ok(view.players.filter(x => x.id !== p.id).every(x => x.slots.every(y => y.face === null)));
      const encoded = JSON.stringify(view);
      for (const c of [...s.deck, ...s.discard, ...s.players.flatMap(p => p.slots.map(x => x.card!))]) assert.ok(!encoded.includes(`"${c.id}"`));
      assert.ok(!("deck" in view));
    }
    assert.ok(viewFor(s, "p0", 6000).players.every(p => p.slots.every(x => x.face === null)));
    assert.equal(advanceTime(s, 6000, entropy).phase, "TURN_START");
  }
});

test("lobby start requires 2–6 ready players and host permission", () => {
  const e = seeded();
  let s = createRoom("r", [{ id: "p0", name: "a" }]);
  s.players[0]!.ready = true;
  assert.throws(() => reduceCommand(s, "p0", { type: "START" }, 0, e), /PLAYER_COUNT/);
  s = createRoom("r", [{ id: "p0", name: "a" }, { id: "p1", name: "b" }]);
  assert.throws(() => reduceCommand(s, "p1", { type: "START" }, 0, e), /HOST_ONLY/);
  assert.throws(() => reduceCommand(s, "p0", { type: "START" }, 0, e), /PLAYERS_NOT_READY/);
});

test("drawn card is private; out-of-turn action rolls back without losing any cards", () => {
  const { game } = fixture(baseHands, [["JOKER"]]);
  const before = game.serverSnapshot();
  assert.equal(send(game, "p1", "DRAW_DECK").ok, false);
  assert.deepEqual(game.serverSnapshot(), before);
  ok(game, "p0", "DRAW_DECK");
  assert.equal(game.view("p0", NOW).private.drawn?.rank, "JOKER");
  assert.equal(game.view("p1", NOW).private.drawn, null);
  assert.equal(game.view("p1", NOW).private.actionId, null);
});

test("one burn winner; second correct contender is stale, not penalized", () => {
  const { game } = fixture([[[2]], [[5, "hearts"]], [[5, "diamonds"]]], [[5, "clubs"]]);
  direct(game);
  const burnId = game.view("p1", NOW).burn!.id;
  assert.equal(ok(game, "p1", "BURN", { burnId, own: ref(game, "p1") }).code, "BURN_ACCEPTED");
  const before = game.serverSnapshot();
  assert.equal(send(game, "p2", "BURN", { burnId, own: ref(game, "p2") }).code, "STALE_BURN");
  assert.equal(liveCount(game, "p1"), 0);
  assert.equal(liveCount(game, "p2"), 1);
  assert.deepEqual(game.serverSnapshot(), before);
  assert.notEqual(game.view("p0", NOW).phase, "ROUND_END");
});

test("chain burns include the discarder, the previous winner, and every other player", () => {
  const { game } = fixture([[[5,"hearts"],[5,"diamonds"],[2]],[[5,"spades"],[3]]],[[5,"clubs"]]);
  direct(game);
  const first=game.view("p0",NOW).burn!;
  assert.equal(first.canAttempt,true);
  ok(game,"p0","BURN",{burnId:first.id,own:ref(game,"p0",0)});
  const second=game.view("p0",NOW).burn!;
  assert.notEqual(second.id,first.id);assert.equal(second.chainId,first.chainId);assert.equal(second.sequence,1);
  assert.equal(second.canAttempt,true);
  ok(game,"p0","BURN",{burnId:second.id,own:ref(game,"p0",1)});
  const third=game.view("p1",NOW).burn!;
  assert.equal(third.canAttempt,true);
  ok(game,"p1","BURN",{burnId:third.id,own:ref(game,"p1",0)});
  assert.equal(game.view("p0",NOW).burn!.sequence,3);
  assert.equal(liveCount(game,"p0"),1);assert.equal(liveCount(game,"p1"),1);
  assert.equal(game.view("p0",NOW).phase,"WAIT_BURN");
  game.tick(NOW+1500);assert.equal(game.view("p0",NOW+1500).turnPlayerId,"p1");
  assertInvariants(game.serverSnapshot());
});

test("a held fire card can return to fire then the same player burns behind it without a power",()=>{
  const {game}=fixture([[[10,"hearts"],[2]],[[3],[4]]],[],[10,"clubs"]);
  const deckSize=game.serverSnapshot().deck.length;
  ok(game,"p0","DRAW_FIRE");
  assert.equal(game.view("p0",NOW).private.drawnSource,"fire");
  assert.equal(game.view("p1",NOW).private.drawn,null);
  assert.equal(game.view("p1",NOW).private.drawnSource,null);
  assert.equal(game.view("p0",NOW).fireTop,null);
  assert.equal(game.serverSnapshot().deck.length,deckSize);
  ok(game,"p0","DISCARD_DRAWN");
  assert.equal(game.view("p0",NOW).activePower,null);
  ok(game,"p0","BURN",{burnId:game.view("p0",NOW).burn!.id,own:ref(game,"p0",0)});
  assert.equal(game.view("p0",NOW).activePower,null);assert.equal(liveCount(game,"p0"),1);
});

test("holding fire then replacing preserves all cards and uses the chosen board slot",()=>{
  const {game}=fixture(baseHands,[],["K","hearts"]);
  const before=game.serverSnapshot(),old=before.players[0]!.slots[1]!.card!;
  ok(game,"p0","DRAW_FIRE");
  assert.equal(send(game,"p0","DRAW_DECK").code,"WRONG_PHASE");
  ok(game,"p0","REPLACE_DRAWN",{own:ref(game,"p0",1)});
  const after=game.serverSnapshot();
  assert.equal(after.players[0]!.slots[1]!.card!.id,before.discard.at(-1)!.id);
  assert.equal(after.discard.at(-1)!.id,old.id);assert.equal(after.drawn,null);assertInvariants(after);
});

test("a held fire power card expires without activating a power",()=>{
  const {game}=fixture(baseHands,[],[8,"clubs"]);
  ok(game,"p0","DRAW_FIRE");game.tick(36000);
  assert.equal(game.view("p0",36000).phase,"WAIT_BURN");
  assert.equal(game.view("p0",36000).activePower,null);
  assert.equal(game.view("p0",36000).burn!.canAttempt,true);
});

test("burn chains preserve a pending power and never activate a second power",()=>{
  const {game}=fixture([[[7,"hearts"],[2]],[[3],[4]]],[[7,"clubs"]]);direct(game);
  const actionId=game.view("p0",NOW).private.actionId;
  ok(game,"p0","BURN",{burnId:game.view("p0",NOW).burn!.id,own:ref(game,"p0")});
  assert.equal(game.view("p0",NOW).private.actionId,actionId);
  assert.equal(game.view("p0",NOW).activePower!.rank,7);
  ok(game,"p0","POWER_7",{own:ref(game,"p0",1)});
  assert.equal(game.view("p0",NOW).phase,"WAIT_BURN");assert.equal(game.view("p0",NOW).activePower,null);
});

test("Duko scoring waits for the whole final burn chain",()=>{
  const {game}=fixture([[[5,"hearts"]],[[2],[5,"diamonds"]]],[[5,"clubs"]]);
  ok(game,"p0","CABO");ok(game,"p1","DRAW_DECK");ok(game,"p1","DISCARD_DRAWN");
  ok(game,"p0","BURN",{burnId:game.view("p0",NOW).burn!.id,own:ref(game,"p0")});
  ok(game,"p1","BURN",{burnId:game.view("p1",NOW).burn!.id,own:ref(game,"p1",1)},NOW+1000);
  game.tick(NOW+1500);assert.equal(game.view("p0",NOW+1500).result,null);
  game.tick(NOW+2500);assert.equal(game.view("p0",NOW+2500).phase,"ROUND_END");
  assert.deepEqual(game.view("p0",NOW+2500).result!.scores.map(s=>s.total),[0,2]);
});

test("legacy room rules upgrade at the next round without resetting the room or host",()=>{
  const entropy=seeded(),state=createRoom('legacy',[{id:'p0',name:'A'},{id:'p1',name:'B'}]);
  delete state.rules.chainBurns;state.rules.discarderCanBurn=false;
  state.players.forEach(p=>p.ready=true);
  const game=new RoomActor(state,entropy);
  assert.equal(game.serverSnapshot().rules.discarderCanBurn,false);
  ok(game,'p0','START');
  assert.equal(game.serverSnapshot().id,'legacy');assert.equal(game.serverSnapshot().hostId,'p0');
  assert.equal(game.serverSnapshot().rules.discarderCanBurn,true);assert.equal(game.serverSnapshot().rules.chainBurns,true);
});

test("wrong burn adds one hidden penalty; one attempt per window; duplicate delivery is harmless", () => {
  const { game } = fixture(baseHands, [[5, "clubs"], ["JOKER"]]);
  direct(game);
  const v = game.view("p1", NOW);
  const envelope = { commandId: "wrong-once", roundId: v.roundId, command: { type: "BURN", burnId: v.burn!.id, own: ref(game, "p1") } as Command };
  const first = game.dispatch("p1", envelope, NOW);
  assert.equal(first.code, "BURN_PENALTY");
  assert.equal(liveCount(game, "p1"), 5);
  assert.equal(game.view("p1", NOW).players[1]!.slots[0]!.face, null);
  assert.deepEqual(game.dispatch("p1", envelope, NOW), first);
  assert.equal(liveCount(game, "p1"), 5);
  assert.equal(send(game, "p1", "BURN", { burnId: v.burn!.id, own: ref(game, "p1", 1) }).code, "ALREADY_ATTEMPTED");
});

test("stale slots and expired burns never cause a penalty; the discarder may burn", () => {
  const { game } = fixture(baseHands, [[5, "clubs"]]);
  direct(game);
  const burnId = game.view("p1", NOW).burn!.id;
  assert.equal(send(game, "p1", "BURN", { burnId, own: { ...ref(game, "p1"), version: 44 } }).code, "STALE_SLOT");
  assert.equal(send(game, "p0", "BURN", { burnId, own: ref(game, "p0", 3) }).code, "BURN_ACCEPTED");
  assert.equal(liveCount(game, "p0"), 3);
  assert.equal(send(game, "p1", "BURN", { burnId, own: ref(game, "p1") }, NOW + 1500).code, "STALE_BURN");
  assert.equal(liveCount(game, "p1"), 4);
});

test("replacement discards and taking fire do not trigger old power cards", () => {
  const { game } = fixture([[[7], [2]], [[3], [4]]], [[8]], [10]);
  ok(game, "p0", "DRAW_DECK");
  ok(game, "p0", "REPLACE_DRAWN", { own: ref(game, "p0") });
  assert.equal(game.view("p0", NOW).phase, "WAIT_BURN");
  assert.equal(game.view("p0", NOW).activePower, null);
  const other = fixture([[[9]], [[3]]], [], [10]).game;
  ok(other, "p0", "TAKE_FIRE", { own: ref(other, "p0") });
  assert.equal(other.view("p0", NOW).activePower, null);
  assert.equal(other.serverSnapshot().players[0]!.slots[0]!.card!.rank, 10);
});

test("7 reveals only selected own card, expires, cannot be replayed", () => {
  const { game } = fixture(baseHands, [[7, "clubs"]]);
  direct(game);
  const own = ref(game, "p0");
  ok(game, "p0", "POWER_7", { own });
  assert.equal(game.view("p0", NOW).players[0]!.slots[0]!.face!.rank, 2);
  assert.equal(game.view("p1", NOW).players[0]!.slots[0]!.face, null);
  assert.equal(send(game, "p0", "POWER_7", { own }).ok, false);
  assert.equal(game.view("p0", NOW + 3000).players[0]!.slots[0]!.face, null);
});

test("8 reveals opponent only to the actor, without moving the card", () => {
  const { game } = fixture(baseHands, [[8, "clubs"]]);
  direct(game);
  const original = game.serverSnapshot().players[1]!.slots[0]!.card!.id;
  ok(game, "p0", "POWER_8", { target: target(game, "p1") });
  assert.equal(game.view("p0", NOW).players[1]!.slots[0]!.face!.rank, 6);
  assert.equal(game.view("p1", NOW).players[1]!.slots[0]!.face, null);
  assert.equal(game.serverSnapshot().players[1]!.slots[0]!.card!.id, original);
});

test("9 swaps blindly, revokes stale grants and increments slot versions", () => {
  const setup = fixture(baseHands, [[9, "clubs"]]);
  const s = setup.state;
  const old = s.players[1]!.slots[0]!;
  s.grants.push({ viewerId: "p1", playerId: "p1", slotId: old.id, version: old.version, expiresAt: NOW + 5000 });
  const game = new RoomActor(s, setup.entropy);
  direct(game);
  const own = ref(game, "p0"), chosen = target(game, "p1");
  ok(game, "p0", "POWER_9", { own, target: chosen });
  const server = game.serverSnapshot();
  assert.equal(server.players[0]!.slots[0]!.card!.rank, 6);
  assert.equal(server.players[1]!.slots[0]!.card!.rank, 2);
  assert.equal(server.players[0]!.slots[0]!.version, own.version + 1);
  for (const id of ["p0", "p1"]) assert.ok(game.view(id, NOW).players.every(p => p.slots.every(x => x.face === null)));
});

test("10 permits one inspection followed by optional swap; no second free inspection", () => {
  const { game } = fixture(baseHands, [[10]]);
  direct(game);
  ok(game, "p0", "POWER_10_PEEK", { target: target(game, "p1") });
  assert.equal(game.view("p0", NOW).players[1]!.slots[0]!.face!.rank, 6);
  assert.equal(send(game, "p0", "POWER_10_PEEK", { target: target(game, "p1", 1) }).code, "ALREADY_PEEKED");
  ok(game, "p0", "POWER_10_SWAP", { own: ref(game, "p0") });
  assert.equal(game.serverSnapshot().players[0]!.slots[0]!.card!.rank, 6);
  assert.equal(game.serverSnapshot().players[1]!.slots[0]!.card!.rank, 2);
  assert.ok(game.view("p1", NOW).players.every(p => p.slots.every(x => x.face === null)));
});

test("10 can decline, and never silently exchanges a card that was burned meanwhile", () => {
  const { game } = fixture([[[2]], [[10, "hearts"], [3]]], [[10, "clubs"]]);
  direct(game);
  ok(game, "p0", "POWER_10_PEEK", { target: target(game, "p1") });
  ok(game, "p1", "BURN", { burnId: game.view("p1", NOW).burn!.id, own: ref(game, "p1") });
  const before = game.serverSnapshot();
  assert.equal(send(game, "p0", "POWER_10_SWAP", { own: ref(game, "p0") }).code, "STALE_SLOT");
  assert.deepEqual(game.serverSnapshot(), before);
  ok(game, "p0", "POWER_10_PEEK", { target: target(game, "p1", 1) });
  ok(game, "p0", "SKIP_POWER");
  assert.equal(game.serverSnapshot().players[0]!.slots[0]!.card!.rank, 2);
});

test("a burn targeted at a slot moved by 9 is stale and does not draw a penalty", () => {
  const { game } = fixture([[[2]], [[9, "hearts"], [4]]], [[9, "clubs"]]);
  direct(game);
  const burnId = game.view("p1", NOW).burn!.id;
  const old = ref(game, "p1");
  ok(game, "p0", "POWER_9", { own: ref(game, "p0"), target: target(game, "p1") });
  assert.equal(send(game, "p1", "BURN", { burnId, own: old }).code, "STALE_SLOT");
  assert.equal(liveCount(game, "p1"), 2);
});

test("CABO: caller gives up their turn, exactly N-1 others play, including the final burn window", () => {
  const { game } = fixture([[[2]], [[3]], [[4]], [[5]]], [[2, "clubs"], [3, "clubs"], [4, "clubs"]]);
  ok(game, "p0", "CABO");
  let now = NOW;
  for (const id of ["p1", "p2", "p3"]) {
    assert.equal(game.view(id, now).turnPlayerId, id);
    ok(game, id, "DRAW_DECK", {}, now);
    ok(game, id, "DISCARD_DRAWN", {}, now);
    assert.notEqual(game.view(id, now).phase, "ROUND_END");
    now += 1500;
    game.tick(now);
  }
  assert.equal(game.view("p0", now).phase, "ROUND_END");
  assert.equal(game.view("p0", now).result!.reason, "CABO");
  assert.ok(game.view("p0", now).players.every(p => p.slots.every(x => x.face !== null)));
});

test("CABO cannot be called after drawing or twice", () => {
  const first = fixture(baseHands, [[2, "clubs"]]).game;
  ok(first, "p0", "DRAW_DECK");
  assert.equal(send(first, "p0", "CABO").ok, false);
  const second = fixture(baseHands).game;
  ok(second, "p0", "CABO");
  assert.equal(send(second, "p1", "CABO").code, "CABO_ALREADY_CALLED");
});

test("empty hand does not auto-win; negative ties are shared correctly", () => {
  const { game } = fixture([[], [["JOKER"]], [["JOKER"]]], [[2], [3]]);
  ok(game, "p0", "CABO");
  let now = NOW;
  for (const id of ["p1", "p2"]) {
    ok(game, id, "DRAW_DECK", {}, now);
    ok(game, id, "DISCARD_DRAWN", {}, now);
    now += 1500; game.tick(now);
  }
  assert.deepEqual(game.view("p0", now).result!.winners, ["p1", "p2"]);
  assert.deepEqual(game.view("p0", now).result!.scores.map(x => x.total), [0, -2, -2]);
});

test("empty deck reshuffles all fire cards except the visible top", () => {
  const { state, entropy } = fixture(baseHands);
  const top = state.discard[0]!;
  state.discard = [...state.deck, top]; state.deck = [];
  const game = new RoomActor(state, entropy);
  ok(game, "p0", "DRAW_DECK");
  assert.equal(game.serverSnapshot().discard.length, 1);
  assert.equal(game.serverSnapshot().discard[0]!.id, top.id);
  assert.notEqual(game.serverSnapshot().drawn!.card.id, top.id);
  assertInvariants(game.serverSnapshot());
});

test("when no refill or penalty card exists, round ends with all 54 cards still accounted for", () => {
  const { state, entropy } = fixture([[[2]], [[3]]], [[5]]);
  // Preserve one upcoming card; put every other deck card onto a player's board.
  const next = state.deck.pop()!;
  for (const c of state.deck) state.players[1]!.slots.push({ id: entropy.id(), version: 0, card: c });
  state.deck = [next];
  const game = new RoomActor(state, entropy);
  // Fire take replaces its sole card, with no new card available for wrong burn.
  state.players[1]!.slots.push({ id: entropy.id(), version: 0, card: next });
  state.deck = [];
  const depleted = new RoomActor(state, entropy);
  ok(depleted, "p0", "TAKE_FIRE", { own: ref(depleted, "p0") });
  const result = ok(depleted, "p1", "BURN", { burnId: depleted.view("p1", NOW).burn!.id, own: ref(depleted, "p1") });
  assert.equal(result.code, "ROUND_ENDED_NO_PENALTY_CARD");
  assert.equal(depleted.view("p1", NOW).result!.reason, "DECK_EXHAUSTED");
  assertInvariants(depleted.serverSnapshot());
  assertInvariants(game.serverSnapshot());
});

test("timeout: draw then discard; power is skipped; round continues after burn expiry", () => {
  const { game } = fixture(baseHands, [[10]]);
  const due = game.view("p0", NOW).turnDeadlineAt!;
  game.tick(due);
  assert.equal(game.view("p0", due).phase, "WAIT_BURN");
  assert.equal(game.view("p0", due).activePower, null);
  game.tick(due + 1500);
  assert.equal(game.view("p0", due + 1500).turnPlayerId, "p1");
  assertInvariants(game.serverSnapshot());
});

test("idempotent draw, changed-payload command id rejection, and stale action rejection", () => {
  const { game } = fixture(baseHands, [[2, "clubs"]]);
  const view = game.view("p0", NOW);
  const envelope = { commandId: "draw-1", roundId: view.roundId, command: { type: "DRAW_DECK", actionId: view.private.actionId! } as Command };
  const first = game.dispatch("p0", envelope, NOW);
  const after = game.serverSnapshot();
  assert.deepEqual(game.dispatch("p0", envelope, NOW), first);
  assert.deepEqual(game.serverSnapshot(), after);
  assert.equal(game.dispatch("p0", { ...envelope, command: { type: "DISCARD_DRAWN", actionId: game.view("p0", NOW).private.actionId! } }, NOW).code, "COMMAND_ID_REUSED");
  assert.equal(send(game, "p0", "DISCARD_DRAWN", { actionId: view.private.actionId }).code, "STALE_ACTION");
  assert.deepEqual(game.serverSnapshot(), after);
});

test("snapshots are detached; unknown players receive no state; expired grants do not reappear", () => {
  const { game } = fixture(baseHands, [[8, "clubs"]]);
  direct(game); ok(game, "p0", "POWER_8", { target: target(game, "p1") });
  const v = game.view("p0", NOW);
  v.players[1]!.slots[0]!.face!.rank = "JOKER";
  assert.equal(game.view("p0", NOW).players[1]!.slots[0]!.face!.rank, 6);
  assert.throws(() => game.view("stranger", NOW), /NOT_A_MEMBER/);
  assert.equal(game.view("p0", NOW + 3000).players[1]!.slots[0]!.face, null);
});

test("multi-turn simulation conserves cards through power timeouts and several reshuffles", () => {
  for (const count of [2, 4, 6]) {
    const entropy = seeded();
    const game = new RoomActor(readyRoom(count, entropy), entropy);
    let now = 6000;
    game.tick(now);
    for (let step = 0; step < 120; step++) {
      now += 40000;
      game.tick(now);
      now += 1500;
      game.tick(now);
      assertInvariants(game.serverSnapshot());
      assert.ok(game.view("p0", now).players.every(p => p.slots.every(x => x.face === null)));
    }
  }
});
