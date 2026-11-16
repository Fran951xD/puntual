// Detalle de un turno (cajón lateral) y alta manual de turnos. Lo usan Hoy, Agenda y Clientes.
import { el, icono, api, avisar, poner, dialogo, confirmar, campo, entrada, valores, mostrarErrorEn, copiar, estado as chipEstado,
  fechaLarga, capital, hora, pesos, duracion, sumarDias } from '../comun.js';

/** Abre un <dialog> como cajón lateral. Devuelve { caja, cuerpo, cerrar, cerrado }. */
export function cajon(titulo) {
  const cuerpo = el('div', { class: 'cajon__cuerpo' });
  const caja = el('dialog', { class: 'cajon', 'aria-label': titulo },
    el('div', { class: 'cajon__cabecera' }, el('h2', {}, titulo), el('button', { type: 'button', class: 'boton-icono', 'aria-label': 'Cerrar', onclick: () => cerrar() }, icono('cerrar'))),
    cuerpo);
  const anterior = document.activeElement;
  let resolver;
  const cerrado = new Promise((r) => { resolver = r; });
  const cerrar = (valor) => { if (!caja.open) return; caja.close(); caja.remove(); anterior?.focus?.(); resolver(valor); };
  caja.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(); });
  caja.addEventListener('click', (e) => { if (e.target === caja) cerrar(); });
  document.body.append(caja);
  caja.showModal();
  return { caja, cuerpo, cerrar, cerrado };
}

