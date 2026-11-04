// Fails on patterns that the privacy rules in CLAUDE.md forbid in shipped code.
// Scans index.html, styles.css and src/**. Tests and tools are not scanned.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain substrings, checked line by line.
const LITERALS = [
  'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon',
  'innerHTML', 'outerHTML', 'insertAdjacentHTML',
  'new Function', 'http://', 'https://',
  'srcdoc', "setAttribute('style'", 'RTCPeerConnection',
];

// Regexes run over the whole file (so a call split across lines is caught); \s spans
// newlines. The reported line is the one where the match starts. The `fetch(`, `eval(`
// and dotted names are regexes so whitespace is tolerated and `prefetch(`/`myeval(`
// are not matched. They keep their old labels.
// Protocol-relative = two of / or \ (browsers treat \ as / in http(s) URLs).
const PR = String.raw`[\/\\]{2}`;
const REGEXES = [
  { re: /\bfetch\s*\(/g, name: 'fetch(' },
  { re: /\beval\s*\(/g, name: 'eval(' },
  { re: /\bimport\s*\(/g, name: 'import(' },
  { re: /window\s*\.\s*open/g, name: 'window.open' },
  { re: /document\s*\.\s*write/g, name: 'document.write' },
  { re: /location\s*\.\s*assign/g, name: 'location.assign' },
  { re: /location\s*\.\s*replace/g, name: 'location.replace' },
  { re: /location\s*\.\s*href/g, name: 'location.href' },
  // Bare open(): not after a word character or a dot (so indexedDB.open and foo.open pass).
  { re: /(?<![\w$])(?<!\.\s*)open\s*\(/g, name: 'open(' },
  { re: /navigation\s*\.\s*navigate/g, name: 'navigation.navigate' },
  { re: /\blocation\s*\+?=(?![=>])/g, name: 'location =' },
  // CSS @import needs a following quote or url(, so JSDoc `@import {X} from` is not flagged.
  { re: /@import\s*(["']|url\()/gi, name: '@import' },
  { re: new RegExp(String.raw`(href|src|srcset|ping)\s*=\s*["']?\s*${PR}`, 'gi'), name: 'protocol-relative URL' },
  { re: new RegExp(String.raw`\burl\(\s*["']?\s*${PR}`, 'gi'), name: 'protocol-relative URL' },
  // Static imports/exports; `from` alone also covers multi-line import lists.
  { re: new RegExp(String.raw`\bfrom\s*["']\s*${PR}`, 'g'), name: 'protocol-relative URL' },
  { re: new RegExp(String.raw`\bimport\s*["']\s*${PR}`, 'g'), name: 'protocol-relative URL' },
];

/** Documented exceptions: {file, pattern, reason}. Empty on purpose. */
export const EXCEPTIONS = [];

function listFiles(root, rel, out) {
  const full = path.join(root, rel);
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const childRel = path.posix.join(rel.split(path.sep).join('/'), entry.name);
    if (entry.isDirectory()) listFiles(root, childRel, out);
    else if (entry.isFile()) out.push(childRel);
  }
}

/**
 * @param {string} root
 * @param {{file: string, pattern: string, reason: string}[]} [exceptions]
 * @returns {{file: string, line: number, pattern: string}[]}
 */
export function scan(root, exceptions = EXCEPTIONS) {
  const files = [];
  for (const name of ['index.html', 'styles.css']) {
    if (fs.existsSync(path.join(root, name))) files.push(name);
  }
  if (fs.existsSync(path.join(root, 'src'))) listFiles(root, 'src', files);
  files.sort();

  const findings = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    const seen = new Set();
    const found = [];
    const add = (line, pattern) => {
      const key = `${line}\0${pattern}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (exceptions.some((e) => e.file === file && e.pattern === pattern)) return;
      found.push({ file, line, pattern });
    };
    content.split(/\r?\n/).forEach((text, i) => {
      for (const lit of LITERALS) if (text.includes(lit)) add(i + 1, lit);
    });
    for (const { re, name } of REGEXES) {
      for (const m of content.matchAll(re)) {
        let line = 1;
        for (let k = content.indexOf('\n'); k !== -1 && k < m.index; k = content.indexOf('\n', k + 1)) line++;
        add(line, name);
      }
    }
    found.sort((x, y) => x.line - y.line);
    findings.push(...found);
  }
  return findings;
}

if (process.argv[1] && fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const findings = scan(root);
  for (const f of findings) console.log(`${f.file}:${f.line}: ${f.pattern}`);
  process.exit(findings.length ? 1 : 0);
}
