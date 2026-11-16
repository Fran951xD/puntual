// Cuenta de demostración: una peluquería con dos meses de historia y la agenda de las próximas semanas.
// Cada visita crea su propia copia (se borra sola a las 24 horas).
import * as A from './agenda.js';
import { aleatorio, hashContrasena } from './util.js';

const NOMBRES = ['Lucía Fernández', 'Martín Gómez', 'Sofía Rodríguez', 'Juan Pérez', 'Valentina López', 'Mateo Díaz', 'Camila Martínez', 'Tomás García',
  'Florencia Romero', 'Santiago Sosa', 'Agustina Álvarez', 'Nicolás Torres', 'Julieta Ruiz', 'Facundo Ramírez', 'Micaela Flores', 'Joaquín Acosta',
  'Carolina Benítez', 'Lucas Medina', 'Paula Herrera', 'Ignacio Suárez', 'Rocío Aguirre', 'Federico Pereyra', 'Milagros Gutiérrez', 'Bruno Giménez',
  'Antonella Molina', 'Franco Silva', 'Belén Castro', 'Gonzalo Rojas', 'Delfina Ortiz', 'Ezequiel Núñez', 'Abril Luna', 'Ramiro Cabrera',
  'Victoria Ríos', 'Emiliano Vega', 'Candela Morales', 'Leandro Paz'];

const SERVICIOS = [
  { nombre: 'Corte', descripcion: 'Lavado, corte y peinado.', duracion: 45, margen: 15, precio: 18000, sena: 0 },
  { nombre: 'Corte y barba', descripcion: 'Corte, perfilado y arreglo de barba con navaja.', duracion: 60, margen: 0, precio: 24000, sena: 0 },
  { nombre: 'Color', descripcion: 'Color raíz o global. Incluye lavado y secado.', duracion: 120, margen: 15, precio: 48000, sena: 10000 },
  { nombre: 'Mechas o balayage', descripcion: 'Aclarado con técnica a mano alzada. Consultá por largos extra.', duracion: 180, margen: 15, precio: 85000, sena: 20000 },
  { nombre: 'Peinado para eventos', descripcion: 'Recogidos, ondas o brushing para fiestas.', duracion: 60, margen: 0, precio: 26000, sena: 5000 },
];

