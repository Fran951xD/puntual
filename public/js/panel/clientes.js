// Clientes: buscador, ficha con historial y notas.
import { el, icono, api, avisar, poner, campo, fechaCorta, fechaLarga, capital, pesos, iniciales, plural, estado as chipEstado } from '../comun.js';
import { cajon, verTurno } from './turno.js';

export async function vistaClientes(raiz) {
  const buscador = el('input', { type: 'search', class: 'entrada', placeholder: 'Buscar por nombre, celular o email', 'aria-label': 'Buscar clientes' });
  const zona = el('section', { class: 'bloque', 'aria-live': 'polite' });
  let espera;
  buscador.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(cargar, 220); });

  poner(raiz,
    el('header', { class: 'cabecera' },
      el('div', {}, el('h1', {}, 'Clientes'), el('p', { class: 'cabecera__bajada' }, 'Se agregan solos cuando alguien reserva.')),
      el('div', { class: 'cabecera__acciones' },
        el('div', { class: 'buscador' }, icono('buscar', { tamano: 18 }), buscador),
        el('a', { class: 'boton boton--secundario', href: '/api/exportar/turnos.csv', download: '' }, icono('descargar', { tamano: 18 }), 'Exportar'))),
    zona);

  async function cargar() {
    const { clientes } = await api(`/api/clientes?q=${encodeURIComponent(buscador.value)}`);
    if (!clientes.length) {
      poner(zona, el('p', { class: 'bloque__vacio', style: { padding: '1.5rem 1.15rem' } }, buscador.value ? 'Ningún cliente coincide con la búsqueda.' : 'Todavía no hay clientes. Aparecen acá apenas alguien reserva.'));
      return;
    }
    poner(zona, el('table', { class: 'tabla' },
      el('caption', { class: 'solo-lectores' }, `${plural(clientes.length, 'cliente', 'clientes')}`),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Cliente'), el('th', { scope: 'col', class: 'num' }, 'Visitas'), el('th', { scope: 'col', class: 'ocultar-movil' }, 'Última visita'), el('th', { scope: 'col', class: 'ocultar-movil' }, 'Próximo turno'))),
      el('tbody', {}, clientes.map((c) => el('tr', { tabindex: '0', onclick: () => ficha(c.id, cargar), onkeydown: (e) => { if (e.key === 'Enter') ficha(c.id, cargar); } },
        el('td', {}, el('div', { class: 'persona' }, el('span', { class: 'persona__avatar', 'aria-hidden': 'true' }, iniciales(c.nombre)),
          el('div', {}, el('p', { class: 'persona__nombre' }, c.nombre), el('p', { class: 'persona__dato' }, `+${c.telefono}`, c.ausentes ? el('span', { class: 'etiqueta-ausente' }, `  ${plural(c.ausentes, 'ausencia', 'ausencias')}`) : null)))),
        el('td', { class: 'num' }, String(c.asistidos || 0)),
        el('td', { class: 'ocultar-movil' }, c.ultima_visita ? fechaCorta(c.ultima_visita) : '—'),
        el('td', { class: 'ocultar-movil' }, c.proximo ? fechaCorta(c.proximo) : '—'))))));
  }
  await cargar();
}

async function ficha(id, alCambiar) {
  const c = cajon('Cliente');
  const { cliente, turnos } = await api(`/api/clientes/${id}`);
  const asistidos = turnos.filter((t) => t.estado === 'asistio');
  const notas = el('textarea', { class: 'entrada', rows: 4, maxlength: 2000 }, cliente.notas || '');
  notas.addEventListener('change', async () => {
    await api(`/api/clientes/${id}`, { metodo: 'PATCH', cuerpo: { notas: notas.value } });
    avisar('Notas guardadas.');
  });
  poner(c.cuerpo,
    el('div', { class: 'persona' }, el('span', { class: 'persona__avatar', style: { width: '3rem', height: '3rem', 'font-size': '1rem' }, 'aria-hidden': 'true' }, iniciales(cliente.nombre)),
      el('div', {}, el('p', { style: { font: '600 1.25rem var(--titulos)' } }, cliente.nombre), el('p', { class: 'persona__dato' }, `+${cliente.telefono}`))),
    el('div', { class: 'grupo-acciones__fila' },
      el('a', { class: 'boton boton--whatsapp', href: cliente.whatsapp, target: '_blank', rel: 'noopener' }, icono('whatsapp', { tamano: 18 }), 'WhatsApp'),
      cliente.email ? el('a', { class: 'boton boton--secundario', href: `mailto:${cliente.email}` }, 'Email') : null),
    el('div', { class: 'cifras', style: { 'border-radius': 'var(--radio)', border: '1px solid var(--linea-suave)' } },
      el('div', { class: 'cifra' }, el('p', { class: 'cifra__valor' }, String(asistidos.length)), el('p', { class: 'cifra__etiqueta' }, 'visitas')),
      el('div', { class: 'cifra' }, el('p', { class: 'cifra__valor' }, pesos(asistidos.reduce((s, t) => s + t.precio, 0))), el('p', { class: 'cifra__etiqueta' }, 'en total')),
      el('div', { class: 'cifra' }, el('p', { class: 'cifra__valor' }, String(turnos.filter((t) => t.estado === 'ausente').length)), el('p', { class: 'cifra__etiqueta' }, 'ausencias')),
      el('div', { class: 'cifra' }, el('p', { class: 'cifra__valor' }, String(turnos.filter((t) => t.estado === 'cancelado').length)), el('p', { class: 'cifra__etiqueta' }, 'cancelaciones'))),
    campo({ etiqueta: 'Notas', ayuda: 'Preferencias, alergias, lo que te pidió la última vez. Solo las ves vos.', control: notas }),
    el('section', {}, el('h3', { style: { 'font-size': '1rem', 'margin-bottom': '0.5rem' } }, 'Historial'),
      turnos.length ? el('ul', { class: 'historial-cliente' }, turnos.map((t) => el('li', {},
        el('button', { type: 'button', class: 'boton-enlace', onclick: () => { c.cerrar(); verTurno(t.id, { alCambiar }); } }, `${capital(fechaLarga(t.fecha))}, ${t.hora}`, el('span', { class: 'persona__dato', style: { display: 'block' } }, t.servicio_nombre)),
        chipEstado(t.estado)))) : el('p', { class: 'persona__dato' }, 'Sin turnos.')));
}
