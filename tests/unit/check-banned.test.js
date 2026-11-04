import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scan, EXCEPTIONS } from '../../tools/check-banned.js';

const tempDirs = [];
after(() => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
});

function makeDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budgie-banned-'));
  tempDirs.push(dir);
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

const hit = (file, pattern) => [{ file, line: 1, pattern }];

// [label, file, content, expected findings]
const POSITIVE = [
  ...[
    'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'innerHTML', 'outerHTML',
    'insertAdjacentHTML', 'document.write', 'new Function', 'http://', 'https://',
    'window.open', 'location.assign', 'location.replace', 'location.href', 'srcdoc',
    "setAttribute('style'", 'RTCPeerConnection',
  ].map((lit) => [`literal ${lit}`, 'src/l.js', `x ${lit} y`, hit('src/l.js', lit)]),
  ['literal webkitRTCPeerConnection', 'src/l.js', 'new webkitRTCPeerConnection(c)', hit('src/l.js', 'RTCPeerConnection')],
  ['fetch(', 'src/r.js', 'fetch(x)', hit('src/r.js', 'fetch(')],
  ['fetch (', 'src/r.js', 'fetch (x)', hit('src/r.js', 'fetch(')],
  ['fetch tab', 'src/r.js', 'await fetch\t(x)', hit('src/r.js', 'fetch(')],
  ['eval(', 'src/r.js', 'eval(s)', hit('src/r.js', 'eval(')],
  ['eval (', 'src/r.js', 'eval (s)', hit('src/r.js', 'eval(')],
  ['import(', 'src/r.js', 'import(m)', hit('src/r.js', 'import(')],
  ['import (', 'src/r.js', 'import (m)', hit('src/r.js', 'import(')],
  ['import tab', 'src/r.js', 'await import\t(m)', hit('src/r.js', 'import(')],
  ['href //', 'index.html', '<a href=//h/x>', hit('index.html', 'protocol-relative URL')],
  ['src quoted //', 'index.html', '<script src = "//h/x.js">', hit('index.html', 'protocol-relative URL')],
  ['location = u', 'src/r.js', 'location = u', hit('src/r.js', 'location =')],
  ['window.location = u', 'src/r.js', 'window.location = u', hit('src/r.js', 'location =')],
  ['document.location=u', 'src/r.js', 'document.location=u', hit('src/r.js', 'location =')],
  ['css @import quote', 'styles.css', "@import 'x.css';", hit('styles.css', '@import')],
  ['css @import dquote nospace', 'styles.css', '@import"x.css";', hit('styles.css', '@import')],
  ['css @import url', 'styles.css', '@import url(x.css);', hit('styles.css', '@import')],
  ['css @import in js string', 'src/r.js', 'const c = "@import url(x)"', hit('src/r.js', '@import')],
  ['css url(//)', 'styles.css', 'a{background:url(//h/x.png)}', hit('styles.css', 'protocol-relative URL')],
  ['css url("//") spaced', 'styles.css', 'a{background:url( "//h/x.png" )}', hit('styles.css', 'protocol-relative URL')],
  ["css url('//')", 'styles.css', "a{background:url('//h/x.png')}", hit('styles.css', 'protocol-relative URL')],
  ['import x from //', 'src/r.js', "import x from '//host/m.js'", hit('src/r.js', 'protocol-relative URL')],
  ['import {a} from //', 'src/r.js', 'import { a } from "//host/m.js"', hit('src/r.js', 'protocol-relative URL')],
  ['import //', 'src/r.js', "import '//host/m.js'", hit('src/r.js', 'protocol-relative URL')],
  ['export from //', 'src/r.js', "export { a } from '//host/m.js'", hit('src/r.js', 'protocol-relative URL')],
  ['export * from //', 'src/r.js', 'export * from "//host/m.js"', hit('src/r.js', 'protocol-relative URL')],
  ['multi-line from //', 'src/r.js', "} from '//host/m.js'", hit('src/r.js', 'protocol-relative URL')],
  ['nested directory', 'src/a/b/deep.js', 'el.innerHTML = s', hit('src/a/b/deep.js', 'innerHTML')],
];

for (const [label, file, content, expected] of POSITIVE) {
  test(`flags ${label}`, () => {
    assert.deepEqual(scan(makeDir({ [file]: content })), expected);
  });
}

const NEGATIVE = [
  ['prefetch(x)', 'src/n.js', 'prefetch(x)'],
  ['myeval(s)', 'src/n.js', 'myeval(s)'],
  ['a == location', 'src/n.js', 'if (a == location) go()'],
  ['x.location === y', 'src/n.js', 'if (x.location === y) go()'],
  ['x.location == y', 'src/n.js', 'if (x.location == y) go()'],
  ['location arrow', 'src/n.js', 'items.map(location => location.id)'],
  ['JSDoc @import', 'src/n.js', "/** @import {A} from './types.js' */"],
  ['local import', 'src/n.js', "import { a } from './local.js'"],
  ['local export', 'src/n.js', "export { a } from './local.js'"],
  ['css local url', 'styles.css', 'a{background:url(img/x.png)}'],
];

for (const [label, file, content] of NEGATIVE) {
  test(`does not flag ${label}`, () => {
    assert.deepEqual(scan(makeDir({ [file]: content })), []);
  });
}

test('findings matching an exception are dropped, others kept', () => {
  const dir = makeDir({ 'src/a.js': 'el.innerHTML = s', 'src/b.js': 'el.innerHTML = s' });
  const exceptions = [{ file: 'src/a.js', pattern: 'innerHTML', reason: 'test' }];
  assert.deepEqual(scan(dir, exceptions), hit('src/b.js', 'innerHTML'));
  assert.deepEqual(scan(dir, [{ file: 'src/a.js', pattern: 'eval(', reason: 'test' }]).length, 2);
});

test('shipped EXCEPTIONS list is empty', () => {
  assert.deepEqual(EXCEPTIONS, []);
});
