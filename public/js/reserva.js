// Página pública: /:slug (reservar) y /t/:token (ver, cambiar o cancelar un turno).
import {
  $, el, icono, api, avisar, dialogo, confirmar, campo, entrada, valores, conCarga, copiar, mostrarErrorEn, desplazarArriba,
  poner, fechaLarga, nombreMes, hora, pesos, duracion, capital, iniciales, plural, sumarDias, diaSemana,
} from './comun.js';

const app = $('#app');
const partes = location.pathname.split('/').filter(Boolean);

const estado = {
  negocio: null, servicios: [], hoy: '', conSena: false,
  paso: 'servicio', servicio: null, mes: '', fecha: '', inicio: null, dias: [], horarios: [],
  reprogramar: null, // token del turno que se está cambiando
};

if (partes[0] === 't' && partes[1]) verTurno(partes[1]);
else if (partes[0]) iniciarReserva(partes[0]);
else location.replace('/');

window.addEventListener('popstate', () => location.reload());

// ---------------------------------------------------------------- Reserva

async function iniciarReserva(slug, { reprogramar = null, servicioId = null } = {}) {
  try {
    const d = await api(`/api/p/${encodeURIComponent(slug)}`);
    Object.assign(estado, { negocio: d.negocio, servicios: d.servicios, hoy: d.hoy, conSena: d.sena, reprogramar });
    aplicarMarca(d.negocio);
    document.title = `${reprogramar ? 'Cambiar turno' : 'Reservar turno'} en ${d.negocio.nombre}`;
    if (!d.activo) return pantalla(el('section', { class: 'paso' }, el('div', { class: 'vacio' },
      el('h2', {}, 'Por ahora no se toman turnos online'), el('p', {}, 'Escribile directamente al negocio para coordinar.'),
      botonWhatsApp('Escribir por WhatsApp'))));
    if (!d.servicios.length) return pantalla(el('section', { class: 'paso' }, el('div', { class: 'vacio' }, el('h2', {}, 'Todavía no hay servicios para reservar'), botonWhatsApp('Consultar por WhatsApp'))));
    const pedido = new URLSearchParams(location.search);
    const preelegido = d.servicios.find((s) => s.id === (servicioId || Number(pedido.get('servicio'))));
    if (preelegido || d.servicios.length === 1) {
      estado.servicio = preelegido || d.servicios[0];
      const fecha = pedido.get('fecha');
      estado.mes = (fecha && fecha >= d.hoy ? fecha : d.hoy).slice(0, 7);
      if (fecha && fecha >= d.hoy) estado.fecha = fecha;
      return irA('horario');
    }
    irA('servicio');
  } catch (e) {
    pantalla(el('section', { class: 'paso' }, el('div', { class: 'vacio' },
      el('h1', {}, e.estado === 404 ? 'No encontramos esta agenda' : 'No pudimos cargar la agenda'),
      el('p', {}, e.estado === 404 ? 'Revisá que el link esté bien escrito o pedile uno nuevo al negocio.' : e.message),
      el('button', { type: 'button', class: 'boton boton--secundario', onclick: () => location.reload() }, 'Probar de nuevo'))), { sinPerfil: true });
  }
}

function aplicarMarca(n) {
  document.documentElement.dataset.color = n.color || 'pino';
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--fondo').trim();
}

