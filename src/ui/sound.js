// Sound effects, synthesized with the Web Audio API (no audio files), plus vibration.
// Only public events make a sound, so a sound never gives away anyone's role.

let ctx = null;
let muted = false;

/** Browsers only allow audio after a user gesture: call this from one. */
export function unlockAudio() {
  if (!ctx) {
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

export const setMuted = (m) => { muted = m; };
export const isMuted = () => muted;

/** One note: frequency (Hz), start offset and length (s), waveform, peak volume. */
function note(freq, at, length, { type = 'triangle', volume = 0.2, slideTo = null } = {}) {
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + length);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + length + 0.05);
}

const N = { C3: 130.8, F3: 174.6, Ab3: 207.7, C4: 261.6, Eb4: 311.1, E4: 329.6, G4: 392, A4: 440, C5: 523.3, E5: 659.3, G5: 784, B5: 987.8, C6: 1046.5 };

const SOUNDS = {
  // A game begins: a low bell.
  start: () => {
    note(N.C3, 0, 1.8, { type: 'sine', volume: 0.3 });
    note(N.C4 * 1.5, 0, 1.2, { type: 'sine', volume: 0.08 });
    note(N.C5, 0.02, 0.9, { type: 'sine', volume: 0.05 });
  },
  // It is your turn: a bright two-note chime.
  turn: () => {
    note(N.E5, 0, 0.35);
    note(N.B5, 0.12, 0.5);
  },
  // All votes are in.
  approved: () => {
    note(N.E4, 0, 0.25);
    note(N.A4, 0.1, 0.4);
  },
  rejected: () => {
    note(N.A4, 0, 0.25, { type: 'square', volume: 0.07 });
    note(N.E4, 0.12, 0.4, { type: 'square', volume: 0.07 });
  },
  // Quest results: a rising fanfare, or a sinking sting.
  success: () => [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => note(f, i * 0.11, i === 3 ? 0.7 : 0.25, { volume: 0.18 })),
  fail: () => {
    [N.C4, N.Ab3, N.F3].forEach((f, i) => note(f, i * 0.16, 0.5, { type: 'sawtooth', volume: 0.06 }));
    note(N.F3 / 2, 0.32, 0.9, { type: 'sine', volume: 0.2 });
  },
  win: () => [N.C5, N.E5, N.G5, N.C6, N.G5, N.C6].forEach((f, i) => note(f, i * 0.13, i === 5 ? 1.2 : 0.3, { volume: 0.16 })),
  lose: () => [N.G4, N.Eb4, N.C4, N.C3].forEach((f, i) => note(f, i * 0.25, i === 3 ? 1.2 : 0.4, { type: 'sine', volume: 0.22 })),
};

const BUZZ = { turn: [60, 60, 60], start: [120], win: [80, 60, 160], lose: [300] };

/** Plays a named sound after `delay` seconds; vibrates too where supported. */
export function play(name, delay = 0) {
  if (muted) return;
  setTimeout(() => {
    if (BUZZ[name]) navigator.vibrate?.(BUZZ[name]);
    if (!ctx || ctx.state !== 'running') return;
    try { SOUNDS[name]?.(); } catch { /* audio is a nicety */ }
  }, delay * 1000);
}
