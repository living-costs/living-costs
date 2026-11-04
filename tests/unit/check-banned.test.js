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

const hitAt = (file, line, pattern) => [{ file, line, pattern }];
const hit = (file, pattern) => hitAt(file, 1, pattern);

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
  // Multi-line: reported line is where the match starts.
  ['fetch split over lines', 'src/r.js', 'a\nb\nfetch\n(u)', hitAt('src/r.js', 3, 'fetch(')],
  ['eval split over lines', 'src/r.js', 'eval\n  (s)', hit('src/r.js', 'eval(')],
  ['import( split over lines', 'src/r.js', 'x\nimport\n(m)', hitAt('src/r.js', 2, 'import(')],
  ['window.location split', 'src/r.js', 'a\nwindow.location\n  = u', hitAt('src/r.js', 2, 'location =')],
  ['location CRLF split', 'src/r.js', 'a\r\nlocation\r\n= u', hitAt('src/r.js', 2, 'location =')],
  ['css url( split', 'styles.css', 'a{\nb:url(\n//h)}', hitAt('styles.css', 2, 'protocol-relative URL')],
  ['css @import split', 'styles.css', 'x\n@import\n"x.css";', hitAt('styles.css', 2, '@import')],
  ['attr split', 'index.html', '<a\nhref=\n"//h">', hitAt('index.html', 2, 'protocol-relative URL')],
  ['from split', 'src/r.js', "import {\n a\n}\nfrom\n'//h/m.js'", hitAt('src/r.js', 4, 'protocol-relative URL')],
  // Case-insensitive HTML/CSS.
  ['css URL(//h)', 'styles.css', 'a{b:URL(//h)}', hit('styles.css', 'protocol-relative URL')],
  ['css @IMPORT', 'styles.css', "@IMPORT 'x.css'", hit('styles.css', '@import')],
  ['HREF=//', 'index.html', '<a HREF="//h">', hit('index.html', 'protocol-relative URL')],
  // Compound location assignment.
  ['location +=', 'src/r.js', 'location += u', hit('src/r.js', 'location =')],
  ['window.location+=', 'src/r.js', 'window.location+=u', hit('src/r.js', 'location =')],
  // Dotted calls with whitespace/newlines.
  ['window . open', 'src/r.js', 'window . open(u)', hit('src/r.js', 'window.open')],
  ['window.open call', 'src/r.js', 'window.open(u)', hit('src/r.js', 'window.open')],
  ['window\\n.open', 'src/r.js', 'window\n  .open(u)', hit('src/r.js', 'window.open')],
  ['document .write', 'src/r.js', 'document\n.write(x)', hit('src/r.js', 'document.write')],
  ['location . assign', 'src/r.js', 'location . assign(u)', hit('src/r.js', 'location.assign')],
  ['location.replace split', 'src/r.js', 'location.\nreplace(u)', hit('src/r.js', 'location.replace')],
  ['location .href', 'src/r.js', 'x = location\n.href', hit('src/r.js', 'location.href')],
  ['bare open(', 'src/r.js', 'open(u)', hit('src/r.js', 'open(')],
  ['bare open (', 'src/r.js', 'x; open (u)', hit('src/r.js', 'open(')],
  ['bare open after paren', 'src/r.js', 'f(open(u))', hit('src/r.js', 'open(')],
  ['navigation.navigate', 'src/r.js', 'navigation.navigate(u)', hit('src/r.js', 'navigation.navigate')],
  ['navigation . navigate split', 'src/r.js', 'navigation\n.navigate(u)', hit('src/r.js', 'navigation.navigate')],
  // More attributes and backslash forms.
  ['srcset //', 'index.html', '<img srcset="//h/x.png 1x">', hit('index.html', 'protocol-relative URL')],
  ['ping //', 'index.html', '<a ping="//h">', hit('index.html', 'protocol-relative URL')],
  ['href /\\host', 'index.html', '<a href="/\\h">', hit('index.html', 'protocol-relative URL')],
  ['href \\\\host', 'index.html', '<a href="\\\\h">', hit('index.html', 'protocol-relative URL')],
  ['href \\/host', 'index.html', '<a href="\\/h">', hit('index.html', 'protocol-relative URL')],
  ['css url(/\\h)', 'styles.css', 'a{b:url(/\\h)}', hit('styles.css', 'protocol-relative URL')],
  ['css url("\\\\h")', 'styles.css', 'a{b:url("\\\\h")}', hit('styles.css', 'protocol-relative URL')],
  ['import from \\/h', 'src/r.js', "import x from '\\/h/m.js'", hit('src/r.js', 'protocol-relative URL')],
  ['export from /\\h', 'src/r.js', "export * from '/\\h/m.js'", hit('src/r.js', 'protocol-relative URL')],
  ['import \\\\h', 'src/r.js', "import '\\\\h/m.js'", hit('src/r.js', 'protocol-relative URL')],
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
  ['indexedDB.open(x)', 'src/n.js', "indexedDB.open('budgie', 1)"],
  ['foo.open(x)', 'src/n.js', 'foo.open(x)'],
  ['foo\\n.open(x)', 'src/n.js', 'foo\n  .open(x)'],
  ['dialog.open', 'src/n.js', 'dialog.open = true'],
  ['reopen(x)', 'src/n.js', 'reopen(x)'],
  ['x.navigate(u)', 'src/n.js', 'router.navigate(u)'],
  ['a == location across lines', 'src/n.js', 'a ==\nlocation'],
  ['local url', 'styles.css', 'a{b:url(./x.png)}'],
  ['css @import word', 'styles.css', '/* @import notes */'],
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

