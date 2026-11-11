import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(
  new URL('../../packages/frontend/apps/web/dist/', import.meta.url)
);
const types = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, 'http://localhost').pathname
    );
    const filename = resolve(
      root,
      `.${pathname === '/' ? '/index.html' : pathname}`
    );
    if (!filename.startsWith(resolve(root) + sep)) {
      response.writeHead(403).end();
      return;
    }
    let data;
    let extension = extname(filename);
    try {
      data = await readFile(filename);
    } catch (error) {
      if (error.code !== 'ENOENT' || extension) throw error;
      data = await readFile(resolve(root, 'index.html'));
      extension = '.html';
    }
    response.writeHead(200, {
      'Content-Type': types[extension] ?? 'application/octet-stream',
    });
    response.end(data);
  } catch {
    response.writeHead(404).end();
  }
}).listen(18080, '127.0.0.1');
