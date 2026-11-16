// Avisos: archivo de calendario (.ics), enlaces de Google Calendar y correos opcionales (Resend).
import { hora, fechaLarga, pesos, absoluto } from './agenda.js';
import { escaparHtml } from './util.js';

const ZONAS_OFFSET = { 'America/Argentina/Buenos_Aires': -180 };

/** Instante UTC de una fecha/hora local del negocio (Argentina no tiene horario de verano desde 2009). */
export function instanteUtc(fecha, minutos, zona = 'America/Argentina/Buenos_Aires') {
  const offset = ZONAS_OFFSET[zona] ?? offsetDeZona(zona, Date.parse(`${fecha}T12:00:00Z`));
  return new Date((absoluto(fecha, minutos) - offset) * 60000);
}

function offsetDeZona(zona, ms) {
  const d = new Date(ms);
  const enZona = new Date(d.toLocaleString('en-US', { timeZone: zona }));
  const enUtc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((enZona - enUtc) / 60000);
}

const formatoIcs = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const escaparIcs = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);

export function archivoIcs({ negocio, servicio, turno, urlGestion }) {
  const inicio = instanteUtc(turno.fecha, turno.inicio, negocio.zona);
  const fin = instanteUtc(turno.fecha, turno.fin, negocio.zona);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Puntual//Turnos//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${turno.token}@puntual`,
    `DTSTAMP:${formatoIcs(new Date())}`,
    `DTSTART:${formatoIcs(inicio)}`,
    `DTEND:${formatoIcs(fin)}`,
    `SUMMARY:${escaparIcs(`${servicio.nombre} · ${negocio.nombre}`)}`,
    negocio.direccion ? `LOCATION:${escaparIcs(negocio.direccion)}` : null,
    `DESCRIPTION:${escaparIcs(`Para cancelar o cambiar el turno: ${urlGestion}`)}`,
    `URL:${urlGestion}`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', `DESCRIPTION:${escaparIcs(`Turno en ${negocio.nombre}`)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

export function enlaceGoogleCalendar({ negocio, servicio, turno, urlGestion }) {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${servicio.nombre} · ${negocio.nombre}`,
    dates: `${formatoIcs(instanteUtc(turno.fecha, turno.inicio, negocio.zona))}/${formatoIcs(instanteUtc(turno.fecha, turno.fin, negocio.zona))}`,
    details: `Para cancelar o cambiar el turno: ${urlGestion}`,
    location: negocio.direccion || '',
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

// ---------------------------------------------------------------- Correo

/** Envía un correo con Resend si está configurado. Devuelve true si se envió. Nunca rompe el flujo. */
export async function enviarCorreo(env, { para, asunto, html, textoPlano, adjuntos }) {
  if (!env.RESEND_API_KEY || !para) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.CORREO_REMITENTE || 'Puntual <turnos@resend.dev>', to: [para], subject: asunto, html, text: textoPlano, attachments: adjuntos }),
    });
    if (!r.ok) console.error('Resend', r.status, await r.text());
    return r.ok;
  } catch (e) {
    console.error('Resend', e);
    return false;
  }
}

function plantilla({ titulo, cuerpo, boton, color = '#0b5d57' }) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4f5f2;font-family:Arial,Helvetica,sans-serif;color:#1d211f">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e3e5df" cellpadding="0" cellspacing="0">
  <tr><td style="padding:28px 28px 8px"><h1 style="margin:0;font-size:22px;line-height:1.3">${escaparHtml(titulo)}</h1></td></tr>
  <tr><td style="padding:8px 28px 8px;font-size:16px;line-height:1.55">${cuerpo}</td></tr>
  ${boton ? `<tr><td style="padding:16px 28px 28px"><a href="${escaparHtml(boton.url)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">${escaparHtml(boton.texto)}</a></td></tr>` : ''}
  </table><p style="color:#7b817c;font-size:12px;margin-top:16px">Enviado con Puntual</p></td></tr></table></body></html>`;
}

function detalle({ negocio, servicio, turno }) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:12px 0;font-size:16px">
    <tr><td style="color:#5f6661;padding:4px 16px 4px 0">Cuándo</td><td><strong>${escaparHtml(fechaLarga(turno.fecha))}, ${hora(turno.inicio)}</strong></td></tr>
    <tr><td style="color:#5f6661;padding:4px 16px 4px 0">Servicio</td><td>${escaparHtml(servicio.nombre)} (${servicio.duracion} min)</td></tr>
    ${negocio.direccion ? `<tr><td style="color:#5f6661;padding:4px 16px 4px 0">Dónde</td><td>${escaparHtml(negocio.direccion)}</td></tr>` : ''}
    ${turno.precio ? `<tr><td style="color:#5f6661;padding:4px 16px 4px 0">Precio</td><td>${pesos(turno.precio)}</td></tr>` : ''}
  </table>`;
}

export function correoConfirmacion(datos) {
  const { negocio, turno, cliente, urlGestion } = datos;
  const pendiente = turno.estado === 'pendiente_sena';
  return {
    para: cliente.email,
    asunto: pendiente ? `Reservaste un turno en ${negocio.nombre}: falta la seña` : `Turno confirmado en ${negocio.nombre}`,
    html: plantilla({
      titulo: pendiente ? 'Tu turno está reservado' : 'Tu turno está confirmado',
      cuerpo: `<p>Hola ${escaparHtml(cliente.nombre.split(' ')[0])},</p>${detalle(datos)}` +
        (pendiente ? `<p>Para confirmarlo, pagá la seña de <strong>${pesos(turno.sena)}</strong>${negocio.sena_alias ? ` al alias <strong>${escaparHtml(negocio.sena_alias)}</strong>` : ''} antes de ${negocio.sena_plazo_horas} horas. Si no, el turno se libera.</p>` : '') +
        `<p style="color:#5f6661">Podés cancelar o cambiar el turno hasta ${negocio.cancelacion_horas} horas antes.</p>`,
      boton: { texto: 'Ver o cambiar mi turno', url: urlGestion },
    }),
    textoPlano: `Turno en ${negocio.nombre}: ${fechaLarga(turno.fecha)} ${hora(turno.inicio)}. Ver o cambiar: ${urlGestion}`,
    adjuntos: [{ filename: 'turno.ics', content: btoa(unescape(encodeURIComponent(archivoIcs(datos)))) }],
  };
}

export function correoRecordatorio(datos) {
  const { negocio, turno, cliente, urlGestion } = datos;
  return {
    para: cliente.email,
    asunto: `Mañana: tu turno en ${negocio.nombre} a las ${hora(turno.inicio)}`,
    html: plantilla({
      titulo: 'Te esperamos mañana',
      cuerpo: `<p>Hola ${escaparHtml(cliente.nombre.split(' ')[0])}, te recordamos tu turno:</p>${detalle(datos)}<p style="color:#5f6661">Si no podés venir, avisá cancelándolo así otra persona puede usar el horario.</p>`,
      boton: { texto: 'Ver o cancelar mi turno', url: urlGestion },
    }),
    textoPlano: `Recordatorio: ${negocio.nombre}, ${fechaLarga(turno.fecha)} ${hora(turno.inicio)}. Ver o cancelar: ${urlGestion}`,
  };
}

export function correoCancelacion(datos) {
  const { negocio, cliente, urlReservar } = datos;
  return {
    para: cliente.email,
    asunto: `Turno cancelado en ${negocio.nombre}`,
    html: plantilla({
      titulo: 'Tu turno quedó cancelado',
      cuerpo: `<p>Hola ${escaparHtml(cliente.nombre.split(' ')[0])}, cancelamos este turno:</p>${detalle(datos)}`,
      boton: { texto: 'Reservar otro horario', url: urlReservar },
    }),
    textoPlano: `Se canceló tu turno en ${negocio.nombre}. Reservar otro: ${urlReservar}`,
  };
}

export function correoEspera({ negocio, espera, urlReservar }) {
  return {
    para: espera.email,
    asunto: `Se liberó un horario en ${negocio.nombre}`,
    html: plantilla({
      titulo: 'Se liberó un horario',
      cuerpo: `<p>Hola ${escaparHtml(espera.nombre.split(' ')[0])}, se liberó un lugar el <strong>${escaparHtml(fechaLarga(espera.fecha))}</strong>. Los lugares se reservan por orden de llegada.</p>`,
      boton: { texto: 'Ver horarios libres', url: urlReservar },
    }),
    textoPlano: `Se liberó un horario en ${negocio.nombre} el ${fechaLarga(espera.fecha)}: ${urlReservar}`,
  };
}

export function correoNuevoTurno({ negocio, servicio, turno, cliente, urlPanel }) {
  return {
    para: negocio.email_contacto,
    asunto: `Nuevo turno: ${cliente.nombre}, ${fechaLarga(turno.fecha)} ${hora(turno.inicio)}`,
    html: plantilla({
      titulo: 'Tenés un turno nuevo',
      cuerpo: `<p><strong>${escaparHtml(cliente.nombre)}</strong> (${escaparHtml(cliente.telefono)}) reservó:</p>${detalle({ negocio, servicio, turno })}${turno.nota_cliente ? `<p>Nota: ${escaparHtml(turno.nota_cliente)}</p>` : ''}`,
      boton: { texto: 'Abrir la agenda', url: urlPanel },
    }),
    textoPlano: `Nuevo turno de ${cliente.nombre} el ${fechaLarga(turno.fecha)} ${hora(turno.inicio)}.`,
  };
}
