// Hoy: el próximo turno, la lista del día y lo que hay que hacer (recordatorios, señas, lista de espera).
import { el, icono, api, avisar, poner, copiar, capital, fechaLarga, relativo, hora, pesos, plural, estado as chipEstado } from '../comun.js';
import { sesion, enlace, urlPublica, marcarAviso } from './app.js';
import { verTurno, nuevoTurno } from './turno.js';

export async function vistaHoy(raiz) {
  const [d, { servicios }] = await Promise.all([api('/api/hoy'), api('/api/servicios')]);
  const ahora = d.ahora;
  const recargar = () => vistaHoy(raiz);
  const activos = d.hoy.filter((t) => t.estado !== 'cancelado');
  const siguiente = activos.find((t) => t.fin > ahora.minutos && ['confirmado', 'pendiente_sena'].includes(t.estado));
  const enCurso = siguiente && siguiente.inicio <= ahora.minutos;
  const pendientes = d.recordar.length + d.senas.length + d.espera.filter((e) => e.libres > 0).length;
  marcarAviso('', pendientes);

  const saludo = ahora.minutos < 720 ? 'Buen día' : ahora.minutos < 1200 ? 'Buenas tardes' : 'Buenas noches';
  const marcar = async (t, nuevo) => {
    try {
      await api(`/api/turnos/${t.id}`, { metodo: 'PATCH', cuerpo: { estado: nuevo } });
      avisar(nuevo === 'asistio' ? `${t.cliente_nombre.split(' ')[0]}: asistió.` : `${t.cliente_nombre.split(' ')[0]}: no vino.`, {
        accion: { texto: 'Deshacer', alHacer: () => api(`/api/turnos/${t.id}`, { metodo: 'PATCH', cuerpo: { estado: t.estado } }).then(recargar) },
      });
      recargar();
    } catch (e) { avisar(e.message, { tipo: 'error' }); }
  };

  // ------------------------------------------------ Próximo turno
  const tarjeta = siguiente
    ? el('section', { class: 'siguiente', 'aria-label': enCurso ? 'Turno en curso' : 'Próximo turno' },
      el('p', { class: 'siguiente__etiqueta' }, enCurso ? 'Ahora' : `Próximo, en ${faltan(siguiente.inicio - ahora.minutos)}`),
      el('p', { class: 'siguiente__hora' }, siguiente.hora),
      el('div', {}, el('p', { class: 'siguiente__quien' }, siguiente.cliente_nombre), el('p', { class: 'siguiente__que' }, `${siguiente.servicio_nombre}, hasta las ${siguiente.hora_fin}`)),
      el('div', { class: 'siguiente__acciones' },
        el('button', { type: 'button', class: 'boton boton--secundario', onclick: () => verTurno(siguiente.id, { alCambiar: recargar }) }, 'Ver detalle'),
        siguiente.whatsapp ? el('a', { class: 'boton boton--secundario', href: siguiente.whatsapp, target: '_blank', rel: 'noopener' }, icono('whatsapp', { tamano: 18 }), 'WhatsApp') : null))
    : el('section', { class: 'siguiente siguiente--libre' },
      el('p', { class: 'siguiente__etiqueta' }, activos.length ? 'Terminaste por hoy' : 'Hoy no tenés turnos'),
      el('div', { style: { 'grid-column': '1 / -1' } }, el('p', { class: 'siguiente__quien' }, d.proximos ? `Tenés ${plural(d.proximos, 'turno', 'turnos')} en los próximos 7 días.` : 'Compartí tu link para empezar a recibir reservas.')),
      el('div', { class: 'siguiente__acciones' },
        el('button', { type: 'button', class: 'boton boton--primario', onclick: () => copiar(urlPublica(), 'Link copiado. Pegalo en tu Instagram o WhatsApp.') }, icono('copiar', { tamano: 18 }), 'Copiar mi link'),
        enlace('/panel/agenda', 'Ver la agenda')));
  tarjeta.querySelector('a[data-nav]')?.classList.add('boton', 'boton--secundario');

  // ------------------------------------------------ Lista del día
  const lista = el('section', { class: 'bloque', 'aria-labelledby': 'titulo-dia' },
    el('div', { class: 'bloque__cabecera' },
      el('div', {}, el('h2', { id: 'titulo-dia' }, 'Turnos de hoy'), el('p', {}, activos.length ? plural(activos.length, 'turno', 'turnos') : 'Ninguno por ahora')),
      el('button', { type: 'button', class: 'boton boton--secundario boton--chico', onclick: () => nuevoTurno({ fecha: ahora.fecha, servicios: servicios.filter((s) => s.activo === 1), alCrear: recargar }) }, icono('mas', { tamano: 16 }), 'Agendar')),
    d.hoy.length ? el('ul', { class: 'dia-lista' }, d.hoy.map((t) => {
      const pasado = t.fin <= ahora.minutos;
      const ahoraMismo = t.inicio <= ahora.minutos && t.fin > ahora.minutos && t.estado !== 'cancelado';
      const sinMarcar = pasado && ['confirmado', 'pendiente_sena'].includes(t.estado);
      return el('li', {
        class: `turno-fila ${pasado ? 'turno-fila--pasado' : ''} ${ahoraMismo ? 'turno-fila--ahora' : ''} ${t.estado === 'cancelado' ? 'turno-fila--cancelado' : ''}`,
        onclick: (e) => { if (!e.target.closest('button, a')) verTurno(t.id, { alCambiar: recargar }); },
      },
      el('div', { class: 'turno-fila__hora' }, t.hora, el('small', {}, t.hora_fin)),
      el('div', { style: { 'min-width': '0' } },
        el('button', { type: 'button', class: 'turno-fila__nombre boton-enlace', onclick: () => verTurno(t.id, { alCambiar: recargar }) }, t.cliente_nombre),
        el('p', { class: 'turno-fila__detalle' }, t.servicio_nombre, t.nota_cliente ? ` · “${t.nota_cliente}”` : '')),
      el('div', { class: 'turno-fila__acciones' },
        sinMarcar || ahoraMismo
          ? el('div', { class: 'marcar', role: 'group', 'aria-label': `¿Vino ${t.cliente_nombre}?` },
            el('button', { type: 'button', class: 'si', onclick: () => marcar(t, 'asistio') }, 'Vino'),
            el('button', { type: 'button', class: 'no', onclick: () => marcar(t, 'ausente') }, 'No vino'))
          : chipEstado(t.estado)));
    })) : el('p', { class: 'bloque__vacio' }, 'Cuando alguien reserve para hoy, lo vas a ver acá.'));

  // ------------------------------------------------ Para hacer
  const recordatorios = el('section', { class: 'bloque', 'aria-labelledby': 'titulo-recordar' },
    el('div', { class: 'bloque__cabecera' }, el('div', {}, el('h2', { id: 'titulo-recordar' }, 'Recordatorios para mañana'), el('p', {}, d.recordar.length ? 'Un mensaje reduce mucho las ausencias.' : 'Todo recordado.'))),
    d.recordar.length ? el('ul', { class: 'pendientes' }, d.recordar.map((t) => el('li', { class: 'pendiente' },
      el('p', { class: 'pendiente__titulo' }, `${t.hora}  ${t.cliente_nombre}`),
      el('p', { class: 'pendiente__detalle' }, t.servicio_nombre),
      el('a', { class: 'boton boton--whatsapp boton--chico', href: t.whatsapp, target: '_blank', rel: 'noopener', onclick: (e) => {
        api(`/api/turnos/${t.id}/recordado`, { metodo: 'POST', cuerpo: {} }).then(() => setTimeout(recargar, 1500)).catch(() => {});
        e.currentTarget.textContent = 'Enviado';
      } }, icono('whatsapp', { tamano: 16 }), 'Recordar')))) : null);

  const senas = d.senas.length ? el('section', { class: 'bloque', 'aria-labelledby': 'titulo-senas' },
    el('div', { class: 'bloque__cabecera' }, el('div', {}, el('h2', { id: 'titulo-senas' }, 'Señas por confirmar'), el('p', {}, 'Si no se pagan a tiempo, el turno se libera solo.'))),
    el('ul', { class: 'pendientes' }, d.senas.map((t) => el('li', { class: 'pendiente' },
      el('p', { class: 'pendiente__titulo' }, `${t.cliente_nombre}, ${pesos(t.sena)}`),
      el('p', { class: 'pendiente__detalle' }, `${capital(relativo(t.fecha, ahora.fecha))} ${t.hora}, ${t.servicio_nombre}`),
      el('button', { type: 'button', class: 'boton boton--secundario boton--chico', onclick: async () => {
        await api(`/api/turnos/${t.id}`, { metodo: 'PATCH', cuerpo: { estado: 'confirmado' } });
        avisar(`Seña de ${t.cliente_nombre.split(' ')[0]} registrada.`);
        recargar();
      } }, 'Recibí la seña'))))) : null;

  const espera = d.espera.length ? el('section', { class: 'bloque', 'aria-labelledby': 'titulo-espera' },
    el('div', { class: 'bloque__cabecera' }, el('div', {}, el('h2', { id: 'titulo-espera' }, 'Lista de espera'), el('p', {}, 'Personas que quieren un turno en días completos.'))),
    el('ul', { class: 'pendientes' }, d.espera.map((e) => el('li', { class: 'pendiente' },
      el('p', { class: 'pendiente__titulo' }, e.nombre),
      el('p', { class: 'pendiente__detalle' }, `${capital(relativo(e.fecha, ahora.fecha))}, ${e.servicio_nombre || 'cualquier servicio'}. `, e.libres ? el('strong', { style: { color: 'var(--ok)' } }, `Hay ${plural(e.libres, 'lugar libre', 'lugares libres')}`) : 'Sin lugar todavía'),
      el('div', { class: 'grupo-acciones__fila' },
        e.libres ? el('a', { class: 'boton boton--whatsapp boton--chico', href: e.whatsapp, target: '_blank', rel: 'noopener' }, icono('whatsapp', { tamano: 16 }), 'Avisar') : null,
        el('button', { type: 'button', class: 'boton-icono', 'aria-label': `Quitar a ${e.nombre} de la lista`, onclick: async () => { await api(`/api/espera/${e.id}`, { metodo: 'DELETE' }); recargar(); } }, icono('cerrar', { tamano: 18 }))))))) : null;

  const semana = el('section', { class: 'bloque', 'aria-labelledby': 'titulo-semana' },
    el('div', { class: 'bloque__cabecera' }, el('h2', { id: 'titulo-semana' }, 'Esta semana'), enlace('/panel/estadisticas', 'Ver más')),
    el('div', { class: 'cifras' },
      cifra(String(d.semana.turnos), 'turnos'),
      cifra(pesos(d.semana.ingresos), 'cobrado'),
      cifra(pesos(d.semana.previstos), 'previsto'),
      cifra(String(d.semana.ausentes), d.semana.ausentes === 1 ? 'ausencia' : 'ausencias')));

  const configuracion = (!sesion.listo.servicios || !d.proximos) && !sesion.usuario.demo ? primerosPasos() : null;

  poner(raiz,
    el('header', { class: 'cabecera' },
      el('div', {}, el('h1', {}, `${saludo}, ${sesion.usuario.nombre.split(' ')[0]}`), el('p', { class: 'cabecera__bajada' }, capital(fechaLarga(ahora.fecha)))),
      el('div', { class: 'cabecera__acciones' }, el('a', { class: 'boton boton--secundario', href: `/${sesion.negocio.slug}`, target: '_blank', rel: 'noopener' }, 'Ver mi página'))),
    el('div', { class: 'hoy' },
      el('div', { class: 'hoy__columna' }, configuracion, tarjeta, lista),
      el('div', { class: 'hoy__columna' }, recordatorios, senas, espera, semana)));

  // Se actualiza solo cada minuto (la hora actual y lo que entra por la web).
  const reloj = setInterval(() => { if (!document.querySelector('dialog[open]')) vistaHoy(raiz); }, 60000);
  return () => clearInterval(reloj);
}

