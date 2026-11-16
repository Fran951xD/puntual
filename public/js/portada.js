// Portada: botón para entrar a la demo sin registrarse.
import { $$, api, avisar, conCarga } from './comun.js';

for (const boton of $$('[data-demo]')) {
  boton.addEventListener('click', () => conCarga(boton, async () => {
    try {
      await api('/api/demo', { metodo: 'POST', cuerpo: {} });
      location.href = '/panel';
    } catch (e) { avisar(e.message, { tipo: 'error' }); }
  }));
}
