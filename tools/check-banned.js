// Fails on patterns that the privacy rules in CLAUDE.md forbid in shipped code.
// Scans index.html, styles.css, favicon.svg and src/**. Tests and tools are not scanned.
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
// Attribute names that take a URL (the set h() refuses as a prop), as a string or property key.
const URL_ATTR = String.raw`(?:href|src|srcset|action|formaction|ping|poster|background|xlink:href)`;
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
  // A script element, in any shipped file (SVG can carry script too), with or without a
  // namespace prefix. The match runs to the end of the start tag, so an exception can name it.
  { re: /<(?:[\w-]+:)?script\b[^>]*>?/gi, name: '<script' },
  { re: /\blocation\s*\+?=(?![=>])/g, name: 'location =' },
  // CSS @import needs a following quote or url(, so JSDoc `@import {X} from` is not flagged.
  { re: /@import\s*(["']|url\()/gi, name: '@import' },
  { re: new RegExp(String.raw`(href|src|srcset|ping)\s*=\s*["']?\s*${PR}`, 'gi'), name: 'protocol-relative URL' },
  { re: new RegExp(String.raw`\burl\(\s*["']?\s*${PR}`, 'gi'), name: 'protocol-relative URL' },
  // Static imports/exports; `from` alone also covers multi-line import lists.
  { re: new RegExp(String.raw`\bfrom\s*["']\s*${PR}`, 'g'), name: 'protocol-relative URL' },
  { re: new RegExp(String.raw`\bimport\s*["']\s*${PR}`, 'g'), name: 'protocol-relative URL' },
  // A DOM property that takes a URL (the set h() refuses as a prop), assigned directly, which
  // bypasses h()'s URL-key guard. Compound assignment counts; a comparison (==, ===, !=, <=,
  // >=) does not. The match runs from the start of the target expression to the next `;` or
  // the end of the line, so an exception can name the statement exactly.
  {
    re: /[\w$.[\]'"()]*?\s*\.\s*(?:href|src|srcset|srcdoc|action|formAction|ping|poster|background)\s*(?:\+|\|\||&&|\?\?)?=(?!=)[^;\r\n]*;?/gi,
    name: 'URL property =',
  },
  // The same names set by other routes, in any case and quote style. `[^,)]*` is the namespace
  // argument; a prefixed qualified name (svg:href) counts.
  { re: new RegExp(String.raw`\bsetAttribute\s*\(\s*(["'\`])${URL_ATTR}\1`, 'gi'), name: 'setAttribute URL' },
  {
    re: new RegExp(String.raw`\bsetAttributeNS\s*\([^,)]*,\s*(["'\`])(?:[\w-]+:)?${URL_ATTR}\1`, 'gi'),
    name: 'setAttributeNS URL',
  },
  // A bracketed name, assigned (as for the dotted form above, to the end of the statement).
  {
    re: new RegExp(String.raw`[\w$.[\]()]*?\[\s*(["'\`])${URL_ATTR}\1\s*\]\s*(?:\+|\|\||&&|\?\?)?=(?!=)[^;\r\n]*;?`, 'gi'),
    name: 'URL property =',
  },
  // Object.assign with an object literal that has one of the names as a key: quoted, computed
  // or shorthand. The key must follow `{` or `,`, and come before the end of the statement.
  {
    re: new RegExp(String.raw`\bObject\s*\.\s*assign\s*\([^;]*?[{,]\s*\[?\s*(["'\`]?)${URL_ATTR}\1\s*\]?\s*[:,}]`, 'gi'),
    name: 'Object.assign URL',
  },
];

/**
 * Documented exceptions: {file, pattern, match?, reason}. Without `match`, every finding of
 * `pattern` in `file` is exempt (too broad for URLs; avoid). With `match`, only a finding
 * whose matched text equals it exactly is exempt. For `http://` and `https://` the matched
 * text is the whole URL, up to the next whitespace, quote, backtick, `<` or `>`. For
 * `URL property =` it is the whole assignment, from its target to the `;` or the end of the line.
 */
export const EXCEPTIONS = [
  {
    file: 'index.html',
    pattern: 'https://',
    match: 'https://www.gnu.org/licenses/agpl-3.0.html',
    reason: 'Page footer link to the AGPL-3.0 licence. Approved by the owner; the only licence link.',
  },
  {
    file: 'index.html',
    pattern: 'https://',
    match: 'https://github.com/living-costs/living-costs',
    reason: 'Page footer link to the source code. Approved by the owner; the only source link.',
  },
  {
    file: 'index.html',
    pattern: '<script',
    match: '<script type="module" src="src/main.js">',
    reason: "The app's one entry module, same-origin; everything else loads from it as a static import.",
  },
  {
    file: 'favicon.svg',
    pattern: 'http://',
    match: 'http://www.w3.org/2000/svg',
    reason: 'The SVG namespace on the root element. It is an identifier, never fetched; the favicon needs it to render.',
  },
  {
    file: 'src/ui/backup.js',
    pattern: 'URL property =',
    match: 'link.href = url;',
    reason: 'Backup download fallback: a hidden link to a blob: object URL for our own JSON, made by URL.createObjectURL and revoked straight after the click.',
  },
];

const URL_LITERALS = new Set(['http://', 'https://']);
const urlAt = (text, i) => text.slice(i).match(/^[^\s"'`<>]*/)[0];

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
 * @param {{file: string, pattern: string, match?: string, reason: string}[]} [exceptions]
 * @returns {{file: string, line: number, pattern: string}[]}
 */
export function scan(root, exceptions = EXCEPTIONS) {
  const files = [];
  for (const name of ['index.html', 'styles.css', 'favicon.svg']) {
    if (fs.existsSync(path.join(root, name))) files.push(name);
  }
  if (fs.existsSync(path.join(root, 'src'))) listFiles(root, 'src', files);
  files.sort();

  const findings = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    const seen = new Set();
    const found = [];
    const add = (line, pattern, matched) => {
      const key = `${line}\0${pattern}`;
      if (seen.has(key)) return;
      if (exceptions.some((e) => e.file === file && e.pattern === pattern && (e.match === undefined || e.match === matched))) return;
      seen.add(key);
      found.push({ file, line, pattern });
    };
    content.split(/\r?\n/).forEach((text, i) => {
      for (const lit of LITERALS) {
        for (let at = text.indexOf(lit); at !== -1; at = text.indexOf(lit, at + 1)) {
          add(i + 1, lit, URL_LITERALS.has(lit) ? urlAt(text, at) : lit);
        }
      }
    });
    for (const { re, name } of REGEXES) {
      for (const m of content.matchAll(re)) {
        let line = 1;
        for (let k = content.indexOf('\n'); k !== -1 && k < m.index; k = content.indexOf('\n', k + 1)) line++;
        add(line, name, m[0]);
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