function perfil() {
  const n = estado.negocio;
  return el('header', { class: 'perfil' },
    el('div', { class: 'avatar', 'aria-hidden': 'true' }, iniciales(n.nombre)),
    el('div', {},
      el('p', { class: 'perfil__nombre' }, n.nombre),
      el('div', { class: 'perfil__datos' },
        n.rubro ? el('span', {}, n.rubro) : null,
        n.direccion ? el('a', { href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(n.direccion)}`, target: '_blank', rel: 'noopener' }, icono('lugar', { tamano: 16 }), n.direccion) : null)),
    n.whatsapp ? el('a', { class: 'boton boton--secundario boton--chico', href: `https://wa.me/${n.whatsapp}`, target: '_blank', rel: 'noopener' }, icono('whatsapp', { tamano: 18 }), 'Consultar') : null,
    n.descripcion && estado.paso === 'servicio' ? el('p', { class: 'perfil__descripcion' }, n.descripcion) : null);
}

function botonWhatsApp(texto, mensaje = '') {
  const n = estado.negocio;
  if (!n?.whatsapp) return null;
  return el('a', { class: 'boton boton--whatsapp', href: `https://wa.me/${n.whatsapp}${mensaje ? `?text=${encodeURIComponent(mensaje)}` : ''}`, target: '_blank', rel: 'noopener' }, icono('whatsapp'), texto);
}

function pantalla(contenido, { sinPerfil = false } = {}) {
  app.removeAttribute('aria-busy');
  poner(app, 
    sinPerfil || !estado.negocio ? null : perfil(),
    el('main', { id: 'contenido', tabindex: '-1' }, contenido),
    el('footer', { class: 'pie-reserva' }, 'Turnos online con ', el('a', { href: '/' }, 'Puntual')));
}

function cabecera(numero, titulo, volverA) {
  const total = estado.reprogramar ? 1 : 3;
  return el('div', { class: 'paso__cabecera' },
    el('div', {}, estado.reprogramar ? null : el('p', { class: 'paso__numero' }, `Paso ${numero} de ${total}`), el('h1', { class: 'paso__titulo', tabindex: '-1' }, titulo)),
    volverA ? el('button', { type: 'button', class: 'volver', onclick: () => irA(volverA) }, icono('atras', { tamano: 18 }), 'Volver') : null);
}

function irA(paso) {
  estado.paso = paso;
  if (paso === 'servicio') pasoServicio();
  if (paso === 'horario') pasoHorario();
  if (paso === 'datos') pasoDatos();
  app.querySelector('.paso__titulo')?.focus({ preventScroll: true });
  desplazarArriba();
}

function pasoServicio() {
  pantalla(el('section', { class: 'paso', 'aria-labelledby': 'titulo-paso' },
    cabecera(1, 'Elegí el servicio'),
    el('ul', { class: 'servicios' }, estado.servicios.map((s) => el('li', {}, el('button', {
      type: 'button', class: 'servicio',
      onclick: () => { estado.servicio = s; estado.mes ||= estado.hoy.slice(0, 7); estado.fecha = ''; estado.inicio = null; irA('horario'); },
    },
    el('span', { class: 'servicio__nombre' }, s.nombre),
    s.descripcion ? el('span', { class: 'servicio__descripcion' }, s.descripcion) : null,
    el('span', { class: 'servicio__datos' },
      el('span', {}, icono('reloj', { tamano: 15 }), duracion(s.duracion)),
      s.sena && estado.conSena ? el('span', { class: 'servicio__sena' }, `Seña ${pesos(s.sena)}`) : null),
    el('span', { class: 'servicio__precio' }, s.precio ? pesos(s.precio) : ''))))),
  ));
}

// ------------------------------------------------ Día y hora

async function pasoHorario() {
  const lista = el('div', { class: 'horas', 'aria-live': 'polite' });
  const calendario = el('div', { class: 'mes' });
  pantalla(el('section', { class: 'paso' },
    cabecera(estado.reprogramar ? 1 : 2, estado.reprogramar ? 'Elegí el nuevo horario' : 'Elegí día y horario', estado.servicios.length > 1 && !estado.reprogramar ? 'servicio' : null),
    estado.reprogramar ? null : el('div', { class: 'elegido' }, el('button', { type: 'button', onclick: () => irA('servicio'), disabled: estado.servicios.length < 2 }, icono('servicios', { tamano: 16 }), `${estado.servicio.nombre}, ${duracion(estado.servicio.duracion)}`)),
    el('div', { class: 'cuando' }, calendario, lista)));
  await dibujarMes(calendario, lista);
}

async function dibujarMes(calendario, lista) {
  poner(calendario, el('div', { class: 'esqueleto esqueleto--bloque' }));
  try {
    const { dias } = await api(`/api/p/${estado.negocio.slug}/mes?servicio=${estado.servicio.id}&mes=${estado.mes}`);
    estado.dias = dias;
  } catch (e) {
    poner(calendario, el('p', { class: 'caja-error' }, e.message));
    return;
  }
  // Si el día elegido no está en este mes (o ya no hay lugar), elegimos el primero libre.
  if (!estado.fecha || !estado.fecha.startsWith(estado.mes)) {
    const primero = estado.dias.find((d) => d.estado === 'libre');
    estado.fecha = primero ? primero.fecha : '';
  }
  const mesActual = estado.hoy.slice(0, 7);
  const [a, m] = estado.mes.split('-').map(Number);
  const cambiarMes = (delta) => {
    const d = new Date(Date.UTC(a, m - 1 + delta, 1));
    estado.mes = d.toISOString().slice(0, 7);
    estado.fecha = '';
    dibujarMes(calendario, lista);
  };
  const primerDia = (diaSemana(`${estado.mes}-01`) + 6) % 7; // lunes primero
  const botones = estado.dias.map((d) => {
    const n = Number(d.fecha.slice(8));
    const etiqueta = `${capital(fechaLarga(d.fecha))}: ${d.estado === 'libre' ? plural(d.libres, 'horario libre', 'horarios libres') : d.estado === 'completo' ? 'sin lugar' : 'no se atiende'}`;
    return el('button', {
      type: 'button', class: `dia dia--${d.estado} ${d.fecha === estado.hoy ? 'dia--hoy' : ''} ${d.fecha === estado.fecha ? 'dia--elegido' : ''}`,
      'aria-label': etiqueta, 'aria-pressed': String(d.fecha === estado.fecha), disabled: d.estado === 'cerrado',
      dataset: { fecha: d.fecha },
      onclick: () => { estado.fecha = d.fecha; estado.inicio = null; marcarDia(); dibujarHoras(lista); },
    }, String(n));
  });
  const grilla = el('div', { class: 'mes__dias', role: 'group', 'aria-label': `Días de ${nombreMes(estado.mes)}` },
    Array.from({ length: primerDia }, () => el('span', { 'aria-hidden': 'true' })), botones);
  grilla.addEventListener('keydown', moverEnGrilla);
  poner(calendario, 
    el('div', { class: 'mes__cabecera' },
      el('h2', { class: 'mes__titulo', 'aria-live': 'polite' }, nombreMes(estado.mes)),
      el('div', { class: 'mes__nav' },
        el('button', { type: 'button', class: 'boton-icono', 'aria-label': 'Mes anterior', disabled: estado.mes <= mesActual, onclick: () => cambiarMes(-1) }, icono('atras')),
        el('button', { type: 'button', class: 'boton-icono', 'aria-label': 'Mes siguiente', onclick: () => cambiarMes(1) }, icono('adelante')))),
    el('div', { class: 'mes__semana', 'aria-hidden': 'true' }, ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x) => el('span', {}, x))),
    grilla,
    el('div', { class: 'mes__leyenda' }, el('span', {}, el('i'), 'Con lugar'), el('span', {}, el('i', { class: 'completo' }), 'Completo')));
  function marcarDia() {
    for (const b of botones) {
      const elegido = b.dataset.fecha === estado.fecha;
      b.classList.toggle('dia--elegido', elegido);
      b.setAttribute('aria-pressed', String(elegido));
    }
  }
  dibujarHoras(lista);
}

function moverEnGrilla(e) {
  const pasos = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
  if (!pasos) return;
  const dias = [...e.currentTarget.querySelectorAll('.dia')];
  let i = dias.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  do { i += pasos; } while (dias[i] && dias[i].disabled);
  dias[i]?.focus();
}

async function dibujarHoras(lista) {
  if (!estado.fecha) {
    const hayCompletos = estado.dias.some((d) => d.estado === 'completo');
    poner(lista, el('div', { class: 'horas__vacio' },
      el('p', {}, hayCompletos ? 'Este mes ya no quedan horarios libres.' : 'No hay días disponibles este mes.'),
      el('p', {}, 'Probá con el mes siguiente.')));
    return;
  }
  poner(lista, el('div', { class: 'esqueleto esqueleto--bloque' }));
  let horarios;
  try {
    ({ horarios } = await api(`/api/p/${estado.negocio.slug}/horarios?servicio=${estado.servicio.id}&fecha=${estado.fecha}${estado.reprogramar ? `&turno=${estado.reprogramar}` : ''}`));
  } catch (e) {
    poner(lista, el('p', { class: 'caja-error' }, e.message));
    return;
  }
  estado.horarios = horarios;
  const titulo = el('h2', { class: 'horas__titulo' }, capital(fechaLarga(estado.fecha)));
  if (!horarios.length) {
    poner(lista, titulo, el('div', { class: 'horas__vacio' },
      el('p', {}, 'Este día ya no tiene lugar.'),
      estado.reprogramar ? null : el('button', { type: 'button', class: 'boton boton--secundario', onclick: anotarEnEspera }, icono('campana', { tamano: 18 }), 'Avisarme si se libera un lugar')));
    return;
  }
  const grupos = [['Mañana', (m) => m < 720], ['Tarde', (m) => m >= 720 && m < 1140], ['Noche', (m) => m >= 1140]];
  poner(lista, titulo, ...grupos.map(([nombre, filtro]) => {
    const delGrupo = horarios.filter((h) => filtro(h.inicio));
    if (!delGrupo.length) return null;
    return el('div', { class: 'horas__grupo' }, el('h3', {}, nombre), el('div', { class: 'horas__lista' }, delGrupo.map((h) => el('button', {
      type: 'button', class: 'hora', 'aria-pressed': 'false', 'aria-label': `${h.hora} horas`,
      onclick: () => { estado.inicio = h.inicio; estado.reprogramar ? confirmarCambio() : irA('datos'); },
    }, h.hora))));
  }));
}

async function anotarEnEspera() {
  const f = el('div', { class: 'formulario' },
    campo({ etiqueta: 'Nombre', control: entrada({ name: 'nombre', autocomplete: 'name', required: true }) }),
    campo({ etiqueta: 'Celular', control: entrada({ name: 'telefono', type: 'tel', autocomplete: 'tel', inputmode: 'tel', placeholder: '11 2345-6789', required: true }) }),
    campo({ etiqueta: 'Email', opcional: true, ayuda: 'Te avisamos por mail apenas se libere un lugar.', control: entrada({ name: 'email', type: 'email', autocomplete: 'email' }) }));
  const ok = await dialogo({
    titulo: 'Lista de espera',
    descripcion: `Si alguien cancela el ${fechaLarga(estado.fecha)}, te avisamos para que puedas reservar.`,
    contenido: f,
    botones: [{ texto: 'Cancelar', valor: false }, {
      texto: 'Anotarme', valor: true, tipo: 'primario', enviar: true,
      alHacer: () => api(`/api/p/${estado.negocio.slug}/espera`, { metodo: 'POST', cuerpo: { ...valores(f), servicio_id: estado.servicio.id, fecha: estado.fecha } }),
    }],
  });
  if (ok) avisar('Listo, te anotamos en la lista de espera.');
}

// ------------------------------------------------ Datos y confirmación

function pasoDatos() {
  const s = estado.servicio;
  const conSena = s.sena > 0 && estado.conSena;
  const guardado = JSON.parse(localStorage.getItem('puntual.cliente') || '{}');
  const formulario = el('form', { class: 'formulario', novalidate: true },
    campo({ etiqueta: 'Nombre y apellido', control: entrada({ name: 'nombre', autocomplete: 'name', required: true, value: guardado.nombre || '', maxlength: 80 }) }),
    campo({ etiqueta: 'Celular', ayuda: 'Con código de área. Lo usamos solo para avisarte sobre tu turno.', control: entrada({ name: 'telefono', type: 'tel', autocomplete: 'tel', inputmode: 'tel', placeholder: '11 2345-6789', required: true, value: guardado.telefono || '', maxlength: 30 }) }),
    campo({ etiqueta: 'Email', opcional: true, ayuda: 'Para recibir la confirmación y un recordatorio el día anterior.', control: entrada({ name: 'email', type: 'email', autocomplete: 'email', value: guardado.email || '', maxlength: 120 }) }),
    campo({ etiqueta: '¿Algo que debamos saber?', opcional: true, control: el('textarea', { class: 'entrada', name: 'nota', rows: 2, maxlength: 300 }) }),
    el('div', { class: 'trampa', 'aria-hidden': 'true' }, el('label', {}, 'No completar', el('input', { name: 'sitio', tabindex: '-1', autocomplete: 'off' }))),
    el('label', { class: 'casilla' }, el('input', { type: 'checkbox', name: 'recordar', checked: Boolean(guardado.nombre) }), el('span', {}, 'Recordar mis datos en este dispositivo')),
    el('button', { type: 'submit', class: 'boton boton--primario boton--ancho' }, conSena ? 'Reservar y ver cómo pagar la seña' : 'Confirmar turno'));
  formulario.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = valores(formulario);
    await conCarga(formulario.querySelector('[type=submit]'), async () => {
      try {
        const r = await api(`/api/p/${estado.negocio.slug}/reservas`, { metodo: 'POST', cuerpo: { ...v, servicio_id: s.id, fecha: estado.fecha, inicio: estado.inicio } });
        if (v.recordar) localStorage.setItem('puntual.cliente', JSON.stringify({ nombre: v.nombre, telefono: v.telefono, email: v.email }));
        else localStorage.removeItem('puntual.cliente');
        history.pushState(null, '', `/t/${r.token}`);
        verTurno(r.token, { recienReservado: true });
      } catch (error) {
        if (error.datos?.codigo === 'ocupado') {
          avisar(error.message, { tipo: 'error' });
          irA('horario');
          return;
        }
        mostrarErrorEn(formulario, error);
      }
    });
  });
  pantalla(el('section', { class: 'paso' },
    cabecera(3, 'Tus datos', 'horario'),
    el('div', { class: 'datos' }, formulario,
      el('aside', { class: 'resumen', 'aria-label': 'Resumen del turno' },
        el('p', { class: 'resumen__hora' }, hora(estado.inicio)),
        el('p', {}, el('strong', {}, capital(fechaLarga(estado.fecha)))),
        el('div', { class: 'resumen__fila' }, el('span', {}, s.nombre), el('strong', {}, duracion(s.duracion))),
        s.precio ? el('div', { class: 'resumen__fila' }, el('span', {}, 'Precio'), el('strong', {}, pesos(s.precio))) : null,
        conSena ? el('div', { class: 'resumen__fila' }, el('span', {}, 'Seña para confirmar'), el('strong', {}, pesos(s.sena))) : null,
        el('p', { class: 'resumen__nota' }, estado.negocio.cancelacion_horas
          ? `Podés cancelar o cambiar el turno hasta ${plural(estado.negocio.cancelacion_horas, 'hora', 'horas')} antes.`
          : 'Podés cancelar o cambiar el turno cuando quieras.'),
        estado.negocio.mensaje ? el('p', { class: 'resumen__nota' }, estado.negocio.mensaje) : null))));
}

