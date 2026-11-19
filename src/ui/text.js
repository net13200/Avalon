// Player-facing English text.

export const ROLE_TEXT = {
  merlin: 'You know who is evil. Guide the good players without being obvious: if good wins, the Assassin gets one guess at who you are.',
  percival: 'You know who could be Merlin. Protect Merlin, and watch out for Morgana pretending to be Merlin.',
  servant: 'You have no special knowledge. Watch the votes and quests, and work out who to trust.',
  assassin: 'Fail quests without getting caught. If good wins three quests, you get one guess at Merlin to steal the win.',
  morgana: 'Fail quests without getting caught. Percival sees you as a possible Merlin, so act like Merlin.',
  mordred: 'Fail quests without getting caught. Merlin cannot see you.',
  oberon: 'You are evil but alone: the other evil players do not know you, and you do not know them. Merlin can see you.',
  minion: 'Fail quests without getting caught. Work with the other evil players.',
};

export const CHARACTER_OPTIONS = [
  { key: 'merlin', roles: ['merlin', 'assassin'], label: 'Merlin & Assassin', hint: 'Merlin knows evil; the Assassin can steal a good win.' },
  { key: 'percival', roles: ['percival', 'morgana'], label: 'Percival & Morgana', hint: 'Percival sees Merlin and Morgana but not which is which.', needs: 'merlin' },
  { key: 'mordred', roles: ['mordred'], label: 'Mordred', hint: 'Evil, hidden from Merlin.' },
  { key: 'oberon', roles: ['oberon'], label: 'Oberon', hint: 'Evil, but unknown to the other evil players.' },
];

export const WIN_TEXT = {
  'three-successes': 'Good completed three quests.',
  'merlin-survived': 'Good completed three quests and the Assassin missed Merlin.',
  'three-fails': 'Evil sabotaged three quests.',
  'five-rejections': 'Five teams in a row were rejected.',
  'merlin-assassinated': 'The Assassin found Merlin.',
};

export const PHASE_TITLE = {
  TEAM_BUILD: 'Choosing a team',
  TEAM_VOTE: 'Vote on the team',
  QUEST: 'On the quest',
  LADY: 'Lady of the Lake',
  ASSASSINATION: 'The Assassin strikes',
  GAME_OVER: 'Game over',
};
