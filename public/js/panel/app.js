// Panel: sesión, estructura y navegación (history API: /panel, /panel/agenda, /ingresar…).
import { $, el, icono, api, avisar, poner, copiar, iniciales, ErrorApi } from '../comun.js';
import { vistaAcceso } from './acceso.js';
import { vistaHoy } from './hoy.js';
import { vistaAgenda } from './agenda.js';
import { vistaClientes } from './clientes.js';
import { vistaServicios } from './servicios.js';
import { vistaHorarios } from './horarios.js';
import { vistaEstadisticas } from './estadisticas.js';
import { vistaAjustes } from './ajustes.js';

export const sesion = { usuario: null, negocio: null, listo: null };

const SECCIONES = [
  { ruta: '', titulo: 'Hoy', icono: 'hoy', vista: vistaHoy },
  { ruta: 'agenda', titulo: 'Agenda', icono: 'agenda', vista: vistaAgenda },
  { ruta: 'clientes', titulo: 'Clientes', icono: 'clientes', vista: vistaClientes },
  { ruta: 'servicios', titulo: 'Servicios', icono: 'servicios', vista: vistaServicios },
  { ruta: 'horarios', titulo: 'Horarios', icono: 'horarios', vista: vistaHorarios },
  { ruta: 'estadisticas', titulo: 'Estadísticas', icono: 'estadisticas', vista: vistaEstadisticas },
  { ruta: 'ajustes', titulo: 'Ajustes', icono: 'ajustes', vista: vistaAjustes },
];

const app = $('#app');
let limpiar = null;
let contenedor = null;

export function ir(ruta, { reemplazar = false } = {}) {
  if (location.pathname + location.search !== ruta) history[reemplazar ? 'replaceState' : 'pushState'](null, '', ruta);
  enrutar();
}

/** Los enlaces internos (data-nav) navegan sin recargar la página. */
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-nav]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  ir(a.getAttribute('href'));
});
window.addEventListener('popstate', enrutar);

export const enlace = (href, ...hijos) => el('a', { href, 'data-nav': '' }, ...hijos);

export async function recargarSesion() {
  const d = await api('/api/yo');
  Object.assign(sesion, d);
  document.documentElement.dataset.color = d.negocio.color || 'pino';
  return d;
}

export const urlPublica = () => `${location.origin}/${sesion.negocio.slug}`;

async function enrutar() {
  try { limpiar?.(); } catch { /* nada */ }
  limpiar = null;
  const ruta = location.pathname;
  if (ruta === '/ingresar' || ruta === '/registro') {
    contenedor = null;
    return vistaAcceso(app, { modo: ruta.slice(1), alEntrar: () => ir('/panel', { reemplazar: true }) });
  }
  if (!sesion.usuario) {
    try { await recargarSesion(); } catch (e) {
      if (e instanceof ErrorApi && e.estado === 401) return ir('/ingresar', { reemplazar: true });
      poner(app, el('div', { class: 'vacio', style: { margin: '3rem auto' } }, el('h1', {}, 'No pudimos abrir el panel'), el('p', {}, e.message),
        el('button', { type: 'button', class: 'boton boton--primario', onclick: () => location.reload() }, 'Probar de nuevo')));
      return;
    }
  }
  const nombre = ruta.replace(/^\/panel\/?/, '').split('/')[0];
  const seccion = SECCIONES.find((s) => s.ruta === nombre) || SECCIONES[0];
  if (!contenedor) montarEstructura();
  for (const a of app.querySelectorAll('.nav a')) a.toggleAttribute('aria-current', a.dataset.ruta === seccion.ruta) && a.setAttribute('aria-current', 'page');
  $('#titulo-movil').textContent = seccion.titulo;
  cerrarMenu();
  document.title = `${seccion.titulo} · ${sesion.negocio.nombre}`;
  poner(contenedor, el('div', { class: 'esqueleto', style: { height: '2.5rem', width: '14rem', 'margin-bottom': '1.5rem' } }), el('div', { class: 'esqueleto', style: { height: '18rem' } }));
  try {
    limpiar = await seccion.vista(contenedor, { params: new URLSearchParams(location.search), resto: ruta.split('/').slice(3) });
  } catch (e) {
    if (e instanceof ErrorApi && e.estado === 401) { sesion.usuario = null; return ir('/ingresar', { reemplazar: true }); }
    console.error(e);
    poner(contenedor, el('div', { class: 'vacio' }, el('h1', {}, 'No se pudo cargar esta sección'), el('p', {}, e.message),
      el('button', { type: 'button', class: 'boton boton--secundario', onclick: enrutar }, 'Probar de nuevo')));
  }
  const h1 = contenedor.querySelector('h1');
  if (h1 && document.activeElement?.closest?.('.nav, .barra-movil')) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
  window.scrollTo(0, 0);
}

