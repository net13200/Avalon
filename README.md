# Avalon

A serverless, phone-per-player digital adaptation of the hidden-role game *The Resistance: Avalon*, for 5–10 players sitting together or playing remotely. No AI bots: every seat is a real person on their own phone.

## Plan

The host's phone runs the game and holds the full state. The other phones connect to it directly over WebRTC (peer to peer) and receive only what their player is allowed to see. The app is a static PWA, built without a build step, like the other Sugi games.

1. ✅ **Rules engine and tests**: pure, framework-free game logic.
2. ✅ **Local prototype**: the full app, played across browser tabs connected via `BroadcastChannel`.
3. ✅ **WebRTC**: phones connect peer to peer, join with a room code or QR code, and rejoin after a reload.
4. ✅ **Reliability**: keepalive detection of dropped connections, screen wake lock, version check, installable PWA.
5. ✅ **Polish**: original character emblems, synthesized sound and vibration, game history, rules sheet, reveal animations.
6. ✅ **SugiGames portal**: a card on the "Game night" shelf of [SugiGames](https://github.com/net13200/SugiGames).

## Playing on phones

1. Put the app on any static HTTPS host, for example GitHub Pages. It has no build step and no server code.
2. One player taps **Host a new game**. Their phone shows a 4-letter room code and a QR code.
3. The others scan the QR code, or open the app and type the code. Players can sit together or play remotely; remote players will want a voice or video call alongside.
4. The host's phone must stay open for the whole game, because it runs the game.

A phone that reloads, sleeps or loses its connection rejoins its seat automatically. If the host's phone reloads, the game resumes from its saved state and the others reconnect. Someone who opens the link after the game has started is turned away.

- **Screen stays on:** while you're in a room, the app asks the phone to keep the screen awake, because a sleeping phone drops out. The host's page also asks for confirmation before it's closed mid-game.
- **Dropped connections:** phones exchange small keepalive messages every 3 seconds. A phone silent for 10 seconds is shown as offline, and players whose host goes silent see "Lost the host. Reconnecting…".
- **Install:** "Add to Home Screen" installs Avalon as an app. It then opens without downloading anything. Playing still needs the internet, to find the other phones.
- **Updates:** a new version reaches each phone the next time it loads the app. If a phone and the host run incompatible versions, the player is asked to reload instead of getting errors.

### How the connection works

- **Finding each other:** the host's phone registers the room code (as the id `sugi-avalon-<code>`) with the free public [PeerJS](https://peerjs.com) server, and the others look it up there. That server only introduces the phones. It never sees game messages.
- **Playing:** game messages travel over encrypted WebRTC data channels, directly between each player's phone and the host's. On networks that block direct connections, PeerJS's public TURN servers relay the encrypted traffic.
- **Seat ownership:** each device keeps a random player id and a secret in `localStorage`. Other players can see the ids, but only the device holding a seat's secret can take that seat.
- **Self-hosting:** if the public PeerJS server is ever down, run your own (`npm run signal`) and open the app with `?signal=your-host:port`.

## Developing

The page uses ES modules, so it must be served over HTTP rather than opened as a file:

```
npm install            # only needed for the local PeerJS server and e2e tests
npm run serve          # http://localhost:8000
```

- **`dev.html`, the test table**: every seat of a 5–10 player game on one screen, each in its own frame. Seat 1 hosts. By default the frames talk over `BroadcastChannel`. For real WebRTC, run `npm run signal` and open `dev.html?net=peer&signal=localhost:9000`.
- **Caching:** the service worker is skipped on `localhost` (and with `?sw=0`), so edits show up on reload.
- **`index.html`**: the real app. Add `?net=local` to connect tabs of one browser without WebRTC. Tabs of one browser share `localStorage`, so for WebRTC tests across tabs use the test table, which gives each frame its own player id.

### How a game plays

- **Lobby:** the host orders the seats to match where people sit. The leader passes in seat order. The host also picks the characters: Merlin & Assassin and Percival & Morgana are on by default, and Mordred, Oberon and Lady of the Lake are optional.
- **Your role:** hold the button at the bottom of the screen to see your role and what you know. It hides as soon as you let go. The button pulses until you've looked once.
- **Team building:** the leader taps players to build the team, then proposes it.
- **Voting:** everyone votes on their own phone. The votes are revealed together under "Last vote".
- **Quest:** team members play Success or Fail in secret. Good players' Fail button is disabled. Only the number of Fail cards is announced.
- **Lady of the Lake and the assassination:** the player whose turn it is taps a target on the player list.
- **End:** all roles are revealed, and the host can return everyone to the lobby for another game.
- **Header buttons:**
  - **History:** every proposal of the game, with who approved and who rejected, grouped by quest, plus quest results and Lady of the Lake checks.
  - **How to play:** a rules summary with the team-size table.
  - **Sound:** on or off. The setting is remembered on each phone.

**Sound and vibration:** effects play for a new game, your turn, vote results, quest results and the end of the game. Only public events make a sound, so a sound can't give away anyone's role. For the same reason, the Assassin's turn is silent. The sounds are synthesized with the Web Audio API, so there are no audio files.

### Code layout

| Path | What |
|---|---|
| `src/rules.js`, `src/game.js`, `src/view.js` | rules engine (below) |
| `src/host.js` | `HostSession`: lobby, seats, game state and messages. Doesn't depend on any network. |
| `src/net/peer.js` | WebRTC transport (PeerJS) with automatic reconnection |
| `src/net/local.js` | `BroadcastChannel` transport for development, with the same interface |
| `src/ui/` | `app.js` (wiring and events), `render.js` (HTML from state), `text.js` (English text), `art.js` (character emblems and icons, inline SVG), `sound.js` (synthesized effects), `events.js` (works out what just happened, for sounds and animations) |
| `vendor/` | PeerJS and a QR code generator, copied unmodified from npm (MIT) |
| `sw.js`, `manifest.webmanifest`, `icon*` | service worker, install manifest and icons. `icon.svg` and `icon-maskable.svg` are the sources for the PNGs. |
| `dev.html` | the test table |

The host's own player talks to its `HostSession` directly. Every other device sends `C2H` messages and receives `H2C` messages (see `src/host.js`). A connection becomes a seat by saying hello with that seat's secret. The host then attributes every action to the connection's seat, so a device can't act as someone else.

In local mode, every tab can technically read every message on the channel. Over WebRTC, each connection carries only its own player's messages.

## Rules engine

`src/` is plain ES modules with no dependencies. It runs in browsers and Node.

```js
import { createGame, reduce, viewFor, ACTIONS } from './src/index.js';

let state = createGame(
  [{ id: 'a', name: 'Ann' }, /* … 5–10 players in seating order */],
  { roles: ['merlin', 'assassin', 'percival', 'morgana'], ladyOfTheLake: true },
);

state = reduce(state, { type: ACTIONS.PROPOSE_TEAM, playerId: 'a', team: ['a', 'b'] });
const annSees = viewFor(state, 'a'); // send this, and only this, to Ann's phone
```

- `createGame(players, options, rng?)` deals roles and picks the first leader. `rng` defaults to `crypto.getRandomValues`.
- `reduce(state, action)` returns a new state and never modifies its input. It throws a `RuleError` with a stable `code` for illegal actions.
- `viewFor(state, playerId)` returns public information plus that player's secrets: their role, who they saw in the night phase, their own vote or quest card, and their Lady of the Lake results. Roles are revealed to everyone only at `GAME_OVER`.
- `awaiting(state)` lists the players the game is waiting on.

### Phases and actions

| Phase | Action | Who |
|---|---|---|
| `TEAM_BUILD` | `PROPOSE_TEAM { team }` | leader |
| `TEAM_VOTE` | `VOTE { approve }` | everyone |
| `QUEST` | `PLAY_QUEST_CARD { success }` | team members (good players must play Success) |
| `LADY` | `LADY_EXAMINE { targetId }` | Lady of the Lake holder, after quests 2–4 |
| `ASSASSINATION` | `ASSASSINATE { targetId }` | Assassin, after 3 successful quests |
| `GAME_OVER` | — | — |

Every action also carries `playerId`.

### Rules implemented

- 5–10 players. Evil count is 2/2/3/3/3/4 for 5–10 players.
- Quest team sizes follow the rulebook table. With 7 or more players, the 4th quest needs 2 Fail cards to fail.
- Ties reject a team. Five rejections in a row means evil wins.
- Quest results keep only the number of Fail cards, never who played them.
- Characters are Merlin with the Assassin (must be used together), Percival, Morgana (requires Percival), Mordred and Oberon. The night phase is modelled exactly: Merlin doesn't see Mordred, evil players don't see Oberon, Oberon sees no one, and Percival sees Merlin and Morgana without knowing which is which.
- Lady of the Lake: the token starts with the player to the right of the first leader and is used after quests 2, 3 and 4. A player can't examine themselves or a past holder. Only the holder learns the result.

## Tests

```
npm test
```

The tests use Node's built-in test runner (Node 20+), with no install needed. They include a simulation that plays over 1,000 random legal games for every player count and set of characters, and checks that each one ends correctly.

End to end:

```
npm run e2e              # needs Playwright with Chromium, and npm install
NET=local npm run e2e    # BroadcastChannel only; NET=peer for WebRTC only
SHOTS=shots npm run e2e  # also saves phone-sized screenshots of each phase
```

This plays complete games in Chromium, with one page per player. It runs them twice: once over `BroadcastChannel`, and once over real WebRTC through a local PeerJS server it starts itself. The WebRTC run also reloads a player's page and then the host's page mid-game and checks that everyone reconnects. Both runs check that a stranger can't join a game in progress. The WebRTC run also checks three more things:
- When a player loses their network, the host marks them offline within about 10 seconds, and they rejoin when the network returns.
- When the host loses its network, players see "Lost the host", and everyone reconnects when it returns.
- A phone running an outdated version is asked to reload.

The suite also checks that the app is installable and opens offline from the cache.
