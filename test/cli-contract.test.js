const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('forget command help keeps the id argument optional', () => {
  const cliPath = path.join(__dirname, '..', 'dist', 'cli', 'index.js');
  const output = execFileSync(process.execPath, [cliPath, 'forget', '--help'], { encoding: 'utf-8' });

  assert.match(output, /Usage: nc forget \[options\] \[id\]/);
  assert.match(output, /--before <date>/);
});
