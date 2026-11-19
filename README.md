# Avalon

A serverless, phone-per-player digital adaptation of the hidden-role game *The Resistance: Avalon*, for 5–10 players sitting together or playing remotely. No AI bots: every seat is a real person on their own phone.

## Plan

The host's phone runs the game and holds the full state. The other phones connect to it directly over WebRTC (peer to peer) and receive only what their player is allowed to see. The app is a static PWA, built without a build step, like the other Sugi games.

1. ✅ **Rules engine and tests**: pure, framework-free game logic.
2. ✅ **Local prototype**: the full app, played across browser tabs connected via `BroadcastChannel`.
3. WebRTC host and join with a QR code and room code, and private views per phone.
4. Reliability: reconnecting, recovering the host's state, wake lock, offline install.
5. Polish: original art, sound, game history.
6. Add a card to the SugiGames portal.

## Try it

The page uses ES modules, so it must be served over HTTP rather than opened as a file:

```
npm run serve          # http://localhost:8000
```

- **`dev.html`, the test table**: every seat of a 5–10 player game on one screen, each in its own frame. Seat 1 hosts. Use it to play a whole game yourself.
- **`index.html`**: the real app. Host a game in one tab and join it from other tabs of the same browser with the room code. Until milestone 3, players can only connect within one browser.

### How a game plays

- **Lobby:** the host orders the seats to match where people sit. The leader passes in seat order. The host also picks the characters: Merlin & Assassin and Percival & Morgana are on by default, and Mordred, Oberon and Lady of the Lake are optional.
- **Your role:** hold the button at the bottom of the screen to see your role and what you know. It hides as soon as you let go.
- **Team building:** the leader taps players to build the team, then proposes it.
- **Voting:** everyone votes on their own phone. The votes are revealed together under "Last vote".
- **Quest:** team members play Success or Fail in secret. Good players' Fail button is disabled. Only the number of Fail cards is announced.
- **Lady of the Lake and the assassination:** the player whose turn it is taps a target on the player list.
- **End:** all roles are revealed, and the host can return everyone to the lobby for another game.

### Code layout

| Path | What |
|---|---|
| `src/rules.js`, `src/game.js`, `src/view.js` | rules engine (below) |
| `src/host.js` | `HostSession`: lobby, game state and messages. Doesn't depend on any network. |
| `src/net/local.js` | `BroadcastChannel` transport. Milestone 3 adds a WebRTC transport with the same shape. |
| `src/ui/` | `app.js` (wiring and events), `render.js` (HTML from state), `text.js` (English text) |
| `dev.html` | the test table |

The host's own player talks to its `HostSession` directly. Every other device sends `C2H` messages and receives `H2C` messages (see `src/host.js`). The host fills in `playerId` from the sender, so a device can't act as someone else.

In local mode, every tab can technically read every message on the channel. Each WebRTC connection will only carry its own player's view.

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
npm run e2e            # needs Playwright with Chromium
SHOTS=shots npm run e2e   # also saves phone-sized screenshots of each phase
```

This plays complete 5-, 7- and 10-player games in Chromium, with one page per player connected over `BroadcastChannel`.
