const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  renderTrustBadgeSvg,
  trustBadgeMarkdown,
  escapeXml,
} = require('../lib/trust-badge');

describe('trust-badge', () => {
  it('renders svg with grade and score', () => {
    const svg = renderTrustBadgeSvg({
      grade: 'A',
      score: 100,
      status: 'verified',
      posture: 'flat',
    });
    assert.match(svg, /<svg /);
    assert.match(svg, /A 100/);
    assert.match(svg, /#2fd48a/);
    assert.match(svg, /hermes trust/);
  });

  it('escapes xml in labels', () => {
    assert.equal(escapeXml('a<b&c'), 'a&lt;b&amp;c');
  });

  it('markdown points to badge and trust focus', () => {
    const md = trustBadgeMarkdown('https://live.hermesbro.cloud', { grade: 'A', score: 98 });
    assert.match(md, /badge\.svg/);
    assert.match(md, /\?trust=1/);
  });
});
