const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

describe('DATA_DIR', () => {
  after(() => {
    delete process.env.DATA_DIR;
    delete require.cache[require.resolve('../config/default')];
  });

  it('defaults to project root (not config/)', () => {
    delete process.env.DATA_DIR;
    delete require.cache[require.resolve('../config/default')];
    const { DATA_DIR, PROJECT_ROOT, STRATEGY_FILE } = require('../config/default');
    const root = path.resolve(path.join(__dirname, '..'));
    assert.equal(path.resolve(PROJECT_ROOT), root);
    assert.equal(path.resolve(DATA_DIR), root);
    assert.equal(STRATEGY_FILE, path.join(root, 'strategy.json'));
    assert.ok(!DATA_DIR.endsWith(`${path.sep}config`));
  });
});
