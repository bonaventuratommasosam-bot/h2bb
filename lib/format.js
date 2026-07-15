// Helper di formattazione
// EXTRACTED FROM index.js:96-100

function formatPosition(pos, pair) {
  if (!pos || Math.abs(pos) < 1e-9) return `0 ${pair}`;
  if (pos < 0) return `SHORT ${Math.abs(pos).toFixed(6)} ${pair}`;
  return `LONG ${pos.toFixed(6)} ${pair}`;
}

module.exports = { formatPosition };
