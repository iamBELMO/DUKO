import { randomInt, randomUUID } from "node:crypto";
import type { Card, CardFace, Entropy, Rules, StandardRank, Suit } from "./models.ts";

export const secureEntropy: Entropy = { id: randomUUID, int: max => randomInt(max) };
export function makeDeck(entropy: Entropy = secureEntropy): Card[] {
  const suits: Suit[] = ["hearts", "diamonds", "clubs", "spades"];
  const ranks: StandardRank[] = ["A", 2, 3, 4, 5, 6, 7, 8, 9, 10, "J", "Q", "K"];
  const cards: Card[] = [];
  for (const suit of suits) for (const rank of ranks) cards.push({ id: entropy.id(), rank, suit });
  cards.push({ id: entropy.id(), rank: "JOKER", suit: null });
  cards.push({ id: entropy.id(), rank: "JOKER", suit: null });
  return cards;
}
export function shuffle<T>(items: readonly T[], entropy: Entropy = secureEntropy): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = entropy.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
export const face = (card: Card): CardFace => ({ rank: card.rank, suit: card.suit });
export function scoreCard(card: CardFace): number {
  if (card.rank === "JOKER") return -2;
  if (card.rank === "A") return 0;
  if (card.rank === "K") return card.suit === "hearts" || card.suit === "diamonds" ? -1 : 13;
  if (card.rank === "J") return 11;
  if (card.rank === "Q") return 13;
  return card.rank;
}
function color(card: Card) {
  if (card.rank === "JOKER") return "joker";
  return card.suit === "hearts" || card.suit === "diamonds" ? "red" : "black";
}
export function burnMatches(a: Card, b: Card, mode: Rules["burnMatch"]): boolean {
  if (a.rank !== b.rank) return false;
  if (mode === "rank-and-color") return color(a) === color(b);
  if (mode === "rank-and-suit") return a.suit === b.suit;
  return true;
}
