// Servicios: alta, edición, orden, pausa y borrado.
import { el, icono, api, avisar, poner, dialogo, confirmar, campo, entrada, valores, pesos, duracion } from '../comun.js';
import { sesion, recargarSesion } from './app.js';

const SUGERENCIAS = [
  { nombre: 'Consulta', duracion: 30 }, { nombre: 'Sesión', duracion: 50 }, { nombre: 'Corte', duracion: 45 }, { nombre: 'Clase', duracion: 60 },
];

export async function vistaServicios(raiz) {
  const { servicios } = await api('/api/servicios');
  const recargar = async () => { await recargarSesion(); vistaServicios(raiz); };

  const mover = async (i, delta) => {
    const ids = servicios.map((s) => s.id);
    [ids[i], ids[i + delta]] = [ids[i + delta], ids[i]];
    await api('/api/servicios/orden', { metodo: 'POST', cuerpo: { ids } });
    vistaServicios(raiz);
  };

  poner(raiz,
    el('header', { class: 'cabecera' },
      el('div', {}, el('h1', {}, 'Servicios'), el('p', { class: 'cabecera__bajada' }, 'Lo que tus clientes pueden reservar, en este orden.')),
      el('button', { type: 'button', class: 'boton boton--primario', onclick: () => editar(null, recargar) }, icono('mas', { tamano: 18 }), 'Agregar servicio')),
    servicios.length
      ? el('section', { class: 'bloque' }, el('ul', { class: 'lista-servicios' }, servicios.map((s, i) => el('li', { class: `fila-servicio ${s.activo ? '' : 'fila-servicio--pausado'}` },
        el('div', { class: 'fila-servicio__orden' },
          el('button', { type: 'button', 'aria-label': `Subir ${s.nombre}`, disabled: i === 0, onclick: () => mover(i, -1) }, icono('arriba', { tamano: 16 })),
          el('button', { type: 'button', 'aria-label': `Bajar ${s.nombre}`, disabled: i === servicios.length - 1, onclick: () => mover(i, 1) }, icono('abajo', { tamano: 16 }))),
        el('div', {},
          el('p', { class: 'fila-servicio__nombre' }, s.nombre, s.activo ? null : el('span', { class: 'estado estado--cancelado', style: { 'margin-left': '0.5rem' } }, 'Pausado')),
          el('p', { class: 'fila-servicio__datos' },
            el('span', {}, duracion(s.duracion)),
            s.margen ? el('span', {}, `+${s.margen} min de descanso`) : null,
            s.sena ? el('span', {}, `Seña ${pesos(s.sena)}`) : null)),
        el('p', { class: 'fila-servicio__precio' }, s.precio ? pesos(s.precio) : 'Sin precio'),
        el('button', { type: 'button', class: 'boton boton--secundario boton--chico', onclick: () => editar(s, recargar) }, 'Editar')))))
      : el('section', { class: 'bloque' }, el('div', { class: 'vacio', style: { padding: '2rem 1.5rem' } },
        el('h2', {}, 'Cargá tu primer servicio'),
        el('p', {}, 'Por ejemplo: "Corte, 45 minutos, $18.000". Después podés agregar todos los que quieras.'),
        el('div', { class: 'grupo-acciones__fila' }, SUGERENCIAS.map((x) => el('button', { type: 'button', class: 'boton boton--secundario boton--chico', onclick: () => editar({ ...x, id: null }, recargar) }, `${x.nombre}, ${x.duracion} min`))))),
    !sesion.negocio.sena_alias && !sesion.negocio.mp_configurado && servicios.some((s) => s.sena)
      ? el('p', { class: 'caja-error', style: { 'margin-top': '1rem' } }, 'Tenés servicios con seña, pero todavía no cargaste un alias para cobrarla. Hasta que lo hagas, esos turnos se confirman sin seña. ', el('a', { href: '/panel/ajustes', 'data-nav': '' }, 'Configurar la seña'))
      : null);
}

async function editar(s, alGuardar) {
  const nuevo = !s?.id;
  const f = el('div', { class: 'formulario' },
    campo({ etiqueta: 'Nombre', control: entrada({ name: 'nombre', value: s?.nombre || '', required: true, maxlength: 80, placeholder: 'Corte, Sesión de kinesiología, Clase de inglés…' }) }),
    campo({ etiqueta: 'Descripción', opcional: true, ayuda: 'Se muestra en tu página de reservas.', control: el('textarea', { class: 'entrada', name: 'descripcion', rows: 2, maxlength: 300 }, s?.descripcion || '') }),
    el('div', { class: 'formulario__fila' },
      campo({ etiqueta: 'Duración (minutos)', control: entrada({ name: 'duracion', type: 'number', min: 5, max: 600, step: 5, value: s?.duracion ?? 30, required: true }) }),
      campo({ etiqueta: 'Descanso después', ayuda: 'Para limpiar o preparar. Nadie puede reservar en ese tiempo.', control: entrada({ name: 'margen', type: 'number', min: 0, max: 120, step: 5, value: s?.margen ?? 0 }) })),
    el('div', { class: 'formulario__fila' },
      campo({ etiqueta: 'Precio', opcional: true, control: el('div', { class: 'entrada-con-prefijo' }, el('span', {}, '$'), entrada({ name: 'precio', type: 'number', min: 0, step: 100, value: s?.precio || '', inputmode: 'numeric' })) }),
      campo({ etiqueta: 'Seña para confirmar', opcional: true, ayuda: 'Si es 0, el turno se confirma al reservar.', control: el('div', { class: 'entrada-con-prefijo' }, el('span', {}, '$'), entrada({ name: 'sena', type: 'number', min: 0, step: 100, value: s?.sena || '', inputmode: 'numeric' })) })),
    el('label', { class: 'interruptor' }, el('input', { type: 'checkbox', name: 'activo', checked: s ? s.activo !== 0 : true }), el('span', { class: 'interruptor__pista' }), el('span', {}, 'Disponible para reservar online')));
  const botones = [{ texto: 'Cancelar', valor: false }];
  if (!nuevo) {
    botones.unshift({
      texto: 'Borrar', valor: 'borrado', tipo: 'peligro',
      alHacer: async () => {
        if (!await confirmar(`¿Borrar "${s.nombre}"?`, 'Los turnos que ya tiene se mantienen en el historial.', { texto: 'Borrar', peligro: true })) return false;
        await api(`/api/servicios/${s.id}`, { metodo: 'DELETE' });
        return 'borrado';
      },
    });
  }
  botones.push({
    texto: nuevo ? 'Agregar' : 'Guardar', valor: true, tipo: 'primario', enviar: true,
    alHacer: async () => {
      const v = valores(f);
      const cuerpo = { ...v, precio: v.precio || 0, sena: v.sena || 0, margen: v.margen || 0 };
      await api(nuevo ? '/api/servicios' : `/api/servicios/${s.id}`, { metodo: nuevo ? 'POST' : 'PUT', cuerpo });
      return true;
    },
  });
  const r = await dialogo({ titulo: nuevo ? 'Nuevo servicio' : 'Editar servicio', contenido: f, botones, clase: 'dialogo--ancho' });
  if (r === true) { avisar(nuevo ? 'Servicio agregado.' : 'Cambios guardados.'); alGuardar(); }
  if (r === 'borrado') { avisar('Servicio borrado.'); alGuardar(); }
}
