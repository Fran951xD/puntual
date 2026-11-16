// Piezas compartidas del frontend: elementos, pedidos a la API, avisos, diálogos, formatos e íconos.

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/** Crea un elemento. El texto siempre se inserta como texto (nunca como HTML). */
export function el(tag, atributos = {}, ...hijos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(atributos ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v)) n.style.setProperty(p, x);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'selected', 'disabled', 'indeterminate'].includes(k)) n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...hijos.flat(Infinity).filter((h) => h != null && h !== false));
  return n;
}

const SVG = 'http://www.w3.org/2000/svg';
const TRAZOS = {
  hoy: 'M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z',
  agenda: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  clientes: 'M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 19v-1a4 4 0 00-3-3.9M15.5 3.2a3.5 3.5 0 010 6.6',
  servicios: 'M4 6h16M4 12h16M4 18h10',
  horarios: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5h4',
  estadisticas: 'M5 20V11M12 20V4M19 20v-6',
  ajustes: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5',
  salir: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  mas: 'M12 5v14M5 12h14',
  cerrar: 'M6 6l12 12M18 6L6 18',
  atras: 'M15 5l-7 7 7 7',
  adelante: 'M9 5l7 7-7 7',
  ok: 'M5 12l5 5 9-10',
  whatsapp: 'M4 20l1.3-3.9A8 8 0 1112 20a8 8 0 01-4.1-1.1zM9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8c-.9-.4-1.6-1.1-2-2l.8-1-1-2z',
  copiar: 'M9 9h10v11H9zM5 15V4h10',
  enlace: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  calendario: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h3v3H8z',
  lugar: 'M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11zM12 12a2 2 0 100-4 2 2 0 000 4z',
  reloj: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  lapiz: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  basura: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  buscar: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  campana: 'M6 16V11a6 6 0 1112 0v5l2 2H4zM10 21h4',
  descargar: 'M12 4v12m0 0l-5-5m5 5l5-5M5 20h14',
  alerta: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  ojo: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
  arriba: 'M6 15l6-6 6 6',
  abajo: 'M6 9l6 6 6-6',
  plata: 'M4 7h16v10H4zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM7 12h.5M16.5 12h.5',
  espera: 'M8 3h8M8 21h8M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9',
  usuario: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  telefono: 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z',
  pausa: 'M9 6v12M15 6v12',
};

export function icono(nombre, { tamano = 20, clase = '' } = {}) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', tamano);
  s.setAttribute('height', tamano);
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', `icono ${clase}`);
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', TRAZOS[nombre] || '');
  s.append(p);
  return s;
}

// ---------------------------------------------------------------- API

export class ErrorApi extends Error {
  constructor(mensaje, estado, datos = {}) { super(mensaje); this.estado = estado; this.datos = datos; }
}

