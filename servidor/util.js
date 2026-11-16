// Utilidades HTTP, criptografía y validación. Solo APIs web estándar (funcionan en Cloudflare y en Node).

export class ErrorHttp extends Error {
  constructor(estado, mensaje, extra = {}) { super(mensaje); this.estado = estado; this.extra = extra; }
}

export const json = (datos, estado = 200, encabezados = {}) => new Response(JSON.stringify(datos), {
  status: estado,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...encabezados },
});

export async function leerJson(pedido) {
  const tipo = pedido.headers.get('content-type') || '';
  if (!tipo.includes('application/json')) throw new ErrorHttp(415, 'Se esperaba JSON.');
  const texto = await pedido.text();
  if (texto.length > 100_000) throw new ErrorHttp(413, 'El pedido es demasiado grande.');
  try { return texto ? JSON.parse(texto) : {}; } catch { throw new ErrorHttp(400, 'JSON inválido.'); }
}

// ---------------------------------------------------------------- Criptografía

const texto = new TextEncoder();
const aB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export function aleatorio(bytes = 24) {
  return aB64(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(s) {
  return aB64(await crypto.subtle.digest('SHA-256', texto.encode(s)));
}

// Cloudflare Workers admite como máximo 100.000 iteraciones de PBKDF2.
const ITERACIONES = 100_000;

export async function hashContrasena(contrasena, sal = crypto.getRandomValues(new Uint8Array(16)), iteraciones = ITERACIONES) {
  const clave = await crypto.subtle.importKey('raw', texto.encode(contrasena), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones }, clave, 256);
  return `pbkdf2$${iteraciones}$${aB64(sal)}$${aB64(bits)}`;
}

export async function verificarContrasena(contrasena, guardado) {
  const [tipo, iter, sal, hash] = String(guardado).split('$');
  if (tipo !== 'pbkdf2' || !hash) return false;
  const calculado = (await hashContrasena(contrasena, deB64(sal), Number(iter))).split('$')[3];
  return compararSeguro(calculado, hash);
}

/** Comparación en tiempo constante (evita filtrar información por la duración). */
export function compararSeguro(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------------------------------------------------------------- Cookies

export function leerCookies(pedido) {
  const salida = {};
  for (const parte of (pedido.headers.get('cookie') || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0) salida[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return salida;
}

export function cookie(nombre, valor, { maxEdad, seguro = true } = {}) {
  return [`${nombre}=${encodeURIComponent(valor)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', seguro ? 'Secure' : null,
    maxEdad != null ? `Max-Age=${maxEdad}` : null].filter(Boolean).join('; ');
}

// ---------------------------------------------------------------- Validación

/** Valida un objeto según reglas simples y devuelve los valores limpios o un error 422 con detalle por campo. */
export function validar(datos, reglas) {
  const limpio = {};
  const errores = {};
  for (const [campo, r] of Object.entries(reglas)) {
    let v = datos?.[campo];
    if (typeof v === 'string') v = v.trim();
    const vacio = v === undefined || v === null || v === '';
    if (vacio) {
      if (r.requerido) errores[campo] = r.mensaje || 'Este dato es obligatorio.';
      else if ('defecto' in r) limpio[campo] = r.defecto;
      continue;
    }
    if (r.tipo === 'texto') {
      v = String(v);
      if (r.max && v.length > r.max) { errores[campo] = `Máximo ${r.max} caracteres.`; continue; }
      if (r.min && v.length < r.min) { errores[campo] = r.mensaje || `Mínimo ${r.min} caracteres.`; continue; }
      if (r.patron && !r.patron.test(v)) { errores[campo] = r.mensaje || 'Formato inválido.'; continue; }
    } else if (r.tipo === 'entero') {
      v = Number(v);
      if (!Number.isInteger(v) || (r.min != null && v < r.min) || (r.max != null && v > r.max)) {
        errores[campo] = r.mensaje || `Ingresá un número entero${r.min != null ? ` desde ${r.min}` : ''}${r.max != null ? ` hasta ${r.max}` : ''}.`;
        continue;
      }
    } else if (r.tipo === 'email') {
      v = String(v).toLowerCase();
      if (v.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { errores[campo] = 'Revisá el email.'; continue; }
    } else if (r.tipo === 'opcion') {
      if (!r.opciones.includes(v)) { errores[campo] = 'Opción inválida.'; continue; }
    } else if (r.tipo === 'booleano') {
      v = Boolean(v);
    }
    if (r.validar) {
      const problema = r.validar(v);
      if (problema) { errores[campo] = problema; continue; }
    }
    limpio[campo] = v;
  }
  if (Object.keys(errores).length) throw new ErrorHttp(422, 'Revisá los datos marcados.', { errores });
  return limpio;
}

export const REGLA_TELEFONO = { tipo: 'texto', max: 30, patron: /^[+\d\s()-]{8,30}$/, mensaje: 'Escribí un teléfono con código de área, por ejemplo 11 2345-6789.' };

export function escaparHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
