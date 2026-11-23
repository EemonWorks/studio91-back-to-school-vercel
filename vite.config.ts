import { defineConfig, loadEnv } from 'vite';
import type { Plugin, ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Runs api/index.ts inside the Vite dev server, so `npm run dev` needs no separate backend.
// (On Vercel the same file runs as a Vercel Function.)
async function runApi(server: ViteDevServer, req: IncomingMessage, res: ServerResponse) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk as Uint8Array);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else if (value !== undefined) headers.set(key, value);
  }
  const method = req.method ?? 'GET';
  const request = new Request(new URL(req.url ?? '/', 'http://localhost'), {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? null : new Uint8Array(Buffer.concat(chunks)),
  });
  const api = await server.ssrLoadModule('/api/index.ts') as { default: { fetch: (request: Request) => Promise<Response> } };
  const response = await api.default.fetch(request);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

function localApi(): Plugin {
  return {
    name: 'studio91-local-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api')) { next(); return; }
        runApi(server, req, res).catch((error: unknown) => next(error));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Lets the local API read .env.local (for example ADMIN_RESET_KEY) just like Vercel would.
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) process.env[key] ??= value;
  return {
    plugins: [react(), localApi()],
    server: {
      port: 5173,
      strictPort: true,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            three: ['three'],
          },
        },
      },
    },
  };
});
