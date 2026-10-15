import { face } from "./cards.ts";
import { RuleError } from "./engine.ts";
import type { RoomState } from "./models.ts";

/** An allow-list projection, not {...state} followed by deleting a few keys. */
export function viewFor(s: RoomState, viewerId: string, now: number) {
  if (!s.players.some(p => p.id === viewerId)) throw new RuleError("NOT_A_MEMBER");
  const ended = s.phase === "ROUND_END";
  const isActor = s.players[s.actorIndex]?.id === viewerId;
  const active = !["LOBBY", "INITIAL_PEEK", "ROUND_END"].includes(s.phase);
  return {
    roomId: s.id,
    roundId: s.roundId,
    revision: s.revision,
    serverNow: now,
    phase: s.phase,
    hostId: s.hostId,
    rules: { ...s.rules },
    me: viewerId,
    turnPlayerId: active ? s.players[s.actorIndex]!.id : null,
    turnDeadlineAt: s.turnDeadlineAt,
    previewEndsAt: s.previewEndsAt,
    deckCount: s.deck.length,
    fireCount: s.discard.length,
    fireTop: s.discard.length ? face(s.discard.at(-1)!) : null,
    players: s.players.map(p => ({
      id: p.id, name: p.name, seat: p.seat, connected: p.connected, ready: p.ready,
      slots: p.slots.map(x => {
        const grant = s.grants.find(g => g.viewerId === viewerId && g.playerId === p.id && g.slotId === x.id && g.version === x.version && g.expiresAt > now);
        return {
          slotId: x.id,
          version: x.version,
          occupied: x.card !== null,
          face: x.card && (ended || grant) ? face(x.card) : null,
          revealUntil: !ended && grant && x.card ? grant.expiresAt : null,
        };
      }),
    })),
    burn: s.burn && now < s.burn.endsAt ? {
      id: s.burn.id,
      chainId: s.burn.chainId ?? s.burn.id,
      sequence: s.burn.sequence ?? 0,
      endsAt: s.burn.endsAt,
      discarderId: s.burn.discarderId,
      canAttempt: !s.burn.attemptedBy.includes(viewerId) && (s.rules.discarderCanBurn || s.burn.discarderId !== viewerId),
    } : null,
    activePower: s.power ? { rank: s.power.rank, actorId: s.power.actorId } : null,
    cabo: s.cabo ? { callerId: s.cabo.callerId, remainingPlayerIds: [...s.cabo.remainingPlayerIds] } : null,
    result: s.result ? structuredClone(s.result) : null,
    private: {
      actionId: isActor && active ? s.actionId : null,
      drawn: s.drawn?.playerId === viewerId ? face(s.drawn.card) : null,
      drawnSource: s.drawn?.playerId === viewerId ? (s.drawn.source ?? "deck") : null,
      power: isActor && s.power ? {
        rank: s.power.rank, stage: s.power.stage,
        inspected: s.power.inspected ? { ...s.power.inspected } : null,
      } : null,
    },
  };
}
export type RoomView = ReturnType<typeof viewFor>;
