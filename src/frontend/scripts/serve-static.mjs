// Tiny static file server with SPA fallback (like Cloudflare's "single-page-application" not_found_handling).
// Usage: node scripts/serve-static.mjs <directory> <port>      Used by the demo e2e; no dependencies.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const [dirArg, portArg] = process.argv.slice(2);
if (!dirArg || !portArg) {
  console.error('usage: node scripts/serve-static.mjs <directory> <port>');
  process.exit(2);
}
const root = resolve(dirArg);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      file = join(file, 'index.html');
      info = await stat(file).catch(() => null);
    }
    // Anything that is not a real file is an app route: serve the SPA shell (as Cloudflare does).
    if (!info) file = join(root, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
}).listen(Number(portArg), '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${portArg}`));
