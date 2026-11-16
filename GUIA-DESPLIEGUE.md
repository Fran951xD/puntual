# Publicar Puntual gratis en Cloudflare

Cloudflare Pages sirve la página y el servidor, y D1 guarda los datos. El plan gratuito alcanza de sobra para un negocio o para mostrarlo en tu portfolio. Se hace todo desde el navegador, también desde el celular con "Versión para computadoras".

## 1. Crear la base de datos (2 min)

1. Entrá a **dash.cloudflare.com** y creá una cuenta si no tenés.
2. Menú **Storage & Databases → D1 SQL Database → Create**.
3. Nombre: `puntual` → **Create**. Las tablas se crean solas la primera vez que se usa.

## 2. Conectar el repositorio (3 min)

1. Menú **Workers & Pages → Create → Pages → Connect to Git**.
2. Elegí tu cuenta de GitHub y el repositorio `puntual`.
3. Configuración de la compilación:
   - **Framework preset**: None
   - **Build command**: `node scripts/construir.mjs`
   - **Build output directory**: `dist`
4. **Save and Deploy**. La primera publicación puede fallar porque todavía no está conectada la base: es normal, la conectás en el paso siguiente.

## 3. Conectar la base y las variables (2 min)

> Si usás el `wrangler.toml` del repo, poné ahí el `database_id` de tu base (lo ves en D1 → tu base) y la `URL_PUBLICA`: Cloudflare toma la configuración de ese archivo y este paso no hace falta.

En el proyecto de Pages: **Settings → Bindings → Add → D1 database**:

- **Variable name**: `DB` (exactamente así)
- **D1 database**: `puntual`

En **Settings → Variables and Secrets** (todas son opcionales):

| Variable | Para qué |
|---|---|
| `URL_PUBLICA` | Tu dirección final, por ejemplo `https://puntual.pages.dev`. Se usa en los links de los mails. |
| `RESEND_API_KEY` | Activa los mails de confirmación, recordatorio y lista de espera. Se saca gratis en resend.com. |
| `CORREO_REMITENTE` | Por ejemplo `Puntual <turnos@tudominio.com>`. Si no tenés un dominio verificado en Resend, dejalo vacío. |
| `CRON_SECRETO` | Una clave larga cualquiera, para llamar a `/api/cron` desde un cron externo (cron-job.org) cada 15 minutos con el encabezado `x-cron-secreto`. |

Después: **Deployments → … → Retry deployment**. Listo: tu Puntual está en `https://<proyecto>.pages.dev`.

Sin `CRON_SECRETO`, las tareas automáticas (vencer señas, recordatorios, limpiar demos) igual se ejecutan con las visitas, como máximo una vez cada 10 minutos.

## Actualizaciones

Cada push a la rama `main` de GitHub publica una nueva versión sola.

## Otra opción: un servidor con Node

En cualquier servidor con Node 22.5+, por ejemplo una VPS o tu propia PC:

```bash
PUERTO=8787 BD=/ruta/puntual.db URL_PUBLICA=https://mi-dominio.com node servidor/node.js
```

Ponelo detrás de un proxy con HTTPS (Caddy o Nginx) para que las cookies de sesión sean seguras.
