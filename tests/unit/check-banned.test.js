import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan } from '../../tools/check-banned.js';

function makeDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budgie-banned-'));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

test('reports banned patterns in shipped files only', () => {
  const dir = makeDir({
    'index.html': '<a href="https://x">',
    'src/a.js': 'const el = document.body;\nel.innerHTML = s',
    'src/ok.js': 'el.textContent = s',
    'tests/t.js': 'fetch(',
  });
  assert.deepEqual(scan(dir), [
    { file: 'index.html', line: 1, pattern: 'https://' },
    { file: 'src/a.js', line: 2, pattern: 'innerHTML' },
  ]);
});

test('clean tree has no findings', () => {
  const dir = makeDir({ 'src/ok.js': 'el.textContent = s' });
  assert.deepEqual(scan(dir), []);
});
