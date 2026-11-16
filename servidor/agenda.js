// Lógica pura de agenda: fechas en la hora local del negocio, horarios libres, políticas y estadísticas.
// Sin base de datos ni red: se prueba entera con Node.
//
// Convenciones: una fecha es 'AAAA-MM-DD' en la zona del negocio; una hora son minutos desde las 00:00.

export const DIA_MS = 86400000;

// ---------------------------------------------------------------- Fechas

/** Fecha y minutos actuales en una zona horaria IANA (por defecto Argentina). */
export function ahoraEn(zona = 'America/Argentina/Buenos_Aires', ms = Date.now()) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { fecha: `${partes.year}-${partes.month}-${partes.day}`, minutos: Number(partes.hour) * 60 + Number(partes.minute) };
}

export function esFecha(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function sumarDias(fecha, dias) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado. */
export function diaSemana(fecha) {
  return new Date(`${fecha}T00:00:00Z`).getUTCDay();
}

export function diasEntre(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA_MS);
}

/** Minutos absolutos (desde 1970) de una fecha y hora locales: sirve para comparar sin zonas. */
export const absoluto = (fecha, minutos) => (Date.parse(`${fecha}T00:00:00Z`) / 60000) + minutos;

export function hora(minutos) {
  const m = ((Math.round(minutos) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function leerHora(s) {
  const m = String(s ?? '').trim().match(/^(\d{1,2})(?::|\.|h)?(\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2] || 0);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

export function diasDelMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  const total = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return Array.from({ length: total }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`);
}

// ---------------------------------------------------------------- Franjas de atención

/** Une y ordena rangos [{desde, hasta}] que se tocan o superponen. */
export function unirRangos(rangos) {
  const orden = rangos.filter((r) => r.hasta > r.desde).map((r) => ({ desde: r.desde, hasta: r.hasta })).sort((a, b) => a.desde - b.desde);
  const salida = [];
  for (const r of orden) {
    const ultimo = salida[salida.length - 1];
    if (ultimo && r.desde <= ultimo.hasta) ultimo.hasta = Math.max(ultimo.hasta, r.hasta);
    else salida.push(r);
  }
  return salida;
}

export function restarRango(rangos, quitar) {
  const salida = [];
  for (const r of rangos) {
    if (quitar.hasta <= r.desde || quitar.desde >= r.hasta) { salida.push(r); continue; }
    if (quitar.desde > r.desde) salida.push({ desde: r.desde, hasta: quitar.desde });
    if (quitar.hasta < r.hasta) salida.push({ desde: quitar.hasta, hasta: r.hasta });
  }
  return salida;
}

/**
 * Horario de atención de un día concreto.
 * horarios: [{ dia, desde, hasta }] semanales. excepciones: [{ fecha, tipo: 'cerrado'|'abierto', desde?, hasta? }]
 * Un 'cerrado' sin horas cierra el día entero; con horas, quita ese tramo. Un 'abierto' agrega un tramo extra.
 */
export function franjasDelDia(fecha, horarios, excepciones = []) {
  let franjas = unirRangos(horarios.filter((h) => Number(h.dia) === diaSemana(fecha)));
  const delDia = excepciones.filter((e) => e.fecha === fecha);
  for (const e of delDia.filter((x) => x.tipo === 'abierto' && x.desde != null)) franjas = unirRangos([...franjas, { desde: e.desde, hasta: e.hasta }]);
  for (const e of delDia.filter((x) => x.tipo === 'cerrado')) {
    franjas = e.desde == null || e.hasta == null ? [] : restarRango(franjas, { desde: e.desde, hasta: e.hasta });
  }
  return franjas;
}

// ---------------------------------------------------------------- Horarios libres

/**
 * Horarios de inicio libres para un servicio en un día.
 * ocupados: [{ inicio, fin, margen }] turnos activos de ese día (margen = descanso posterior).
 * politica: { anticipacionMinHoras, anticipacionMaxDias }, ahora: { fecha, minutos }.
 */
export function horariosLibres({ fecha, franjas, duracion, margen = 0, paso = 30, ocupados = [], ahora, politica = {} }) {
  if (!duracion || duracion <= 0) return [];
  const { anticipacionMinHoras = 0, anticipacionMaxDias = 60 } = politica;
  if (ahora) {
    const dias = diasEntre(ahora.fecha, fecha);
    if (dias < 0 || dias > anticipacionMaxDias) return [];
  }
  const minimo = ahora ? absoluto(ahora.fecha, ahora.minutos) + anticipacionMinHoras * 60 : -Infinity;
  const libres = [];
  for (const f of franjas) {
    // Los inicios se alinean al paso desde el comienzo de la franja (10:15, 10:45… si abre 10:15).
    for (let inicio = f.desde; inicio + duracion <= f.hasta; inicio += paso) {
      if (absoluto(fecha, inicio) < minimo) continue;
      if (ocupados.some((o) => seSuperponen(inicio, inicio + duracion + margen, o.inicio, o.fin + (o.margen || 0)))) continue;
      libres.push(inicio);
    }
  }
  return libres;
}

export const seSuperponen = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

/** Qué días de un mes tienen al menos un horario libre (para pintar el calendario). */
export function disponibilidadDelMes({ mes, horarios, excepciones, ocupadosPorFecha, duracion, margen, paso, ahora, politica }) {
  return diasDelMes(mes).map((fecha) => {
    const libres = horariosLibres({ fecha, franjas: franjasDelDia(fecha, horarios, excepciones), duracion, margen, paso, ocupados: ocupadosPorFecha[fecha] || [], ahora, politica });
    const atiende = franjasDelDia(fecha, horarios, excepciones).length > 0;
    return { fecha, libres: libres.length, estado: libres.length ? 'libre' : atiende && (!ahora || fecha >= ahora.fecha) ? 'completo' : 'cerrado' };
  });
}

// ---------------------------------------------------------------- Políticas

/** ¿Se puede cancelar o reprogramar todavía? */
export function puedeModificar(turno, ahora, horasLimite) {
  if (!['confirmado', 'pendiente_sena'].includes(turno.estado)) return false;
  return absoluto(turno.fecha, turno.inicio) - absoluto(ahora.fecha, ahora.minutos) >= horasLimite * 60;
}

/** ¿Ya empezó (o pasó) el turno? */
export function yaPaso(turno, ahora) {
  return absoluto(turno.fecha, turno.inicio) <= absoluto(ahora.fecha, ahora.minutos);
}

/** ¿Venció el plazo para pagar la seña? (horas desde que se reservó, o el día del turno). */
export function senaVencida(turno, ahoraMs, horasPlazo) {
  return turno.estado === 'pendiente_sena' && ahoraMs - turno.creado > horasPlazo * 3600000;
}

// ---------------------------------------------------------------- Textos y validación

const RESERVADOS = new Set(['api', 'panel', 'admin', 'r', 't', 'demo', 'ingresar', 'registro', 'salir', 'assets', 'css', 'js', 'img', 'fonts', 'static', 'favicon', 'robots', 'ayuda', 'precios']);

export function normalizarSlug(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

export function slugValido(s) {
  return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(s) && !RESERVADOS.has(s) && !s.includes('--');
}

/** Teléfono argentino en formato internacional para WhatsApp: "11 2345-6789" → "5491123456789". */
export function telefonoWhatsApp(tel) {
  let d = String(tel ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('54')) {
    d = d.slice(2);
    if (d.startsWith('9')) d = d.slice(1);
  }
  if (d.startsWith('0')) d = d.slice(1);
  // Saca el "15" de los celulares escritos a la antigua (11 15 2345-6789 → 11 2345-6789).
  const conQuince = d.match(/^(\d{2,4})15(\d{6,8})$/);
  if (conQuince && conQuince[1].length + conQuince[2].length === 10) d = conQuince[1] + conQuince[2];
  if (d.length !== 10) return String(tel).replace(/\D/g, '').length >= 11 ? String(tel).replace(/\D/g, '') : '';
  return `549${d}`;
}

export function enlaceWhatsApp(tel, texto) {
  const numero = telefonoWhatsApp(tel);
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function fechaLarga(fecha) {
  const [, m, d] = fecha.split('-').map(Number);
  return `${DIAS[diaSemana(fecha)]} ${d} de ${MESES[m - 1]}`;
}

export function pesos(n) {
  return `$${Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

export function textoRecordatorio({ negocio, servicio, turno, cliente, enlace }) {
  return `Hola ${cliente.nombre.split(' ')[0]}! Te recordamos tu turno de ${servicio.nombre} en ${negocio.nombre} el ${fechaLarga(turno.fecha)} a las ${hora(turno.inicio)}.` +
    `${negocio.direccion ? ` Dirección: ${negocio.direccion}.` : ''} Si no podés venir, avisanos acá: ${enlace}`;
}

// ---------------------------------------------------------------- Estadísticas

/**
 * turnos: [{ fecha, inicio, estado, precio, servicio_id, cliente_id }] del período.
 * Devuelve tasas, ingresos, ranking de servicios, mapa de calor día×hora y evolución semanal.
 */
export function estadisticas(turnos, { desde, hasta, servicios = [] }) {
  const pasados = turnos.filter((t) => t.estado === 'asistio' || t.estado === 'ausente');
  const asistidos = turnos.filter((t) => t.estado === 'asistio');
  const ausentes = turnos.filter((t) => t.estado === 'ausente');
  const cancelados = turnos.filter((t) => t.estado === 'cancelado');
  const nombre = Object.fromEntries(servicios.map((s) => [s.id, s.nombre]));

  const porServicio = {};
  for (const t of turnos.filter((x) => x.estado !== 'cancelado')) {
    const k = t.servicio_id;
    porServicio[k] ??= { servicio: nombre[k] || 'Servicio borrado', turnos: 0, ingresos: 0 };
    porServicio[k].turnos++;
    if (t.estado === 'asistio') porServicio[k].ingresos += Number(t.precio) || 0;
  }

  const calor = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const t of turnos.filter((x) => x.estado !== 'cancelado')) calor[diaSemana(t.fecha)][Math.floor(t.inicio / 60)]++;

  const semanas = [];
  for (let inicio = inicioDeSemana(desde); inicio <= hasta; inicio = sumarDias(inicio, 7)) {
    const fin = sumarDias(inicio, 6);
    const enSemana = turnos.filter((t) => t.fecha >= inicio && t.fecha <= fin);
    semanas.push({
      semana: inicio,
      asistidos: enSemana.filter((t) => t.estado === 'asistio').length,
      ausentes: enSemana.filter((t) => t.estado === 'ausente').length,
      cancelados: enSemana.filter((t) => t.estado === 'cancelado').length,
      ingresos: enSemana.filter((t) => t.estado === 'asistio').reduce((s, t) => s + (Number(t.precio) || 0), 0),
    });
  }

  const clientesUnicos = new Set(asistidos.map((t) => t.cliente_id));
  const visitas = {};
  for (const t of asistidos) visitas[t.cliente_id] = (visitas[t.cliente_id] || 0) + 1;
  const recurrentes = Object.values(visitas).filter((n) => n > 1).length;

  return {
    total: turnos.length,
    asistidos: asistidos.length,
    ausentes: ausentes.length,
    cancelados: cancelados.length,
    ausentismo: pasados.length ? ausentes.length / pasados.length : 0,
    cancelacion: turnos.length ? cancelados.length / turnos.length : 0,
    ingresos: asistidos.reduce((s, t) => s + (Number(t.precio) || 0), 0),
    ticketPromedio: asistidos.length ? asistidos.reduce((s, t) => s + (Number(t.precio) || 0), 0) / asistidos.length : 0,
    clientes: clientesUnicos.size,
    recurrencia: clientesUnicos.size ? recurrentes / clientesUnicos.size : 0,
    porServicio: Object.values(porServicio).sort((a, b) => b.turnos - a.turnos),
    calor,
    semanas,
  };
}

export function inicioDeSemana(fecha) {
  const d = diaSemana(fecha);
  return sumarDias(fecha, d === 0 ? -6 : 1 - d); // semanas de lunes a domingo
}
