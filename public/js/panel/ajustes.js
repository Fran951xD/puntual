// Ajustes: perfil del negocio y link, reglas de reserva, seña, cuenta.
import { el, icono, api, avisar, poner, dialogo, confirmar, campo, entrada, valores, conCarga, mostrarErrorEn, copiar } from '../comun.js';
import { sesion, recargarSesion } from './app.js';

const COLORES = [['pino', '#0b5d57', 'Pino'], ['oceano', '#1f5ea6', 'Océano'], ['ciruela', '#7a3a69', 'Ciruela'], ['arcilla', '#9a4529', 'Ladrillo'], ['lima', '#44700f', 'Lima'], ['grafito', '#353b38', 'Grafito']];

export async function vistaAjustes(raiz) {
  const { negocio: n } = await api('/api/negocio');
  const f = el('form', { class: 'ajustes', novalidate: true });
  const estadoSlug = el('p', { class: 'estado-slug', 'aria-live': 'polite' });
  const slug = entrada({ name: 'slug', value: n.slug, required: true, maxlength: 40, autocomplete: 'off', spellcheck: 'false' });
  let espera;
  slug.addEventListener('input', () => {
    clearTimeout(espera);
    espera = setTimeout(async () => {
      const r = await api(`/api/slug?valor=${encodeURIComponent(slug.value)}`).catch(() => null);
      if (!r) return;
      if (r.valor !== slug.value) slug.value = r.valor;
      estadoSlug.className = `estado-slug estado-slug--${r.libre ? 'ok' : 'mal'}`;
      estadoSlug.textContent = r.libre ? `Disponible: ${location.host}/${r.valor}` : 'Ese link no está disponible.';
    }, 300);
  });

  const seccion = (titulo, bajada, ...hijos) => el('section', { class: 'bloque' },
    el('div', { class: 'bloque__cabecera' }, el('div', {}, el('h2', {}, titulo), bajada ? el('p', {}, bajada) : null)),
    el('div', { class: 'bloque__cuerpo formulario' }, ...hijos));

  const numero = (name, valor, min, max, sufijo) => el('div', { class: 'entrada-con-prefijo' }, entrada({ name, type: 'number', value: valor, min, max, required: true, inputmode: 'numeric' }), el('span', {}, sufijo));

  poner(f,
    seccion('Tu página de turnos', 'Lo que ven tus clientes al entrar a tu link.',
      el('div', { class: 'formulario__fila' },
        campo({ etiqueta: 'Nombre del negocio', control: entrada({ name: 'nombre', value: n.nombre, required: true, maxlength: 80 }) }),
        campo({ etiqueta: 'Rubro', opcional: true, control: entrada({ name: 'rubro', value: n.rubro, maxlength: 60, placeholder: 'Peluquería, Kinesiología, Clases…' }) })),
      el('div', { class: 'campo' },
        el('label', { for: 'slug' }, 'Tu link'),
        el('div', { class: 'entrada-con-prefijo' }, el('span', {}, `${location.host}/`), Object.assign(slug, { id: 'slug' })),
        estadoSlug, el('p', { class: 'campo__error' })),
      campo({ etiqueta: 'Descripción', opcional: true, control: el('textarea', { class: 'entrada', name: 'descripcion', rows: 2, maxlength: 400 }, n.descripcion) }),
      el('div', { class: 'formulario__fila' },
        campo({ etiqueta: 'Dirección', opcional: true, ayuda: 'Se muestra con un link a Google Maps.', control: entrada({ name: 'direccion', value: n.direccion, maxlength: 160 }) }),
        campo({ etiqueta: 'WhatsApp del negocio', opcional: true, ayuda: 'Para que te puedan consultar desde la página.', control: entrada({ name: 'whatsapp', type: 'tel', value: n.whatsapp, maxlength: 30, placeholder: '11 2345-6789' }) })),
      campo({ etiqueta: 'Email para avisos', opcional: true, ayuda: 'Te avisamos cada vez que alguien reserva (si el envío de mails está activado).', control: entrada({ name: 'email_contacto', type: 'email', value: n.email_contacto, maxlength: 120 }) }),
      el('fieldset', { class: 'colores' }, el('legend', {}, 'Color'),
        COLORES.map(([valor, hex, nombre]) => el('label', { class: 'color', title: nombre },
          el('input', { type: 'radio', name: 'color', value: valor, checked: n.color === valor, 'aria-label': nombre, onchange: () => { document.documentElement.dataset.color = valor; } }),
          el('span', { style: { '--muestra': hex } })))),
      campo({ etiqueta: 'Mensaje para el cliente', opcional: true, ayuda: 'Aparece al reservar. Por ejemplo: "Llegá 5 minutos antes".', control: el('textarea', { class: 'entrada', name: 'mensaje', rows: 2, maxlength: 500 }, n.mensaje) }),
      el('label', { class: 'interruptor' }, el('input', { type: 'checkbox', name: 'activo', checked: Boolean(n.activo) }), el('span', { class: 'interruptor__pista' }), el('span', {}, 'Tomar turnos online (desactivalo si te vas de vacaciones largas)'))),

    seccion('Reglas de reserva', 'Para que la agenda se ordene sola.',
      el('div', { class: 'formulario__fila' },
        campo({ etiqueta: 'Mostrar horarios cada', control: el('select', { class: 'entrada', name: 'paso' }, [10, 15, 20, 30, 45, 60].map((m) => el('option', { value: m, selected: n.paso === m }, `${m} minutos`))) }),
        campo({ etiqueta: 'Reservar con al menos', ayuda: 'Evita turnos para dentro de 10 minutos.', control: numero('anticipacion_min_horas', n.anticipacion_min_horas, 0, 168, 'horas de anticipación') })),
      el('div', { class: 'formulario__fila' },
        campo({ etiqueta: 'Reservar hasta', control: numero('anticipacion_max_dias', n.anticipacion_max_dias, 1, 365, 'días adelante') }),
        campo({ etiqueta: 'Cancelar o cambiar hasta', ayuda: '0 = en cualquier momento.', control: numero('cancelacion_horas', n.cancelacion_horas, 0, 168, 'horas antes') }))),

    seccion('Seña', 'Para los servicios con seña: el turno queda reservado hasta que la pagan.',
      el('div', { class: 'formulario__fila' },
        campo({ etiqueta: 'Alias o CVU', opcional: true, control: entrada({ name: 'sena_alias', value: n.sena_alias, maxlength: 60, placeholder: 'mi.negocio.mp' }) }),
        campo({ etiqueta: 'Titular de la cuenta', opcional: true, control: entrada({ name: 'sena_titular', value: n.sena_titular, maxlength: 80 }) })),
      campo({ etiqueta: 'Plazo para pagar', ayuda: 'Pasado este tiempo sin pagar, el turno se cancela y el horario se libera.', control: numero('sena_plazo_horas', n.sena_plazo_horas, 1, 72, 'horas') }),
      el('details', {},
        el('summary', { style: { cursor: 'pointer', 'font-weight': '500' } }, 'Cobrar la seña con Mercado Pago (opcional)'),
        el('div', { class: 'formulario', style: { 'margin-top': '1rem' } },
          el('p', { class: 'campo__ayuda' }, 'Con tu Access Token de Mercado Pago, el cliente paga con un botón y el turno se confirma solo. Lo sacás en mercadopago.com.ar/developers → Tus integraciones → Credenciales. Para probar sin cobrar de verdad, usá el de prueba (empieza con TEST-).'),
          campo({ etiqueta: 'Access Token', opcional: true, ayuda: n.mp_configurado ? 'Ya hay un token guardado. Dejalo vacío para mantenerlo o escribí uno nuevo.' : null, control: entrada({ name: 'mp_token', type: 'password', autocomplete: 'off', maxlength: 200, placeholder: n.mp_configurado ? '••••••••••••' : 'APP_USR-… o TEST-…' }) }),
          n.mp_configurado ? el('button', { type: 'button', class: 'boton boton--texto boton--chico', onclick: async () => {
            await api('/api/negocio', { metodo: 'PUT', cuerpo: { ...n, mp_token: '' } });
            avisar('Mercado Pago desconectado.'); vistaAjustes(raiz);
          } }, 'Desconectar Mercado Pago') : null))),

    el('div', { class: 'pie-bloque', style: { 'border-radius': 'var(--radio)', border: '1px solid var(--linea)', position: 'sticky', bottom: '1rem', 'box-shadow': 'var(--sombra)' } },
      el('p', {}, 'Los cambios se ven en tu página apenas guardás.'),
      el('button', { type: 'submit', class: 'boton boton--primario' }, 'Guardar cambios')),

    seccion('Tus datos', null,
      el('div', { class: 'grupo-acciones__fila' },
        el('a', { class: 'boton boton--secundario', href: '/api/exportar/turnos.csv', download: '' }, icono('descargar', { tamano: 18 }), 'Descargar todos los turnos (Excel)'),
        sesion.usuario.demo ? null : el('button', { type: 'button', class: 'boton boton--secundario', onclick: cambiarContrasena }, 'Cambiar contraseña'),
        sesion.usuario.demo ? null : el('button', { type: 'button', class: 'boton boton--peligro', onclick: borrarCuenta }, 'Borrar mi cuenta'))));

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = valores(f);
    const cuerpo = { ...v, paso: Number(v.paso) };
    if (!v.mp_token) delete cuerpo.mp_token;
    await conCarga(f.querySelector('[type=submit]'), async () => {
      try {
        await api('/api/negocio', { metodo: 'PUT', cuerpo });
        await recargarSesion();
        document.querySelector('.lateral__nombre').textContent = sesion.negocio.nombre;
        document.querySelector('.lateral__link code').textContent = `${location.host}/${sesion.negocio.slug}`;
        avisar('Cambios guardados.', { accion: { texto: 'Ver mi página', alHacer: () => window.open(`/${sesion.negocio.slug}`, '_blank') } });
      } catch (error) { mostrarErrorEn(f, error); }
    });
  });

  poner(raiz,
    el('header', { class: 'cabecera' },
      el('div', {}, el('h1', {}, 'Ajustes'), el('p', { class: 'cabecera__bajada' }, 'Tu página, tus reglas y tu cuenta.')),
      el('button', { type: 'button', class: 'boton boton--secundario', onclick: () => copiar(`${location.origin}/${n.slug}`, 'Link copiado.') }, icono('copiar', { tamano: 18 }), 'Copiar mi link')),
    f);
}

async function cambiarContrasena() {
  const c = el('div', { class: 'formulario' },
    campo({ etiqueta: 'Contraseña actual', control: entrada({ name: 'actual', type: 'password', autocomplete: 'current-password', required: true }) }),
    campo({ etiqueta: 'Nueva contraseña', ayuda: 'Al menos 8 caracteres. Se cierran las otras sesiones.', control: entrada({ name: 'nueva', type: 'password', autocomplete: 'new-password', required: true, minlength: 8 }) }));
  const ok = await dialogo({ titulo: 'Cambiar contraseña', contenido: c, botones: [{ texto: 'Cancelar', valor: false }, { texto: 'Cambiar', valor: true, tipo: 'primario', enviar: true, alHacer: () => api('/api/cuenta/contrasena', { metodo: 'POST', cuerpo: valores(c) }) }] });
  if (ok) avisar('Contraseña cambiada.');
}

async function borrarCuenta() {
  if (!await confirmar('¿Borrar tu cuenta?', 'Se borran tu página, servicios, clientes y todos los turnos. No se puede deshacer. Si querés, primero descargá tus turnos.', { texto: 'Borrar todo', peligro: true })) return;
  await api('/api/cuenta', { metodo: 'DELETE' });
  location.href = '/';
}
