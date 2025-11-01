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
  .description('HTTP server with cache: GET/PUT/DELETE /<code> for JPEG files')
  .requiredOption('-h, --host <host>', 'Server host, e.g. 127.0.0.1')
  .requiredOption('-p, --port <port>', 'Server port, e.g. 3000', (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      throw new Error('Port must be an integer between 1 and 65535');
    }
    return n;
  })
  .requiredOption('-c, --cache <dir>', 'Cache directory (will be created if missing)')
  .version('1.1.0');

let opts;
try {
  opts = program.parse(process.argv).opts();
} catch {
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

const codeRegex = /^\d{3}$/;
const fileForCode = (code) => path.join(CACHE_DIR, `${code}.jpg`);

async function listCacheFiles() {
  try {
    const items = await fsp.readdir(CACHE_DIR, { withFileTypes: true });
    return items.filter(d => d.isFile()).map(d => d.name).sort();
  } catch {
    return [];
  }
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;
  const parsed = parseUrl(url, true);
  const pathname = decodeURIComponent(parsed.pathname || '/');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
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
    const list = files.map(f => `<li>${f}</li>`).join('');
    const html = `<!doctype html>
<meta charset="utf-8">
<title>Cache Index</title>
<body style="font-family:system-ui,Segoe UI,Arial,sans-serif;line-height:1.4">
<h1>Cache (${files.length})</h1>
<p>Host: <b>${host}</b> | Port: <b>${port}</b> | Dir: <b>${CACHE_DIR}</b></p>
<p>Використання: <code>GET/PUT/DELETE /&lt;HTTP_CODE&gt;</code>, наприклад <code>/200</code>. Файл зберігається як <code>&lt;code&gt;.jpg</code>.</p>
<ol>${list || '<em>порожньо</em>'}</ol>
</body>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  if (/^\/\d{3}$/.test(pathname)) {
    const code = pathname.slice(1);
    if (!codeRegex.test(code)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'bad code' }));
    }
    const filePath = fileForCode(code);

    if (method === 'GET') {
      try {
        const buf = await fsp.readFile(filePath);
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        return res.end(buf);
      } catch {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'not found' }));
      }
    }

    if (method === 'PUT') {
      const chunks = [];
      req.on('data', ch => chunks.push(ch));
      req.on('end', async () => {
        try {
          const body = Buffer.concat(chunks);
          await fsp.mkdir(path.dirname(filePath), { recursive: true });
          await fsp.writeFile(filePath, body);
          res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, saved: `${code}.jpg`, bytes: body.length }));
        } catch {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'write failed' }));
        }
      });
      return;
    }

    if (method === 'DELETE') {
      try {
        await fsp.unlink(filePath);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, deleted: `${code}.jpg` }));
      } catch {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'not found' }));
      }
    }

    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'method not allowed' }));
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(port, host, () => {
  console.log(`[STARTED] http://${host}:${port}  (cache: ${CACHE_DIR})`);
}).on('error', (err) => {
  console.error('Server failed to start:', err.message);
  process.exit(1);
});