function montarEstructura() {
  const n = sesion.negocio;
  contenedor = el('main', { class: 'principal', id: 'vista', tabindex: '-1' });
  const lateral = el('aside', { class: 'lateral', id: 'lateral', 'aria-label': 'Menú' },
    el('div', { class: 'lateral__negocio' },
      el('span', { class: 'avatar', 'aria-hidden': 'true' }, iniciales(n.nombre)),
      el('div', { style: { 'min-width': '0' } }, el('p', { class: 'lateral__nombre' }, n.nombre), el('p', { class: 'lateral__usuario' }, sesion.usuario.nombre))),
    el('nav', { class: 'nav', 'aria-label': 'Secciones' }, SECCIONES.map((s) => el('a', { href: `/panel${s.ruta ? `/${s.ruta}` : ''}`, 'data-nav': '', dataset: { ruta: s.ruta } }, icono(s.icono), s.titulo))),
    el('div', { class: 'lateral__link' },
      el('p', {}, 'Tu página de turnos'),
      el('code', {}, `${location.host}/${n.slug}`),
      el('div', { class: 'fila' },
        el('button', { type: 'button', class: 'boton boton--secundario boton--chico', onclick: () => copiar(urlPublica(), 'Link copiado. Pegalo en tu Instagram o WhatsApp.') }, icono('copiar', { tamano: 16 }), 'Copiar'),
        el('a', { class: 'boton boton--texto boton--chico', href: `/${n.slug}`, target: '_blank', rel: 'noopener' }, 'Ver'))),
    el('button', { type: 'button', class: 'lateral__salir', onclick: salir }, icono('salir'), sesion.usuario.demo ? 'Salir de la demo' : 'Salir'));
  const barra = el('header', { class: 'barra-movil' },
    el('button', { type: 'button', class: 'boton-icono', 'aria-label': 'Abrir menú', 'aria-controls': 'lateral', 'aria-expanded': 'false', id: 'boton-menu', onclick: abrirMenu }, icono('menu')),
    el('strong', { id: 'titulo-movil' }, ''),
    el('button', { type: 'button', class: 'boton-icono', 'aria-label': 'Copiar mi link de turnos', onclick: () => copiar(urlPublica(), 'Link copiado.') }, icono('enlace')));
  poner(app, el('div', { class: 'marco' }, lateral, el('div', { style: { 'min-width': '0' } }, barra,
    sesion.usuario.demo ? el('div', { class: 'cinta-demo', role: 'note' }, el('span', {}, 'Estás en una demo con datos de ejemplo. Probá todo lo que quieras: se borra sola en 24 horas.'), el('a', { href: '/registro' }, 'Crear mi agenda gratis')) : null,
    contenedor)));
}

function abrirMenu() {
  $('#lateral').classList.add('lateral--abierto');
  $('#boton-menu').setAttribute('aria-expanded', 'true');
  const velo = el('div', { class: 'velo', onclick: cerrarMenu });
  document.body.append(velo);
  $('#lateral a')?.focus();
  document.addEventListener('keydown', escape);
}
function cerrarMenu() {
  $('#lateral')?.classList.remove('lateral--abierto');
  $('#boton-menu')?.setAttribute('aria-expanded', 'false');
  document.querySelector('.velo')?.remove();
  document.removeEventListener('keydown', escape);
}
function escape(e) { if (e.key === 'Escape') { cerrarMenu(); $('#boton-menu')?.focus(); } }

async function salir() {
  const demo = sesion.usuario?.demo;
  await api('/api/salir', { metodo: 'POST', cuerpo: {} }).catch(() => {});
  Object.assign(sesion, { usuario: null, negocio: null });
  contenedor = null;
  location.href = demo ? '/' : '/ingresar';
}

/** Actualiza el contador del menú (por ejemplo, pendientes de hoy). */
export function marcarAviso(ruta, n) {
  const a = app.querySelector(`.nav a[data-ruta="${ruta}"]`);
  if (!a) return;
  a.querySelector('.nav__aviso')?.remove();
  if (n) a.append(el('span', { class: 'nav__aviso', 'aria-label': `${n} pendientes` }, String(n)));
}

window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); avisar(e.reason?.message || 'Ocurrió un error.', { tipo: 'error' }); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});

enrutar();