/** Generador pseudoaleatorio con semilla: la demo se ve igual cada vez. */
function azar(semilla) {
  let s = semilla >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

export async function crearDemo(bd, ahoraMs = Date.now()) {
  const r = azar(20261116);
  const elegir = (lista) => lista[Math.floor(r() * lista.length)];
  const sufijo = aleatorio(6).toLowerCase().replace(/[^a-z0-9]/g, 'x');
  const usuario = await bd.ejecutar('INSERT INTO usuarios (email, hash, nombre, demo, creado) VALUES (?, ?, ?, 1, ?)',
    `demo-${sufijo}@puntual.demo`, await hashContrasena(aleatorio(24), undefined, 1000), 'Carla Benedetti', ahoraMs);
  const negocio = await bd.ejecutar(`INSERT INTO negocios (usuario_id, slug, nombre, rubro, descripcion, direccion, whatsapp, email_contacto, color, paso,
      anticipacion_min_horas, anticipacion_max_dias, cancelacion_horas, sena_alias, sena_titular, sena_plazo_horas, mensaje, creado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    usuario.id, `demo-${sufijo}`, 'Estudio Lumen', 'Peluquería', 'Cortes, color y peinados en Palermo. Atendemos con turno para que no esperes.',
    'Gorriti 4820, Palermo, CABA', '11 2345-6789', '', 'pino', 15, 2, 45, 12, 'estudio.lumen.mp', 'Carla Benedetti', 12,
    'Llegá 5 minutos antes. Si venís a color, traé una foto de referencia.', ahoraMs);
  const nid = negocio.id;

  // Lunes 14 a 19, martes a viernes 10 a 19, sábado 9 a 14.
  const horarios = [[1, 840, 1140], [2, 600, 1140], [3, 600, 1140], [4, 600, 1140], [5, 600, 1140], [6, 540, 840]];
  const sentencias = horarios.map(([dia, desde, hasta]) => ['INSERT INTO horarios (negocio_id, dia, desde, hasta) VALUES (?, ?, ?, ?)', nid, dia, desde, hasta]);
  const servicios = [];
  for (const [i, s] of SERVICIOS.entries()) {
    const fila = await bd.ejecutar('INSERT INTO servicios (negocio_id, nombre, descripcion, duracion, margen, precio, sena, orden) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      nid, s.nombre, s.descripcion, s.duracion, s.margen, s.precio, s.sena, i + 1);
    servicios.push({ ...s, id: fila.id });
  }
  const clientes = [];
  for (const [i, nombre] of NOMBRES.entries()) {
    const tel = `54911${String(40000000 + Math.floor(r() * 59999999)).slice(0, 8)}`;
    const email = i % 3 === 0 ? `${nombre.split(' ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}@ejemplo.com` : '';
    const fila = await bd.ejecutar('INSERT INTO clientes (negocio_id, nombre, telefono, email, notas, creado) VALUES (?, ?, ?, ?, ?, ?)',
      nid, nombre, tel, email, i === 0 ? 'Prefiere la tarde. Alergia a la amoníaco: usar color sin amoníaco.' : '', ahoraMs - 200 * 86400000);
    clientes.push({ id: fila.id, nombre, tel, frecuencia: 0.3 + r() });
  }

  const hoy = A.ahoraEn(undefined, ahoraMs);
  let feriado = A.sumarDias(hoy.fecha, 3);
  while (A.diaSemana(feriado) !== 4) feriado = A.sumarDias(feriado, 1); // el próximo jueves (desde dentro de 3 días)
  sentencias.push(['INSERT INTO excepciones (negocio_id, fecha, tipo, motivo) VALUES (?, ?, ?, ?)', nid, feriado, 'cerrado', 'Feriado']);

  const pesos = [0.38, 0.22, 0.2, 0.08, 0.12]; // cuánto se pide cada servicio
  const elegirServicio = () => { let x = r(); for (const [i, p] of pesos.entries()) { if ((x -= p) <= 0) return servicios[i]; } return servicios[0]; };

  let n = 0;
  for (let d = -190; d <= 16; d++) {
    const fecha = A.sumarDias(hoy.fecha, d);
    if (fecha === feriado) continue;
    const franjas = A.franjasDelDia(fecha, horarios.map(([dia, desde, hasta]) => ({ dia, desde, hasta })));
    if (!franjas.length) continue;
    const ocupados = [];
    // Más turnos los viernes y sábados, menos en el futuro lejano.
    // Crece de a poco en los últimos meses (el negocio va tomando clientes).
    const crecimiento = d < -120 ? 0.7 : d < -60 ? 0.85 : 1;
    const intensidad = ([5, 6].includes(A.diaSemana(fecha)) ? 0.85 : 0.65) * crecimiento * (d > 9 ? 0.5 : d > 0 ? 0.95 : 1);
    for (const f of franjas) {
      for (let inicio = f.desde; inicio < f.hasta; inicio += 15) {
        if (r() > intensidad * 0.28) continue;
        const s = elegirServicio();
        if (inicio + s.duracion > f.hasta || ocupados.some((o) => A.seSuperponen(inicio, inicio + s.duracion + s.margen, o.inicio, o.fin + o.margen))) continue;
        ocupados.push({ inicio, fin: inicio + s.duracion, margen: s.margen });
        const cli = elegir(clientes.filter((x) => x.frecuencia > r() * 1.2)) || elegir(clientes);
        let estado;
        if (d < 0 || (d === 0 && inicio + s.duracion < hoy.minutos)) {
          const x = r();
          estado = x < 0.08 ? 'ausente' : x < 0.15 ? 'cancelado' : 'asistio';
        } else {
          estado = s.sena && r() < 0.35 && d > 0 ? 'pendiente_sena' : r() < 0.06 ? 'cancelado' : 'confirmado';
        }
        const creado = ahoraMs + (d - 3 - Math.floor(r() * 10)) * 86400000;
        sentencias.push([`INSERT INTO turnos (negocio_id, servicio_id, cliente_id, fecha, inicio, fin, margen, estado, precio, sena, token, origen, nota_cliente, recordado, creado, actualizado)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        nid, s.id, cli.id, fecha, inicio, inicio + s.duracion, s.margen, estado, s.precio, estado === 'pendiente_sena' ? s.sena : 0, aleatorio(18),
        r() < 0.72 ? 'web' : 'panel', r() < 0.1 ? elegir(['Es mi primera vez.', 'Quiero algo más corto que la última vez.', 'Voy con mi hija.']) : '',
        0, estado === 'pendiente_sena' ? ahoraMs - Math.floor(r() * 6) * 3600000 : creado, creado]);
        n++;
      }
    }
  }

  // Lista de espera para el próximo sábado.
  const sabado = A.sumarDias(hoy.fecha, ((6 - A.diaSemana(hoy.fecha)) + 7) % 7 || 7);
  for (const cli of clientes.slice(30, 33)) {
    sentencias.push(['INSERT INTO espera (negocio_id, servicio_id, fecha, nombre, telefono, creado) VALUES (?, ?, ?, ?, ?, ?)', nid, servicios[0].id, sabado, cli.nombre, cli.tel, ahoraMs - 3600000]);
  }
  for (let i = 0; i < sentencias.length; i += 80) await bd.lote(sentencias.slice(i, i + 80));
  return { usuarioId: usuario.id, negocioId: nid, turnos: n };
}
