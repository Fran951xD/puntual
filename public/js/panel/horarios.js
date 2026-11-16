// Horarios: semana tipo (con horario partido) y días especiales (feriados, vacaciones, días extra).
import { el, icono, api, avisar, poner, dialogo, campo, entrada, valores, hora, DIAS, capital, fechaLarga, plural } from '../comun.js';

const ORDEN = [1, 2, 3, 4, 5, 6, 0];
const aMinutos = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };

export async function vistaHorarios(raiz) {
  const d = await api('/api/horarios');
  let semana = Object.fromEntries(ORDEN.map((dia) => [dia, d.horarios.filter((h) => h.dia === dia).map((h) => ({ desde: h.desde, hasta: h.hasta }))]));
  let cambios = false;
  const guardar = el('button', { type: 'button', class: 'boton boton--primario', disabled: true, onclick: grabar }, 'Guardar horarios');
  const contenedorDias = el('div', { class: 'semana-horarios' });

  function marcarCambio() { cambios = true; guardar.disabled = false; }

  function dibujarDias() {
    poner(contenedorDias, ORDEN.map((dia) => {
      const tramos = semana[dia];
      const abierto = tramos.length > 0;
      const interruptor = el('input', { type: 'checkbox', checked: abierto, 'aria-label': `Atiendo los ${DIAS[dia]}` });
      interruptor.addEventListener('change', () => {
        semana[dia] = interruptor.checked ? [{ desde: 540, hasta: 1080 }] : [];
        marcarCambio(); dibujarDias();
      });
      return el('div', { class: 'dia-horario' },
        el('label', { class: 'interruptor dia-horario__nombre' }, interruptor, el('span', { class: 'interruptor__pista' }), el('strong', {}, capital(DIAS[dia]))),
        el('div', { class: 'tramos' },
          abierto ? tramos.map((t, i) => {
            const desde = entrada({ type: 'time', value: hora(t.desde), step: 900, 'aria-label': `${capital(DIAS[dia])}: desde` });
            const hasta = entrada({ type: 'time', value: hora(t.hasta === 1440 ? 1439 : t.hasta), step: 900, 'aria-label': `${capital(DIAS[dia])}: hasta` });
            desde.addEventListener('change', () => { t.desde = aMinutos(desde.value); marcarCambio(); });
            hasta.addEventListener('change', () => { t.hasta = aMinutos(hasta.value); marcarCambio(); });
            return el('div', { class: 'tramo' }, desde, el('span', {}, 'a'), hasta,
              tramos.length > 1 ? el('button', { type: 'button', class: 'boton-icono', 'aria-label': 'Quitar este horario', onclick: () => { tramos.splice(i, 1); marcarCambio(); dibujarDias(); } }, icono('cerrar', { tamano: 18 })) : null,
              i === tramos.length - 1 ? el('button', { type: 'button', class: 'boton boton--texto boton--chico', onclick: () => {
                const ultimo = tramos[tramos.length - 1];
                tramos.push({ desde: Math.min(ultimo.hasta + 60, 1380), hasta: Math.min(ultimo.hasta + 240, 1440) });
                marcarCambio(); dibujarDias();
              } }, icono('mas', { tamano: 16 }), 'Horario partido') : null);
          }) : el('p', { class: 'tramos__cerrado' }, 'No atiendo')));
    }));
  }

  async function grabar() {
    const horarios = ORDEN.flatMap((dia) => semana[dia].map((t) => ({ dia, ...t })));
    try {
      const r = await api('/api/horarios', { metodo: 'PUT', cuerpo: { horarios } });
      semana = Object.fromEntries(ORDEN.map((dia) => [dia, r.horarios.filter((h) => h.dia === dia).map((h) => ({ desde: h.desde, hasta: h.hasta }))]));
      cambios = false; guardar.disabled = true;
      dibujarDias();
      avisar('Horarios guardados. Tu página ya muestra los nuevos.');
    } catch (e) { avisar(e.message, { tipo: 'error' }); }
  }

  const especiales = el('section', { class: 'bloque', 'aria-labelledby': 'titulo-especiales' },
    el('div', { class: 'bloque__cabecera' },
      el('div', {}, el('h2', { id: 'titulo-especiales' }, 'Días especiales'), el('p', {}, 'Feriados, vacaciones o un sábado que abrís de más.')),
      el('button', { type: 'button', class: 'boton boton--secundario boton--chico', onclick: () => agregarEspecial(() => vistaHorarios(raiz)) }, icono('mas', { tamano: 16 }), 'Agregar')),
    d.excepciones.length
      ? el('ul', { class: 'pendientes' }, agrupar(d.excepciones).map((g) => el('li', { class: 'pendiente' },
        el('p', { class: 'pendiente__titulo' }, g.desde === g.hasta ? capital(fechaLarga(g.desde)) : `Del ${fechaLarga(g.desde)} al ${fechaLarga(g.hasta)}`),
        el('p', { class: 'pendiente__detalle' }, g.tipo === 'abierto' ? `Abierto de ${hora(g.inicio)} a ${hora(g.fin)}` : g.inicio != null ? `Cerrado de ${hora(g.inicio)} a ${hora(g.fin)}` : 'Cerrado todo el día', g.motivo ? `: ${g.motivo}` : ''),
        el('button', { type: 'button', class: 'boton-icono', 'aria-label': 'Quitar', onclick: async () => {
          await Promise.all(g.ids.map((id) => api(`/api/excepciones/${id}`, { metodo: 'DELETE' })));
          avisar('Día especial quitado.'); vistaHorarios(raiz);
        } }, icono('basura', { tamano: 18 })))))
      : el('p', { class: 'bloque__vacio' }, 'No tenés días especiales cargados.'));

  poner(raiz,
    el('header', { class: 'cabecera' },
      el('div', {}, el('h1', {}, 'Horarios'), el('p', { class: 'cabecera__bajada' }, 'Tus clientes solo ven horarios libres dentro de estos tramos.'))),
    el('div', { class: 'dos-columnas' },
      el('section', { class: 'bloque', 'aria-label': 'Semana tipo' }, contenedorDias,
        el('div', { class: 'pie-bloque' }, el('p', {}, 'Para un horario cortado (por ejemplo 9 a 13 y 15 a 19), agregá un horario partido.'), guardar)),
      especiales));
  dibujarDias();
  const avisarSalida = (e) => { if (cambios) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', avisarSalida);
  return () => window.removeEventListener('beforeunload', avisarSalida);
}

/** Agrupa días consecutivos con la misma excepción (para mostrar "del 2 al 15 de enero"). */
function agrupar(lista) {
  const grupos = [];
  for (const e of lista) {
    const g = grupos[grupos.length - 1];
    const siguiente = g && new Date(`${g.hasta}T00:00:00Z`).getTime() + 86400000 === new Date(`${e.fecha}T00:00:00Z`).getTime();
    if (g && siguiente && g.tipo === e.tipo && g.inicio === e.desde && g.fin === e.hasta && g.motivo === e.motivo) { g.hasta = e.fecha; g.ids.push(e.id); } else {
      grupos.push({ desde: e.fecha, hasta: e.fecha, tipo: e.tipo, inicio: e.desde, fin: e.hasta, motivo: e.motivo, ids: [e.id] });
    }
  }
  return grupos;
}

async function agregarEspecial(alGuardar) {
  const hoy = new Date().toISOString().slice(0, 10);
  const tipo = el('select', { class: 'entrada', name: 'modo' },
    el('option', { value: 'cerrado-dia' }, 'Cerrado todo el día (feriado, vacaciones)'),
    el('option', { value: 'cerrado-horas' }, 'Cerrado unas horas'),
    el('option', { value: 'abierto' }, 'Abierto en un horario extra'));
  const horas = el('div', { class: 'formulario__fila', hidden: true },
    campo({ etiqueta: 'Desde', control: entrada({ type: 'time', name: 'desde', value: '09:00', step: 900 }) }),
    campo({ etiqueta: 'Hasta', control: entrada({ type: 'time', name: 'hasta', value: '13:00', step: 900 }) }));
  tipo.addEventListener('change', () => { horas.hidden = tipo.value === 'cerrado-dia'; });
  const f = el('div', { class: 'formulario' },
    campo({ etiqueta: 'Tipo', control: tipo }),
    el('div', { class: 'formulario__fila' },
      campo({ etiqueta: 'Desde el día', control: entrada({ type: 'date', name: 'fecha', value: hoy, min: hoy, required: true }) }),
      campo({ etiqueta: 'Hasta el día', opcional: true, ayuda: 'Para vacaciones de varios días.', control: entrada({ type: 'date', name: 'hasta_fecha', min: hoy }) })),
    horas,
    campo({ etiqueta: 'Motivo', opcional: true, ayuda: 'Solo para vos, por ejemplo "Feriado" o "Vacaciones".', control: entrada({ name: 'motivo', maxlength: 80 }) }));
  let afectados = [];
  const ok = await dialogo({
    titulo: 'Agregar día especial', contenido: f,
    botones: [{ texto: 'Cancelar', valor: false }, {
      texto: 'Agregar', valor: true, tipo: 'primario', enviar: true,
      alHacer: async () => {
        const v = valores(f);
        const conHoras = v.modo !== 'cerrado-dia';
        const r = await api('/api/excepciones', { metodo: 'POST', cuerpo: {
          fecha: v.fecha, hasta_fecha: v.hasta_fecha || undefined, motivo: v.motivo,
          tipo: v.modo === 'abierto' ? 'abierto' : 'cerrado',
          desde: conHoras ? aMinutos(v.desde) : undefined, hasta: conHoras ? aMinutos(v.hasta) : undefined,
        } });
        afectados = r.afectados;
        return true;
      },
    }],
  });
  if (!ok) return;
  if (afectados.length) {
    await dialogo({
      titulo: `Hay ${plural(afectados.length, 'turno', 'turnos')} en esos días`,
      descripcion: 'Los turnos ya reservados no se cancelan solos. Revisalos en la agenda y avisale a cada cliente.',
      contenido: el('ul', { class: 'historial-cliente' }, afectados.map((t) => el('li', {}, el('span', {}, `${capital(fechaLarga(t.fecha))}, ${hora(t.inicio)}`), el('strong', {}, t.nombre)))),
      botones: [{ texto: 'Entendido', valor: true, tipo: 'primario' }],
    });
  } else avisar('Día especial agregado.');
  alGuardar();
}