/** Muestra un turno con todas sus acciones. alCambiar() se llama si algo cambió. */
export async function verTurno(id, { alCambiar } = {}) {
  const c = cajon('Turno');
  poner(c.cuerpo, el('div', { class: 'esqueleto', style: { height: '16rem' } }));
  let cambio = false;
  const dibujar = async () => {
    const { turno: t, historial: h } = await api(`/api/turnos/${id}`);
    const activo = ['confirmado', 'pendiente_sena'].includes(t.estado);
    const accion = async (cuerpo, mensaje) => {
      try {
        await api(`/api/turnos/${t.id}`, { metodo: 'PATCH', cuerpo });
        cambio = true;
        avisar(mensaje);
        await dibujar();
      } catch (e) { avisar(e.message, { tipo: 'error' }); }
    };
    const nota = el('textarea', { class: 'entrada', rows: 3, maxlength: 500, 'aria-label': 'Nota interna' }, t.nota_interna || '');
    nota.addEventListener('change', () => accion({ nota_interna: nota.value }, 'Nota guardada.'));
    poner(c.cuerpo,
      el('div', {},
        el('p', {}, capital(fechaLarga(t.fecha))),
        el('p', { class: 'cajon__hora' }, t.hora),
        el('p', {}, `${t.servicio_nombre || 'Servicio'}, hasta las ${t.hora_fin}`),
        el('div', { style: { 'margin-top': '0.6rem' } }, chipEstado(t.estado))),
      el('dl', { class: 'ficha' },
        el('div', {}, el('dt', {}, 'Cliente'), el('dd', {}, t.cliente_nombre)),
        el('div', {}, el('dt', {}, 'Celular'), el('dd', {}, t.cliente_telefono ? `+${t.cliente_telefono}` : '—')),
        t.cliente_email ? el('div', {}, el('dt', {}, 'Email'), el('dd', {}, t.cliente_email)) : null,
        el('div', {}, el('dt', {}, 'Historial'), el('dd', {}, h.total ? `${h.asistidos || 0} visitas${h.ausentes ? `, faltó ${h.ausentes} ${h.ausentes === 1 ? 'vez' : 'veces'}` : ''}` : 'Primera vez')),
        t.precio ? el('div', {}, el('dt', {}, 'Precio'), el('dd', {}, pesos(t.precio), t.sena ? ` (seña ${pesos(t.sena)})` : '')) : null,
        el('div', {}, el('dt', {}, 'Reservado'), el('dd', {}, t.origen === 'web' ? 'Online por el cliente' : 'Desde el panel')),
        t.nota_cliente ? el('div', {}, el('dt', {}, 'Nota del cliente'), el('dd', {}, t.nota_cliente)) : null),
      el('div', { class: 'grupo-acciones' },
        t.whatsapp ? el('a', { class: 'boton boton--whatsapp', href: t.whatsapp, target: '_blank', rel: 'noopener', onclick: () => api(`/api/turnos/${t.id}/recordado`, { metodo: 'POST', cuerpo: {} }).catch(() => {}) }, icono('whatsapp'), 'Mandar recordatorio por WhatsApp') : null,
        t.estado === 'pendiente_sena' ? el('button', { type: 'button', class: 'boton boton--primario', onclick: () => accion({ estado: 'confirmado' }, 'Seña registrada: turno confirmado.') }, icono('plata'), 'Recibí la seña') : null,
        el('div', { class: 'grupo-acciones__fila' },
          t.estado !== 'asistio' && t.estado !== 'cancelado' ? el('button', { type: 'button', class: 'boton boton--secundario', onclick: () => accion({ estado: 'asistio' }, 'Marcado como asistió.') }, icono('ok', { tamano: 18 }), 'Asistió') : null,
          t.estado !== 'ausente' && t.estado !== 'cancelado' ? el('button', { type: 'button', class: 'boton boton--secundario', onclick: () => accion({ estado: 'ausente' }, 'Marcado como ausente.') }, 'No vino') : null,
          ['asistio', 'ausente', 'cancelado'].includes(t.estado) ? el('button', { type: 'button', class: 'boton boton--texto', onclick: () => accion({ estado: 'confirmado' }, 'Volvió a confirmado.') }, 'Deshacer') : null),
        activo ? el('div', { class: 'grupo-acciones__fila' },
          el('button', { type: 'button', class: 'boton boton--secundario', onclick: async () => { if (await moverTurno(t)) { cambio = true; await dibujar(); } } }, icono('reloj', { tamano: 18 }), 'Cambiar horario'),
          el('button', { type: 'button', class: 'boton boton--peligro', onclick: async () => {
            if (!await confirmar('¿Cancelar este turno?', `${t.cliente_nombre}, ${fechaLarga(t.fecha)} a las ${t.hora}. ${t.cliente_email ? 'Le avisamos por mail.' : 'Avisale por WhatsApp.'} Si hay gente en lista de espera, se le avisa.`, { texto: 'Cancelar turno', peligro: true })) return;
            await accion({ estado: 'cancelado' }, 'Turno cancelado.');
          } }, 'Cancelar')) : null,
        el('button', { type: 'button', class: 'boton boton--texto', onclick: () => copiar(t.url_gestion, 'Link del turno copiado.') }, icono('enlace', { tamano: 18 }), 'Copiar link para el cliente')),
      campo({ etiqueta: 'Nota interna', ayuda: 'Solo la ves vos. Se guarda sola.', control: nota }));
  };
  try { await dibujar(); } catch (e) { poner(c.cuerpo, el('p', { class: 'caja-error' }, e.message)); }
  await c.cerrado;
  if (cambio) alCambiar?.();
}

/** Diálogo para mover un turno a otro día y hora (muestra solo horarios libres). */
async function moverTurno(t) {
  const fecha = entrada({ type: 'date', name: 'fecha', value: t.fecha, required: true });
  const horas = el('select', { class: 'entrada', name: 'inicio', required: true });
  const forzar = el('input', { type: 'checkbox', name: 'forzar' });
  const cargar = async () => {
    poner(horas, el('option', { value: '' }, 'Cargando…'));
    const { horarios } = await api(`/api/disponibles?servicio=${t.servicio_id}&fecha=${fecha.value}&ignorar=${t.id}`);
    poner(horas, horarios.length ? horarios.map((h) => el('option', { value: h.inicio, selected: h.inicio === t.inicio }, h.hora)) : el('option', { value: '' }, 'Sin horarios libres ese día'));
  };
  fecha.addEventListener('change', cargar);
  await cargar();
  const contenido = el('div', { class: 'formulario' },
    el('div', { class: 'formulario__fila' }, campo({ etiqueta: 'Día', control: fecha }), campo({ etiqueta: 'Hora', control: horas })));
  return dialogo({
    titulo: 'Cambiar horario',
    descripcion: `${t.cliente_nombre}: ${t.servicio_nombre}.`,
    contenido,
    botones: [{ texto: 'Volver', valor: false }, {
      texto: 'Guardar cambio', valor: true, tipo: 'primario', enviar: true,
      alHacer: async (caja) => {
        if (!horas.value) { avisar('Elegí un horario libre.', { tipo: 'error' }); return false; }
        await api(`/api/turnos/${t.id}`, { metodo: 'PATCH', cuerpo: { fecha: fecha.value, inicio: Number(horas.value), forzar: forzar.checked } });
        avisar('Turno movido.');
        return true;
      },
    }],
  });
}

