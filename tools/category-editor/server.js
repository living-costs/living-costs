// Categories Editor: a local page for editing src/default-categories.js.
// Dev tooling only. It is never deployed, and it uses the standard library only.
//
//   node tools/category-editor/server.js     then open http://localhost:4180/
//
// GET /data returns the current list; POST /save validates and writes the file.
// Loopback only. Requests must carry this server's Host, and saves its Origin and a JSON
// content type, so another web page can't read or write the file through the browser.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { header, render, validate, clean } from './format.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const categoriesFile = path.join(root, 'src', 'default-categories.js');
const merchantsFile = path.join(root, 'src', 'merchants.js');
const port = Number(process.env.PORT) || 4180;
const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
const origins = new Set([...hosts].map((h) => `http://${h}`));

/** @type {Record<string, [string, string]>} served path → [file, content type] */
const STATIC = {
  '/': [path.join(here, 'index.html'), 'text/html; charset=utf-8'],
  '/editor.js': [path.join(here, 'editor.js'), 'text/javascript'],
  '/editor.css': [path.join(here, 'editor.css'), 'text/css'],
  '/format.js': [path.join(here, 'format.js'), 'text/javascript'],
};

/**
 * A module loaded fresh each time, so edits on disk show up without a restart.
 * @param {string} file
 */
async function load(file) {
  return (await import(`${pathToFileURL(file).href}?t=${Date.now()}-${Math.random()}`)).default;
}

async function current() {
  const source = fs.readFileSync(categoriesFile, 'utf8');
  const categories = await load(categoriesFile);
  /** @type {Record<string, number>} */
  const merchantCounts = {};
  for (const m of await load(merchantsFile)) {
    if (m.defaultId) merchantCounts[m.defaultId] = (merchantCounts[m.defaultId] ?? 0) + 1;
  }
  const version = crypto.createHash('sha256').update(source).digest('hex');
  return { source, categories, merchantCounts, version };
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** @param {http.IncomingMessage} req */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function save(req, res) {
  if (!origins.has(req.headers.origin ?? '')) return json(res, 403, { error: 'Wrong origin' });
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
    return json(res, 415, { error: 'Send JSON' });
  }
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: 'Not valid JSON' });
  }
  if (!body || !Array.isArray(body.categories) || typeof body.version !== 'string') {
    return json(res, 400, { error: 'Expected { version, categories: [...] }' });
  }
  const now = await current();
  if (body.version !== now.version) {
    return json(res, 409, { error: 'src/default-categories.js changed on disk since you loaded it. Revert to load it, then redo your changes.' });
  }
  const list = body.categories.map(clean);
  const errors = validate(list, now.merchantCounts);
  if (errors.length) return json(res, 422, { error: 'Not saved', errors });
  const tmp = `${categoriesFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, render(header(now.source), list));
  fs.renameSync(tmp, categoriesFile);
  const after = await current();
  console.log(`Saved ${list.length} categories to src/default-categories.js`);
  return json(res, 200, { categories: after.categories, merchantCounts: after.merchantCounts, version: after.version });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!hosts.has(req.headers.host ?? '')) return json(res, 421, { error: 'Wrong host' });
    const pathname = new URL(req.url ?? '/', `http://${req.headers.host}`).pathname;
    if (req.method === 'POST' && pathname === '/save') return await save(req, res);
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
    if (pathname === '/data') {
      const { categories, merchantCounts, version } = await current();
      return json(res, 200, { categories, merchantCounts, version });
    }
    const entry = STATIC[pathname];
    if (!entry) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(entry[0]));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Categories Editor on http://localhost:${port}/  (Ctrl+C to stop)`));
