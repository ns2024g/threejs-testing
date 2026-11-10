// Frames the game in an old CRT TV: a dark plastic bezel around a slightly bulged, rounded
// screen, a soft shadow where the glass meets the bezel, a faint glass reflection and a dim
// power light. Kept subtle so it frames the game without taking it over.

const BEZEL = 0.035;          // bezel thickness (fraction of the screen size)
const BULGE = 0.012;          // how much the screen edges bow outward, like curved glass
const CORNER = 0.05;          // how rounded the screen corners are
const BEZEL_COLOR_TOP = '#171614';
const BEZEL_COLOR_BOTTOM = '#0b0a09';

export function addTvFrame() {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 1000 1000');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:6;';

  // The screen opening: a rounded rectangle whose sides bow outward slightly
  const m = BEZEL * 1000, b = BULGE * 1000, r = CORNER * 1000;
  const L = m, T = m, R = 1000 - m, B = 1000 - m;
  const screen = `M ${L + r} ${T}
    Q 500 ${T - b} ${R - r} ${T}  Q ${R} ${T} ${R} ${T + r}
    Q ${R + b} 500 ${R} ${B - r}  Q ${R} ${B} ${R - r} ${B}
    Q 500 ${B + b} ${L + r} ${B}  Q ${L} ${B} ${L} ${B - r}
    Q ${L - b} 500 ${L} ${T + r}  Q ${L} ${T} ${L + r} ${T} Z`;

  svg.innerHTML = `
    <defs>
      <linearGradient id="tv-plastic" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${BEZEL_COLOR_TOP}"/>
        <stop offset="1" stop-color="${BEZEL_COLOR_BOTTOM}"/>
      </linearGradient>
      <radialGradient id="tv-glass" cx="0.3" cy="0.22" r="0.75">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.045"/>
        <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.012"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
      <filter id="tv-soft" x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur stdDeviation="14"/>
      </filter>
      <clipPath id="tv-screen-clip"><path d="${screen}"/></clipPath>
    </defs>
    <!-- Shadow on the glass along the bezel's inner edge -->
    <g clip-path="url(#tv-screen-clip)">
      <path d="${screen}" fill="none" stroke="#000" stroke-opacity="0.85" stroke-width="46" filter="url(#tv-soft)"/>
      <path d="${screen}" fill="url(#tv-glass)"/>
    </g>
    <!-- The bezel: everything outside the screen -->
    <path fill-rule="evenodd" fill="url(#tv-plastic)" d="M -10 -10 H 1010 V 1010 H -10 Z ${screen}"/>
    <!-- A faint highlight on the bezel lip, and a dim power light -->
    <path d="${screen}" fill="none" stroke="#ffffff" stroke-opacity="0.04" stroke-width="2.5"/>
    <circle cx="500" cy="${(B + 1000) / 2 + 2}" r="2.6" fill="#7a1a12" opacity="0.8"/>
  `;
  document.body.appendChild(svg);
  return BEZEL;
}
