// Estadísticas: cifras con comparación, evolución semanal, servicios y horarios más pedidos.
import { el, api, poner, pesos, porcentaje, plural, fechaCorta, DIAS_CORTOS } from '../comun.js';

const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, atributos = {}, ...hijos) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(atributos)) if (v != null) n.setAttribute(k, v);
  n.append(...hijos.filter(Boolean));
  return n;
};

export async function vistaEstadisticas(raiz, { params }) {
  let dias = Number(params.get('dias')) || 90;
  const zona = el('div');
  const periodos = el('div', { class: 'periodos', role: 'group', 'aria-label': 'Período' }, [[30, '30 días'], [90, '3 meses'], [365, '12 meses']].map(([n, t]) => el('button', {
    type: 'button', 'aria-pressed': String(n === dias), onclick: () => { dias = n; history.replaceState(null, '', `/panel/estadisticas?dias=${n}`); cargar(); },
  }, t)));
  poner(raiz,
    el('header', { class: 'cabecera' },
      el('div', {}, el('h1', {}, 'Estadísticas'), el('p', { class: 'cabecera__bajada', id: 'rango' }, '')),
      periodos),
    zona);

  async function cargar() {
    for (const b of periodos.children) b.setAttribute('aria-pressed', String(b.textContent === { 30: '30 días', 90: '3 meses', 365: '12 meses' }[dias]));
    const d = await api(`/api/estadisticas?dias=${dias}`);
    const e = d.actual;
    raiz.querySelector('#rango').textContent = `Del ${fechaCorta(d.desde)} al ${fechaCorta(d.hasta)}, comparado con el período anterior.`;
    if (!e.total) {
      poner(zona, el('section', { class: 'bloque' }, el('div', { class: 'vacio', style: { padding: '2rem 1.5rem' } }, el('h2', {}, 'Todavía no hay datos'), el('p', {}, 'Cuando tengas turnos, vas a ver acá cuánto trabajaste, cuánto cobraste y quiénes faltan.'))));
      return;
    }
    poner(zona,
      el('section', { class: 'kpis', 'aria-label': 'Resumen' },
        kpi('Cobrado', pesos(e.ingresos), cambio(e.ingresos, d.anterior.ingresos)),
        kpi('Turnos atendidos', String(e.asistidos), cambio(e.asistidos, d.anterior.asistidos)),
        kpi('Ausentismo', porcentaje(e.ausentismo), cambio(e.ausentismo, d.anterior.ausentismo, { invertido: true, puntos: true }), `${plural(e.ausentes, 'persona faltó', 'personas faltaron')} sin avisar`),
        kpi('Clientes', String(e.clientes), cambio(e.clientes, d.anterior.clientes), `${porcentaje(e.recurrencia)} volvió más de una vez`)),
      el('div', { class: 'graficos' },
        el('section', { class: 'bloque', 'aria-labelledby': 't-semanas' },
          el('div', { class: 'bloque__cabecera' }, el('div', {}, el('h2', { id: 't-semanas' }, 'Cobrado por semana'), el('p', {}, `Ticket promedio ${pesos(e.ticketPromedio)}. ${porcentaje(e.online)} de los turnos se reservaron online.`))),
          el('div', { class: 'bloque__cuerpo' }, graficoSemanas(e.semanas))),
        el('section', { class: 'bloque', 'aria-labelledby': 't-servicios' },
          el('div', { class: 'bloque__cabecera' }, el('h2', { id: 't-servicios' }, 'Servicios más pedidos')),
          el('div', { class: 'bloque__cuerpo' }, ranking(e.porServicio))),
        el('section', { class: 'bloque bloque--ancho', 'aria-labelledby': 't-calor' },
          el('div', { class: 'bloque__cabecera' }, el('div', {}, el('h2', { id: 't-calor' }, 'Cuándo te piden turno'), el('p', {}, 'Más oscuro, más turnos. Útil para decidir qué días abrir más o hacer promociones.'))),
          el('div', { class: 'bloque__cuerpo' }, mapaCalor(e.calor)))));
  }
  await cargar();
}

function kpi(etiqueta, valor, variacion, detalle) {
  return el('div', { class: 'kpi' }, el('p', { class: 'kpi__etiqueta' }, etiqueta), el('p', { class: 'kpi__valor' }, valor), variacion, detalle ? el('p', { class: 'kpi__cambio' }, detalle) : null);
}

