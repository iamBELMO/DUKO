// SERVER ONLY. Do not import RoomState into the browser's state store.
export type PlayerId = string;
export type Suit = "hearts" | "diamonds" | "clubs" | "spades";
export type StandardRank = "A" | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | "J" | "Q" | "K";
export type Rank = StandardRank | "JOKER";
export type Card =
  | { id: string; rank: StandardRank; suit: Suit }
  | { id: string; rank: "JOKER"; suit: null };
export type CardFace = { rank: Rank; suit: Suit | null };

export interface Slot {
  id: string;                 // Stable board position, never the card identity.
  version: number;            // Increments whenever its card changes.
  card: Card | null;          // null after a successful burn; keep the visual gap.
}
export interface Player {
  id: PlayerId;
  name: string;
  seat: number;
  connected: boolean;
  ready: boolean;
  slots: Slot[];              // Left to right in physical screen coordinates.
}
export interface Rules {
  initialPeekMs: number;
  powerPeekMs: number;
  burnWindowMs: number;
  turnMs: number;
  burnMatch: "rank" | "rank-and-color" | "rank-and-suit";
  discarderCanBurn: boolean;
  chainBurns?: boolean;       // Absent only in rooms saved before the Duko rules update.
}
export type Phase = "LOBBY" | "INITIAL_PEEK" | "TURN_START" | "DRAWN" | "POWER" | "WAIT_BURN" | "ROUND_END";
export interface SlotRef { slotId: string; version: number }
export interface TargetRef extends SlotRef { playerId: PlayerId }
export interface RevealGrant extends TargetRef {
  viewerId: PlayerId;
  expiresAt: number;
}
export interface Power {
  rank: 7 | 8 | 9 | 10;
  actorId: PlayerId;
  stage: "SELECT" | "DECIDE_10";
  inspected: TargetRef | null;
}
export interface BurnWindow {
  id: string;
  target: Card;
  discarderId: PlayerId;
  endsAt: number;
  attemptedBy: PlayerId[];    // At most one attempt per player per window.
  chainId?: string;
  sequence?: number;
}
export interface RoundResult {
  reason: "CABO" | "DECK_EXHAUSTED";
  scores: { playerId: PlayerId; total: number }[];
  winners: PlayerId[];        // All tied lowest scores win.
}
export interface RoomState {
  id: string;
  hostId: PlayerId;
  rules: Rules;
  phase: Phase;
  players: Player[];
  roundId: string | null;
  revision: number;
  deck: Card[];
  discard: Card[];
  actorIndex: number;
  actionId: string | null;
  turnDeadlineAt: number | null;
  previewEndsAt: number | null;
  drawn: { playerId: PlayerId; card: Card; source?: "deck" | "fire" } | null;
  power: Power | null;
  burn: BurnWindow | null;
  cabo: { callerId: PlayerId; remainingPlayerIds: PlayerId[] } | null;
  grants: RevealGrant[];
  result: RoundResult | null;
}

type TurnCommand = { actionId: string };
export type Command =
  | { type: "READY"; ready: boolean }
  | { type: "START" }
  | ({ type: "DRAW_DECK" } & TurnCommand)
  | ({ type: "DRAW_FIRE" } & TurnCommand)
  | ({ type: "TAKE_FIRE"; own: SlotRef } & TurnCommand)
  | ({ type: "REPLACE_DRAWN"; own: SlotRef } & TurnCommand)
  | ({ type: "DISCARD_DRAWN" } & TurnCommand)
  | ({ type: "POWER_7"; own: SlotRef } & TurnCommand)
  | ({ type: "POWER_8"; target: TargetRef } & TurnCommand)
  | ({ type: "POWER_9"; own: SlotRef; target: TargetRef } & TurnCommand)
  | ({ type: "POWER_10_PEEK"; target: TargetRef } & TurnCommand)
  | ({ type: "POWER_10_SWAP"; own: SlotRef } & TurnCommand)
  | ({ type: "SKIP_POWER" } & TurnCommand)
  | ({ type: "CABO" } & TurnCommand)
  | { type: "BURN"; burnId: string; own: SlotRef };

export interface Entropy {
  id(): string;
  int(maxExclusive: number): number;
}
export interface Receipt {
  commandId: string;
  ok: boolean;
  revision: number;
  code: string;
}
