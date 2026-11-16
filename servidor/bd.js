// Acceso a datos: una interfaz chica sobre D1 (Cloudflare) o node:sqlite (desarrollo y pruebas).

export const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    hash TEXT NOT NULL,
    nombre TEXT NOT NULL,
    demo INTEGER NOT NULL DEFAULT 0,
    creado INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sesiones (
    id TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira INTEGER NOT NULL,
    creado INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS negocios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
    slug TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    rubro TEXT NOT NULL DEFAULT '',
    descripcion TEXT NOT NULL DEFAULT '',
    direccion TEXT NOT NULL DEFAULT '',
    whatsapp TEXT NOT NULL DEFAULT '',
    email_contacto TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT 'pino',
    zona TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    paso INTEGER NOT NULL DEFAULT 30,
    anticipacion_min_horas INTEGER NOT NULL DEFAULT 2,
    anticipacion_max_dias INTEGER NOT NULL DEFAULT 45,
    cancelacion_horas INTEGER NOT NULL DEFAULT 12,
    sena_alias TEXT NOT NULL DEFAULT '',
    sena_titular TEXT NOT NULL DEFAULT '',
    sena_plazo_horas INTEGER NOT NULL DEFAULT 12,
    mp_token TEXT NOT NULL DEFAULT '',
    mensaje TEXT NOT NULL DEFAULT '',
    activo INTEGER NOT NULL DEFAULT 1,
    creado INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS servicios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    descripcion TEXT NOT NULL DEFAULT '',
    duracion INTEGER NOT NULL,
    margen INTEGER NOT NULL DEFAULT 0,
    precio INTEGER NOT NULL DEFAULT 0,
    sena INTEGER NOT NULL DEFAULT 0,
    activo INTEGER NOT NULL DEFAULT 1,
    orden INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS horarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    dia INTEGER NOT NULL,
    desde INTEGER NOT NULL,
    hasta INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS excepciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    fecha TEXT NOT NULL,
    tipo TEXT NOT NULL,
    desde INTEGER,
    hasta INTEGER,
    motivo TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    telefono TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    notas TEXT NOT NULL DEFAULT '',
    creado INTEGER NOT NULL,
    UNIQUE (negocio_id, telefono)
  )`,
  `CREATE TABLE IF NOT EXISTS turnos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    servicio_id INTEGER NOT NULL,
    cliente_id INTEGER NOT NULL,
    fecha TEXT NOT NULL,
    inicio INTEGER NOT NULL,
    fin INTEGER NOT NULL,
    margen INTEGER NOT NULL DEFAULT 0,
    estado TEXT NOT NULL,
    precio INTEGER NOT NULL DEFAULT 0,
    sena INTEGER NOT NULL DEFAULT 0,
    token TEXT NOT NULL UNIQUE,
    origen TEXT NOT NULL DEFAULT 'web',
    nota_cliente TEXT NOT NULL DEFAULT '',
    nota_interna TEXT NOT NULL DEFAULT '',
    recordado INTEGER NOT NULL DEFAULT 0,
    mp_pago TEXT NOT NULL DEFAULT '',
    creado INTEGER NOT NULL,
    actualizado INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS turnos_agenda ON turnos (negocio_id, fecha, estado)',
  'CREATE INDEX IF NOT EXISTS turnos_cliente ON turnos (cliente_id)',
  `CREATE TABLE IF NOT EXISTS espera (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    servicio_id INTEGER NOT NULL,
    fecha TEXT NOT NULL,
    nombre TEXT NOT NULL,
    telefono TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    avisado INTEGER NOT NULL DEFAULT 0,
    creado INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS espera_fecha ON espera (negocio_id, fecha)',
  `CREATE TABLE IF NOT EXISTS limites (
    clave TEXT PRIMARY KEY,
    ventana INTEGER NOT NULL,
    cuenta INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sistema (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  )`,
];

/** Envuelve una base con interfaz D1 (prepare/bind/all/first/run/batch). */
export function crearBD(d1) {
  const preparar = (sql, params) => d1.prepare(sql).bind(...params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p)));
  return {
    async todos(sql, ...params) { return (await preparar(sql, params).all()).results || []; },
    async uno(sql, ...params) { return (await preparar(sql, params).first()) ?? null; },
    async ejecutar(sql, ...params) {
      const r = await preparar(sql, params).run();
      return { cambios: r.meta?.changes ?? 0, id: r.meta?.last_row_id ?? null };
    },
    /** Varias sentencias juntas: se aplican todas o ninguna. */
    async lote(sentencias) {
      const r = await d1.batch(sentencias.map(([sql, ...params]) => preparar(sql, params)));
      return r.map((x) => ({ cambios: x.meta?.changes ?? 0, id: x.meta?.last_row_id ?? null }));
    },
    async migrar() {
      for (const sql of ESQUEMA) await d1.prepare(sql).run();
    },
  };
}

/** Adaptador de node:sqlite con la misma forma que D1 (solo para Node). */
export function d1DesdeSqlite(db) {
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const sentencia = (sql, params = []) => ({
    sql,
    params,
    bind: (...p) => sentencia(sql, p),
    all: async () => ({ results: db.prepare(sql).all(...params).map((f) => ({ ...f })) }),
    first: async () => { const f = db.prepare(sql).get(...params); return f ? { ...f } : null; },
    run: async () => { const r = db.prepare(sql).run(...params); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return {
    prepare: (sql) => sentencia(sql),
    async batch(lista) {
      db.exec('BEGIN');
      try {
        const salida = lista.map((s) => { const r = db.prepare(s.sql).run(...s.params); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; });
        db.exec('COMMIT');
        return salida;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
