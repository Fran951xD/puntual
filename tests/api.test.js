import test from 'node:test';
import assert from 'node:assert/strict';
import { manejar, procesarPendientes } from '../servidor/app.js';
import { crearEntorno } from '../servidor/node.js';
import * as A from '../servidor/agenda.js';

const BASE = 'http://puntual.test';

/** Cliente HTTP mínimo con cookies, para hablar con la API como un navegador. */
function navegador(env) {
  let cookie = '';
  const pedir = async (metodo, ruta, cuerpo, extra = {}) => {
    const r = await manejar(new Request(BASE + ruta, {
      method: metodo,
      headers: { ...(cuerpo ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), origin: BASE, ...extra },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    }), env, { waitUntil: () => {} });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const tipo = r.headers.get('content-type') || '';
    return { estado: r.status, datos: tipo.includes('json') ? await r.json() : await r.text(), r };
  };
  return { get: (r, e) => pedir('GET', r, null, e), post: (r, c, e) => pedir('POST', r, c, e), put: (r, c) => pedir('PUT', r, c), patch: (r, c) => pedir('PATCH', r, c), del: (r) => pedir('DELETE', r) };
}

async function preparar() {
  const env = await crearEntorno();
  const pro = navegador(env);
  const reg = await pro.post('/api/registro', { nombre: 'Ana', email: 'ana@ejemplo.com', contrasena: 'secreta123', negocio: 'Kinesio Ana' });
  assert.equal(reg.estado, 201, JSON.stringify(reg.datos));
  return { env, pro, slug: reg.datos.slug };
}

const hoyAR = () => A.ahoraEn().fecha;
const proximo = (dia, desde = hoyAR()) => { let f = A.sumarDias(desde, 2); while (A.diaSemana(f) !== dia) f = A.sumarDias(f, 1); return f; };

test('registro, sesión e ingreso', async () => {
  const { env, pro, slug } = await preparar();
  assert.equal(slug, 'kinesio-ana');
  const yo = await pro.get('/api/yo');
  assert.equal(yo.datos.negocio.nombre, 'Kinesio Ana');
  assert.equal(yo.datos.listo.servicios, false);
  assert.ok(!('mp_token' in yo.datos.negocio));
  const repetido = await navegador(env).post('/api/registro', { nombre: 'X', email: 'ANA@ejemplo.com', contrasena: 'otraclave1', negocio: 'Otro' });
  assert.equal(repetido.estado, 422);
  assert.match(repetido.datos.errores.email, /Ya hay una cuenta/);
  await pro.post('/api/salir', {});
  assert.equal((await pro.get('/api/yo')).estado, 401);
  assert.equal((await pro.post('/api/ingresar', { email: 'ana@ejemplo.com', contrasena: 'mal' })).estado, 401);
  assert.equal((await pro.post('/api/ingresar', { email: 'ana@ejemplo.com', contrasena: 'secreta123' })).estado, 200);
  assert.equal((await pro.get('/api/yo')).estado, 200);
});

test('protección: CSRF, validación y límites', async () => {
  const { env, pro } = await preparar();
  const ajeno = await pro.post('/api/servicios', { nombre: 'X', duracion: 30 }, { origin: 'https://malicioso.com' });
  assert.equal(ajeno.estado, 403);
  const invalido = await pro.post('/api/servicios', { nombre: '', duracion: 3 });
  assert.equal(invalido.estado, 422);
  assert.ok(invalido.datos.errores.nombre && invalido.datos.errores.duracion);
  const intruso = navegador(env);
  for (let i = 0; i < 10; i++) await intruso.post('/api/ingresar', { email: 'x@y.com', contrasena: 'nada' });
  assert.equal((await intruso.post('/api/ingresar', { email: 'x@y.com', contrasena: 'nada' })).estado, 429);
});

