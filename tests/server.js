// Static server for e2e tests. Standard library only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 4173;
const TYPES = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const notFound = () => {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  };
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    return notFound();
  }
  if (pathname.includes('..') || pathname.includes('\0')) return notFound();
  if (pathname === '/') pathname = '/index.html';
  const allowed =
    pathname === '/index.html' || pathname === '/styles.css' || pathname.startsWith('/src/');
  if (!allowed) return notFound();
  const file = path.join(root, pathname);
  if (!file.startsWith(root + path.sep)) return notFound();
  fs.readFile(file, (err, data) => {
    if (err) return notFound();
    const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

// Loopback only, so nothing else on the network can reach the dev server. The URL stays
// localhost (which resolves to it), so the browser origin and its saved data don't change.
server.listen(port, '127.0.0.1', () => console.log(`Budgie on http://localhost:${port}/`));
