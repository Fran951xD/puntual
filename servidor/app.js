// Puntual: servidor HTTP independiente del entorno. manejar(pedido, env, ctx) → Response.
// env: { DB (D1), ASSETS?, URL_PUBLICA?, RESEND_API_KEY?, CORREO_REMITENTE?, CRON_SECRETO? }
import { crearBD } from './bd.js';
import * as A from './agenda.js';
import * as U from './util.js';
import * as Av from './avisos.js';
import { crearDemo } from './demo.js';

const { ErrorHttp, json } = U;
const ACTIVOS = "('confirmado','pendiente_sena','asistio')";
const COOKIE = 'puntual_sesion';
const DURACION_SESION = 30 * 86400;
const COLORES = ['pino', 'ciruela', 'oceano', 'arcilla', 'grafito', 'lima'];

// ---------------------------------------------------------------- Rutas

const rutas = [];
const ruta = (metodo, patron, fn, opciones = {}) => {
  const claves = [];
  const re = new RegExp(`^${patron.replace(/:(\w+)/g, (_, k) => { claves.push(k); return '([^/]+)'; })}$`);
  rutas.push({ metodo, re, claves, fn, ...opciones });
};

export async function manejar(pedido, env, ctx = { waitUntil: (p) => p?.catch?.(() => {}) }) {
  const url = new URL(pedido.url);
  if (url.pathname.startsWith('/api/')) {
    const respuesta = await api(pedido, env, ctx, url);
    ponerEnCola(env, ctx);
    return respuesta;
  }
  return estatico(pedido, env, url);
}

