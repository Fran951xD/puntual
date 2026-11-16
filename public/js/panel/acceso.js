// Ingresar, crear cuenta y probar la demo.
import { el, icono, api, poner, campo, entrada, valores, conCarga, mostrarErrorEn } from '../comun.js';

export function vistaAcceso(raiz, { modo, alEntrar }) {
  const registro = modo === 'registro';
  document.title = registro ? 'Crear cuenta · Puntual' : 'Ingresar · Puntual';
  const formulario = el('form', { class: 'formulario', novalidate: true },
    registro ? campo({ etiqueta: 'Tu nombre', control: entrada({ name: 'nombre', autocomplete: 'name', required: true, maxlength: 80 }) }) : null,
    registro ? campo({ etiqueta: 'Nombre del negocio o consultorio', ayuda: 'Es lo que van a ver tus clientes. Lo podés cambiar después.', control: entrada({ name: 'negocio', autocomplete: 'organization', required: true, maxlength: 80, placeholder: 'Estudio Lumen, Kinesiología Ana Paz…' }) }) : null,
    campo({ etiqueta: 'Email', control: entrada({ name: 'email', type: 'email', autocomplete: 'email', required: true, maxlength: 120 }) }),
    campo({ etiqueta: 'Contraseña', ayuda: registro ? 'Al menos 8 caracteres.' : null, control: entrada({ name: 'contrasena', type: 'password', autocomplete: registro ? 'new-password' : 'current-password', required: true, minlength: registro ? 8 : null }) }),
    el('button', { type: 'submit', class: 'boton boton--primario boton--ancho' }, registro ? 'Crear mi agenda' : 'Ingresar'));
  formulario.addEventListener('submit', async (e) => {
    e.preventDefault();
    await conCarga(formulario.querySelector('[type=submit]'), async () => {
      try {
        await api(registro ? '/api/registro' : '/api/ingresar', { metodo: 'POST', cuerpo: valores(formulario) });
        alEntrar();
      } catch (error) { mostrarErrorEn(formulario, error); }
    });
  });
  const demo = el('button', { type: 'button', class: 'boton boton--secundario boton--ancho', onclick: async (e) => {
    await conCarga(e.currentTarget, async () => {
      try { await api('/api/demo', { metodo: 'POST', cuerpo: {} }); alEntrar(); } catch (error) { mostrarErrorEn(formulario, error); }
    });
  } }, 'Probar con una peluquería de ejemplo');

  poner(raiz, el('div', { class: 'acceso' },
    el('main', { class: 'acceso__formulario', id: 'vista' },
      el('div', { class: 'acceso__caja' },
        el('a', { class: 'acceso__marca', href: '/' }, el('img', { src: '/img/icono.svg', alt: '' }), 'Puntual'),
        el('div', {}, el('h1', {}, registro ? 'Creá tu agenda online' : 'Hola de nuevo'),
          el('p', { class: 'cabecera__bajada' }, registro ? 'Gratis. En 3 minutos tus clientes ya pueden sacar turno solos.' : 'Ingresá para ver tu agenda.')),
        formulario,
        el('div', { class: 'separador' }, 'o'),
        demo,
        el('p', { class: 'cabecera__bajada' }, registro ? '¿Ya tenés cuenta? ' : '¿Todavía no tenés cuenta? ',
          el('a', { href: registro ? '/ingresar' : '/registro', 'data-nav': '' }, registro ? 'Ingresá' : 'Creala gratis')))),
    el('aside', { class: 'acceso__lado', 'aria-hidden': 'true' },
      el('div', { class: 'ticket' },
        el('div', { class: 'ticket__cabecera' }, el('span', { class: 'ticket__marca' }, 'Kinesiología Paz'), el('span', {}, 'Confirmado')),
        el('div', { class: 'ticket__cuerpo' }, el('p', { class: 'ticket__dia' }, 'Jueves 19 de noviembre'), el('p', { class: 'ticket__hora' }, '18:30'), el('p', {}, 'Sesión de rehabilitación, 50 min')),
        el('div', { class: 'ticket__troquel' }),
        el('div', { class: 'ticket__pie' }, el('div', { class: 'ticket__fila' }, el('span', {}, 'A nombre de'), el('strong', {}, 'Martín Gómez')))),
      el('p', {}, 'Tus clientes eligen el horario, reciben el comprobante y un recordatorio. Vos dejás de coordinar por WhatsApp.'))));
  raiz.querySelector('input')?.focus();
}
