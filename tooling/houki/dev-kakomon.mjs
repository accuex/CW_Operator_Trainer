import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function houkiKakomonPlugin() {
  return {
    name: 'cwot-houki-kakomon',
    buildStart() {
      const dir = resolve(process.cwd(), 'private/houki-kakomon/sets');
      let names = [];
      try { names = readdirSync(dir).filter((name) => /^1sou-houki-\d{4}-(?:03|09)\.json$/.test(name)); } catch { names = []; }
      if (!names.length) this.error('private/houki-kakomon/sets に法規過去問がない。このビルドには問題セットが入らない。');
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        let url;
        try { url = new URL(req.url ?? '', 'http://localhost'); } catch { return next(); }
        if (!url.pathname.startsWith('/__houki-kakomon/')) return next();
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        const host = req.headers.host ?? '';
        const remote = req.socket?.remoteAddress ?? '';
        const local = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host) && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote);
        if (process.env.NODE_ENV === 'production' || !local) {
          res.writeHead(403);
          res.end('unavailable');
          return;
        }
        if (req.method !== 'GET') {
          res.writeHead(404);
          res.end();
          return;
        }
        const setId = url.pathname.match(/^\/__houki-kakomon\/sets\/(1sou-houki-\d{4}-(?:03|09))$/)?.[1];
        const file = url.pathname === '/__houki-kakomon/manifest'
          ? resolve(server.config.root, 'private/houki-kakomon/manifest.json')
          : setId
            ? resolve(server.config.root, `private/houki-kakomon/sets/${setId}.json`)
            : '';
        if (!file) {
          res.writeHead(404);
          res.end();
          return;
        }
        try {
          const data = await readFile(file, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(data);
        } catch {
          res.writeHead(404);
          res.end('set unavailable');
        }
      });
    },
  };
}
