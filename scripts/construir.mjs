// Arma dist/ para Cloudflare Pages: copia public/ y junta el servidor en un único dist/_worker.js.
// Sin dependencias: cada módulo queda dentro de su propia función, como un espacio de nombres.
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';

const MODULOS = ['agenda', 'util', 'bd', 'avisos', 'demo', 'app']; // en orden de dependencias
const salida = new URL('../dist/', import.meta.url);
rmSync(salida, { recursive: true, force: true });
mkdirSync(salida, { recursive: true });
cpSync(new URL('../public/', import.meta.url), salida, { recursive: true });

const partes = ['// Generado por scripts/construir.mjs a partir de servidor/. No editar a mano.'];
for (const nombre of MODULOS) {
  let codigo = readFileSync(new URL(`../servidor/${nombre}.js`, import.meta.url), 'utf8');
  const exportados = [];
  codigo = codigo
    .replace(/^import \* as (\w+) from '\.\/(\w+)\.js';$/gm, (_, alias, mod) => `const ${alias} = __${mod};`)
    .replace(/^import \{([^}]+)\} from '\.\/(\w+)\.js';$/gm, (_, nombres, mod) => `const {${nombres.replace(/\s+as\s+/g, ': ')}} = __${mod};`)
    .replace(/^export (async function|function|const|let|class) (\w+)/gm, (_, tipo, n) => { exportados.push(n); return `${tipo} ${n}`; })
    .replace(/^export \{([^}]+)\};?$/gm, (_, nombres) => { exportados.push(...nombres.split(',').map((x) => x.trim()).filter(Boolean)); return ''; });
  if (/^\s*(import|export)\s/m.test(codigo)) throw new Error(`Quedó un import/export sin convertir en servidor/${nombre}.js`);
  partes.push(`const __${nombre} = (() => {\n${codigo}\nreturn { ${exportados.join(', ')} };\n})();`);
}
partes.push(`
let migrado = null;
const preparar = (env) => (migrado ??= __bd.crearBD(env.DB).migrar());

export default {
  async fetch(pedido, env, ctx) {
    await preparar(env);
    return __app.manejar(pedido, env, ctx);
  },
  async scheduled(evento, env, ctx) {
    await preparar(env);
    ctx.waitUntil(__app.procesarPendientes(env));
  },
};
`);
writeFileSync(new URL('_worker.js', salida), partes.join('\n\n'));
console.log('Listo: dist/ con _worker.js');
