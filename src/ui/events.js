// Works out what just happened between two views of the game, for sounds and
// animations. Pure, so it can be tested without a browser.

/**
 * @returns {{ sounds: { name: string, delay: number }[], fresh: { vote?: number, quest?: number } }}
 *   sounds to play in order; `fresh` marks the vote (history index) and quest
 *   (index) that were just revealed, so they can be animated.
 */
export function changes(before, after, pid) {
  const sounds = [];
  const fresh = {};
  let delay = 0;
  const add = (name, gap = 0.6) => {
    sounds.push({ name, delay });
    delay += gap;
  };

  if (!before) {
    // A new game; joining or rejoining a game in progress is silent.
    if (after.history.length === 0 && after.phase !== 'GAME_OVER') add('start', 1.4);
  } else {
    if (after.history.length > before.history.length) {
      fresh.vote = after.history.length - 1;
      add(after.history.at(-1).approved ? 'approved' : 'rejected');
    }
    if (after.questResults.length > before.questResults.length) {
      fresh.quest = after.questResults.length - 1;
      add(after.questResults.at(-1).success ? 'success' : 'fail', 1);
    }
    if (after.phase === 'GAME_OVER' && before.phase !== 'GAME_OVER') {
      add(after.winner === after.me.side ? 'win' : 'lose');
      return { sounds, fresh };
    }
  }

  // Your turn. The Assassin's turn stays silent: a sound would point at them.
  const nowMine = after.awaiting.includes(pid) && after.phase !== 'ASSASSINATION';
  const wasMine = before && before.phase === after.phase && before.quest === after.quest
    && before.history.length === after.history.length && before.awaiting.includes(pid);
  if (nowMine && !wasMine) add('turn');

  return { sounds, fresh };
}
