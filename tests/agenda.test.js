import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../servidor/agenda.js';

test('fechas y horas', () => {
  assert.equal(A.sumarDias('2026-02-27', 2), '2026-03-01');
  assert.equal(A.diaSemana('2026-11-16'), 1); // lunes
  assert.equal(A.hora(570), '09:30');
  assert.equal(A.leerHora('9:30'), 570);
  assert.equal(A.leerHora('18'), 1080);
  assert.equal(A.leerHora('25:00'), null);
  assert.ok(A.esFecha('2026-02-28')); assert.ok(!A.esFecha('2026-02-30'));
  assert.equal(A.diasDelMes('2028-02').length, 29);
  assert.deepEqual(A.ahoraEn('America/Argentina/Buenos_Aires', Date.UTC(2026, 10, 16, 2, 30)), { fecha: '2026-11-15', minutos: 23 * 60 + 30 });
  assert.equal(A.inicioDeSemana('2026-11-22'), '2026-11-16');
});

test('franjas con horario partido y excepciones', () => {
  const horarios = [{ dia: 1, desde: 540, hasta: 780 }, { dia: 1, desde: 840, hasta: 1140 }, { dia: 1, desde: 770, hasta: 800 }];
  assert.deepEqual(A.franjasDelDia('2026-11-16', horarios), [{ desde: 540, hasta: 800 }, { desde: 840, hasta: 1140 }]);
  assert.deepEqual(A.franjasDelDia('2026-11-16', horarios, [{ fecha: '2026-11-16', tipo: 'cerrado' }]), []);
  assert.deepEqual(A.franjasDelDia('2026-11-16', horarios, [{ fecha: '2026-11-16', tipo: 'cerrado', desde: 600, hasta: 660 }]),
    [{ desde: 540, hasta: 600 }, { desde: 660, hasta: 800 }, { desde: 840, hasta: 1140 }]);
  assert.deepEqual(A.franjasDelDia('2026-11-17', horarios, [{ fecha: '2026-11-17', tipo: 'abierto', desde: 600, hasta: 720 }]), [{ desde: 600, hasta: 720 }]);
});

test('horarios libres respetan turnos, margen, duración y cierre', () => {
  const franjas = [{ desde: 540, hasta: 720 }]; // 9 a 12
  const libres = A.horariosLibres({ fecha: '2026-11-20', franjas, duracion: 60, margen: 0, paso: 30, ocupados: [{ inicio: 600, fin: 660, margen: 0 }] });
  assert.deepEqual(libres.map(A.hora), ['09:00', '11:00']);
  const conMargen = A.horariosLibres({ fecha: '2026-11-20', franjas, duracion: 45, margen: 15, paso: 15, ocupados: [{ inicio: 600, fin: 645, margen: 15 }] });
  assert.deepEqual(conMargen.map(A.hora), ['09:00', '11:00', '11:15']);
});

test('anticipación mínima y máxima', () => {
  const franjas = [{ desde: 540, hasta: 720 }];
  const ahora = { fecha: '2026-11-20', minutos: 590 }; // 9:50
  const hoy = A.horariosLibres({ fecha: '2026-11-20', franjas, duracion: 30, paso: 30, ahora, politica: { anticipacionMinHoras: 1 } });
  assert.deepEqual(hoy.map(A.hora), ['11:00', '11:30']);
  assert.deepEqual(A.horariosLibres({ fecha: '2026-11-19', franjas, duracion: 30, ahora }), []);
  assert.deepEqual(A.horariosLibres({ fecha: '2027-03-01', franjas, duracion: 30, ahora, politica: { anticipacionMaxDias: 30 } }), []);
});

test('disponibilidad del mes', () => {
  const horarios = [{ dia: 1, desde: 540, hasta: 600 }];
  const meses = A.disponibilidadDelMes({ mes: '2026-11', horarios, excepciones: [], ocupadosPorFecha: { '2026-11-23': [{ inicio: 540, fin: 600 }] }, duracion: 60, paso: 30, ahora: { fecha: '2026-11-16', minutos: 0 }, politica: {} });
  const ver = (f) => meses.find((d) => d.fecha === f).estado;
  assert.equal(ver('2026-11-16'), 'libre');
  assert.equal(ver('2026-11-23'), 'completo');
  assert.equal(ver('2026-11-17'), 'cerrado');
  assert.equal(ver('2026-11-09'), 'cerrado'); // pasado
});

test('políticas de cancelación y seña', () => {
  const t = { estado: 'confirmado', fecha: '2026-11-20', inicio: 600 };
  assert.ok(A.puedeModificar(t, { fecha: '2026-11-19', minutos: 600 }, 24));
  assert.ok(!A.puedeModificar(t, { fecha: '2026-11-19', minutos: 601 }, 24));
  assert.ok(!A.puedeModificar({ ...t, estado: 'cancelado' }, { fecha: '2026-11-01', minutos: 0 }, 24));
  assert.ok(A.senaVencida({ estado: 'pendiente_sena', creado: 0 }, 13 * 3600000, 12));
});

test('slugs y teléfonos', () => {
  assert.equal(A.normalizarSlug('Estudio Lúmen — Peluquería!'), 'estudio-lumen-peluqueria');
  assert.ok(A.slugValido('estudio-lumen'));
  assert.ok(!A.slugValido('api')); assert.ok(!A.slugValido('a')); assert.ok(!A.slugValido('-x-'));
  assert.equal(A.telefonoWhatsApp('11 2345-6789'), '5491123456789');
  assert.equal(A.telefonoWhatsApp('+54 9 351 555-1234'), '5493515551234');
  assert.equal(A.telefonoWhatsApp('0351 15 555-1234'), '5493515551234');
  assert.equal(A.telefonoWhatsApp('011 15 2345 6789'), '5491123456789');
  assert.equal(A.telefonoWhatsApp('123'), '');
});

test('estadísticas', () => {
  const turnos = [
    { fecha: '2026-11-16', inicio: 600, estado: 'asistio', precio: 1000, servicio_id: 1, cliente_id: 1 },
    { fecha: '2026-11-17', inicio: 610, estado: 'asistio', precio: 2000, servicio_id: 2, cliente_id: 1 },
    { fecha: '2026-11-18', inicio: 900, estado: 'ausente', precio: 1000, servicio_id: 1, cliente_id: 2 },
    { fecha: '2026-11-24', inicio: 900, estado: 'cancelado', precio: 1000, servicio_id: 1, cliente_id: 3 },
  ];
  const e = A.estadisticas(turnos, { desde: '2026-11-16', hasta: '2026-11-30', servicios: [{ id: 1, nombre: 'Corte' }, { id: 2, nombre: 'Color' }] });
  assert.equal(e.ingresos, 3000);
  assert.equal(Math.round(e.ausentismo * 100), 33);
  assert.equal(e.cancelacion, 0.25);
  assert.equal(e.recurrencia, 1);
  assert.deepEqual(e.porServicio.map((x) => [x.servicio, x.turnos, x.ingresos]), [['Corte', 2, 1000], ['Color', 1, 2000]]);
  assert.equal(e.calor[1][10], 1);
  assert.equal(e.semanas.length, 3);
  assert.equal(e.semanas[0].asistidos, 2);
});