async function confirmarCambio() {
  const ok = await confirmar('¿Cambiamos tu turno?', `Nuevo horario: ${fechaLarga(estado.fecha)} a las ${hora(estado.inicio)}.`, { texto: 'Sí, cambiar', cancelar: 'Elegir otro' });
  if (!ok) return;
  try {
    await api(`/api/t/${estado.reprogramar}/reprogramar`, { metodo: 'POST', cuerpo: { fecha: estado.fecha, inicio: estado.inicio } });
    avisar('Listo, cambiamos tu turno.');
    verTurno(estado.reprogramar, { recienCambiado: true });
  } catch (e) {
    avisar(e.message, { tipo: 'error' });
    if (e.datos?.codigo === 'ocupado') pasoHorario();
  }
}

// ---------------------------------------------------------------- Ver / gestionar un turno

async function verTurno(token, { recienReservado = false, recienCambiado = false } = {}) {
  let d;
  try {
    d = await api(`/api/t/${encodeURIComponent(token)}`);
  } catch (e) {
    pantalla(el('div', { class: 'listo' }, el('div', { class: 'vacio' }, el('h1', {}, 'No encontramos este turno'), el('p', {}, 'Revisá que el link esté completo.'))), { sinPerfil: true });
    return;
  }
  const { turno: t, negocio: n } = d;
  estado.negocio = n;
  estado.reprogramar = null;
  aplicarMarca(n);
  document.title = `Tu turno en ${n.nombre}`;
  const cancelado = t.estado === 'cancelado';
  const pendiente = t.estado === 'pendiente_sena';
  const linkPropio = `${location.origin}/t/${t.token}`;

  const titulo = cancelado
    ? { icono: 'cerrar', clase: 'marca-ok--gris', texto: 'Turno cancelado', bajada: 'Este turno ya no está activo.' }
    : pendiente
      ? { icono: 'reloj', clase: 'marca-ok--aviso', texto: 'Turno reservado', bajada: 'Falta pagar la seña para confirmarlo.' }
      : d.paso
        ? { icono: 'ok', clase: '', texto: 'Turno', bajada: 'Este turno ya pasó.' }
        : { icono: 'ok', clase: '', texto: recienCambiado ? 'Turno cambiado' : recienReservado ? '¡Listo, te esperamos!' : 'Tu turno', bajada: recienReservado ? 'Tu turno quedó confirmado.' : '' };

  const ticket = el('article', { class: `ticket ${cancelado ? 'ticket--cancelado' : ''}`, 'aria-label': 'Comprobante del turno', 'data-anima': recienReservado ? '' : null },
    el('div', { class: 'ticket__cabecera' }, el('span', { class: 'ticket__marca' }, el('span', { class: 'avatar avatar--mini', 'aria-hidden': 'true' }, iniciales(n.nombre)), n.nombre), el('span', { class: 'estado-texto' }, cancelado ? 'Cancelado' : pendiente ? 'Falta la seña' : 'Confirmado')),
    el('div', { class: 'ticket__cuerpo' },
      el('p', { class: 'ticket__dia' }, capital(fechaLarga(t.fecha))),
      el('p', { class: 'ticket__hora' }, t.hora),
      el('p', { class: 'ticket__servicio' }, `${t.servicio}, ${duracion(t.duracion)}`)),
    el('div', { class: 'ticket__troquel', 'aria-hidden': 'true' }),
    el('div', { class: 'ticket__pie' },
      el('div', { class: 'ticket__fila' }, el('span', {}, 'A nombre de'), el('strong', {}, t.cliente)),
      n.direccion ? el('div', { class: 'ticket__fila' }, el('span', {}, 'Dirección'), el('strong', {}, n.direccion)) : null,
      t.precio ? el('div', { class: 'ticket__fila' }, el('span', {}, 'Precio'), el('strong', {}, pesos(t.precio))) : null));

  const sena = pendiente ? cajaSena(t, n) : null;
  const acciones = cancelado
    ? el('div', { class: 'acciones' }, el('a', { class: 'boton boton--primario', href: `/${n.slug}` }, 'Reservar otro turno'), botonWhatsApp('Escribir al negocio'))
    : d.paso ? el('div', { class: 'acciones' }, el('a', { class: 'boton boton--primario', href: `/${n.slug}` }, 'Reservar de nuevo'))
      : el('div', { class: 'acciones' },
        el('div', { class: 'acciones acciones--dos' },
          el('a', { class: 'boton boton--secundario', href: d.calendario, target: '_blank', rel: 'noopener' }, icono('calendario', { tamano: 18 }), 'Google Calendar'),
          el('a', { class: 'boton boton--secundario', href: `/api/t/${t.token}/turno.ics`, download: 'turno.ics' }, icono('descargar', { tamano: 18 }), 'Apple / Outlook')),
        d.puede_modificar ? el('div', { class: 'acciones acciones--dos' },
          el('button', { type: 'button', class: 'boton boton--secundario', onclick: () => cambiar(t, n) }, 'Cambiar horario'),
          el('button', { type: 'button', class: 'boton boton--peligro', onclick: () => cancelar(t) }, 'Cancelar turno'))
          : el('p', { class: 'pequeno' }, n.cancelacion_horas ? `Faltan menos de ${plural(n.cancelacion_horas, 'hora', 'horas')}: para cancelar o cambiar, escribile al negocio.` : ''),
        !d.puede_modificar ? botonWhatsApp('Escribir al negocio', `Hola! Tengo turno el ${fechaLarga(t.fecha)} a las ${t.hora} a nombre de ${t.cliente}.`) : null);

  pantalla(el('div', { class: 'listo' },
    el('div', { class: 'listo__titulo' },
      el('span', { class: `marca-ok ${titulo.clase}`, 'aria-hidden': 'true' }, icono(titulo.icono, { tamano: 24 })),
      el('h1', { class: 'paso__titulo', tabindex: '-1' }, titulo.texto),
      titulo.bajada ? el('p', {}, titulo.bajada) : null),
    ticket, sena, acciones,
    !cancelado && !d.paso ? el('div', { class: 'guardar-link' }, icono('enlace', { tamano: 18 }),
      el('div', {}, el('p', {}, 'Este es el link de tu turno: guardalo para cambiarlo o cancelarlo.'),
        el('button', { type: 'button', class: 'boton boton--texto boton--chico', onclick: () => copiar(linkPropio, 'Link copiado.') }, icono('copiar', { tamano: 16 }), 'Copiar link'))) : null,
  ), { sinPerfil: true });
  window.scrollTo(0, 0);
  app.querySelector('h1')?.focus({ preventScroll: true });
}