function cambio(actual, anterior, { invertido = false, puntos = false } = {}) {
  if (!anterior) return el('p', { class: 'kpi__cambio' }, 'Sin datos del período anterior');
  const dif = puntos ? (actual - anterior) * 100 : ((actual - anterior) / anterior) * 100;
  if (Math.abs(dif) < 0.5) return el('p', { class: 'kpi__cambio' }, 'Igual que el período anterior');
  const sube = dif > 0;
  const bien = invertido ? !sube : sube;
  return el('p', { class: `kpi__cambio kpi__cambio--${bien ? 'bien' : 'mal'}` },
    `${sube ? '▲' : '▼'} ${Math.abs(Math.round(dif))}${puntos ? ' puntos' : '%'} vs. período anterior`);
}

/** Barras verticales de una sola serie, con detalle al pasar el mouse o con el teclado, y tabla equivalente. */
function graficoSemanas(semanas) {
  const ancho = 640, alto = 220, izq = 52, abajo = 26, arriba = 8;
  const max = Math.max(...semanas.map((x) => x.ingresos), 1);
  const paso = topeLindo(max);
  const escalaY = (v) => arriba + (alto - arriba - abajo) * (1 - v / paso.tope);
  const banda = (ancho - izq) / semanas.length;
  const grosor = Math.min(24, banda * 0.6);
  const globo = el('div', { class: 'globo', hidden: true, role: 'status' });
  const contenedor = el('div', { class: 'grafico' });
  const svg = s('svg', { viewBox: `0 0 ${ancho} ${alto}`, role: 'img', 'aria-label': `Cobrado por semana: máximo ${pesos(max)}` });
  for (let v = 0; v <= paso.tope; v += paso.salto) {
    const y = escalaY(v);
    svg.append(s('line', { class: 'grilla', x1: izq, x2: ancho, y1: y, y2: y }), s('text', { class: 'eje', x: izq - 8, y: y + 4, 'text-anchor': 'end' }, document.createTextNode(abreviar(v))));
  }
  const cadaCuanto = Math.ceil(semanas.length / 8);
  semanas.forEach((w, i) => {
    const x = izq + banda * i + (banda - grosor) / 2;
    const y = escalaY(w.ingresos);
    const h = Math.max(alto - abajo - y, w.ingresos ? 2 : 0);
    const r = Math.min(4, grosor / 2, h);
    // Barra con las puntas superiores redondeadas y apoyada en la base.
    const camino = h ? `M${x},${alto - abajo} V${y + r} Q${x},${y} ${x + r},${y} H${x + grosor - r} Q${x + grosor},${y} ${x + grosor},${y + r} V${alto - abajo} Z` : '';
    const grupo = s('g', { class: 'barra-grupo', tabindex: '0', role: 'img', 'aria-label': `Semana del ${fechaCorta(w.semana)}: ${pesos(w.ingresos)}, ${w.asistidos} atendidos, ${w.ausentes} ausentes` },
      s('rect', { class: 'barra-objetivo', x: izq + banda * i, y: arriba, width: banda, height: alto - abajo - arriba }),
      camino ? s('path', { class: 'barra', d: camino }) : null);
    const mostrar = () => {
      poner(globo, el('strong', {}, `Semana del ${fechaCorta(w.semana)}`), el('span', {}, `${pesos(w.ingresos)} cobrado`), el('br'), el('span', {}, `${w.asistidos} atendidos, ${w.ausentes} ausentes`));
      globo.hidden = false;
      const caja = contenedor.getBoundingClientRect();
      const factor = caja.width / ancho;
      globo.style.left = `${(x + grosor / 2) * factor}px`;
      globo.style.top = `${Math.min(y, alto - abajo - 10) * factor}px`;
    };
    grupo.addEventListener('mouseenter', mostrar);
    grupo.addEventListener('focus', mostrar);
    grupo.addEventListener('mouseleave', () => { globo.hidden = true; });
    grupo.addEventListener('blur', () => { globo.hidden = true; });
    svg.append(grupo);
    if (i % cadaCuanto === 0) svg.append(s('text', { class: 'eje', x: izq + banda * i + banda / 2, y: alto - 6, 'text-anchor': 'middle' }, document.createTextNode(fechaCorta(w.semana))));
  });
  contenedor.append(svg, globo);
  return el('div', {}, contenedor, tablaEquivalente(['Semana', 'Cobrado', 'Atendidos', 'Ausentes'], semanas.map((w) => [`Semana del ${fechaCorta(w.semana)}`, pesos(w.ingresos), w.asistidos, w.ausentes])));
}

