/**
 * Embeddable SVG trust badge (shields-style) for public showcase.
 * Pure — no I/O.
 */

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function statusColor(status) {
  if (status === 'verified') return '#2fd48a';
  if (status === 'degraded') return '#e0b04a';
  return '#f06570';
}

/**
 * Approximate text width for IBM Plex Mono-ish 11px bold.
 */
function textWidth(str) {
  return Math.ceil(String(str).length * 6.6) + 2;
}

/**
 * @param {object} trust - output of buildTrustReport (or subset)
 * @param {object} [opts]
 * @returns {string} SVG markup
 */
function renderTrustBadgeSvg(trust = {}, opts = {}) {
  const label = opts.label || 'hermes trust';
  const grade = trust.grade || '?';
  const score = trust.score != null ? Number(trust.score) : null;
  const status = trust.status || 'degraded';
  const posture = trust.posture || '';
  const right = score != null
    ? `${grade} ${score}${posture ? ` · ${posture}` : ''}`
    : String(grade);

  const leftPad = 8;
  const gap = 10;
  const rightPad = 8;
  const h = 20;
  const leftW = textWidth(label) + leftPad * 2;
  const rightW = textWidth(right) + rightPad * 2;
  const w = leftW + rightW;
  const color = statusColor(status);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" role="img" aria-label="${escapeXml(label)}: ${escapeXml(right)}">
  <title>${escapeXml(label)}: ${escapeXml(right)} (${escapeXml(status)})</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".08"/>
    <stop offset="1" stop-opacity=".08"/>
  </linearGradient>
  <clipPath id="r"><rect width="${w}" height="${h}" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${leftW}" height="${h}" fill="#1a1f2b"/>
    <rect x="${leftW}" width="${rightW}" height="${h}" fill="${color}"/>
    <rect width="${w}" height="${h}" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">
    <text x="${leftW / 2}" y="14" fill="#c8ced9">${escapeXml(label)}</text>
    <text x="${leftW + rightW / 2}" y="14" font-weight="700">${escapeXml(right)}</text>
  </g>
</svg>`;
}

/**
 * Markdown snippet for README / social.
 */
function trustBadgeMarkdown(baseUrl, trust) {
  const origin = String(baseUrl || '').replace(/\/$/, '');
  const alt = `Hermes trust ${trust?.grade || ''} ${trust?.score != null ? trust.score : ''}`.trim();
  return `[![${alt}](${origin}/badge.svg)](${origin}/?trust=1)`;
}

/**
 * HTML embed snippet.
 */
function trustBadgeHtml(baseUrl) {
  const origin = String(baseUrl || '').replace(/\/$/, '');
  return `<a href="${origin}/?trust=1" title="Hermes Trust Terminal"><img src="${origin}/badge.svg" alt="Hermes trust" /></a>`;
}

module.exports = {
  renderTrustBadgeSvg,
  trustBadgeMarkdown,
  trustBadgeHtml,
  statusColor,
  escapeXml,
};
