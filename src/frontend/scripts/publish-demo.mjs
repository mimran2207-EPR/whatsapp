// Builds the DEMO configuration (in-browser fake API, base href "/", no source maps) and replaces the repo-root public/
// (served by Cloudflare static assets, see wrangler.jsonc) with the result.   Usage: npm run demo:publish
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(frontend, 'dist', 'demo');
const pub = resolve(frontend, '..', '..', 'public');

// Plain recursive copy (fs.cpSync is avoided on purpose: it crashes node on some Windows/OneDrive paths).
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const s = join(from, name);
    if (statSync(s).isDirectory()) copyTree(s, join(to, name));
    else copyFileSync(s, join(to, name));
  }
}

function run(args) {
  const r = spawnSync(process.execPath, args, { cwd: frontend, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run([join('scripts', 'build-tokens.mjs')]);
rmSync(dist, { recursive: true, force: true });
run([join('node_modules', '@angular', 'cli', 'bin', 'ng.js'), 'build', '--configuration', 'demo']);

if (!existsSync(join(dist, 'index.html'))) {
  console.error(`demo build produced no index.html in ${dist}`);
  process.exit(1);
}

rmSync(pub, { recursive: true, force: true });
mkdirSync(pub, { recursive: true });
copyTree(dist, pub);

let bytes = 0;
let files = 0;
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else {
      bytes += statSync(p).size;
      files++;
    }
  }
};
walk(pub);
console.log(`\npublic/ now holds the demo build: ${files} files, ${(bytes / 1024).toFixed(0)} KiB `);
