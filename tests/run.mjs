// Serves the repo over HTTP and runs each suite against it.
//
// The page has to be served rather than opened off disk: config.json is fetched
// at load, and file:// would silently fall back to the embedded defaults. The
// port is ephemeral so parallel runs don't collide.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname))
    .replace(/^([/\\]?\.\.)+/, '');
  const file = join(ROOT, path === '/' ? 'index.html' : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const BASE_URL = `http://127.0.0.1:${server.address().port}`;
console.log(`serving ${ROOT} at ${BASE_URL}`);

const suites = process.argv.slice(2);
let failed = 0;
for (const name of suites.length ? suites : ['hub', 'wheel']) {
  console.log(`\n──── ${name} ${'─'.repeat(Math.max(0, 58 - name.length))}\n`);
  const code = await new Promise(resolve =>
    spawn(process.execPath, [fileURLToPath(new URL(`${name}.test.mjs`, import.meta.url))],
      { stdio: 'inherit', env: { ...process.env, BASE_URL } }).on('close', resolve));
  if (code !== 0) failed++;
}

server.close();
if (failed) console.log(`\n${failed} suite(s) failed`);
process.exit(failed ? 1 : 0);
