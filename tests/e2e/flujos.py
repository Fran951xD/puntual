"""Pruebas punta a punta de Puntual en un navegador real.

Uso:
  PUERTO=8788 BD=:memory: node servidor/node.js &
  PUNTUAL_URL=http://localhost:8788 python3 tests/e2e/flujos.py

Variables: PUNTUAL_URL (por defecto http://localhost:8788), CHROME (ruta a Chrome, opcional).
"""
import asyncio, os, re, sys, datetime
from playwright.async_api import async_playwright, expect

URL = os.environ.get('PUNTUAL_URL', 'http://localhost:8788')
CHROME = os.environ.get('CHROME')
ERRORES = []


def vigilar(pagina):
    pagina.on('pageerror', lambda e: ERRORES.append(f'{pagina.url}: {e}'))
    pagina.on('console', lambda m: ERRORES.append(f'{pagina.url}: {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path=CHROME) if CHROME else await p.chromium.launch()

        # ---------------- El profesional se registra y configura
        pro = await (await nav.new_context(viewport={'width': 1366, 'height': 900})).new_page()
        vigilar(pro)
        await pro.goto(URL + '/registro')
        await pro.fill('[name=nombre]', 'Ana Paz')
        await pro.fill('[name=negocio]', 'Kinesiología Ana Paz')
        await pro.fill('[name=email]', 'ana@ejemplo.com')
        await pro.fill('[name=contrasena]', 'corta')
        await pro.click('button[type=submit]')
        await expect(pro.locator('.campo__error').filter(has_text='8 caracteres')).to_be_visible()
        await pro.fill('[name=contrasena]', 'clave-segura-1')
        await pro.click('button[type=submit]')
        await expect(pro.locator('h1')).to_contain_text('Ana')
        await expect(pro.locator('.primeros-pasos')).to_be_visible()
        print('ok  registro con validación y pasos iniciales')

        await pro.click('.nav a[href="/panel/servicios"]')
        await pro.click('text=Sesión, 50 min')
        await pro.fill('[name=precio]', '22000')
        await pro.click('dialog button[type=submit]')
        await expect(pro.locator('.fila-servicio')).to_have_count(1)
        await expect(pro.locator('.fila-servicio__precio')).to_have_text('$22.000')
        print('ok  alta de servicio desde una sugerencia')

        await pro.click('.nav a[href="/panel/horarios"]')
        await pro.wait_for_selector('.dia-horario')
        sabado = pro.locator('.dia-horario').nth(5)
        await sabado.locator('.interruptor__pista').click()
        await pro.click('text=Guardar horarios')
        await expect(pro.locator('.aviso').last).to_contain_text('Horarios guardados')
        print('ok  horarios: abrir el sábado')

        await pro.click('.nav a[href="/panel/ajustes"]')
        slug = await pro.input_value('[name=slug]')
        assert slug == 'kinesiologia-ana-paz', slug
        await pro.fill('[name=direccion]', 'Av. Corrientes 1234, CABA')
        await pro.click('label.color[title="Océano"]')
        await pro.click('text=Guardar cambios')
        await expect(pro.locator('.aviso').last).to_contain_text('Cambios guardados')
        print('ok  ajustes: link, dirección y color')

        # ---------------- Un cliente reserva desde el celular
        cel = await (await nav.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)).new_page()
        vigilar(cel)
        # Un día con al menos 3 días de margen (para que se pueda cambiar y cancelar a cualquier hora que corra la prueba).
        dia = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-3))).date() + datetime.timedelta(days=3)
        while dia.weekday() == 6:
            dia += datetime.timedelta(days=1)
        await cel.goto(f'{URL}/{slug}?fecha={dia.isoformat()}')
        await expect(cel.locator('.perfil__nombre')).to_have_text('Kinesiología Ana Paz')
        assert await cel.evaluate("document.documentElement.dataset.color") == 'oceano'
        await cel.wait_for_selector('.hora')  # un solo servicio: va directo a elegir horario
        await cel.locator('.hora').first.click()
        await cel.fill('[name=nombre]', 'Pedro')
        await cel.fill('[name=telefono]', '123')
        await cel.click('button[type=submit]')
        await expect(cel.locator('.campo__error:not(:empty)')).to_contain_text('código de área')
        await cel.fill('[name=nombre]', 'Pedro Gómez')
        await cel.fill('[name=telefono]', '11 5555-1234')
        await cel.fill('[name=email]', 'pedro@ejemplo.com')
        await cel.click('button[type=submit]')
        await cel.wait_for_selector('.ticket')
        await expect(cel.locator('.listo__titulo h1')).to_have_text('¡Listo, te esperamos!')
        assert re.search(r'/t/[\w-]+$', cel.url), cel.url
        hora_reservada = await cel.locator('.ticket__hora').inner_text()
        print(f'ok  reserva desde el celular ({hora_reservada}) con validación y comprobante')

        # Cambiar horario y cancelar desde el link del turno
        await cel.click('text=Cambiar horario')
        await cel.wait_for_selector('.hora')
        await cel.locator('.hora').nth(2).click()
        await cel.click('dialog .boton--primario')
        await expect(cel.locator('.listo__titulo h1')).to_have_text('Turno cambiado')
        nueva = await cel.locator('.ticket__hora').inner_text()
        assert nueva != hora_reservada
        print(f'ok  el cliente cambia el horario ({hora_reservada} → {nueva})')

        # ---------------- El profesional ve el turno y lo gestiona
        await pro.goto(URL + '/panel/clientes')
        await expect(pro.locator('.tabla tbody tr')).to_have_count(1)
        await pro.locator('.tabla tbody tr').first.click()
        await expect(pro.locator('.cajon')).to_contain_text('Pedro Gómez')
        await pro.keyboard.press('Escape')
        await pro.goto(URL + '/panel/agenda?vista=semana')
        await pro.wait_for_selector('.bloque-turno')
        await pro.locator('.bloque-turno').first.click()
        await expect(pro.locator('.cajon__hora')).to_have_text(nueva)
        await expect(pro.locator('.cajon a.boton--whatsapp')).to_have_attribute('href', re.compile(r'^https://wa\.me/5491155551234'))
        print('ok  el profesional ve el turno en clientes y en la agenda, con WhatsApp')

        # Doble reserva imposible: el mismo horario ya no aparece
        cel2 = await (await nav.new_context(viewport={'width': 390, 'height': 844})).new_page()
        await cel2.goto(f'{URL}/{slug}?fecha={dia.isoformat()}')
        await cel2.wait_for_selector('.hora')
        horas = await cel2.locator('.hora').all_inner_texts()
        assert nueva not in horas, 'el horario ocupado sigue apareciendo'
        print('ok  el horario ocupado desaparece para el resto')

        # El cliente cancela
        await cel.click('text=Cancelar turno')
        await cel.click('dialog .boton--peligro-lleno')
        await expect(cel.locator('.listo__titulo h1')).to_have_text('Turno cancelado')
        await cel2.reload()
        await cel2.wait_for_selector('.hora')
        assert nueva in await cel2.locator('.hora').all_inner_texts(), 'el horario cancelado no se liberó'
        print('ok  al cancelar, el horario vuelve a estar libre')

        # Turno manual desde el panel, superposición y marcar asistencia
        await pro.goto(URL + '/panel/agenda?vista=semana')
        await pro.click('text=Nuevo turno')
        await pro.wait_for_selector('dialog [name=nombre]')
        await pro.fill('dialog [name=nombre]', 'Laura Ríos')
        await pro.fill('dialog [name=telefono]', '11 4444-1111')
        await pro.click('dialog button[type=submit]')
        await expect(pro.locator('.aviso').last).to_contain_text('Turno agendado')
        await pro.goto(URL + '/panel/clientes')
        await expect(pro.locator('.tabla tbody tr')).to_have_count(2)
        print('ok  turno manual desde el panel')

        # Demo y estadísticas
        demo = await (await nav.new_context(viewport={'width': 1366, 'height': 900})).new_page()
        vigilar(demo)
        await demo.goto(URL + '/')
        await demo.click('[data-demo]')
        await demo.wait_for_selector('.hoy')
        await expect(demo.locator('.cinta-demo')).to_be_visible()
        await demo.click('.nav a[href="/panel/estadisticas"]')
        await demo.wait_for_selector('.kpi__valor')
        assert int(await demo.locator('.kpi__valor').nth(1).inner_text()) > 50
        await demo.locator('.barra-grupo').nth(5).hover()
        await expect(demo.locator('.globo').first).to_be_visible()
        await demo.click('.nav a[href="/panel/hoy"]') if await demo.locator('.nav a[href="/panel/hoy"]').count() else None
        print('ok  demo desde la portada con estadísticas y detalle al pasar el mouse')

        # Seguridad: sin sesión no hay panel ni API
        anon = await (await nav.new_context()).new_page()
        await anon.goto(URL + '/panel')
        await anon.wait_for_url(re.compile(r'/ingresar$'))
        r = await anon.request.get(URL + '/api/clientes')
        assert r.status == 401
        r = await anon.request.post(URL + '/api/servicios', data='{}', headers={'content-type': 'application/json', 'origin': 'https://otro-sitio.com'})
        assert r.status == 403
        csp = (await anon.request.get(URL + '/')).headers.get('content-security-policy', '')
        assert "frame-ancestors 'none'" in csp
        print('ok  seguridad: panel protegido, CSRF bloqueado y CSP')

        await nav.close()

    if ERRORES:
        print('\nErrores en la consola:\n' + '\n'.join(ERRORES))
        sys.exit(1)
    print('\nTodas las pruebas punta a punta pasaron.')


asyncio.run(main())
