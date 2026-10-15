import { advanceTime, reduceCommand, RuleError } from "./engine.ts";
import { secureEntropy } from "./cards.ts";
import { viewFor } from "./privacy.ts";
import type { Command, Entropy, Receipt, RoomState } from "./models.ts";

export interface Envelope {
  commandId: string;
  roundId: string | null;
  command: Command;
}
export type ReceiptHistory = [string, [string, { fingerprint: string; receipt: Receipt }][]][];
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return "{" + Object.keys(obj).sort().map(k => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}";
}

/** One instance per room, in ONE authoritative process. This is not a distributed lock. */
export class RoomActor {
  #state: RoomState;
  #entropy: Entropy;
  #receipts = new Map<string, Map<string, { fingerprint: string; receipt: Receipt }>>();
  constructor(state: RoomState, entropy: Entropy = secureEntropy, history: ReceiptHistory = []) {
    this.#state = structuredClone(state);
    this.#entropy = entropy;
    this.#receipts = new Map(history.map(([playerId, records]) => [playerId, new Map(records)]));
  }
  receiptHistory(): ReceiptHistory {
    return structuredClone([...this.#receipts].map(([id, records]) => [id, [...records].slice(-64)]));
  }
  // For server persistence/testing only. The transport MUST use view() instead.
  serverSnapshot(): RoomState { return structuredClone(this.#state); }
  setPresence(playerId: string, connected: boolean): void {
    const p = this.#state.players.find(p => p.id === playerId);
    if (p && p.connected !== connected) { p.connected = connected; this.#state.revision++; }
  }
  transferHost(playerId: string): void {
    if (!this.#state.players.some(p => p.id === playerId)) throw new RuleError("NOT_A_MEMBER");
    if (this.#state.hostId !== playerId) { this.#state.hostId = playerId; this.#state.revision++; }
  }
  setLobbyPlayers(roster: { id: string; name: string; connected: boolean; ready: boolean }[], hostId: string): void {
    if (this.#state.phase !== "LOBBY") throw new RuleError("LOBBY_ONLY");
    if (roster.length < 1 || roster.length > 6 || new Set(roster.map(p => p.id)).size !== roster.length || !roster.some(p => p.id === hostId)) throw new RuleError("PLAYER_COUNT");
    this.#state.players = roster.map((p, seat) => ({ ...p, seat, slots: [] }));
    this.#state.hostId = hostId;
    this.#state.revision++;
  }
  resetLobby(): void {
    if (this.#state.phase !== "ROUND_END") throw new RuleError("ROUND_NOT_FINISHED");
    const s = this.#state;
    s.phase = "LOBBY";
    s.deck = []; s.discard = []; s.grants = [];
    s.result = s.drawn = s.power = s.burn = s.cabo = null;
    s.actionId = s.turnDeadlineAt = s.previewEndsAt = null;
    s.actorIndex = 0;
    for (const p of s.players) { p.slots = []; p.ready = false; }
    s.revision++;
  }
  view(playerId: string, now: number) { return viewFor(this.#state, playerId, now); }
  tick(now: number): boolean {
    const next = advanceTime(this.#state, now, this.#entropy);
    if (next === this.#state) return false;
    this.#state = next;
    return true;
  }
  dispatch(playerId: string, envelope: Envelope, now: number): Receipt {
    // Call only after authenticating the socket and validating the JSON schema.
    // No awaits, external callbacks, database writes, or network I/O in this method.
    this.tick(now);
    if (!this.#state.players.some(p => p.id === playerId)) {
      return { commandId: envelope.commandId, ok: false, revision: this.#state.revision, code: "NOT_A_MEMBER" };
    }
    const history = this.#receipts.get(playerId) ?? new Map();
    this.#receipts.set(playerId, history);
    const fingerprint = canonical({ roundId: envelope.roundId, command: envelope.command });
    const previous = history.get(envelope.commandId);
    if (previous) {
      if (previous.fingerprint === fingerprint) return { ...previous.receipt };
      return { commandId: envelope.commandId, ok: false, revision: this.#state.revision, code: "COMMAND_ID_REUSED" };
    }
    let receipt: Receipt;
    try {
      if (envelope.roundId !== this.#state.roundId) throw new RuleError("STALE_ROUND");
      const transition = reduceCommand(this.#state, playerId, envelope.command, now, this.#entropy);
      this.#state = transition.state; // Single atomic commit, before ack or broadcast.
      receipt = { commandId: envelope.commandId, ok: true, revision: this.#state.revision, code: transition.code };
    } catch (error) {
      if (!(error instanceof RuleError)) throw error;
      receipt = { commandId: envelope.commandId, ok: false, revision: this.#state.revision, code: error.code };
    }
    history.set(envelope.commandId, { fingerprint, receipt });
    if (history.size > 512) history.delete(history.keys().next().value!);
    // Fresh actionId/burnId/roundId checks still reject old gameplay after eviction.
    return { ...receipt };
  }
}