function cajaSena(t, n) {
  const restante = Math.max(0, t.vence_sena - Date.now());
  const horas = Math.floor(restante / 3600000);
  const minutos = Math.floor((restante % 3600000) / 60000);
  return el('section', { class: 'sena', 'aria-label': 'Pago de la seña' },
    el('p', {}, 'Para confirmar, pagá la seña de ', el('strong', {}, pesos(t.sena)), ` dentro de las próximas ${horas ? `${horas} h ` : ''}${minutos} min. Si no, el horario se libera.`),
    n.sena_alias ? el('div', { class: 'sena__alias' },
      el('span', {}, el('span', { class: 'solo-lectores' }, 'Alias: '), n.sena_alias),
      el('button', { type: 'button', class: 'boton boton--secundario boton--chico', onclick: () => copiar(n.sena_alias, 'Alias copiado.') }, icono('copiar', { tamano: 16 }), 'Copiar')) : null,
    n.sena_titular ? el('p', {}, `Titular: ${n.sena_titular}. Cuando transfieras, mandá el comprobante por WhatsApp.`) : null,
    el('div', { class: 'acciones' },
      n.mp ? el('button', { type: 'button', class: 'boton boton--primario', onclick: (e) => pagarMp(e.currentTarget, t.token) }, 'Pagar con Mercado Pago') : null,
      botonWhatsApp('Enviar comprobante', `Hola! Te mando el comprobante de la seña del turno del ${fechaLarga(t.fecha)} a las ${t.hora} (${t.cliente}).`)));
}