function ranking(lista) {
  const max = Math.max(...lista.map((x) => x.turnos), 1);
  return el('ol', { class: 'ranking' }, lista.slice(0, 6).map((x) => el('li', {},
    el('div', { class: 'ranking__fila' }, el('span', {}, x.servicio), el('span', {}, `${x.turnos} turnos${x.ingresos ? `, ${pesos(x.ingresos)}` : ''}`)),
    el('div', { class: 'ranking__barra', 'aria-hidden': 'true' }, el('i', { style: { '--ancho': `${(x.turnos / max) * 100}%` } })))));
}

function mapaCalor(calor) {
  const filas = [1, 2, 3, 4, 5, 6, 0].filter((d) => calor[d].some(Boolean));
  const horas = [];
  for (let h = 0; h < 24; h++) if (filas.some((d) => calor[d][h])) horas.push(h);
  if (!horas.length) return el('p', { class: 'bloque__vacio' }, 'Sin datos.');
  const desde = horas[0], hasta = horas[horas.length - 1];
  const rango = Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);
  const max = Math.max(...filas.flatMap((d) => calor[d]), 1);
  const globo = el('div', { class: 'globo', hidden: true });
  const grilla = el('div', { class: 'calor', style: { '--columnas': String(rango.length) }, role: 'img', 'aria-label': 'Turnos por día de la semana y hora (detalle en la tabla de abajo)' },
    el('span'), rango.map((h) => el('span', { class: 'calor__hora' }, h % 2 === 0 ? `${h}h` : '')),
    filas.flatMap((d) => [el('span', { class: 'calor__etiqueta' }, DIAS_CORTOS[d]), rango.map((h) => {
      const n = calor[d][h];
      const celda = el('span', { class: 'calor__celda', style: { '--intensidad': `${n ? Math.round(12 + (n / max) * 88) : 0}%` } });
      celda.addEventListener('mouseenter', () => {
        poner(globo, el('strong', {}, `${DIAS_CORTOS[d]} ${h}:00 a ${h + 1}:00`), el('span', {}, plural(n, 'turno', 'turnos')));
        globo.hidden = false;
        const c = grilla.getBoundingClientRect(); const r = celda.getBoundingClientRect();
        globo.style.left = `${r.left - c.left + r.width / 2}px`;
        globo.style.top = `${r.top - c.top}px`;
      });
      celda.addEventListener('mouseleave', () => { globo.hidden = true; });
      return celda;
    })]));
  return el('div', {}, el('div', { class: 'grafico' }, grilla, globo),
    tablaEquivalente(['Día', ...rango.map((h) => `${h} h`)], filas.map((d) => [DIAS_CORTOS[d], ...rango.map((h) => calor[d][h])])));
}

function tablaEquivalente(columnas, filas) {
  return el('details', { class: 'ver-tabla' }, el('summary', {}, 'Ver como tabla'),
    el('div', { style: { overflow: 'auto' } }, el('table', { class: 'tabla' },
      el('thead', {}, el('tr', {}, columnas.map((c) => el('th', { scope: 'col' }, c)))),
      el('tbody', {}, filas.map((f) => el('tr', {}, f.map((v, i) => (i === 0 ? el('th', { scope: 'row' }, String(v)) : el('td', { class: 'num' }, String(v))))))))));
}

function topeLindo(max) {
  const magnitud = 10 ** Math.floor(Math.log10(max));
  const salto = [1, 2, 2.5, 5, 10].map((x) => x * magnitud).find((x) => max / x <= 4) || magnitud * 10;
  return { tope: Math.ceil(max / salto) * salto, salto };
}

function abreviar(v) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0).replace('.', ',')} M`;
  if (v >= 1000) return `$${Math.round(v / 1000)} mil`;
  return `$${v}`;
}