async function api(pedido, env, ctx, url) {
  const bd = crearBD(env.DB);
  const metodo = pedido.method;
  try {
    if (metodo !== 'GET' && metodo !== 'HEAD') verificarOrigen(pedido, url);
    for (const r of rutas) {
      if (r.metodo !== metodo) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.claves.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const c = { bd, env, pedido, url, params, ctx, ahora: Date.now(), ip: pedido.headers.get('cf-connecting-ip') || pedido.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local' };
      if (r.sesion) await exigirSesion(c);
      return await r.fn(c);
    }
    throw new ErrorHttp(404, 'No existe esa dirección de la API.');
  } catch (e) {
    if (e instanceof ErrorHttp) return json({ error: e.message, ...e.extra }, e.estado);
    console.error(e);
    return json({ error: 'Ocurrió un error inesperado. Probá de nuevo en un momento.' }, 500);
  }
}

/** Protección CSRF: los pedidos que modifican datos tienen que venir de este mismo sitio. */
function verificarOrigen(pedido, url) {
  if (url.pathname === '/api/mp/webhook' || url.pathname === '/api/cron') return;
  const origen = pedido.headers.get('origin');
  if (origen && origen !== url.origin) throw new ErrorHttp(403, 'Origen no permitido.');
  if (!origen && pedido.headers.get('sec-fetch-site') === 'cross-site') throw new ErrorHttp(403, 'Origen no permitido.');
}

const urlBase = (c) => (c.env.URL_PUBLICA || c.url.origin).replace(/\/$/, '');
const urlGestion = (c, token) => `${urlBase(c)}/t/${token}`;
const urlReserva = (c, slug, fecha) => `${urlBase(c)}/${slug}${fecha ? `?fecha=${fecha}` : ''}`;

// ---------------------------------------------------------------- Límites de uso

async function limitar(c, clave, maximo, segundos) {
  const ventana = Math.floor(c.ahora / 1000 / segundos);
  const fila = await c.bd.uno(
    `INSERT INTO limites (clave, ventana, cuenta) VALUES (?, ?, 1)
     ON CONFLICT(clave) DO UPDATE SET cuenta = CASE WHEN ventana = excluded.ventana THEN cuenta + 1 ELSE 1 END, ventana = excluded.ventana
     RETURNING cuenta`, clave, ventana);
  if (fila && fila.cuenta > maximo) throw new ErrorHttp(429, 'Hiciste demasiados intentos. Esperá unos minutos y probá de nuevo.');
}

// ---------------------------------------------------------------- Sesiones

async function exigirSesion(c) {
  const token = U.leerCookies(c.pedido)[COOKIE];
  if (!token) throw new ErrorHttp(401, 'Tenés que ingresar.');
  const fila = await c.bd.uno(
    `SELECT u.id AS usuario_id, u.email, u.nombre AS usuario_nombre, u.demo, n.*
     FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id LEFT JOIN negocios n ON n.usuario_id = u.id
     WHERE s.id = ? AND s.expira > ?`, await U.sha256(token), c.ahora);
  if (!fila) throw new ErrorHttp(401, 'Tu sesión venció. Ingresá de nuevo.');
  c.usuario = { id: fila.usuario_id, email: fila.email, nombre: fila.usuario_nombre, demo: Boolean(fila.demo) };
  c.negocio = fila.id ? fila : null;
  if (!c.negocio) throw new ErrorHttp(409, 'Tu cuenta no tiene un negocio.');
}

async function crearSesion(c, usuarioId) {
  const token = U.aleatorio(32);
  await c.bd.ejecutar('INSERT INTO sesiones (id, usuario_id, expira, creado) VALUES (?, ?, ?, ?)', await U.sha256(token), usuarioId, c.ahora + DURACION_SESION * 1000, c.ahora);
  return U.cookie(COOKIE, token, { maxEdad: DURACION_SESION, seguro: c.url.protocol === 'https:' });
}

// ---------------------------------------------------------------- Cuenta

ruta('POST', '/api/registro', async (c) => {
  await limitar(c, `registro:${c.ip}`, 5, 3600);
  const d = U.validar(await U.leerJson(c.pedido), {
    nombre: { tipo: 'texto', requerido: true, max: 80, mensaje: 'Contanos tu nombre.' },
    email: { tipo: 'email', requerido: true },
    contrasena: { tipo: 'texto', requerido: true, min: 8, max: 200, mensaje: 'Usá al menos 8 caracteres.' },
    negocio: { tipo: 'texto', requerido: true, max: 80, mensaje: 'Poné el nombre de tu negocio o consultorio.' },
    rubro: { tipo: 'texto', max: 60, defecto: '' },
  });
  if (await c.bd.uno('SELECT 1 FROM usuarios WHERE email = ?', d.email)) throw new ErrorHttp(422, 'Revisá los datos marcados.', { errores: { email: 'Ya hay una cuenta con este email. ¿Querés ingresar?' } });
  const slug = await slugLibre(c, A.normalizarSlug(d.negocio) || 'mi-agenda');
  const usuario = await c.bd.ejecutar('INSERT INTO usuarios (email, hash, nombre, creado) VALUES (?, ?, ?, ?)', d.email, await U.hashContrasena(d.contrasena), d.nombre, c.ahora);
  const negocio = await c.bd.ejecutar('INSERT INTO negocios (usuario_id, slug, nombre, rubro, email_contacto, creado) VALUES (?, ?, ?, ?, ?, ?)', usuario.id, slug, d.negocio, d.rubro, d.email, c.ahora);
  // Horario inicial razonable que después se edita: lunes a viernes 9 a 13 y 14 a 18.
  await c.bd.lote([1, 2, 3, 4, 5].flatMap((dia) => [
    ['INSERT INTO horarios (negocio_id, dia, desde, hasta) VALUES (?, ?, ?, ?)', negocio.id, dia, 540, 780],
    ['INSERT INTO horarios (negocio_id, dia, desde, hasta) VALUES (?, ?, ?, ?)', negocio.id, dia, 840, 1080],
  ]));
  return json({ ok: true, slug }, 201, { 'set-cookie': await crearSesion(c, usuario.id) });
});

ruta('POST', '/api/ingresar', async (c) => {
  await limitar(c, `ingresar:${c.ip}`, 10, 900);
  const d = U.validar(await U.leerJson(c.pedido), { email: { tipo: 'email', requerido: true }, contrasena: { tipo: 'texto', requerido: true, max: 200 } });
  await limitar(c, `ingresar:${d.email}`, 8, 900);
  const u = await c.bd.uno('SELECT id, hash FROM usuarios WHERE email = ? AND demo = 0', d.email);
  // Si el email no existe, igual calculamos un hash para no revelar qué cuentas existen por el tiempo de respuesta.
  const ok = u ? await U.verificarContrasena(d.contrasena, u.hash) : (await U.hashContrasena(d.contrasena), false);
  if (!ok) throw new ErrorHttp(401, 'El email o la contraseña no coinciden.');
  return json({ ok: true }, 200, { 'set-cookie': await crearSesion(c, u.id) });
});

ruta('POST', '/api/salir', async (c) => {
  const token = U.leerCookies(c.pedido)[COOKIE];
  if (token) await c.bd.ejecutar('DELETE FROM sesiones WHERE id = ?', await U.sha256(token));
  return json({ ok: true }, 200, { 'set-cookie': U.cookie(COOKIE, '', { maxEdad: 0, seguro: c.url.protocol === 'https:' }) });
});

ruta('POST', '/api/demo', async (c) => {
  await limitar(c, `demo:${c.ip}`, 6, 3600);
  const { usuarioId } = await crearDemo(c.bd, c.ahora);
  return json({ ok: true }, 201, { 'set-cookie': await crearSesion(c, usuarioId) });
});

ruta('GET', '/api/yo', async (c) => {
  const [servicios, horarios] = await Promise.all([
    c.bd.uno('SELECT COUNT(*) AS n FROM servicios WHERE negocio_id = ? AND activo = 1', c.negocio.id),
    c.bd.uno('SELECT COUNT(*) AS n FROM horarios WHERE negocio_id = ?', c.negocio.id),
  ]);
  return json({ usuario: c.usuario, negocio: negocioPrivado(c.negocio), listo: { servicios: servicios.n > 0, horarios: horarios.n > 0 } });
}, { sesion: true });

ruta('POST', '/api/cuenta/contrasena', async (c) => {
  const d = U.validar(await U.leerJson(c.pedido), { actual: { tipo: 'texto', requerido: true }, nueva: { tipo: 'texto', requerido: true, min: 8, max: 200, mensaje: 'Usá al menos 8 caracteres.' } });
  const u = await c.bd.uno('SELECT hash FROM usuarios WHERE id = ?', c.usuario.id);
  if (!await U.verificarContrasena(d.actual, u.hash)) throw new ErrorHttp(422, 'Revisá los datos marcados.', { errores: { actual: 'La contraseña actual no coincide.' } });
  await c.bd.lote([
    ['UPDATE usuarios SET hash = ? WHERE id = ?', await U.hashContrasena(d.nueva), c.usuario.id],
    ['DELETE FROM sesiones WHERE usuario_id = ?', c.usuario.id],
  ]);
  return json({ ok: true }, 200, { 'set-cookie': await crearSesion(c, c.usuario.id) });
}, { sesion: true });

ruta('DELETE', '/api/cuenta', async (c) => {
  await c.bd.ejecutar('DELETE FROM usuarios WHERE id = ?', c.usuario.id);
  return json({ ok: true }, 200, { 'set-cookie': U.cookie(COOKIE, '', { maxEdad: 0 }) });
}, { sesion: true });

async function slugLibre(c, base, ignorarId = 0) {
  let slug = A.slugValido(base) ? base : `${base || 'agenda'}-turnos`.slice(0, 40);
  for (let i = 2; await c.bd.uno('SELECT 1 FROM negocios WHERE slug = ? AND id != ?', slug, ignorarId); i++) slug = `${base}-${i}`.slice(0, 40);
  return slug;
}

function negocioPrivado(n) {
  const { usuario_id, usuario_nombre, email, demo, mp_token, ...resto } = n;
  return { ...resto, mp_configurado: Boolean(mp_token) };
}

function negocioPublico(n) {
  return {
    slug: n.slug, nombre: n.nombre, rubro: n.rubro, descripcion: n.descripcion, direccion: n.direccion, color: n.color,
    whatsapp: n.whatsapp ? A.telefonoWhatsApp(n.whatsapp) : '', cancelacion_horas: n.cancelacion_horas, mensaje: n.mensaje,
    sena_plazo_horas: n.sena_plazo_horas, paso: n.paso,
  };
}

// ---------------------------------------------------------------- Negocio y configuración

const REGLAS_NEGOCIO = {
  nombre: { tipo: 'texto', requerido: true, max: 80 },
  slug: { tipo: 'texto', requerido: true, max: 40, validar: (v) => (A.slugValido(v) ? null : 'Usá entre 3 y 40 letras minúsculas, números o guiones.') },
  rubro: { tipo: 'texto', max: 60, defecto: '' },
  descripcion: { tipo: 'texto', max: 400, defecto: '' },
  direccion: { tipo: 'texto', max: 160, defecto: '' },
  whatsapp: { ...U.REGLA_TELEFONO, defecto: '' },
  email_contacto: { tipo: 'email', defecto: '' },
  color: { tipo: 'opcion', opciones: COLORES, defecto: 'pino' },
  paso: { tipo: 'entero', min: 5, max: 120, defecto: 30 },
  anticipacion_min_horas: { tipo: 'entero', min: 0, max: 168, defecto: 2 },
  anticipacion_max_dias: { tipo: 'entero', min: 1, max: 365, defecto: 45 },
  cancelacion_horas: { tipo: 'entero', min: 0, max: 168, defecto: 12 },
  sena_alias: { tipo: 'texto', max: 60, defecto: '' },
  sena_titular: { tipo: 'texto', max: 80, defecto: '' },
  sena_plazo_horas: { tipo: 'entero', min: 1, max: 72, defecto: 12 },
  mensaje: { tipo: 'texto', max: 500, defecto: '' },
  activo: { tipo: 'booleano', defecto: true },
};

ruta('GET', '/api/negocio', async (c) => json({ negocio: negocioPrivado(c.negocio) }), { sesion: true });

ruta('PUT', '/api/negocio', async (c) => {
  const cuerpo = await U.leerJson(c.pedido);
  const d = U.validar(cuerpo, REGLAS_NEGOCIO);
  if (await c.bd.uno('SELECT 1 FROM negocios WHERE slug = ? AND id != ?', d.slug, c.negocio.id)) {
    throw new ErrorHttp(422, 'Revisá los datos marcados.', { errores: { slug: 'Ese link ya lo usa otro negocio.' } });
  }
  const campos = Object.keys(d);
  const mp = typeof cuerpo.mp_token === 'string' ? cuerpo.mp_token.trim().slice(0, 200) : null;
  await c.bd.ejecutar(`UPDATE negocios SET ${campos.map((k) => `${k} = ?`).join(', ')}${mp !== null ? ', mp_token = ?' : ''} WHERE id = ?`,
    ...campos.map((k) => d[k]), ...(mp !== null ? [mp] : []), c.negocio.id);
  return json({ negocio: negocioPrivado(await c.bd.uno('SELECT * FROM negocios WHERE id = ?', c.negocio.id)) });
}, { sesion: true });

ruta('GET', '/api/slug', async (c) => {
  const valor = A.normalizarSlug(c.url.searchParams.get('valor'));
  const libre = A.slugValido(valor) && !await c.bd.uno('SELECT 1 FROM negocios WHERE slug = ? AND id != ?', valor, c.negocio.id);
  return json({ valor, libre });
}, { sesion: true });

// Servicios
const REGLAS_SERVICIO = {
  nombre: { tipo: 'texto', requerido: true, max: 80, mensaje: 'Poné un nombre, por ejemplo "Corte".' },
  descripcion: { tipo: 'texto', max: 300, defecto: '' },
  duracion: { tipo: 'entero', requerido: true, min: 5, max: 600, mensaje: 'Entre 5 y 600 minutos.' },
  margen: { tipo: 'entero', min: 0, max: 120, defecto: 0 },
  precio: { tipo: 'entero', min: 0, max: 100_000_000, defecto: 0 },
  sena: { tipo: 'entero', min: 0, max: 100_000_000, defecto: 0 },
  activo: { tipo: 'booleano', defecto: true },
};

ruta('GET', '/api/servicios', async (c) => json({ servicios: await c.bd.todos('SELECT * FROM servicios WHERE negocio_id = ? AND activo >= 0 ORDER BY orden, id', c.negocio.id) }), { sesion: true });

ruta('POST', '/api/servicios', async (c) => {
  const d = U.validar(await U.leerJson(c.pedido), REGLAS_SERVICIO);
  if (d.sena > d.precio && d.precio > 0) throw new ErrorHttp(422, 'Revisá los datos marcados.', { errores: { sena: 'La seña no puede superar el precio.' } });
  const orden = (await c.bd.uno('SELECT COALESCE(MAX(orden), 0) + 1 AS o FROM servicios WHERE negocio_id = ?', c.negocio.id)).o;
  const r = await c.bd.ejecutar('INSERT INTO servicios (negocio_id, nombre, descripcion, duracion, margen, precio, sena, activo, orden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    c.negocio.id, d.nombre, d.descripcion, d.duracion, d.margen, d.precio, d.sena, d.activo, orden);
  return json({ servicio: await c.bd.uno('SELECT * FROM servicios WHERE id = ?', r.id) }, 201);
}, { sesion: true });

ruta('PUT', '/api/servicios/:id', async (c) => {
  const d = U.validar(await U.leerJson(c.pedido), REGLAS_SERVICIO);
  if (d.sena > d.precio && d.precio > 0) throw new ErrorHttp(422, 'Revisá los datos marcados.', { errores: { sena: 'La seña no puede superar el precio.' } });
  const r = await c.bd.ejecutar('UPDATE servicios SET nombre = ?, descripcion = ?, duracion = ?, margen = ?, precio = ?, sena = ?, activo = ? WHERE id = ? AND negocio_id = ?',
    d.nombre, d.descripcion, d.duracion, d.margen, d.precio, d.sena, d.activo, c.params.id, c.negocio.id);
  if (!r.cambios) throw new ErrorHttp(404, 'No encontramos ese servicio.');
  return json({ servicio: await c.bd.uno('SELECT * FROM servicios WHERE id = ?', c.params.id) });
}, { sesion: true });

ruta('POST', '/api/servicios/orden', async (c) => {
  const { ids } = await U.leerJson(c.pedido);
  if (!Array.isArray(ids)) throw new ErrorHttp(400, 'Faltan los servicios.');
  await c.bd.lote(ids.map((id, i) => ['UPDATE servicios SET orden = ? WHERE id = ? AND negocio_id = ?', i + 1, Number(id), c.negocio.id]));
  return json({ ok: true });
}, { sesion: true });

ruta('DELETE', '/api/servicios/:id', async (c) => {
  // Si tiene turnos lo archivamos (activo = -1) para no romper el historial.
  const usado = await c.bd.uno('SELECT 1 FROM turnos WHERE servicio_id = ? AND negocio_id = ? LIMIT 1', c.params.id, c.negocio.id);
  if (usado) await c.bd.ejecutar('UPDATE servicios SET activo = -1 WHERE id = ? AND negocio_id = ?', c.params.id, c.negocio.id);
  else await c.bd.ejecutar('DELETE FROM servicios WHERE id = ? AND negocio_id = ?', c.params.id, c.negocio.id);
  return json({ ok: true });
}, { sesion: true });

// Horarios semanales y excepciones
ruta('GET', '/api/horarios', async (c) => json({
  horarios: await c.bd.todos('SELECT dia, desde, hasta FROM horarios WHERE negocio_id = ? ORDER BY dia, desde', c.negocio.id),
  excepciones: await c.bd.todos('SELECT * FROM excepciones WHERE negocio_id = ? AND fecha >= ? ORDER BY fecha, desde', c.negocio.id, A.ahoraEn(c.negocio.zona, c.ahora).fecha),
}), { sesion: true });

ruta('PUT', '/api/horarios', async (c) => {
  const { horarios } = await U.leerJson(c.pedido);
  if (!Array.isArray(horarios) || horarios.length > 70) throw new ErrorHttp(400, 'Horarios inválidos.');
  const limpios = [];
  for (const dia of [0, 1, 2, 3, 4, 5, 6]) {
    const delDia = horarios.filter((h) => Number(h.dia) === dia).map((h) => ({ desde: Number(h.desde), hasta: Number(h.hasta) }));
    for (const h of delDia) {
      if (!Number.isInteger(h.desde) || !Number.isInteger(h.hasta) || h.desde < 0 || h.hasta > 1440 || h.hasta <= h.desde) {
        throw new ErrorHttp(422, `Revisá los horarios del ${['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][dia]}: la hora de cierre tiene que ser posterior a la de apertura.`);
      }
    }
    for (const r of A.unirRangos(delDia)) limpios.push({ dia, ...r });
  }
  await c.bd.lote([
    ['DELETE FROM horarios WHERE negocio_id = ?', c.negocio.id],
    ...limpios.map((h) => ['INSERT INTO horarios (negocio_id, dia, desde, hasta) VALUES (?, ?, ?, ?)', c.negocio.id, h.dia, h.desde, h.hasta]),
  ]);
  return json({ horarios: limpios });
}, { sesion: true });

ruta('POST', '/api/excepciones', async (c) => {
  const d = U.validar(await U.leerJson(c.pedido), {
    fecha: { tipo: 'texto', requerido: true, validar: (v) => (A.esFecha(v) ? null : 'Fecha inválida.') },
    hasta_fecha: { tipo: 'texto', validar: (v) => (A.esFecha(v) ? null : 'Fecha inválida.') },
    tipo: { tipo: 'opcion', opciones: ['cerrado', 'abierto'], defecto: 'cerrado' },
    desde: { tipo: 'entero', min: 0, max: 1440 },
    hasta: { tipo: 'entero', min: 0, max: 1440 },
    motivo: { tipo: 'texto', max: 80, defecto: '' },
  });
  if ((d.desde == null) !== (d.hasta == null) || (d.desde != null && d.hasta <= d.desde)) throw new ErrorHttp(422, 'Revisá el horario: la hora de fin tiene que ser posterior a la de inicio.');
  if (d.tipo === 'abierto' && d.desde == null) throw new ErrorHttp(422, 'Para abrir un día extra, indicá el horario.');
  const fechas = [];
  const fin = d.hasta_fecha && d.hasta_fecha > d.fecha ? d.hasta_fecha : d.fecha;
  for (let f = d.fecha; f <= fin && fechas.length < 120; f = A.sumarDias(f, 1)) fechas.push(f);
  await c.bd.lote(fechas.map((f) => ['INSERT INTO excepciones (negocio_id, fecha, tipo, desde, hasta, motivo) VALUES (?, ?, ?, ?, ?, ?)', c.negocio.id, f, d.tipo, d.desde ?? null, d.hasta ?? null, d.motivo]));
  // Avisamos si hay turnos tomados en los días que se cierran.
  const afectados = d.tipo === 'cerrado' ? await c.bd.todos(
    `SELECT t.id, t.fecha, t.inicio, c.nombre FROM turnos t JOIN clientes c ON c.id = t.cliente_id
     WHERE t.negocio_id = ? AND t.fecha BETWEEN ? AND ? AND t.estado IN ('confirmado','pendiente_sena')
     ${d.desde != null ? 'AND t.inicio < ? AND t.fin > ?' : ''} ORDER BY t.fecha, t.inicio`,
    c.negocio.id, d.fecha, fin, ...(d.desde != null ? [d.hasta, d.desde] : [])) : [];
  return json({ ok: true, dias: fechas.length, afectados }, 201);
}, { sesion: true });

ruta('DELETE', '/api/excepciones/:id', async (c) => {
  await c.bd.ejecutar('DELETE FROM excepciones WHERE id = ? AND negocio_id = ?', c.params.id, c.negocio.id);
  return json({ ok: true });
}, { sesion: true });

// ---------------------------------------------------------------- Agenda del profesional

const SELECT_TURNO = `SELECT t.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, c.email AS cliente_email,
  s.nombre AS servicio_nombre, s.duracion AS servicio_duracion
  FROM turnos t JOIN clientes c ON c.id = t.cliente_id LEFT JOIN servicios s ON s.id = t.servicio_id`;

function turnoParaPanel(c, t) {
  const servicio = { nombre: t.servicio_nombre };
  const texto = A.textoRecordatorio({ negocio: c.negocio, servicio, turno: t, cliente: { nombre: t.cliente_nombre }, enlace: urlGestion(c, t.token) });
  return { ...t, hora: A.hora(t.inicio), hora_fin: A.hora(t.fin), whatsapp: t.cliente_telefono ? A.enlaceWhatsApp(t.cliente_telefono, texto) : '' };
}

ruta('GET', '/api/agenda', async (c) => {
  const desde = c.url.searchParams.get('desde');
  const hasta = c.url.searchParams.get('hasta');
  if (!A.esFecha(desde) || !A.esFecha(hasta) || A.diasEntre(desde, hasta) > 62 || hasta < desde) throw new ErrorHttp(400, 'Rango de fechas inválido.');
  const [turnos, horarios, excepciones] = await Promise.all([
    c.bd.todos(`${SELECT_TURNO} WHERE t.negocio_id = ? AND t.fecha BETWEEN ? AND ? ORDER BY t.fecha, t.inicio`, c.negocio.id, desde, hasta),
    c.bd.todos('SELECT dia, desde, hasta FROM horarios WHERE negocio_id = ?', c.negocio.id),
    c.bd.todos('SELECT * FROM excepciones WHERE negocio_id = ? AND fecha BETWEEN ? AND ?', c.negocio.id, desde, hasta),
  ]);
  const dias = [];
  for (let f = desde; f <= hasta; f = A.sumarDias(f, 1)) dias.push({ fecha: f, franjas: A.franjasDelDia(f, horarios, excepciones), excepciones: excepciones.filter((e) => e.fecha === f) });
  return json({ turnos: turnos.map((t) => turnoParaPanel(c, t)), dias, ahora: A.ahoraEn(c.negocio.zona, c.ahora) });
}, { sesion: true });

ruta('GET', '/api/hoy', async (c) => {
  const ahora = A.ahoraEn(c.negocio.zona, c.ahora);
  const manana = A.sumarDias(ahora.fecha, 1);
  const lunes = A.inicioDeSemana(ahora.fecha);
  const [hoy, recordar, senas, espera, semana, proximos] = await Promise.all([
    c.bd.todos(`${SELECT_TURNO} WHERE t.negocio_id = ? AND t.fecha = ? AND t.estado != 'cancelado' ORDER BY t.inicio`, c.negocio.id, ahora.fecha),
    c.bd.todos(`${SELECT_TURNO} WHERE t.negocio_id = ? AND t.fecha = ? AND t.estado = 'confirmado' AND t.recordado = 0 ORDER BY t.inicio`, c.negocio.id, manana),
    c.bd.todos(`${SELECT_TURNO} WHERE t.negocio_id = ? AND t.estado = 'pendiente_sena' AND t.fecha >= ? ORDER BY t.fecha, t.inicio`, c.negocio.id, ahora.fecha),
    c.bd.todos(`SELECT e.*, s.nombre AS servicio_nombre FROM espera e LEFT JOIN servicios s ON s.id = e.servicio_id WHERE e.negocio_id = ? AND e.fecha >= ? ORDER BY e.fecha, e.creado`, c.negocio.id, ahora.fecha),
    c.bd.todos(`SELECT estado, precio FROM turnos WHERE negocio_id = ? AND fecha BETWEEN ? AND ?`, c.negocio.id, lunes, A.sumarDias(lunes, 6)),
    c.bd.uno(`SELECT COUNT(*) AS n FROM turnos WHERE negocio_id = ? AND fecha BETWEEN ? AND ? AND estado IN ('confirmado','pendiente_sena')`, c.negocio.id, manana, A.sumarDias(ahora.fecha, 7)),
  ]);
  // Para cada día con lista de espera, ¿hay lugares libres ahora?
  const conLugar = [];
  for (const e of espera) {
    const libres = await horariosDelDia(c, c.negocio, e.servicio_id, e.fecha);
    conLugar.push({ ...e, libres: libres.length, whatsapp: A.enlaceWhatsApp(e.telefono, `Hola ${e.nombre.split(' ')[0]}! Se liberó un horario en ${c.negocio.nombre} el ${A.fechaLarga(e.fecha)}. Podés reservarlo acá: ${urlReserva(c, c.negocio.slug, e.fecha)}`) });
  }
  const activos = semana.filter((t) => t.estado !== 'cancelado');
  return json({
    ahora,
    hoy: hoy.map((t) => turnoParaPanel(c, t)),
    recordar: recordar.map((t) => turnoParaPanel(c, t)),
    senas: senas.map((t) => turnoParaPanel(c, t)),
    espera: conLugar,
    semana: {
      turnos: activos.length,
      ingresos: semana.filter((t) => t.estado === 'asistio').reduce((s, t) => s + t.precio, 0),
      previstos: activos.filter((t) => t.estado !== 'ausente').reduce((s, t) => s + t.precio, 0),
      ausentes: semana.filter((t) => t.estado === 'ausente').length,
    },
    proximos: proximos.n,
    link: urlReserva(c, c.negocio.slug),
  });
}, { sesion: true });

ruta('GET', '/api/turnos/:id', async (c) => {
  const t = await c.bd.uno(`${SELECT_TURNO} WHERE t.id = ? AND t.negocio_id = ?`, c.params.id, c.negocio.id);
  if (!t) throw new ErrorHttp(404, 'No encontramos ese turno.');
  const historial = await c.bd.uno(`SELECT COUNT(*) AS total, SUM(estado = 'asistio') AS asistidos, SUM(estado = 'ausente') AS ausentes FROM turnos WHERE cliente_id = ? AND id != ?`, t.cliente_id, t.id);
  return json({ turno: { ...turnoParaPanel(c, t), url_gestion: urlGestion(c, t.token) }, historial });
}, { sesion: true });

ruta('POST', '/api/turnos', async (c) => {
  const d = U.validar(await U.leerJson(c.pedido), {
    servicio_id: { tipo: 'entero', requerido: true, mensaje: 'Elegí un servicio.' },
    fecha: { tipo: 'texto', requerido: true, validar: (v) => (A.esFecha(v) ? null : 'Fecha inválida.') },
    inicio: { tipo: 'entero', requerido: true, min: 0, max: 1439, mensaje: 'Elegí la hora.' },
    nombre: { tipo: 'texto', requerido: true, max: 80, mensaje: 'Poné el nombre del cliente.' },
    telefono: { ...U.REGLA_TELEFONO, requerido: true },
    email: { tipo: 'email', defecto: '' },
    nota_interna: { tipo: 'texto', max: 500, defecto: '' },
    forzar: { tipo: 'booleano', defecto: false },
  });
  const servicio = await servicioDe(c, c.negocio.id, d.servicio_id);
  const turno = await crearTurno(c, {
    negocio: c.negocio, servicio, fecha: d.fecha, inicio: d.inicio, cliente: d, origen: 'panel',
    estado: 'confirmado', nota_interna: d.nota_interna, forzar: d.forzar,
  });
  return json({ turno: turnoParaPanel(c, await c.bd.uno(`${SELECT_TURNO} WHERE t.id = ?`, turno.id)) }, 201);
}, { sesion: true });

ruta('PATCH', '/api/turnos/:id', async (c) => {
  const t = await c.bd.uno(`${SELECT_TURNO} WHERE t.id = ? AND t.negocio_id = ?`, c.params.id, c.negocio.id);
  if (!t) throw new ErrorHttp(404, 'No encontramos ese turno.');
  const d = U.validar(await U.leerJson(c.pedido), {
    estado: { tipo: 'opcion', opciones: ['confirmado', 'cancelado', 'asistio', 'ausente', 'pendiente_sena'] },
    nota_interna: { tipo: 'texto', max: 500 },
    fecha: { tipo: 'texto', validar: (v) => (A.esFecha(v) ? null : 'Fecha inválida.') },
    inicio: { tipo: 'entero', min: 0, max: 1439 },
    avisar: { tipo: 'booleano', defecto: true },
    forzar: { tipo: 'booleano', defecto: false },
  });
  if (d.fecha != null || d.inicio != null) {
    await moverTurno(c, c.negocio, t, d.fecha ?? t.fecha, d.inicio ?? t.inicio, { forzar: d.forzar });
  }
  if (d.nota_interna != null) await c.bd.ejecutar('UPDATE turnos SET nota_interna = ?, actualizado = ? WHERE id = ?', d.nota_interna, c.ahora, t.id);
  if (d.estado && d.estado !== t.estado) {
    await c.bd.ejecutar('UPDATE turnos SET estado = ?, actualizado = ? WHERE id = ?', d.estado, c.ahora, t.id);
    if (d.estado === 'cancelado') await alCancelar(c, c.negocio, t, { avisarCliente: d.avisar });
    if (d.estado === 'confirmado' && t.estado === 'pendiente_sena') await avisarConfirmacion(c, c.negocio, t.id);
  }
  return json({ turno: turnoParaPanel(c, await c.bd.uno(`${SELECT_TURNO} WHERE t.id = ?`, t.id)) });
}, { sesion: true });

ruta('POST', '/api/turnos/:id/recordado', async (c) => {
  await c.bd.ejecutar('UPDATE turnos SET recordado = 2, actualizado = ? WHERE id = ? AND negocio_id = ?', c.ahora, c.params.id, c.negocio.id);
  return json({ ok: true });
}, { sesion: true });

ruta('GET', '/api/disponibles', async (c) => {
  const servicio = await servicioDe(c, c.negocio.id, Number(c.url.searchParams.get('servicio')));
  const fecha = c.url.searchParams.get('fecha');
  if (!A.esFecha(fecha)) throw new ErrorHttp(400, 'Fecha inválida.');
  const ignorar = Number(c.url.searchParams.get('ignorar')) || 0;
  // Para el profesional no rige la anticipación mínima: puede anotar un turno para dentro de 10 minutos.
  const libres = await horariosDelDia(c, c.negocio, servicio.id, fecha, { politica: { anticipacionMinHoras: 0, anticipacionMaxDias: 3650 }, ignorar, servicio });
  return json({ horarios: libres.map((m) => ({ inicio: m, hora: A.hora(m) })) });
}, { sesion: true });

// Clientes
ruta('GET', '/api/clientes', async (c) => {
  const q = `%${(c.url.searchParams.get('q') || '').trim().toLowerCase()}%`;
  const clientes = await c.bd.todos(
    `SELECT c.*, COUNT(t.id) AS turnos, SUM(t.estado = 'asistio') AS asistidos, SUM(t.estado = 'ausente') AS ausentes,
       MAX(CASE WHEN t.estado IN ('asistio') THEN t.fecha END) AS ultima_visita,
       MIN(CASE WHEN t.estado IN ('confirmado','pendiente_sena') AND t.fecha >= ? THEN t.fecha END) AS proximo
     FROM clientes c LEFT JOIN turnos t ON t.cliente_id = c.id
     WHERE c.negocio_id = ? AND (lower(c.nombre) LIKE ? OR c.telefono LIKE ? OR lower(c.email) LIKE ?)
     GROUP BY c.id ORDER BY COALESCE(ultima_visita, proximo, '') DESC, c.nombre LIMIT 300`,
    A.ahoraEn(c.negocio.zona, c.ahora).fecha, c.negocio.id, q, q.replace(/\D/g, '') ? `%${q.replace(/\D/g, '')}%` : q, q);
  return json({ clientes });
}, { sesion: true });

ruta('GET', '/api/clientes/:id', async (c) => {
  const cliente = await c.bd.uno('SELECT * FROM clientes WHERE id = ? AND negocio_id = ?', c.params.id, c.negocio.id);
  if (!cliente) throw new ErrorHttp(404, 'No encontramos ese cliente.');
  const turnos = await c.bd.todos(`${SELECT_TURNO} WHERE t.cliente_id = ? ORDER BY t.fecha DESC, t.inicio DESC LIMIT 100`, cliente.id);
  return json({ cliente: { ...cliente, whatsapp: A.enlaceWhatsApp(cliente.telefono, `Hola ${cliente.nombre.split(' ')[0]}!`) }, turnos: turnos.map((t) => turnoParaPanel(c, t)) });
}, { sesion: true });

ruta('PATCH', '/api/clientes/:id', async (c) => {
  const d = U.validar(await U.leerJson(c.pedido), { nombre: { tipo: 'texto', max: 80 }, email: { tipo: 'email' }, notas: { tipo: 'texto', max: 2000 } });
  const campos = Object.keys(d);
  if (!campos.length) return json({ ok: true });
  await c.bd.ejecutar(`UPDATE clientes SET ${campos.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND negocio_id = ?`, ...campos.map((k) => d[k]), c.params.id, c.negocio.id);
  return json({ cliente: await c.bd.uno('SELECT * FROM clientes WHERE id = ?', c.params.id) });
}, { sesion: true });

ruta('DELETE', '/api/espera/:id', async (c) => {
  await c.bd.ejecutar('DELETE FROM espera WHERE id = ? AND negocio_id = ?', c.params.id, c.negocio.id);
  return json({ ok: true });
}, { sesion: true });

ruta('GET', '/api/estadisticas', async (c) => {
  const dias = Math.min(Math.max(Number(c.url.searchParams.get('dias')) || 90, 7), 365);
  const ahora = A.ahoraEn(c.negocio.zona, c.ahora);
  const desde = A.sumarDias(ahora.fecha, -dias + 1);
  const [turnos, servicios] = await Promise.all([
    c.bd.todos('SELECT fecha, inicio, estado, precio, servicio_id, cliente_id, origen FROM turnos WHERE negocio_id = ? AND fecha BETWEEN ? AND ?', c.negocio.id, desde, ahora.fecha),
    c.bd.todos('SELECT id, nombre FROM servicios WHERE negocio_id = ?', c.negocio.id),
  ]);
  const e = A.estadisticas(turnos, { desde, hasta: ahora.fecha, servicios });
  // Comparación con el período anterior de igual largo.
  const previos = await c.bd.todos('SELECT fecha, inicio, estado, precio, servicio_id, cliente_id FROM turnos WHERE negocio_id = ? AND fecha BETWEEN ? AND ?', c.negocio.id, A.sumarDias(desde, -dias), A.sumarDias(desde, -1));
  const p = A.estadisticas(previos, { desde: A.sumarDias(desde, -dias), hasta: A.sumarDias(desde, -1), servicios });
  e.online = turnos.length ? turnos.filter((t) => t.origen === 'web').length / turnos.length : 0;
  return json({ desde, hasta: ahora.fecha, actual: e, anterior: { ingresos: p.ingresos, asistidos: p.asistidos, ausentismo: p.ausentismo, clientes: p.clientes } });
}, { sesion: true });

ruta('GET', '/api/exportar/turnos.csv', async (c) => {
  const filas = await c.bd.todos(`${SELECT_TURNO} WHERE t.negocio_id = ? ORDER BY t.fecha, t.inicio`, c.negocio.id);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['Fecha;Hora;Servicio;Cliente;Teléfono;Email;Estado;Precio;Seña;Origen;Nota del cliente;Nota interna',
    ...filas.map((t) => [t.fecha, A.hora(t.inicio), t.servicio_nombre, t.cliente_nombre, t.cliente_telefono, t.cliente_email, t.estado, t.precio, t.sena, t.origen, t.nota_cliente, t.nota_interna].map(esc).join(';'))].join('\r\n');
  return new Response(`﻿${csv}`, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="turnos-${c.negocio.slug}.csv"` } });
}, { sesion: true });

// ---------------------------------------------------------------- Reservas públicas

async function negocioPorSlug(c, slug) {
  const n = await c.bd.uno('SELECT * FROM negocios WHERE slug = ?', slug);
  if (!n) throw new ErrorHttp(404, 'No encontramos esta agenda. Revisá el link.');
  return n;
}

async function servicioDe(c, negocioId, servicioId, { soloActivos = false } = {}) {
  const s = await c.bd.uno(`SELECT * FROM servicios WHERE id = ? AND negocio_id = ? ${soloActivos ? 'AND activo = 1' : 'AND activo >= 0'}`, servicioId, negocioId);
  if (!s) throw new ErrorHttp(404, 'Ese servicio ya no está disponible.');
  return s;
}

const politicaDe = (n) => ({ anticipacionMinHoras: n.anticipacion_min_horas, anticipacionMaxDias: n.anticipacion_max_dias });

async function horariosDelDia(c, negocio, servicioId, fecha, { politica = politicaDe(negocio), ignorar = 0, servicio } = {}) {
  servicio ??= await servicioDe(c, negocio.id, servicioId);
  const [horarios, excepciones, ocupados] = await Promise.all([
    c.bd.todos('SELECT dia, desde, hasta FROM horarios WHERE negocio_id = ?', negocio.id),
    c.bd.todos('SELECT * FROM excepciones WHERE negocio_id = ? AND fecha = ?', negocio.id, fecha),
    c.bd.todos(`SELECT inicio, fin, margen FROM turnos WHERE negocio_id = ? AND fecha = ? AND estado IN ${ACTIVOS} AND id != ?`, negocio.id, fecha, ignorar),
  ]);
  return A.horariosLibres({
    fecha, franjas: A.franjasDelDia(fecha, horarios, excepciones), duracion: servicio.duracion, margen: servicio.margen,
    paso: negocio.paso, ocupados, ahora: A.ahoraEn(negocio.zona, c.ahora), politica,
  });
}

ruta('GET', '/api/p/:slug', async (c) => {
  const n = await negocioPorSlug(c, c.params.slug);
  const servicios = await c.bd.todos('SELECT id, nombre, descripcion, duracion, precio, sena FROM servicios WHERE negocio_id = ? AND activo = 1 ORDER BY orden, id', n.id);
  return json({ negocio: negocioPublico(n), servicios, activo: Boolean(n.activo), sena: Boolean(n.sena_alias || n.mp_token), hoy: A.ahoraEn(n.zona, c.ahora).fecha });
});

ruta('GET', '/api/p/:slug/mes', async (c) => {
  const n = await negocioPorSlug(c, c.params.slug);
  const mes = c.url.searchParams.get('mes') || '';
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new ErrorHttp(400, 'Mes inválido.');
  const servicio = await servicioDe(c, n.id, Number(c.url.searchParams.get('servicio')), { soloActivos: true });
  const [desde, hasta] = [`${mes}-01`, `${mes}-31`];
  const [horarios, excepciones, ocupados] = await Promise.all([
    c.bd.todos('SELECT dia, desde, hasta FROM horarios WHERE negocio_id = ?', n.id),
    c.bd.todos('SELECT * FROM excepciones WHERE negocio_id = ? AND fecha BETWEEN ? AND ?', n.id, desde, hasta),
    c.bd.todos(`SELECT fecha, inicio, fin, margen FROM turnos WHERE negocio_id = ? AND fecha BETWEEN ? AND ? AND estado IN ${ACTIVOS}`, n.id, desde, hasta),
  ]);
  const porFecha = {};
  for (const o of ocupados) (porFecha[o.fecha] ??= []).push(o);
  const dias = A.disponibilidadDelMes({ mes, horarios, excepciones, ocupadosPorFecha: porFecha, duracion: servicio.duracion, margen: servicio.margen, paso: n.paso, ahora: A.ahoraEn(n.zona, c.ahora), politica: politicaDe(n) });
  return json({ dias: n.activo ? dias : dias.map((d) => ({ ...d, libres: 0, estado: 'cerrado' })) });
});

ruta('GET', '/api/p/:slug/horarios', async (c) => {
  const n = await negocioPorSlug(c, c.params.slug);
  const fecha = c.url.searchParams.get('fecha');
  if (!A.esFecha(fecha)) throw new ErrorHttp(400, 'Fecha inválida.');
  const servicio = await servicioDe(c, n.id, Number(c.url.searchParams.get('servicio')), { soloActivos: true });
  const libres = n.activo ? await horariosDelDia(c, n, servicio.id, fecha, { servicio, ignorar: await idDeToken(c, c.url.searchParams.get('turno')) }) : [];
  return json({ horarios: libres.map((m) => ({ inicio: m, hora: A.hora(m) })) });
});

async function idDeToken(c, token) {
  if (!token) return 0;
  return (await c.bd.uno('SELECT id FROM turnos WHERE token = ?', token))?.id || 0;
}

ruta('POST', '/api/p/:slug/reservas', async (c) => {
  await limitar(c, `reservar:${c.ip}`, 12, 3600);
  const n = await negocioPorSlug(c, c.params.slug);
  if (!n.activo) throw new ErrorHttp(409, 'Esta agenda no está tomando turnos por ahora.');
  const cuerpo = await U.leerJson(c.pedido);
  if (cuerpo.sitio) return json({ ok: true }, 201); // trampa para robots: campo invisible
  const d = U.validar(cuerpo, {
    servicio_id: { tipo: 'entero', requerido: true, mensaje: 'Elegí un servicio.' },
    fecha: { tipo: 'texto', requerido: true, validar: (v) => (A.esFecha(v) ? null : 'Elegí un día.') },
    inicio: { tipo: 'entero', requerido: true, min: 0, max: 1439, mensaje: 'Elegí un horario.' },
    nombre: { tipo: 'texto', requerido: true, min: 2, max: 80, mensaje: 'Escribí tu nombre y apellido.' },
    telefono: { ...U.REGLA_TELEFONO, requerido: true },
    email: { tipo: 'email', defecto: '' },
    nota: { tipo: 'texto', max: 300, defecto: '' },
  });
  if (!A.telefonoWhatsApp(d.telefono)) throw new ErrorHttp(422, 'Revisá los datos marcados.', { errores: { telefono: 'Escribí el celular con código de área, por ejemplo 11 2345-6789.' } });
  const servicio = await servicioDe(c, n.id, d.servicio_id, { soloActivos: true });
  const libres = await horariosDelDia(c, n, servicio.id, d.fecha, { servicio });
  if (!libres.includes(d.inicio)) throw new ErrorHttp(409, 'Ese horario se acaba de ocupar. Elegí otro.', { codigo: 'ocupado' });
  // Un mismo teléfono no puede acaparar la agenda.
  const activos = await c.bd.uno(`SELECT COUNT(*) AS n FROM turnos t JOIN clientes c ON c.id = t.cliente_id
    WHERE t.negocio_id = ? AND c.telefono = ? AND t.estado IN ('confirmado','pendiente_sena') AND t.fecha >= ?`, n.id, A.telefonoWhatsApp(d.telefono), A.ahoraEn(n.zona, c.ahora).fecha);
  if (activos.n >= 3) throw new ErrorHttp(409, 'Ya tenés 3 turnos reservados. Para sacar otro, escribile al negocio.');
  const conSena = servicio.sena > 0 && Boolean(n.sena_alias || n.mp_token);
  const turno = await crearTurno(c, { negocio: n, servicio, fecha: d.fecha, inicio: d.inicio, cliente: d, origen: 'web', estado: conSena ? 'pendiente_sena' : 'confirmado', nota_cliente: d.nota });
  await c.bd.ejecutar('DELETE FROM espera WHERE negocio_id = ? AND fecha = ? AND telefono = ?', n.id, d.fecha, A.telefonoWhatsApp(d.telefono));
  const datos = await datosAviso(c, turno.id);
  c.ctx.waitUntil(Promise.all([
    Av.enviarCorreo(c.env, Av.correoConfirmacion(datos)),
    Av.enviarCorreo(c.env, Av.correoNuevoTurno({ ...datos, urlPanel: `${urlBase(c)}/panel` })),
  ]));
  return json({ token: turno.token, estado: turno.estado }, 201);
});

ruta('POST', '/api/p/:slug/espera', async (c) => {
  await limitar(c, `espera:${c.ip}`, 10, 3600);
  const n = await negocioPorSlug(c, c.params.slug);
  const cuerpo = await U.leerJson(c.pedido);
  if (cuerpo.sitio) return json({ ok: true }, 201);
  const d = U.validar(cuerpo, {
    servicio_id: { tipo: 'entero', requerido: true },
    fecha: { tipo: 'texto', requerido: true, validar: (v) => (A.esFecha(v) ? null : 'Fecha inválida.') },
    nombre: { tipo: 'texto', requerido: true, min: 2, max: 80, mensaje: 'Escribí tu nombre.' },
    telefono: { ...U.REGLA_TELEFONO, requerido: true },
    email: { tipo: 'email', defecto: '' },
  });
  await servicioDe(c, n.id, d.servicio_id, { soloActivos: true });
  const tel = A.telefonoWhatsApp(d.telefono) || d.telefono;
  if (!await c.bd.uno('SELECT 1 FROM espera WHERE negocio_id = ? AND fecha = ? AND telefono = ?', n.id, d.fecha, tel)) {
    await c.bd.ejecutar('INSERT INTO espera (negocio_id, servicio_id, fecha, nombre, telefono, email, creado) VALUES (?, ?, ?, ?, ?, ?, ?)', n.id, d.servicio_id, d.fecha, d.nombre, tel, d.email, c.ahora);
  }
  return json({ ok: true }, 201);
});

// Gestión del turno por parte del cliente (con el token secreto del link)
async function turnoPorToken(c) {
  const t = await c.bd.uno(`${SELECT_TURNO} WHERE t.token = ?`, c.params.token);
  if (!t) throw new ErrorHttp(404, 'No encontramos este turno. Revisá el link.');
  const n = await c.bd.uno('SELECT * FROM negocios WHERE id = ?', t.negocio_id);
  return { t, n };
}

ruta('GET', '/api/t/:token', async (c) => {
  const { t, n } = await turnoPorToken(c);
  const ahora = A.ahoraEn(n.zona, c.ahora);
  const datos = { negocio: n, servicio: { nombre: t.servicio_nombre, duracion: t.servicio_duracion }, turno: t, urlGestion: urlGestion(c, t.token) };
  return json({
    turno: {
      token: t.token, fecha: t.fecha, inicio: t.inicio, fin: t.fin, hora: A.hora(t.inicio), estado: t.estado, precio: t.precio, sena: t.sena,
      servicio_id: t.servicio_id, servicio: t.servicio_nombre, duracion: t.servicio_duracion, cliente: t.cliente_nombre, nota: t.nota_cliente,
      creado: t.creado, vence_sena: t.estado === 'pendiente_sena' ? t.creado + n.sena_plazo_horas * 3600000 : null,
    },
    negocio: { ...negocioPublico(n), sena_alias: n.sena_alias, sena_titular: n.sena_titular, mp: Boolean(n.mp_token) },
    puede_modificar: A.puedeModificar(t, ahora, n.cancelacion_horas),
    paso: A.yaPaso(t, ahora),
    calendario: Av.enlaceGoogleCalendar(datos),
  });
});

ruta('GET', '/api/t/:token/turno.ics', async (c) => {
  const { t, n } = await turnoPorToken(c);
  const ics = Av.archivoIcs({ negocio: n, servicio: { nombre: t.servicio_nombre }, turno: t, urlGestion: urlGestion(c, t.token) });
  return new Response(ics, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'attachment; filename="turno.ics"' } });
});

ruta('POST', '/api/t/:token/cancelar', async (c) => {
  await limitar(c, `gestion:${c.ip}`, 30, 3600);
  const { t, n } = await turnoPorToken(c);
  if (!A.puedeModificar(t, A.ahoraEn(n.zona, c.ahora), n.cancelacion_horas)) {
    throw new ErrorHttp(409, n.cancelacion_horas ? `Solo se puede cancelar hasta ${n.cancelacion_horas} horas antes. Escribile al negocio.` : 'Este turno ya no se puede cancelar.');
  }
  await c.bd.ejecutar("UPDATE turnos SET estado = 'cancelado', actualizado = ?, nota_interna = trim(nota_interna || ' Cancelado por el cliente.') WHERE id = ?", c.ahora, t.id);
  await alCancelar(c, n, t, { avisarCliente: false });
  return json({ ok: true });
});

ruta('POST', '/api/t/:token/reprogramar', async (c) => {
  await limitar(c, `gestion:${c.ip}`, 30, 3600);
  const { t, n } = await turnoPorToken(c);
  if (!A.puedeModificar(t, A.ahoraEn(n.zona, c.ahora), n.cancelacion_horas)) throw new ErrorHttp(409, 'Este turno ya no se puede cambiar. Escribile al negocio.');
  const d = U.validar(await U.leerJson(c.pedido), {
    fecha: { tipo: 'texto', requerido: true, validar: (v) => (A.esFecha(v) ? null : 'Elegí un día.') },
    inicio: { tipo: 'entero', requerido: true, min: 0, max: 1439, mensaje: 'Elegí un horario.' },
  });
  const servicio = await servicioDe(c, n.id, t.servicio_id);
  const libres = await horariosDelDia(c, n, servicio.id, d.fecha, { servicio, ignorar: t.id });
  if (!libres.includes(d.inicio)) throw new ErrorHttp(409, 'Ese horario se acaba de ocupar. Elegí otro.', { codigo: 'ocupado' });
  await moverTurno(c, n, t, d.fecha, d.inicio, { forzar: false });
  return json({ ok: true });
});

// ---------------------------------------------------------------- Mercado Pago (opcional, por negocio)

ruta('POST', '/api/t/:token/pagar', async (c) => {
  const { t, n } = await turnoPorToken(c);
  if (t.estado !== 'pendiente_sena') throw new ErrorHttp(409, 'Este turno no tiene una seña pendiente.');
  if (!n.mp_token) throw new ErrorHttp(409, 'Este negocio no cobra señas con Mercado Pago.');
  const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: { authorization: `Bearer ${n.mp_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      items: [{ title: `Seña: ${t.servicio_nombre} (${A.fechaLarga(t.fecha)} ${A.hora(t.inicio)})`, quantity: 1, unit_price: t.sena, currency_id: 'ARS' }],
      external_reference: t.token,
      back_urls: { success: urlGestion(c, t.token), failure: urlGestion(c, t.token), pending: urlGestion(c, t.token) },
      auto_return: 'approved',
      notification_url: `${urlBase(c)}/api/mp/webhook?negocio=${n.id}`,
      expires: true,
      expiration_date_to: new Date(t.creado + n.sena_plazo_horas * 3600000).toISOString(),
    }),
  });
  if (!r.ok) throw new ErrorHttp(502, 'Mercado Pago no respondió. Probá de nuevo o pagá por transferencia.');
  const p = await r.json();
  return json({ url: n.mp_token.startsWith('TEST-') ? p.sandbox_init_point || p.init_point : p.init_point });
});

