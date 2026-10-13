import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Local dev plugin: serves the files in /api the same way Vercel does, so `npm run dev`
 * works without the Vercel CLI. Each request re-imports the handler (cache-busted) so edits apply live.
 * In production Vercel runs the /api files itself and this plugin is not used.
 */
function localApiPlugin(env) {
  return {
    name: 'local-vercel-api',
    configureServer(server) {
      // Expose server-side env vars (no VITE_ prefix) to the handlers, exactly like Vercel does.
      // Values from .env.local always win so that editing the file (Vite restarts on env changes) takes effect.
      for (const [k, v] of Object.entries(env)) process.env[k] = v;

      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/')) return next();
        const url = new URL(req.url, 'http://localhost');
        const name = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
        if (!/^[a-z0-9_-]+$/i.test(name)) return next();
        const file = path.resolve(process.cwd(), 'api', `${name}.js`);

        // Shim the Vercel request/response helpers onto Node's objects.
        req.query = Object.fromEntries(url.searchParams.entries());
        if (req.method === 'POST' || req.method === 'PUT') {
          req.body = await new Promise((resolve) => {
            let data = '';
            req.on('data', (c) => (data += c));
            req.on('end', () => {
              try {
                resolve(data ? JSON.parse(data) : {});
              } catch {
                resolve(data);
              }
            });
          });
        }
        res.status = (code) => {
          res.statusCode = code;
          return res;
        };
        res.json = (obj) => {
          if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(obj));
          return res;
        };
        res.send = (body) => {
          res.end(typeof body === 'string' ? body : JSON.stringify(body));
          return res;
        };

        try {
          const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
          await mod.default(req, res);
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: `Local API error: ${err.message}` }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
  return {
    plugins: [react(), tailwindcss(), localApiPlugin(env)],
    // App version recorded with every logged analysis and printed on the tear sheet.
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    build: { outDir: 'dist' },
  };
});
