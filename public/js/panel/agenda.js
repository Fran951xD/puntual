// Agenda: semana (o día, en el celular) con los turnos sobre la grilla horaria.
import { el, icono, api, poner, capital, sumarDias, diaSemana, DIAS_CORTOS, MESES, ESTADOS, hora, estado as chipEstado } from '../comun.js';
import { verTurno, nuevoTurno } from './turno.js';

const lunesDe = (f) => sumarDias(f, -((diaSemana(f) + 6) % 7));

export async function vistaAgenda(raiz, { params }) {
  const movil = matchMedia('(max-width: 56rem)').matches;
  let vista = params.get('vista') || (movil ? 'dia' : 'semana');
  let { servicios } = await api('/api/servicios');
  servicios = servicios.filter((s) => s.activo === 1);
  let hoy = null;
  let desde = params.get('desde');

  const titulo = el('p', { class: 'agenda-barra__titulo', 'aria-live': 'polite' });
  const grilla = el('div');
  const botonesVista = el('div', { class: 'selector-vista', role: 'group', 'aria-label': 'Vista' },
    ['dia', 'semana'].map((v) => el('button', { type: 'button', 'aria-pressed': String(v === vista), onclick: () => { vista = v; if (v === 'semana') desde = lunesDe(desde); cargar(); } }, v === 'dia' ? 'Día' : 'Semana')));

  poner(raiz,
    el('header', { class: 'cabecera' },
      el('div', {}, el('h1', {}, 'Agenda'), el('p', { class: 'cabecera__bajada' }, 'Tocá un horario libre para agendar un turno.')),
      el('div', { class: 'cabecera__acciones' },
        el('button', { type: 'button', class: 'boton boton--primario', onclick: () => nuevoTurno({ fecha: desde, servicios, alCrear: cargar }) }, icono('mas', { tamano: 18 }), 'Nuevo turno'))),
    el('div', { class: 'agenda-barra', style: { 'margin-bottom': '1rem' } },
      el('button', { type: 'button', class: 'boton boton--secundario boton--chico', onclick: () => { desde = vista === 'semana' ? lunesDe(hoy) : hoy; cargar(); } }, 'Hoy'),
      el('button', { type: 'button', class: 'boton-icono', 'aria-label': vista === 'semana' ? 'Semana anterior' : 'Día anterior', onclick: () => mover(-1) }, icono('atras')),
      el('button', { type: 'button', class: 'boton-icono', 'aria-label': 'Siguiente', onclick: () => mover(1) }, icono('adelante')),
      titulo,
      el('span', { style: { 'margin-left': 'auto' } }, botonesVista)),
    grilla,
    el('div', { class: 'leyenda-estados', 'aria-hidden': 'true' }, Object.entries(ESTADOS).map(([k]) => chipEstado(k))));

  function mover(n) { desde = sumarDias(desde, n * (vista === 'semana' ? 7 : 1)); cargar(); }

  async function cargar() {
    for (const b of botonesVista.children) b.setAttribute('aria-pressed', String((b.textContent === 'Día') === (vista === 'dia')));
    if (!desde) {
      const r = await api(`/api/agenda?desde=2000-01-01&hasta=2000-01-01`);
      hoy = r.ahora.fecha;
      desde = vista === 'semana' ? lunesDe(hoy) : hoy;
    }
    const cantidad = vista === 'semana' ? 7 : 1;
    const hasta = sumarDias(desde, cantidad - 1);
    history.replaceState(null, '', `/panel/agenda?vista=${vista}&desde=${desde}`);
    const d = await api(`/api/agenda?desde=${desde}&hasta=${hasta}`);
    hoy = d.ahora.fecha;
    titulo.textContent = capital(tituloRango(desde, hasta));
    dibujar(d, cantidad);
  }

  function dibujar(d, cantidad) {
    // Rango horario visible: el horario de atención de la semana, más los turnos que caigan afuera.
    const minutos = [...d.dias.flatMap((x) => x.franjas.flatMap((f) => [f.desde, f.hasta])), ...d.turnos.flatMap((t) => [t.inicio, t.fin])];
    const inicio = Math.max(0, Math.floor((minutos.length ? Math.min(...minutos) : 540) / 60) - (minutos.length ? 0 : 0));
    const fin = Math.min(24, Math.ceil((minutos.length ? Math.max(...minutos) : 1080) / 60));
    const horas = Array.from({ length: Math.max(fin - inicio, 1) }, (_, i) => inicio + i);
    const altoHora = 56;
    const aPx = (m) => ((m - inicio * 60) / 60) * altoHora;

    const columnas = d.dias.map((dia) => {
      const col = el('div', { class: 'semana__columna', style: { height: `${horas.length * altoHora}px` }, role: 'group', 'aria-label': etiquetaDia(dia.fecha) });
      // Fuera de horario: rayado.
      let cursor = inicio * 60;
      for (const f of [...dia.franjas, { desde: fin * 60, hasta: fin * 60 }]) {
        if (f.desde > cursor) col.append(el('div', { class: 'semana__cerrado', style: { top: `${aPx(cursor)}px`, height: `${aPx(f.desde) - aPx(cursor)}px` } }));
        cursor = Math.max(cursor, f.hasta);
      }
      const delDia = d.turnos.filter((t) => t.fecha === dia.fecha).sort((a, b) => (a.estado === 'cancelado') - (b.estado === 'cancelado'));
      for (const t of delDia) {
        const alto = Math.max(aPx(t.fin) - aPx(t.inicio) - 2, 22);
        col.append(el('button', {
          type: 'button', class: `bloque-turno bloque-turno--${t.estado}`, style: { top: `${aPx(t.inicio) + 1}px`, height: `${alto}px` },
          'aria-label': `${t.hora} a ${t.hora_fin}, ${t.cliente_nombre}, ${t.servicio_nombre}, ${ESTADOS[t.estado]}`,
          onclick: (e) => { e.stopPropagation(); verTurno(t.id, { alCambiar: cargar }); },
        }, el('strong', {}, `${t.hora} ${t.cliente_nombre}`), alto > 34 ? el('span', {}, t.servicio_nombre) : null));
      }
      if (dia.fecha === d.ahora.fecha && d.ahora.minutos >= inicio * 60 && d.ahora.minutos <= fin * 60) {
        col.append(el('div', { class: 'semana__ahora', style: { top: `${aPx(d.ahora.minutos)}px` }, 'aria-hidden': 'true' }));
      }
      col.addEventListener('click', (e) => {
        if (e.target !== col && !e.target.classList.contains('semana__cerrado')) return;
        const y = e.clientY - col.getBoundingClientRect().top;
        const m = inicio * 60 + Math.floor((y / altoHora) * 60 / 15) * 15;
        nuevoTurno({ fecha: dia.fecha, inicio: m, servicios, alCrear: cargar });
      });
      return col;
    });

    const tabla = el('div', { class: 'semana', style: { '--dias': String(cantidad) } },
      el('div', { class: 'semana__esquina' }),
      d.dias.map((dia) => el('div', { class: `semana__dia ${dia.fecha === d.ahora.fecha ? 'semana__dia--hoy' : ''}` },
        el('span', {}, DIAS_CORTOS[diaSemana(dia.fecha)]), el('strong', {}, String(Number(dia.fecha.slice(8)))),
        dia.excepciones.some((e) => e.tipo === 'cerrado' && e.desde == null) ? el('span', { class: 'estado estado--cancelado', style: { 'margin-top': '0.25rem' } }, dia.excepciones[0].motivo || 'Cerrado') : null)),
      el('div', { class: 'semana__horas' }, horas.map((h, i) => el('div', { class: 'semana__hora' }, i ? hora(h * 60) : ''))),
      columnas);
    if (cantidad === 1) tabla.style.gridTemplateColumns = '3.5rem minmax(0, 1fr)';
    poner(grilla, tabla);
    // Lleva la vista a la hora actual o al primer turno.
    const primero = d.turnos.find((t) => t.estado !== 'cancelado');
    const objetivo = d.dias.some((x) => x.fecha === d.ahora.fecha) ? d.ahora.minutos - 60 : primero?.inicio;
    if (objetivo != null) tabla.scrollTop = Math.max(0, aPx(objetivo));
  }

  await cargar();
}

function tituloRango(desde, hasta) {
  const [a1, m1, d1] = desde.split('-').map(Number);
  const [a2, m2, d2] = hasta.split('-').map(Number);
  if (desde === hasta) return `${DIAS_CORTOS[diaSemana(desde)]} ${d1} de ${MESES[m1 - 1]}`;
  if (m1 === m2) return `${d1} al ${d2} de ${MESES[m1 - 1]}`;
  return `${d1} de ${MESES[m1 - 1].slice(0, 3)} al ${d2} de ${MESES[m2 - 1].slice(0, 3)}${a1 !== a2 ? ` ${a2}` : ''}`;
}

function etiquetaDia(f) {
  const [, m, d] = f.split('-').map(Number);
  return `${DIAS_CORTOS[diaSemana(f)]} ${d} de ${MESES[m - 1]}`;
}
