// Arranca Puntual en Node con SQLite local: node servidor/node.js  (variables: PUERTO, BD)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { manejar } from './app.js';
import { crearBD, d1DesdeSqlite } from './bd.js';

const RAIZ = fileURLToPath(new URL('../public/', import.meta.url));
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.ico': 'image/x-icon' };

/** Imita el binding ASSETS de Cloudflare leyendo archivos de public/. */
export const assetsLocales = {
  async fetch(pedido) {
    let ruta = normalize(decodeURIComponent(new URL(pedido.url).pathname)).replace(/^(\.\.[/\\])+/, '');
    // Igual que Cloudflare Pages: /index.html y /x.html redirigen a la versión sin extensión.
    if (/\.html$/.test(ruta)) return new Response(null, { status: 308, headers: { location: ruta.replace(/(index)?\.html$/, '') } });
    if (ruta === '/' || ruta === '\\') ruta = '/index.html';
    else if (!extname(ruta)) ruta += '.html';
    const archivo = join(RAIZ, ruta);
    if (!archivo.startsWith(RAIZ)) return new Response('Prohibido', { status: 403 });
    try {
      if (!(await stat(archivo)).isFile()) throw new Error();
      return new Response(await readFile(archivo), { headers: { 'content-type': TIPOS[extname(archivo)] || 'application/octet-stream', 'cache-control': 'no-cache' } });
    } catch {
      return new Response('No encontrado', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  },
};

export async function crearEntorno(rutaBD = ':memory:', extra = {}) {
  const DB = d1DesdeSqlite(new DatabaseSync(rutaBD));
  await crearBD(DB).migrar();
  return { DB, ASSETS: assetsLocales, ...extra };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = await crearEntorno(process.env.BD || 'puntual.db', { RESEND_API_KEY: process.env.RESEND_API_KEY, CORREO_REMITENTE: process.env.CORREO_REMITENTE, CRON_SECRETO: process.env.CRON_SECRETO, URL_PUBLICA: process.env.URL_PUBLICA });
  const puerto = Number(process.env.PUERTO || 8787);
  createServer(async (req, res) => {
    const cuerpo = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise((ok) => { const partes = []; req.on('data', (p) => partes.push(p)); req.on('end', () => ok(Buffer.concat(partes))); });
    const pedido = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: cuerpo });
    const pendientes = [];
    const r = await manejar(pedido, env, { waitUntil: (p) => pendientes.push(Promise.resolve(p).catch((e) => console.error(e))) });
    const encabezados = {};
    r.headers.forEach((v, k) => { encabezados[k] = k === 'set-cookie' ? r.headers.getSetCookie() : v; });
    res.writeHead(r.status, encabezados);
    res.end(Buffer.from(await r.arrayBuffer()));
  }).listen(puerto, () => console.log(`Puntual en http://localhost:${puerto}`));
}
