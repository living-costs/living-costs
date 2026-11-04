// Fails on patterns that the privacy rules in CLAUDE.md forbid in shipped code.
// Scans index.html, styles.css and src/**. Tests and tools are not scanned.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LITERALS = [
  'fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon',
  'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write',
  'eval(', 'new Function', 'http://', 'https://', 'window.open',
  'location.assign', 'location.replace', 'location.href', 'srcdoc',
  "setAttribute('style'",
];

const REGEXES = [
  { re: /\bimport\s*\(/, name: 'import(' },
  { re: /(href|src)\s*=\s*["']?\/\//, name: 'protocol-relative URL' },
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
 * @returns {{file: string, line: number, pattern: string}[]}
 */
export function scan(root) {
  const files = [];
  for (const name of ['index.html', 'styles.css']) {
    if (fs.existsSync(path.join(root, name))) files.push(name);
  }
  if (fs.existsSync(path.join(root, 'src'))) listFiles(root, 'src', files);
  files.sort();

  const findings = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/);
    lines.forEach((text, i) => {
      const hits = [];
      for (const lit of LITERALS) if (text.includes(lit)) hits.push(lit);
      for (const { re, name } of REGEXES) if (re.test(text)) hits.push(name);
      for (const pattern of hits) {
        if (EXCEPTIONS.some((e) => e.file === file && e.pattern === pattern)) continue;
        findings.push({ file, line: i + 1, pattern });
      }
    });
  }
  return findings;
}

if (process.argv[1] && fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const findings = scan(root);
  for (const f of findings) console.log(`${f.file}:${f.line}: ${f.pattern}`);
  process.exit(findings.length ? 1 : 0);
}