const AGPL = 'https://www.gnu.org/licenses/agpl-3.0.html';
const SOURCE = 'https://github.com/living-costs/living-costs';
const FOOTER =
  `<footer class="site-footer"><p>Copyright 2026. <a href="${AGPL}" target="_blank" rel="noopener noreferrer">AGPL-3.0</a>. ` +
  `<a href="${SOURCE}" target="_blank" rel="noopener noreferrer">Source code</a></p></footer>`;

test('shipped EXCEPTIONS are exactly the two footer links, each naming its literal URL', () => {
  assert.deepEqual(
    EXCEPTIONS.map((e) => [e.file, e.pattern, e.match]),
    [['index.html', 'https://', AGPL], ['index.html', 'https://', SOURCE]],
  );
  for (const e of EXCEPTIONS) assert.ok(e.reason.length > 10);
});

test('the two exact footer URLs pass in index.html', () => {
  assert.deepEqual(scan(makeDir({ 'index.html': FOOTER })), []);
});

test('any other https URL in index.html still fails', () => {
  const third = FOOTER + `\n<a href="https://example.com/x">x</a>`;
  assert.deepEqual(scan(makeDir({ 'index.html': third })), hitAt('index.html', 2, 'https://'));
  const changed = FOOTER.replace('agpl-3.0.html', 'agpl-3.0.txt');
  assert.deepEqual(scan(makeDir({ 'index.html': changed })), hitAt('index.html', 1, 'https://'));
  const prefix = FOOTER.replace(SOURCE + '"', SOURCE + '/evil"');
  assert.deepEqual(scan(makeDir({ 'index.html': prefix })), hitAt('index.html', 1, 'https://'));
});

test('a bad URL on the same line as a good one is still reported', () => {
  const dir = makeDir({ 'index.html': `<a href="${AGPL}">a</a> <a href="https://evil.example/">b</a>` });
  assert.deepEqual(scan(dir), hitAt('index.html', 1, 'https://'));
});

test('an index.html exception does not exempt the same URL in src/', () => {
  const dir = makeDir({ 'index.html': FOOTER, 'src/a.js': `const u = '${AGPL}';` });
  assert.deepEqual(scan(dir), hitAt('src/a.js', 1, 'https://'));
});

test('an exception with a match field exempts only that literal text', () => {
  const dir = makeDir({ 'src/a.js': "x = 'https://ok.example/a'; y = 'https://ok.example/ab';" });
  const ex = [{ file: 'src/a.js', pattern: 'https://', match: 'https://ok.example/a', reason: 'test only' }];
  assert.deepEqual(scan(dir, ex), hitAt('src/a.js', 1, 'https://'));
});
