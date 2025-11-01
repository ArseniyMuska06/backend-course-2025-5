import http from 'http';
import { Command } from 'commander';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse as parseUrl } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program
  .name('cli-web-server-cache')
  .description('HTTP server controlled by CLI options: --host, --port, --cache')
  .requiredOption('-h, --host <host>', 'Server host (required), e.g. 127.0.0.1')
  .requiredOption('-p, --port <port>', 'Server port (required), e.g. 3000', (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      throw new Error('Port must be an integer between 1 and 65535');
    }
    return n;
  })
  .requiredOption('-c, --cache <dir>', 'Path to cache directory (required). Will be created if missing.')
  .version('1.0.0');

let opts;
try {
  opts = program.parse(process.argv).opts();
} catch (e) {
  process.exitCode = 1;
  process.exit();
}

const { host, port, cache } = opts;

try {
  fs.mkdirSync(cache, { recursive: true });
} catch (err) {
  console.error(`Failed to ensure cache directory "${cache}":`, err.message);
  process.exit(1);
}

const CACHE_DIR = path.resolve(cache);

function sanitizeName(name) {
  const unsafe = name.includes('..') || path.isAbsolute(name);
  if (unsafe) throw new Error('Unsafe filename');
  return name;
}

function cachePath(name) {
  return path.join(CACHE_DIR, name);
}

async function listCacheFiles() {
  try {
    const items = await fsp.readdir(CACHE_DIR, { withFileTypes: true });
    return items
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .sort();
  } catch (e) {
    return [];
  }
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;
  const parsed = parseUrl(url, true);
  const pathname = decodeURIComponent(parsed.pathname || '/');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (method === 'GET' && pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('OK');
  }

  if (method === 'GET' && pathname === '/') {
    const files = await listCacheFiles();
    const list = files.map((f) => `<li><a href="/cache/${encodeURIComponent(f)}">${f}</a></li>`).join('');
    const html = `<!doctype html>
<html lang="uk">
<meta charset="utf-8">
<title>Cache Index</title>
<body style="font-family:system-ui,Segoe UI,Arial,sans-serif;line-height:1.4">
<h1>Веб-сервер працює</h1>
<p><b>Host:</b> ${host} &nbsp; <b>Port:</b> ${port} &nbsp; <b>Cache:</b> ${CACHE_DIR}</p>
<p>Маршрути: <code>GET /</code>, <code>GET /health</code>, <code>GET /cache/:name</code>, <code>POST /cache/:name</code></p>
<h2>Файли у кеші (${files.length})</h2>
<ol>${list || '<em>порожньо</em>'}</ol>
</body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  if (pathname.startsWith('/cache/')) {
    const name = pathname.slice('/cache/'.length);
    let safeName;
    try {
      safeName = sanitizeName(name);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'Bad file name' }));
    }
    const fullPath = cachePath(safeName);

    if (method === 'GET') {
      try {
        const data = await fsp.readFile(fullPath);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        return res.end(data);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'Not found' }));
      }
    }

    if (method === 'POST') {
      const chunks = [];
      req.on('data', (ch) => chunks.push(ch));
      req.on('end', async () => {
        const body = Buffer.concat(chunks);
        try {
          await fsp.mkdir(path.dirname(fullPath), { recursive: true });
          await fsp.writeFile(fullPath, body);
          res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, saved: path.basename(fullPath), bytes: body.length }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Failed to write file' }));
        }
      });
      return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(port, host, () => {
  console.log(`[STARTED] http://${host}:${port}  (cache: ${CACHE_DIR})`);
}).on('error', (err) => {
  console.error('Server failed to start:', err.message);
  process.exit(1);
});