/** Alta manual de un turno (por teléfono, en persona…). */
export async function nuevoTurno({ fecha, inicio, servicios, alCrear }) {
  if (!servicios.length) { avisar('Primero cargá al menos un servicio.', { tipo: 'error' }); return; }
  const servicio = el('select', { class: 'entrada', name: 'servicio_id', required: true }, servicios.map((s) => el('option', { value: s.id }, `${s.nombre} (${duracion(s.duracion)})`)));
  const dia = entrada({ type: 'date', name: 'fecha', value: fecha, required: true });
  const horas = el('select', { class: 'entrada', name: 'inicio', required: true });
  const libre = el('input', { type: 'checkbox', name: 'forzar' });
  const cargar = async () => {
    const { horarios } = await api(`/api/disponibles?servicio=${servicio.value}&fecha=${dia.value}`);
    const opciones = horarios.map((h) => ({ valor: h.inicio, texto: h.hora }));
    if (libre.checked) {
      opciones.length = 0;
      for (let m = 6 * 60; m < 23 * 60; m += 15) opciones.push({ valor: m, texto: hora(m) });
    }
    poner(horas, opciones.length ? opciones.map((o) => el('option', { value: o.valor, selected: o.valor === inicio }, o.texto)) : el('option', { value: '' }, 'Sin horarios libres ese día'));
  };
  servicio.addEventListener('change', cargar);
  dia.addEventListener('change', cargar);
  libre.addEventListener('change', cargar);
  await cargar();
  // Si no se eligió una hora concreta y ese día no tiene lugar, saltamos al próximo día con horarios libres.
  if (inicio == null && !horas.value) {
    for (let i = 1; i <= 21 && !horas.value; i++) { dia.value = sumarDias(fecha, i); await cargar(); }
    if (!horas.value) { dia.value = fecha; await cargar(); }
  }
  const contenido = el('div', { class: 'formulario' },
    campo({ etiqueta: 'Servicio', control: servicio }),
    el('div', { class: 'formulario__fila' }, campo({ etiqueta: 'Día', control: dia }), campo({ etiqueta: 'Hora', control: horas })),
    el('label', { class: 'casilla' }, libre, el('span', {}, 'Permitir cualquier hora (fuera de horario o superpuesto)')),
    campo({ etiqueta: 'Nombre del cliente', control: entrada({ name: 'nombre', required: true, maxlength: 80, autocomplete: 'off' }) }),
    el('div', { class: 'formulario__fila' },
      campo({ etiqueta: 'Celular', control: entrada({ name: 'telefono', type: 'tel', required: true, placeholder: '11 2345-6789', autocomplete: 'off' }) }),
      campo({ etiqueta: 'Email', opcional: true, control: entrada({ name: 'email', type: 'email', autocomplete: 'off' }) })),
    campo({ etiqueta: 'Nota interna', opcional: true, control: el('textarea', { class: 'entrada', name: 'nota_interna', rows: 2, maxlength: 500 }) }));
  const ok = await dialogo({
    titulo: 'Nuevo turno',
    contenido,
    clase: 'dialogo--ancho',
    botones: [{ texto: 'Cancelar', valor: false }, {
      texto: 'Agendar turno', valor: true, tipo: 'primario', enviar: true,
      alHacer: async (caja) => {
        const v = valores(contenido);
        if (!v.inicio) { avisar('Elegí la hora.', { tipo: 'error' }); return false; }
        await api('/api/turnos', { metodo: 'POST', cuerpo: { ...v, servicio_id: Number(v.servicio_id), inicio: Number(v.inicio) } });
        return true;
      },
    }],
  });
  if (ok) { avisar('Turno agendado.'); alCrear?.(); }
}

export { sumarDias };