async function pagarMp(boton, token) {
  await conCarga(boton, async () => {
    try { location.href = (await api(`/api/t/${token}/pagar`, { metodo: 'POST', cuerpo: {} })).url; } catch (e) { avisar(e.message, { tipo: 'error' }); }
  });
}

async function cancelar(t) {
  const ok = await confirmar('¿Cancelar el turno?', `${capital(fechaLarga(t.fecha))} a las ${t.hora}. El horario queda libre para otra persona.`, { texto: 'Sí, cancelar', peligro: true, cancelar: 'No, mantener' });
  if (!ok) return;
  try {
    await api(`/api/t/${t.token}/cancelar`, { metodo: 'POST', cuerpo: {} });
    avisar('Cancelamos tu turno.');
    verTurno(t.token);
  } catch (e) { avisar(e.message, { tipo: 'error' }); }
}

async function cambiar(t, n) {
  estado.servicio = { id: t.servicio_id, nombre: t.servicio, duracion: t.duracion };
  estado.mes = t.fecha.slice(0, 7);
  estado.fecha = t.fecha;
  estado.reprogramar = t.token;
  if (!estado.servicios.length) {
    const d = await api(`/api/p/${n.slug}`);
    Object.assign(estado, { servicios: d.servicios, hoy: d.hoy, conSena: d.sena, negocio: d.negocio });
  }
  irA('horario');
}

// Atajo: si el link de reserva trae ?fecha= de una semana pasada, igual funciona (se usa el mes actual).
export const _interno = { estado, sumarDias };