export async function api(ruta, { metodo = 'GET', cuerpo, senal } = {}) {
  let r;
  try {
    r = await fetch(ruta, {
      method: metodo,
      headers: cuerpo !== undefined ? { 'content-type': 'application/json' } : {},
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      credentials: 'same-origin',
      signal: senal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ErrorApi('No hay conexión. Revisá tu internet y probá de nuevo.', 0);
  }
  const datos = (r.headers.get('content-type') || '').includes('json') ? await r.json() : {};
  if (!r.ok) throw new ErrorApi(datos.error || `Error ${r.status}`, r.status, datos);
  return datos;
}

// ---------------------------------------------------------------- Formatos

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const diaSemana = (f) => new Date(`${f}T00:00:00Z`).getUTCDay();
export const sumarDias = (f, n) => { const d = new Date(`${f}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const hora = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const fechaLarga = (f) => { const [, m, d] = f.split('-').map(Number); return `${DIAS[diaSemana(f)]} ${d} de ${MESES[m - 1]}`; };
export const fechaMedia = (f) => { const [, m, d] = f.split('-').map(Number); return `${DIAS_CORTOS[diaSemana(f)]} ${d} ${MESES[m - 1].slice(0, 3)}`; };
export const fechaCorta = (f) => { const [, m, d] = f.split('-').map(Number); return `${d}/${m}`; };
export const nombreMes = (mes) => { const [a, m] = mes.split('-').map(Number); return `${MESES[m - 1]} ${a}`; };
export const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export const pesos = (n) => `$${Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
export const duracion = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`);
export const plural = (n, uno, varios) => `${n.toLocaleString('es-AR')} ${n === 1 ? uno : varios}`;
export const porcentaje = (x) => `${Math.round(x * 100)}%`;
export { DIAS, DIAS_CORTOS, MESES };

export function relativo(fecha, hoy) {
  const d = Math.round((Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86400000);
  if (d === 0) return 'hoy';
  if (d === 1) return 'mañana';
  if (d === -1) return 'ayer';
  return d > 0 && d < 7 ? DIAS[diaSemana(fecha)] : fechaMedia(fecha);
}

export const ESTADOS = { confirmado: 'Confirmado', pendiente_sena: 'Falta la seña', asistio: 'Asistió', ausente: 'No vino', cancelado: 'Cancelado' };
export const estado = (e) => el('span', { class: `estado estado--${e}` }, ESTADOS[e] || e);

export function iniciales(nombre) {
  return String(nombre || '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

// ---------------------------------------------------------------- Avisos, diálogos, carga

export function avisar(mensaje, { tipo = 'ok', accion = null, duracion: dur = 4500 } = {}) {
  const zona = $('#avisos');
  if (!zona) return;
  const a = el('div', { class: `aviso aviso--${tipo}`, role: tipo === 'error' ? 'alert' : 'status' }, el('span', {}, mensaje));
  if (accion) a.append(el('button', { type: 'button', class: 'aviso__accion', onclick: () => { accion.alHacer(); a.remove(); } }, accion.texto));
  zona.append(a);
  while (zona.children.length > 3) zona.firstElementChild.remove();
  setTimeout(() => a.classList.add('aviso--saliendo'), dur);
  setTimeout(() => a.remove(), dur + 300);
}

/**
 * Diálogo modal. botones: [{ texto, valor, tipo, alHacer(caja) → false para no cerrar }].
 * Devuelve el valor del botón elegido (null si se cierra).
 */
export function dialogo({ titulo, descripcion, contenido, botones = [{ texto: 'Cerrar', valor: null }], clase = '' }) {
  return new Promise((resolver) => {
    const anterior = document.activeElement;
    const id = `d${Math.random().toString(36).slice(2, 8)}`;
    const caja = el('dialog', { class: `dialogo ${clase}`, 'aria-labelledby': id });
    let listo = false;
    const cerrar = (valor) => { if (listo) return; listo = true; caja.close(); caja.remove(); anterior?.focus?.(); resolver(valor); };
    caja.cerrar = cerrar;
    const pie = el('div', { class: 'dialogo__pie' }, botones.map((b) => el('button', {
      type: b.enviar ? 'submit' : 'button', class: `boton boton--${b.tipo || 'secundario'}`,
      onclick: async (e) => {
        if (b.enviar) return; // lo maneja el submit del formulario
        await accionar(e.currentTarget, b);
      },
    }, b.texto)));
    async function accionar(boton, b) {
      if (b.alHacer) {
        boton.disabled = true;
        const original = [...boton.childNodes];
        boton.prepend(el('span', { class: 'cargando', 'aria-hidden': 'true' }));
        const seguir = await Promise.resolve().then(() => b.alHacer(caja)).catch((e) => { mostrarErrorEn(caja, e); return false; });
        boton.disabled = false;
        boton.replaceChildren(...original);
        if (seguir === false) return;
        cerrar(seguir === undefined || seguir === true ? b.valor : seguir);
      } else cerrar(b.valor);
    }
    const formulario = el('form', { method: 'dialog', novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      const b = botones.find((x) => x.enviar);
      if (b) accionar(pie.querySelector('[type=submit]'), b);
    } },
    el('div', { class: 'dialogo__cabecera' }, el('h2', { id }, titulo), el('button', { type: 'button', class: 'boton-icono', 'aria-label': 'Cerrar', onclick: () => cerrar(null) }, icono('cerrar'))),
    descripcion ? el('p', { class: 'dialogo__descripcion' }, descripcion) : null,
    contenido ? el('div', { class: 'dialogo__cuerpo' }, contenido) : null,
    botones.length ? pie : null);
    caja.append(formulario);
    caja.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(null); });
    caja.addEventListener('click', (e) => { if (e.target === caja) cerrar(null); });
    document.body.append(caja);
    caja.showModal();
    (caja.querySelector('[autofocus]') || caja.querySelector('.dialogo__cuerpo input, .dialogo__cuerpo select, .dialogo__cuerpo textarea') || caja.querySelector('.boton--primario') || caja.querySelector('button'))?.focus();
  });
}

export const confirmar = (titulo, descripcion, { texto = 'Confirmar', peligro = false, cancelar = 'Volver' } = {}) => dialogo({
  titulo, descripcion, botones: [{ texto: cancelar, valor: false }, { texto, valor: true, tipo: peligro ? 'peligro-lleno' : 'primario' }],
});

/** Muestra errores de validación de la API junto a cada campo (por atributo name). */
export function mostrarErrorEn(raiz, error) {
  for (const e of $$('.campo__error', raiz)) e.textContent = '';
  for (const c of $$('[aria-invalid]', raiz)) c.removeAttribute('aria-invalid');
  const errores = error?.datos?.errores;
  if (errores) {
    let primero = null;
    for (const [campo, mensaje] of Object.entries(errores)) {
      const control = raiz.querySelector(`[name="${campo}"]`);
      if (!control) continue;
      control.setAttribute('aria-invalid', 'true');
      const lugar = control.closest('.campo')?.querySelector('.campo__error');
      if (lugar) lugar.textContent = mensaje;
      primero ??= control;
    }
    primero?.focus();
    if (primero) return;
  }
  avisar(error?.message || 'Algo salió mal.', { tipo: 'error' });
}

/** Campo con etiqueta, ayuda y lugar para el error. */
export function campo({ etiqueta, control, ayuda, opcional = false, clase = '' }) {
  const id = control.id || `c${Math.random().toString(36).slice(2, 8)}`;
  control.id = id;
  const ayudaId = ayuda ? `${id}-ayuda` : null;
  const errorId = `${id}-error`;
  control.setAttribute('aria-describedby', [ayudaId, errorId].filter(Boolean).join(' '));
  return el('div', { class: `campo ${clase}` },
    el('label', { for: id }, etiqueta, opcional ? el('span', { class: 'campo__opcional' }, ' (opcional)') : null),
    control,
    ayuda ? el('p', { class: 'campo__ayuda', id: ayudaId }, ayuda) : null,
    el('p', { class: 'campo__error', id: errorId, 'aria-live': 'polite' }));
}

export const entrada = (atributos) => el('input', { class: 'entrada', ...atributos });

/** Valores de un formulario como objeto (números convertidos si el campo es type=number). */
export function valores(formulario) {
  const salida = {};
  for (const c of $$('[name]', formulario)) {
    if (c.type === 'checkbox') salida[c.name] = c.checked;
    else if (c.type === 'radio') { if (c.checked) salida[c.name] = c.value; }
    else if (c.type === 'number') salida[c.name] = c.value === '' ? null : Number(c.value);
    else salida[c.name] = c.value;
  }
  return salida;
}

/** Pone un botón en estado "cargando" mientras dura una promesa. */
export async function conCarga(boton, trabajo) {
  if (boton.disabled) return undefined;
  const original = [...boton.childNodes];
  boton.disabled = true;
  boton.setAttribute('aria-busy', 'true');
  boton.prepend(el('span', { class: 'cargando', 'aria-hidden': 'true' }));
  try { return await trabajo(); } finally {
    boton.disabled = false;
    boton.removeAttribute('aria-busy');
    boton.replaceChildren(...original);
  }
}

export async function copiar(texto, mensaje = 'Copiado.') {
  try { await navigator.clipboard.writeText(texto); avisar(mensaje); } catch {
    const t = el('textarea', { style: { position: 'fixed', opacity: '0' } }, texto);
    document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); avisar(mensaje);
  }
}

export function desplazarArriba() {
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

/** Reemplaza los hijos de un nodo ignorando los vacíos (replaceChildren escribiría "null"). */
export function poner(nodo, ...hijos) {
  nodo.replaceChildren(...hijos.flat(Infinity).filter((h) => h != null && h !== false));
  return nodo;
}