ruta('POST', '/api/mp/webhook', async (c) => {
  // Nunca confiamos en el contenido del aviso: consultamos el pago a Mercado Pago con el token del negocio.
  const n = await c.bd.uno('SELECT * FROM negocios WHERE id = ?', Number(c.url.searchParams.get('negocio')));
  const cuerpo = await c.pedido.json().catch(() => ({}));
  const pagoId = cuerpo?.data?.id || c.url.searchParams.get('data.id') || c.url.searchParams.get('id');
  if (!n?.mp_token || !pagoId || (cuerpo.type && cuerpo.type !== 'payment')) return json({ ok: true });
  const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(pagoId)}`, { headers: { authorization: `Bearer ${n.mp_token}` } });
  if (!r.ok) return json({ ok: true });
  const pago = await r.json();
  const t = await c.bd.uno('SELECT * FROM turnos WHERE token = ? AND negocio_id = ?', pago.external_reference, n.id);
  if (t && pago.status === 'approved' && Number(pago.transaction_amount) >= t.sena && t.estado === 'pendiente_sena') {
    await c.bd.ejecutar("UPDATE turnos SET estado = 'confirmado', mp_pago = ?, actualizado = ? WHERE id = ?", String(pago.id), c.ahora, t.id);
    await avisarConfirmacion(c, n, t.id);
  }
  return json({ ok: true });
});

// ---------------------------------------------------------------- Tareas programadas

ruta('POST', '/api/cron', async (c) => {
  if (!c.env.CRON_SECRETO || !U.compararSeguro(c.pedido.headers.get('x-cron-secreto') || '', c.env.CRON_SECRETO)) throw new ErrorHttp(401, 'No autorizado.');
  return json(await procesarPendientes(c.env, c.ahora));
});

/** Vence señas impagas, manda recordatorios del día siguiente y limpia demos y sesiones viejas. */
export async function procesarPendientes(env, ahoraMs = Date.now()) {
  const bd = crearBD(env.DB);
  const c = { bd, env, ahora: ahoraMs, url: new URL(env.URL_PUBLICA || 'http://localhost'), ctx: { waitUntil: (p) => p } };
  const resumen = { vencidas: 0, recordatorios: 0 };
  const pendientes = await bd.todos(`${SELECT_TURNO} WHERE t.estado = 'pendiente_sena'`);
  for (const t of pendientes) {
    const n = await bd.uno('SELECT * FROM negocios WHERE id = ?', t.negocio_id);
    if (A.senaVencida(t, ahoraMs, n.sena_plazo_horas)) {
      await bd.ejecutar("UPDATE turnos SET estado = 'cancelado', nota_interna = trim(nota_interna || ' Seña vencida.'), actualizado = ? WHERE id = ?", ahoraMs, t.id);
      await alCancelar(c, n, t, { avisarCliente: true });
      resumen.vencidas++;
    }
  }
  if (env.RESEND_API_KEY) {
    const negocios = await bd.todos('SELECT * FROM negocios WHERE activo = 1');
    for (const n of negocios) {
      const ahora = A.ahoraEn(n.zona, ahoraMs);
      if (ahora.minutos < 9 * 60) continue; // no mandamos recordatorios de madrugada
      const turnos = await bd.todos("SELECT t.id FROM turnos t JOIN clientes c ON c.id = t.cliente_id WHERE t.negocio_id = ? AND t.fecha = ? AND t.estado = 'confirmado' AND t.recordado = 0 AND c.email != ''", n.id, A.sumarDias(ahora.fecha, 1));
      for (const { id } of turnos) {
        if (await Av.enviarCorreo(env, Av.correoRecordatorio(await datosAviso(c, id)))) {
          await bd.ejecutar('UPDATE turnos SET recordado = 1 WHERE id = ?', id);
          resumen.recordatorios++;
        }
      }
    }
  }
  await bd.lote([
    ['DELETE FROM sesiones WHERE expira < ?', ahoraMs],
    ['DELETE FROM usuarios WHERE demo = 1 AND creado < ?', ahoraMs - 86400000],
    ['DELETE FROM limites WHERE ventana < ?', Math.floor(ahoraMs / 1000 / 86400) - 1],
  ]);
  return resumen;
}

function ponerEnCola(env, ctx) {
  // Sin cron externo, las tareas corren solas cada 10 minutos como máximo, aprovechando las visitas.
  ctx.waitUntil((async () => {
    const bd = crearBD(env.DB);
    const ultima = Number((await bd.uno("SELECT valor FROM sistema WHERE clave = 'cron'"))?.valor || 0);
    if (Date.now() - ultima < 600000) return;
    await bd.ejecutar("INSERT INTO sistema (clave, valor) VALUES ('cron', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor", String(Date.now()));
    await procesarPendientes(env);
  })().catch((e) => console.error('tareas', e)));
}

// ---------------------------------------------------------------- Operaciones sobre turnos

async function crearTurno(c, { negocio, servicio, fecha, inicio, cliente, origen, estado, nota_cliente = '', nota_interna = '', forzar = false }) {
  const telefono = A.telefonoWhatsApp(cliente.telefono) || cliente.telefono.replace(/\D/g, '');
  const fila = await c.bd.uno(
    `INSERT INTO clientes (negocio_id, nombre, telefono, email, creado) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(negocio_id, telefono) DO UPDATE SET nombre = excluded.nombre, email = CASE WHEN excluded.email != '' THEN excluded.email ELSE clientes.email END
     RETURNING id`, negocio.id, cliente.nombre, telefono, cliente.email || '', c.ahora);
  const fin = inicio + servicio.duracion;
  const token = U.aleatorio(18);
  // Inserción atómica: solo se guarda si no se superpone con otro turno activo (evita la doble reserva).
  const r = await c.bd.ejecutar(
    `INSERT INTO turnos (negocio_id, servicio_id, cliente_id, fecha, inicio, fin, margen, estado, precio, sena, token, origen, nota_cliente, nota_interna, creado, actualizado)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE ? OR NOT EXISTS (SELECT 1 FROM turnos WHERE negocio_id = ? AND fecha = ? AND estado IN ${ACTIVOS} AND inicio < ? AND fin + margen > ?)`,
    negocio.id, servicio.id, fila.id, fecha, inicio, fin, servicio.margen, estado, servicio.precio, estado === 'pendiente_sena' ? servicio.sena : 0, token, origen, nota_cliente, nota_interna, c.ahora, c.ahora,
    forzar ? 1 : 0, negocio.id, fecha, fin + servicio.margen, inicio);
  if (!r.cambios) throw new ErrorHttp(409, 'Ese horario se superpone con otro turno.', { codigo: 'ocupado' });
  return { id: r.id, token, estado };
}

async function moverTurno(c, negocio, t, fecha, inicio, { forzar }) {
  const fin = inicio + (t.fin - t.inicio);
  const r = await c.bd.ejecutar(
    `UPDATE turnos SET fecha = ?, inicio = ?, fin = ?, recordado = 0, actualizado = ? WHERE id = ?
     AND (? OR NOT EXISTS (SELECT 1 FROM turnos WHERE negocio_id = ? AND fecha = ? AND estado IN ${ACTIVOS} AND id != ? AND inicio < ? AND fin + margen > ?))`,
    fecha, inicio, fin, c.ahora, t.id, forzar ? 1 : 0, negocio.id, fecha, t.id, fin + t.margen, inicio);
  if (!r.cambios) throw new ErrorHttp(409, 'El nuevo horario se superpone con otro turno.', { codigo: 'ocupado' });
  // El horario anterior quedó libre: avisamos a la lista de espera de ese día.
  if (fecha !== t.fecha || inicio !== t.inicio) await avisarEspera(c, negocio, t.fecha);
}

async function alCancelar(c, negocio, t, { avisarCliente }) {
  if (avisarCliente) c.ctx.waitUntil(datosAviso(c, t.id).then((d) => Av.enviarCorreo(c.env, Av.correoCancelacion({ ...d, urlReservar: urlReserva(c, negocio.slug) }))));
  await avisarEspera(c, negocio, t.fecha);
}

async function avisarEspera(c, negocio, fecha) {
  const lista = await c.bd.todos('SELECT * FROM espera WHERE negocio_id = ? AND fecha = ? AND avisado = 0 ORDER BY creado LIMIT 5', negocio.id, fecha);
  for (const e of lista) {
    const enviado = await Av.enviarCorreo(c.env, Av.correoEspera({ negocio, espera: e, urlReservar: urlReserva(c, negocio.slug, fecha) }));
    if (enviado) await c.bd.ejecutar('UPDATE espera SET avisado = 1 WHERE id = ?', e.id);
  }
}

async function avisarConfirmacion(c, negocio, turnoId) {
  c.ctx.waitUntil(datosAviso(c, turnoId).then((d) => Av.enviarCorreo(c.env, Av.correoConfirmacion(d))));
}

async function datosAviso(c, turnoId) {
  const t = await c.bd.uno(`${SELECT_TURNO} WHERE t.id = ?`, turnoId);
  const negocio = await c.bd.uno('SELECT * FROM negocios WHERE id = ?', t.negocio_id);
  return {
    negocio, turno: t,
    servicio: { nombre: t.servicio_nombre, duracion: t.servicio_duracion },
    cliente: { nombre: t.cliente_nombre, telefono: t.cliente_telefono, email: t.cliente_email },
    urlGestion: urlGestion(c, t.token),
  };
}

// ---------------------------------------------------------------- Archivos estáticos

const SEGURIDAD = {
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

async function estatico(pedido, env, url) {
  // Cloudflare Pages sirve las páginas sin ".html" (y redirige /index.html → /), así que las pedimos así.
  const partes = url.pathname.split('/').filter(Boolean);
  let pagina = null;
  if (url.pathname === '/' || url.pathname === '/index.html') pagina = '/';
  else if (partes[0] === 'panel' || url.pathname === '/ingresar' || url.pathname === '/registro' || url.pathname === '/panel.html') pagina = '/panel';
  else if ((partes[0] === 't' && partes.length === 2) || url.pathname === '/reserva.html') pagina = '/reserva';
  else if (partes.length === 1 && !partes[0].includes('.')) pagina = '/reserva'; // /mi-negocio → página de reservas
  if (!pagina) return env.ASSETS.fetch(pedido);
  const r = await env.ASSETS.fetch(new Request(new URL(pagina, url), { method: 'GET', headers: pedido.headers }));
  const h = new Headers(r.headers);
  for (const [k, v] of Object.entries(SEGURIDAD)) h.set(k, v);
  h.set('cache-control', 'no-cache');
  return new Response(r.body, { status: r.status, headers: h });
}
