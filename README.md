# Avalon

A serverless, phone-per-player digital adaptation of the hidden-role game *The Resistance: Avalon*, for 5–10 players sitting together or playing remotely. No AI bots: every seat is a real person on their own phone.

## Plan

The host's phone runs the game and holds the full state. The other phones connect to it directly over WebRTC (peer to peer) and receive only what their player is allowed to see. The app is a static PWA, built without a build step, like the other Sugi games.

1. **Rules engine and tests** (this milestone): pure, framework-free game logic.
2. Local prototype: several browser tabs connected via `BroadcastChannel`.
3. WebRTC host and join with a QR code and room code, and private views per phone.
4. Reliability: reconnecting, recovering the host's state, wake lock, offline install.
5. Polish: original art, sound, game history, Lady of the Lake UI.
6. Add a card to the SugiGames portal.

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