test('flujo completo de reserva pública', async () => {
  const { env, pro, slug } = await preparar();
  const s = (await pro.post('/api/servicios', { nombre: 'Sesión de kinesiología', duracion: 50, margen: 10, precio: 20000 })).datos.servicio;
  const martes = proximo(2);
  const mes = martes.slice(0, 7);

  const cliente = navegador(env);
  const publico = await cliente.get(`/api/p/${slug}`);
  assert.equal(publico.datos.servicios.length, 1);
  assert.ok(!JSON.stringify(publico.datos).includes('ana@ejemplo.com'));

  const dias = (await cliente.get(`/api/p/${slug}/mes?servicio=${s.id}&mes=${mes}`)).datos.dias;
  assert.equal(dias.find((d) => d.fecha === martes).estado, 'libre');
  const horarios = (await cliente.get(`/api/p/${slug}/horarios?servicio=${s.id}&fecha=${martes}`)).datos.horarios;
  assert.equal(horarios[0].hora, '09:00');

  const reserva = await cliente.post(`/api/p/${slug}/reservas`, { servicio_id: s.id, fecha: martes, inicio: 540, nombre: 'Pedro Gómez', telefono: '11 5555-1234', email: 'pedro@ejemplo.com', nota: 'Dolor de rodilla' });
  assert.equal(reserva.estado, 201, JSON.stringify(reserva.datos));
  assert.equal(reserva.datos.estado, 'confirmado');

  // Mismo horario: rechazado. Horario pegado: también (50 min + 10 de margen).
  assert.equal((await cliente.post(`/api/p/${slug}/reservas`, { servicio_id: s.id, fecha: martes, inicio: 540, nombre: 'Otra Persona', telefono: '11 5555-0000' })).estado, 409);
  const despues = (await cliente.get(`/api/p/${slug}/horarios?servicio=${s.id}&fecha=${martes}`)).datos.horarios.map((h) => h.hora);
  assert.ok(!despues.includes('09:00') && !despues.includes('09:30') && despues.includes('10:00'));

  const turno = await cliente.get(`/api/t/${reserva.datos.token}`);
  assert.equal(turno.datos.turno.servicio, 'Sesión de kinesiología');
  assert.equal(turno.datos.puede_modificar, true);
  assert.match(turno.datos.calendario, /calendar\.google\.com.*dates=\d{8}T120000Z/);
  const ics = await cliente.get(`/api/t/${reserva.datos.token}/turno.ics`);
  assert.match(ics.datos, /DTSTART:\d{8}T120000Z/);

  // Reprogramar y cancelar
  assert.equal((await cliente.post(`/api/t/${reserva.datos.token}/reprogramar`, { fecha: martes, inicio: 600 })).estado, 200);
  assert.equal((await cliente.get(`/api/t/${reserva.datos.token}`)).datos.turno.hora, '10:00');
  assert.equal((await cliente.post(`/api/t/${reserva.datos.token}/cancelar`, {})).estado, 200);
  assert.equal((await cliente.get(`/api/t/${reserva.datos.token}`)).datos.turno.estado, 'cancelado');

  // El profesional ve al cliente con su historial
  const clientes = (await pro.get('/api/clientes?q=pedro')).datos.clientes;
  assert.equal(clientes.length, 1);
  assert.equal(clientes[0].telefono, '5491155551234');
});

test('turnos del panel, estados, superposición y estadísticas', async () => {
  const { pro } = await preparar();
  const s = (await pro.post('/api/servicios', { nombre: 'Consulta', duracion: 60, precio: 15000 })).datos.servicio;
  const fecha = proximo(3);
  const t1 = await pro.post('/api/turnos', { servicio_id: s.id, fecha, inicio: 600, nombre: 'Laura', telefono: '11 4444-1111' });
  assert.equal(t1.estado, 201);
  assert.match(t1.datos.turno.whatsapp, /^https:\/\/wa\.me\/5491144441111\?text=/);
  assert.equal((await pro.post('/api/turnos', { servicio_id: s.id, fecha, inicio: 630, nombre: 'Otro', telefono: '11 4444-2222' })).estado, 409);
  assert.equal((await pro.post('/api/turnos', { servicio_id: s.id, fecha, inicio: 630, nombre: 'Otro', telefono: '11 4444-2222', forzar: true })).estado, 201);
  const agenda = await pro.get(`/api/agenda?desde=${fecha}&hasta=${A.sumarDias(fecha, 6)}`);
  assert.equal(agenda.datos.turnos.length, 2);
  assert.equal(agenda.datos.dias[0].franjas.length, 2);
  const id = t1.datos.turno.id;
  assert.equal((await pro.patch(`/api/turnos/${id}`, { estado: 'asistio', nota_interna: 'Vino puntual' })).datos.turno.estado, 'asistio');
  assert.equal((await pro.patch(`/api/turnos/${id}`, { fecha, inicio: 900 })).datos.turno.hora, '15:00');
  const csv = await pro.get('/api/exportar/turnos.csv');
  assert.match(csv.datos, /Fecha;Hora;Servicio/);
  assert.match(csv.datos, /Laura/);
});

