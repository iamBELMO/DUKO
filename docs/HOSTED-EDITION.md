# DUKO CLUB — hosted edition 0.5

Arabic 2–6 player card game. This edition runs on a hosted Cloudflare Worker with D1 storage through Sites. It does not contact the original localhost server or a temporary tunnel. Room membership, shuffled cards, turn state, bot memory and command receipts live server-side.

## Development and publishing

Use the Sites skill's install/build/source helpers and preserve `.openai/hosting.json`. The D1 binding is `DB`. Schema lives in `db/schema.ts`; generate migrations with `npm run db:generate` and publish through Sites so migrations are applied before the Worker.

Checks:

```sh
node --test test/*.test.ts test/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

## Request and privacy model

- A random 256-bit HttpOnly cookie identifies an anonymous game seat; this is a guest game session, not an external account system. Sites controls site-wide access and its optional ChatGPT authentication. The game does not implement or replace Sites sign-in routes.
- An independent session is used for each browser/device. A tab identifier prevents two tabs in one browser from simultaneously controlling a seat.
- Every API command authenticates the session, validates its exact schema, checks room membership, and passes only the authorized player ID into the engine. POST requests require a matching Origin.
- `RoomActor` is recreated per request from D1. The room row has a database version distinct from the game revision. Every update uses `UPDATE ... WHERE version = ?`; a conflict reloads and re-evaluates the command. Membership and active-tab guards are included in the same SQL update for commands. Cards and receipts commit in one room payload write.
- Duplicate delivery receipts are retained for the latest 64 commands per player. Older gameplay still has round, turn, burn and slot-version guards. No browser receives the deck, receipt history or bot memory.
- The client uses HTTPS commands and adaptive polling, normally every 180 ms after each response during active play, 1 second in the lobby, and 2 seconds when hidden. This edition does not claim a persistent WebSocket connection. No room state is trusted to an isolate's memory.
- Bots and deadlines advance when active clients poll or submit commands. When every browser is closed, the room remains saved; overdue deadlines are evaluated on the next request. There is no background game-running process or precise offline timer guarantee.
- Burn arbitration is first valid committed server action. Network and database latency affect races. Each burn window remains 1.5 seconds. At most one valid action commits per window. That winner opens a fresh window with a different ID, so further matching cards can burn in sequence, including from the original discarder or previous winner. A stale attempt is never penalized.
- Rooms with no state changes expire after seven days; guest sessions expire after 30 days. Bounded expiry cleanup runs when new sessions are created. There are no real-money features, chat, uploads or public room listing.

## Rules and interaction in 0.5

- Everyone may burn during an open window, including the discarder, regardless of whose turn it is. Matching remains by rank. Every valid burn resets the 1.5-second window with a new ID; the original power and turn are preserved. Scoring waits until the final chain ends.
- `DRAW_FIRE` holds the current public fire card privately for the active player. The player can then use `REPLACE_DRAWN` or `DISCARD_DRAWN`. Returning a fire-sourced card never activates a power, but opens a burn window. The existing atomic `TAKE_FIRE` gesture and bot behavior remain compatible.
- Old persisted rounds retain their original burn rules until the next `START`, when rooms without `chainBurns` adopt the new rules. Existing room codes, sessions, host selection and scoring are preserved.
- The visible round-ending declaration is **دوكو**. The internal `CABO` command/property is unchanged for compatibility. All scores and 7–10 powers retain their existing semantics.
- Tap fire to hold it, then drag it over an occupied own card to replace that exact slot, or drag it back to fire. A direct fire-to-slot drag also performs the exchange. Tap controls remain available.
- Drag an own card to fire to burn. The tap alternative is selecting the own card and then the fire pile; the burn action explicitly selects this mode when power selection is also available.
- Captured drags validate the round, action, burn window and slot version. Room repainting waits for the gesture, and expired/stale gestures cancel without a command. Reconnection retains authoritative state.

## Visual and audio implementation

- Royal blue UI, deep navy felt, restrained amber fire accents; shared CSS color, spacing, radius, shadow, duration and layer tokens. Tahoma / Segoe UI / Arial Arabic typography is retained.
- Telegram is the first banner, above the header, linking to [BELMO](https://t.me/iamBELMO).
- Vector suit icons, correctly counted pip layouts, real corner indices, a DUKO patterned back, a foil Joker and simplified small opponent faces. No image downloads or font dependencies.
- Responsive fan-shaped own hands retain physical slot order. Desktop opponent seats form an oval; narrow layouts wrap seats. Pointer dragging uses one animation frame per repaint.
- Native Web Animations / FLIP handle dealing, drawing, public discards, page changes, selection and reveals. Lightweight embers, a felt light sweep, timer arcs and result counters provide feedback. All heavy effects respect reduced motion; animations never submit moves.
- Card motion snapshots store geometry only. A discard ghost copies the current public fire card, never an old private face. Effects clear when reveals expire or the page hides.
- Sound hooks synthesize soft deal/flip/draw/discard/fire/win/lose/click cues. The existing sound toggle gates playback and optional mobile vibration. No new dependency or audio asset is needed.
- Keyboard alternatives: D draw, F hold fire, B select burn, K announce Duko; shortcuts do not run in inputs or modals. Modal focus is contained, background controls are inert, controls have Arabic labels and visible focus styles.
- The service worker shell is versioned 0.5.0 and includes all three new browser modules. Live state is never cached by the service worker.

See [the complete Arabic update guide](docs/UPDATE-0.5-AR.md) for changed files and manual checks.

## Verification boundaries

The suite has 48 core, hosted API, gesture and UI integration tests. Gesture tests run replacements through the real engine and check stale drops, burn expiry, wrong-burn penalties and cancellation. Hosted tests use a SQLite-backed asynchronous adapter for D1 statements and cover concurrent joins, duplicate commands, concurrent burns, privacy, tab replacement, host transfer, bot memory and Duko completion. UI tests execute real game transitions through the click handlers and validate generated markup; they are not browser layout tests. Build and TypeScript checks run before deployment. Automated browser visual QA is unavailable in the current managed environment; no claim of visual browser or physical touch-device verification is made.

The original local Node/WebSocket installer remains separate and unchanged. Existing local rooms are not imported into the hosted database; create a new room at the hosted URL.
