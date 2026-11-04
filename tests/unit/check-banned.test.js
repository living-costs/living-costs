import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

test('CLI still scans when run through a symlinked directory', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'budgie-link-'));
  try {
    const real = path.join(base, 'real');
    fs.mkdirSync(path.join(real, 'tools'), { recursive: true });
    fs.mkdirSync(path.join(real, 'src'));
    fs.copyFileSync(
      new URL('../../tools/check-banned.js', import.meta.url),
      path.join(real, 'tools', 'check-banned.js'),
    );
    fs.writeFileSync(path.join(real, 'src', 'bad.js'), 'el.innerHTML = s\n');
    const link = path.join(base, 'link');
    fs.symlinkSync(real, link);
    const run = spawnSync(process.execPath, [path.join(link, 'tools', 'check-banned.js')], {
      encoding: 'utf8',
    });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /src\/bad\.js:1: innerHTML/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