test('horarios, excepciones y disponibilidad', async () => {
  const { pro, env, slug } = await preparar();
  const s = (await pro.post('/api/servicios', { nombre: 'Clase', duracion: 60 })).datos.servicio;
  assert.equal((await pro.put('/api/horarios', { horarios: [{ dia: 2, desde: 600, hasta: 540 }] })).estado, 422);
  await pro.put('/api/horarios', { horarios: [{ dia: 2, desde: 600, hasta: 720 }, { dia: 2, desde: 700, hasta: 780 }] });
  const h = (await pro.get('/api/horarios')).datos.horarios;
  assert.deepEqual(h, [{ dia: 2, desde: 600, hasta: 780 }]);
  const martes = proximo(2);
  const exc = await pro.post('/api/excepciones', { fecha: martes, tipo: 'cerrado', motivo: 'Congreso' });
  assert.equal(exc.estado, 201);
  const cliente = navegador(env);
  assert.deepEqual((await cliente.get(`/api/p/${slug}/horarios?servicio=${s.id}&fecha=${martes}`)).datos.horarios, []);
  assert.equal((await cliente.post(`/api/p/${slug}/reservas`, { servicio_id: s.id, fecha: martes, inicio: 600, nombre: 'Juan', telefono: '11 1234-5678' })).estado, 409);
  assert.equal((await cliente.post(`/api/p/${slug}/espera`, { servicio_id: s.id, fecha: martes, nombre: 'Juan', telefono: '11 1234-5678' })).estado, 201);
  const hoy = (await pro.get('/api/hoy')).datos;
  assert.equal(hoy.espera.length, 1);
  assert.equal(hoy.espera[0].libres, 0);
});

test('seña: pendiente, vencimiento automático y lista de espera', async () => {
  const { pro, env, slug } = await preparar();
  const negocio = (await pro.get('/api/negocio')).datos.negocio;
  await pro.put('/api/negocio', { ...negocio, sena_alias: 'kine.ana', sena_plazo_horas: 2 });
  const s = (await pro.post('/api/servicios', { nombre: 'Evaluación', duracion: 60, precio: 30000, sena: 10000 })).datos.servicio;
  const fecha = proximo(4);
  const cliente = navegador(env);
  const r = await cliente.post(`/api/p/${slug}/reservas`, { servicio_id: s.id, fecha, inicio: 540, nombre: 'Marta Ruiz', telefono: '11 2222-3333' });
  assert.equal(r.datos.estado, 'pendiente_sena');
  const t = (await cliente.get(`/api/t/${r.datos.token}`)).datos;
  assert.equal(t.negocio.sena_alias, 'kine.ana');
  assert.equal(t.turno.sena, 10000);
  assert.equal((await pro.get('/api/hoy')).datos.senas.length, 1);
  // Pasan 3 horas: la seña vence y el horario se libera.
  const resumen = await procesarPendientes(env, Date.now() + 3 * 3600000);
  assert.equal(resumen.vencidas, 1);
  assert.equal((await cliente.get(`/api/t/${r.datos.token}`)).datos.turno.estado, 'cancelado');
  const libres = (await cliente.get(`/api/p/${slug}/horarios?servicio=${s.id}&fecha=${fecha}`)).datos.horarios.map((x) => x.hora);
  assert.ok(libres.includes('09:00'));
});

test('demo con datos realistas y estadísticas', async () => {
  const env = await crearEntorno();
  const visitante = navegador(env);
  const r = await visitante.post('/api/demo', {});
  assert.equal(r.estado, 201);
  const yo = (await visitante.get('/api/yo')).datos;
  assert.equal(yo.usuario.demo, true);
  assert.equal(yo.negocio.nombre, 'Estudio Lumen');
  const e = (await visitante.get('/api/estadisticas?dias=60')).datos.actual;
  assert.ok(e.asistidos > 50, `pocos turnos: ${e.asistidos}`);
  assert.ok(e.ausentismo > 0.02 && e.ausentismo < 0.2, `ausentismo raro: ${e.ausentismo}`);
  assert.ok(e.ingresos > 1_000_000);
  assert.equal(e.porServicio[0].servicio, 'Corte');
  const hoy = (await visitante.get('/api/hoy')).datos;
  assert.ok(hoy.espera.length >= 3);
  // La demo no permite ingresar con contraseña y se borra a las 24 h.
  await procesarPendientes(env, Date.now() + 25 * 3600000);
  assert.equal((await visitante.get('/api/yo')).estado, 401);
});

test('páginas: rutas amigables y encabezados de seguridad', async () => {
  const env = await crearEntorno();
  const b = navegador(env);
  const portada = await b.get('/');
  assert.equal(portada.estado, 200);
  assert.match(portada.datos, /Tus clientes sacan turno solos/);
  assert.ok(portada.r.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
  // /mi-negocio y /t/token muestran la página de reservas; /panel y /ingresar, el panel.
  assert.match((await b.get('/estudio-lumen')).datos, /js\/reserva\.js/);
  assert.match((await b.get('/t/abc123')).datos, /js\/reserva\.js/);
  assert.match((await b.get('/panel/agenda')).datos, /js\/panel\/app\.js/);
  assert.match((await b.get('/ingresar')).datos, /js\/panel\/app\.js/);
  assert.equal((await b.get('/css/base.css')).r.headers.get('content-security-policy'), null);
  assert.equal((await b.get('/api/inexistente')).estado, 404);
});
