// Color helpers
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToStr([r, g, b], a = 1) {
  return a < 1 ? `rgba(${r},${g},${b},${a})` : `rgb(${r},${g},${b})`;
}

function lighten(hex, amount = 0.3) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToStr([
    Math.round(r + (255 - r) * amount),
    Math.round(g + (255 - g) * amount),
    Math.round(b + (255 - b) * amount),
  ]);
}

function darken(hex, amount = 0.3) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToStr([
    Math.round(r * (1 - amount)),
    Math.round(g * (1 - amount)),
    Math.round(b * (1 - amount)),
  ]);
}

// Ball colors for visual variety
const BALL_COLORS = [
  '#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3',
  '#54a0ff', '#5f27cd', '#01a3a4', '#f368e0',
  '#ff9f43', '#ee5a24', '#c8d6e5', '#00d2d3',
];

function ballColor(id) {
  return BALL_COLORS[id % BALL_COLORS.length];
}
