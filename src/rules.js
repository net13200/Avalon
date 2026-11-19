// Static rules data for Avalon: player counts, quest sizes and characters.

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 10;
export const QUEST_COUNT = 5;
export const QUESTS_TO_WIN = 3;
export const MAX_REJECTIONS = 5;

export const GOOD = 'good';
export const EVIL = 'evil';

/** Number of evil players for each player count. */
export const EVIL_COUNT = { 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4 };

/** Team size for each of the five quests, by player count. */
export const QUEST_SIZES = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
};

export const ROLES = {
  merlin: { side: GOOD, name: 'Merlin' },
  percival: { side: GOOD, name: 'Percival' },
  servant: { side: GOOD, name: 'Loyal Servant of Arthur' },
  assassin: { side: EVIL, name: 'Assassin' },
  morgana: { side: EVIL, name: 'Morgana' },
  mordred: { side: EVIL, name: 'Mordred' },
  oberon: { side: EVIL, name: 'Oberon' },
  minion: { side: EVIL, name: 'Minion of Mordred' },
};

/** Characters a host may switch on. Servants and minions fill the remaining seats. */
export const SPECIAL_ROLES = ['merlin', 'assassin', 'percival', 'morgana', 'mordred', 'oberon'];

export const DEFAULT_OPTIONS = Object.freeze({
  roles: ['merlin', 'assassin', 'percival', 'morgana'],
  ladyOfTheLake: false,
});

/** Quests (0-based) after which the Lady of the Lake is used: after quests 2, 3 and 4. */
export const LADY_AFTER_QUESTS = [1, 2, 3];

export const sideOf = (role) => ROLES[role].side;

export const goodCount = (n) => n - EVIL_COUNT[n];

/** Fail cards needed to fail a quest: 2 on the 4th quest with 7 or more players. */
export const failsRequired = (playerCount, questIndex) =>
  questIndex === 3 && playerCount >= 7 ? 2 : 1;
