// Original emblem art for each character, as inline SVG (64×64). Shapes use
// currentColor, so CSS picks the colour per side; details are darker overlays.

const DETAIL = 'rgba(0,0,0,0.35)';

function star(cx, cy, r, points = 5) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (Math.PI * i) / points - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}"/>`;
}

const SHAPES = {
  // A wizard's hat under the stars.
  merlin: `
    <path d="M17 50 L31 9 Q33 6 35 10 L47 50 Z"/>
    <ellipse cx="32" cy="51" rx="24" ry="5.5"/>
    <g fill="${DETAIL}">${star(30, 33, 4)}${star(37, 22, 3)}<rect x="19" y="44" width="26" height="4" rx="2"/></g>
    ${star(52, 12, 4)}${star(12, 20, 3)}`,
  // A knight's shield with a cross.
  percival: `
    <path d="M32 7 L52 13 V30 C52 44 43 52 32 58 C21 52 12 44 12 30 V13 Z"/>
    <g fill="${DETAIL}"><rect x="29" y="15" width="6" height="34" rx="2"/><rect x="19" y="25" width="26" height="6" rx="2"/></g>`,
  // A castle tower.
  servant: `
    <path d="M16 18 h6 v5 h5 v-5 h10 v5 h5 v-5 h6 v40 H16 Z"/>
    <path d="M27 58 V46 a5 5 0 0 1 10 0 V58 Z" fill="${DETAIL}"/>
    <rect x="29" y="27" width="6" height="9" rx="3" fill="${DETAIL}"/>
    <path d="M32 18 V5 l10 4 l-10 4" stroke="currentColor" stroke-width="2" fill="currentColor"/>`,
  // A dagger.
  assassin: `
    <g transform="rotate(-40 32 32)">
      <path d="M29 4 h6 l1 34 h-8 Z"/>
      <rect x="20" y="37" width="24" height="6" rx="3"/>
      <rect x="28.5" y="43" width="7" height="13" rx="2" fill="${DETAIL}"/>
      <circle cx="32" cy="59" r="4"/>
      <path d="M32 6 V36" stroke="${DETAIL}" stroke-width="1.5"/>
    </g>`,
  // A crescent moon and a star.
  morgana: `
    <path d="M38 6 A26 26 0 1 0 38 58 A34 34 0 0 1 38 6 Z"/>
    ${star(46, 26, 7)}`,
  // A spiked dark crown.
  mordred: `
    <path d="M8 48 L12 16 L23 30 L32 10 L41 30 L52 16 L56 48 Z"/>
    <rect x="8" y="47" width="48" height="8" rx="2"/>
    <g fill="${DETAIL}"><circle cx="20" cy="51" r="2.5"/><circle cx="32" cy="51" r="2.5"/><circle cx="44" cy="51" r="2.5"/></g>`,
  // A single watching eye.
  oberon: `
    <path d="M4 32 Q32 4 60 32 Q32 60 4 32 Z"/>
    <circle cx="32" cy="32" r="11" fill="${DETAIL}"/>
    <circle cx="32" cy="32" r="5"/>
    <path d="M10 14 L16 20 M54 14 L48 20 M32 4 V11" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`,
  // A hooded figure.
  minion: `
    <path d="M32 6 C17 6 12 22 12 34 L8 58 H56 L52 34 C52 22 47 6 32 6 Z"/>
    <ellipse cx="32" cy="32" rx="11" ry="13" fill="${DETAIL}"/>
    <g fill="currentColor"><circle cx="27.5" cy="32" r="2"/><circle cx="36.5" cy="32" r="2"/></g>`,
};

/** Inline SVG emblem for a role; `size` in px. Decorative, so hidden from screen readers. */
export function emblem(role, size = 64, className = '') {
  return `<svg class="emblem ${className}" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true" fill="currentColor">${SHAPES[role] ?? ''}</svg>`;
}

/** Small interface icons (24×24, stroked). */
const ICONS = {
  history: '<path d="M4 5h13a3 3 0 0 1 3 3v11H7a3 3 0 0 1-3-3Z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  rules: '<path d="M12 6c-2-1.5-5-2-8-1.5V19c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V4.5C17 4 14 4.5 12 6Z"/><path d="M12 6v14.5"/>',
  'sound-on': '<path d="M4 9h4l5-4v14l-5-4H4Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  'sound-off': '<path d="M4 9h4l5-4v14l-5-4H4Z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};

export function icon(name) {
  return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}