function cifra(valor, etiqueta) {
  return el('div', { class: 'cifra' }, el('p', { class: 'cifra__valor' }, valor), el('p', { class: 'cifra__etiqueta' }, etiqueta));
}

function faltan(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

function primerosPasos() {
  const pasos = [
    { hecho: sesion.listo.servicios, titulo: 'Cargá tus servicios', texto: 'Nombre, duración y precio de lo que ofrecés.', href: '/panel/servicios', boton: 'Cargar' },
    { hecho: false, titulo: 'Revisá tus horarios', texto: 'Arrancamos con lunes a viernes de 9 a 13 y de 14 a 18.', href: '/panel/horarios', boton: 'Revisar' },
    { hecho: false, titulo: 'Compartí tu link', texto: `${location.host}/${sesion.negocio.slug}: en tu Instagram, WhatsApp o Google.`, copiar: true, boton: 'Copiar' },
  ];
  return el('section', { class: 'bloque', 'aria-labelledby': 'titulo-pasos' },
    el('div', { class: 'bloque__cabecera' }, el('div', {}, el('h2', { id: 'titulo-pasos' }, 'Dejá lista tu agenda'), el('p', {}, 'Tres pasos y tus clientes ya pueden reservar.'))),
    el('ol', { class: 'primeros-pasos' }, pasos.map((p) => el('li', { class: p.hecho ? 'hecho' : '' },
      el('div', {}, el('strong', {}, p.titulo), el('p', {}, p.texto)),
      p.copiar ? el('button', { type: 'button', class: 'boton boton--secundario boton--chico', onclick: () => copiar(urlPublica(), 'Link copiado.') }, p.boton)
        : el('a', { class: 'boton boton--secundario boton--chico', href: p.href, 'data-nav': '' }, p.hecho ? 'Editar' : p.boton)))));
}

export { hora };
