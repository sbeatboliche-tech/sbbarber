# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Ecosistema web de la barbería SB Barber. No hay build, bundler, linter ni tests: cada app es un único `index.html` con HTML + CSS + JS vanilla (Firebase por CDN/ES modules), así que "correr" algo es abrir el archivo o servir la carpeta. Los archivos son grandes (`recepcionista/index.html` ~4800 líneas, `tienda/index.html` ~2400, `anotar/index.html` ~3250): leer por rangos con Grep/Read, no enteros. Los textos y comentarios del código están en español rioplatense; mantener ese estilo.

## Dos despliegues distintos (clave)

- **Raíz del repo → GitHub Pages** (`.github/workflows/deploy.yml`, cada push a `main` sube todo `.`). Sirve `index.html` (landing), `recepcionista/`, `anotar/`, `turnos/`, `menu/`, `cursos/`, `inscripciones/`, `resenas/`. GitHub Pages **no** ejecuta funciones serverless.
- **`tienda/` → Vercel** (dominio `tienda.sbbarber.com.ar`, `tienda/vercel.json`). Acá sí corren las funciones de `tienda/api/*.js`. `tienda/index.html` redirige a este dominio si detecta que se abrió desde `sbbarber.com.ar` (donde `/api/*` no existe). Es decir: cualquier cosa que llame a `/api/...` solo funciona en Vercel.

`electron-app/` es solo un wrapper (`main.js`) que abre la URL de GitHub Pages de `recepcionista/` en una ventana. Único lugar con comandos: `cd electron-app && npm start` (dev) / `npm run dist` (portable Windows).

`impresion-whatsapp/` corre en la compu del local (`iniciar.bat`; `arrancar-con-windows.bat` lo deja en Inicio): whatsapp-web.js vinculado al WhatsApp del celu (sesión en `.wwebjs_auth/`, nunca commitear) junta las fotos/PDF de los chats que escriben "imprimir" y las muestra en `http://localhost:3939` para imprimir con confirmación (`imprimir.ps1`, System.Drawing). La versión de WhatsApp Web está fijada (`webVersion` en `index.js`) y WhatsApp la deja de aceptar a los ~2 meses: si deja de conectar, actualizar la librería y la versión.

`app-movil/` es la app de iOS/Android (Capacitor, por ahora solo Android): abre `https://sbbarber.com.ar/panel/`, que hace el login y manda a los `ADMINS` a `recepcionista/` y al resto a `anotar/`. Compilar requiere JDK 21 y Android SDK: `cd app-movil && npm install && npx cap sync && npm run android`.

**Límite de Vercel Hobby: máximo 12 archivos en `tienda/api/`** (hoy hay 12). Con uno más, el deploy compila pero falla al publicar y la tienda queda en la versión anterior sin avisar (pasó el 2026-11-20 con `backup.js`, que ahora vive en `lib/backup.js` y corre como `/api/uso?action=backup`). Lo nuevo va como `action` dentro de una función existente o en `lib/`.

Dependencias de las funciones serverless: `tienda/package.json` (`nodemailer`, `firebase-admin`, `@vercel/functions`). Tiene que estar en `tienda/` y no en `tienda/api/`: `tienda/lib/*.js` también importa paquetes y desde ahí no se ve `api/node_modules` (eso tuvo caído el webhook de MP del 2026-09-08 al 2026-10-08).

## Dos proyectos Firebase

- `sbbarbertienda`: tienda (`tienda/index.html`, `admin.html`, y las funciones). Colecciones `tienda_*` (productos, productos_custom, kits_custom, cursos, config, pedidos, visitas).
- `sb-barber-6dc16`: operación interna (`recepcionista`, `anotar`). Datos en `artifacts/sb-barber-6dc16/public/data/...` más colecciones sueltas (retiros, ajustes_semanales, etc.).

`firestore.rules` (raíz, desplegado con `firebase.json`) define el acceso: la tienda tiene lectura pública y escritura solo logueado; `tienda_pedidos` permite que el comprador cree/actualice su pedido pero **no** cambie `aprobado`/`enviado`/`retirado`; el resto exige auth y el borrado se reserva a admins (emails fijos o sesión anónima de recepcionista). Al agregar una colección nueva revisar qué regla la cubre.

## Arquitectura de la tienda (requiere leer varios archivos)

- **Catálogo**: el navegador NO escucha Firestore en vivo; pide `GET /api/catalogo`, que junta ~7 lecturas en una respuesta cacheada en el borde de Vercel (`Cache-Control` en `api/catalogo.js` y `api/producto.js`, hoy 60s). Es a propósito: los listeners por visitante agotaron la cuota gratuita de Firebase con el tráfico de Instagram. No volver a `onSnapshot` en la tienda pública. Un cambio de precio en el admin tarda ~1-2 min en verse.
- **No pintar precios desde `localStorage`**: `index.html` guarda una caché (`sb_cache_*`) solo como respaldo si falla la red; pintar con ella mostraba precios viejos (`_hasProductCache` queda en `false` a propósito).
- **Precio y stock viven en dos lugares**: productos base hardcodeados (`PRODUCTS` en `index.html`) + overrides en `tienda_productos`; productos/kits creados desde el admin en `tienda_productos_custom` / `tienda_kits_custom`. `productConfig` fusiona ambos.
- **Checkout**: `api/checkout.js` (MercadoPago, crea preferencia y escribe el pedido server-side como respaldo) y `api/notify-transfer.js` (transferencia, 10% de descuento, aviso por mail con nodemailer). El precio cobrado se resuelve en el servidor (`resolveRealPrice`: Firestore custom/kits, si no `BASE_PRICES` de `checkout.js`); no confiar en el precio que manda el cliente. Al cambiar un precio base hay que tocarlo en `PRODUCTS` de `index.html` y en `BASE_PRICES`. `api/webhook.js` marca el pedido pagado con `lib/firebaseAdmin.js` (bypassa reglas). Estado inicial `pendiente_pago` hasta que el webhook lo aprueba.
- **Envío**: tarifas por zona en `ZONE_RATES` y umbral `FREE_SHIP_THRESHOLD` (envío gratis) en `index.html`, sobreescribibles desde `tienda_config/envios`; retiro en local gratis. `api/correo-rates.js` cotiza Correo Argentino.
- **`lib/firestore.js`**: acceso REST a Firestore con la API key pública (sin cuenta de servicio) para lecturas/escrituras públicas; `lib/firebaseAdmin.js` es para lo privilegiado y requiere la env var `FIREBASE_SERVICE_ACCOUNT`.
- Env vars en Vercel (no hay `.env` en el repo): `MP_ACCESS_TOKEN`, `FIREBASE_SERVICE_ACCOUNT`, `GMAIL_APP_PASSWORD`, `WHATSAPP_*`, `CORREO_*`, `STORE_URL`, `ETHEREAL_*`, `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `FIREBASE_SERVICE_ACCOUNT_BARBER`.

## Stock de MercadoLibre enlazado

Los productos de `productos_barber` (proyecto `sb-barber-6dc16`) se enlazan a una o **varias** publicaciones/variantes de ML en `mlEnlaces: [{itemId, variationId, titulo, unidades}]` (`unidades` > 1 = kit: cada venta descuenta esa cantidad). El formato viejo `mlItemId`/`mlVariationId` sigue leyéndose como un enlace de 1 unidad (`enlacesDe` en `tienda/lib/ml.js`, `enlacesML` en recepcionista). Un mismo producto en varias publicaciones (ej. Desinfectante Everest en 3) comparte un solo stock, que se copia a todas. En recepcionista, "Publicaciones sin producto" crea el producto desde ML (nombre, precio, stock y foto) o la enlaza a uno existente. Corre en Vercel aunque recepcionista y anotar estén en GitHub Pages:
- `tienda/api/ml.js`: conectar la cuenta (OAuth, solo dueños), listar publicaciones y `sync` (copia a ML el stock de Firestore; siempre "pisa con el valor actual", así que repetirlo no hace daño). Recepcionista y anotar llaman a `sync` desde el `onSnapshot` de productos cuando **ese** dispositivo cambió el stock (`hasPendingWrites`).
- `tienda/api/ml-webhook.js` (topic `orders_v2`): venta pagada → crea `ventas_productos/ml-{orden}-{i}` con canal `ml` (fuera de la caja) para **toda** línea; si está enlazada descuenta stock y lo copia a las otras publicaciones del producto, si no queda `sinEnlazar` sin tocar stock. Cancelada → devuelve stock y borra esas ventas. Idempotente vía `ml_ordenes/{orden}`.
- Tokens cifrados en `ml_config/cuenta` (las reglas dejan leer todo a cualquier logueado). Env vars: `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `FIREBASE_SERVICE_ACCOUNT_BARBER` (cuenta de servicio de `sb-barber-6dc16`, distinta de `FIREBASE_SERVICE_ACCOUNT`).
- La venta manual (recepcionista y anotar) ya no tiene selector de canal: siempre es `local`. Las ventas de ML entran solas por el webhook; un producto que se vende en ML tiene que estar enlazado.
- El stock es uno solo por producto (no hay lista "Local" vs "MercadoLibre"): cualquier producto se puede enlazar y las ventas del local y de ML descuentan del mismo número. El flag viejo `isML` ya no se usa.
- Códigos de barras: `productos_barber/{id}.codigos` (array, un producto puede tener varios). La cámara (celu) está en `assets/escaner.js` (`html5-qrcode`, se carga al usarla), compartido por recepcionista y anotar.
  - Recepcionista: un listener de `keydown` en captura reconoce al lector USB/Bluetooth por la velocidad (teclas a <50ms + Enter) y manda el código a `handleScan` sin tocar nada: venta abierta → carrito; Stock de productos → "Carga con lector" (sumar o contar, se confirma en un batch y queda en `productos_movimientos`); cualquier otra pantalla → cierra lo abierto y abre la venta. Los campos con `data-scan="nativo"` quedan fuera del listener. En pantallas táctiles el botón de carga abre la cámara.
  - Anotar: solo cámara (botón "Escanear" en la venta y en Stock de productos), misma lógica de carga y venta.
  - Código desconocido → elegir de qué producto es o crear uno nuevo.
- Precio de productos: en Stock de productos (recepcionista) se toca el precio y se guarda en `productos_barber/{id}.precio` con `precioEditado: true`; para los productos base hardcodeados (`PRODUCTOS_BARBER_BASE`) ese precio manda sobre el del código, en recepcionista y anotar.

## Multi-barbería (la app se vende a otras barberías, siempre con la marca SB BARBER)

Config de cada barbería en `barberias/{id}` (`assets/config-barberia.js`); sus datos en `barberias/{id}/...` vía `ruta()` (`assets/rutas-barberia.js`). **SB Barber (`sb-barber`) no se mudó**: sigue en las colecciones de la raíz y sus cuentas no tienen claims (sin claim = SB). Las cuentas de otras barberías llevan el custom claim `{ barberia, rol: 'admin'|'barbero' }`, que pone solo el servidor: `POST /api/uso?action=usuario` / `usuario-baja` (solo dueños, `tienda/lib/usuarios.js`; crea el usuario, genera contraseña si no se manda y lo suma a la config). Al cargar, `BARBERIA_ID` sale de `?barberia=` → `localStorage.sb_barberia_actual` → SB; después del login `exigirAcceso(user)` (async) recarga en la barbería del claim si no coincide. Los dueños entran a cualquiera con `?barberia=`. Reglas: `miBarberia(id)`/`esAdminDe(id)` por claim, sin `get()`. Equipo (⋮ → Equipo/Barberías, `assets/equipo.js`): el admin de cada barbería da de alta barberos/admins solo de la suya; los dueños crean barberías (`action=barberia`). No se puede dar de alta un mail del equipo de SB, y en las reglas una cuenta con claim nunca es `esStaff()`. Servicios y productos: SB usa los fijos del código (`SERVICES`, `PRODUCTOS_BARBER_BASE`); otra barbería arranca con `SERVICIOS_INICIALES` en $0 y sin productos, y carga los suyos desde Precios / Nuevo producto. Planes en `docs/superpowers/plans/2026-11-*-multi-barberia-*.md`.

## Turnos online

`turnos/index.html` (GitHub Pages) reserva contra `tienda/lib/turnos.js` vía `/api/push?action=disponibilidad|reservar` (públicos, sin login; van en `api/push.js` por el límite de 12 funciones). El turno queda **confirmado solo** en `turnos/{id}` (misma colección que recepcionista y anotar, `barbero` = nombre de config: `Santi`, `SantiF`, `Stefa`), con `origen: 'online'`, `duracion`, `telefono` y aviso push al barbero y a los dueños. Barberos, duraciones (Santi/SantiF 45 min, Stefa 60, pelo largo +15), horario (mar–sáb 11:00–19:30) y límites (2 turnos futuros por teléfono —últimos 10 dígitos—, 3 reservas por IP por día en `turnos_limite/`) viven en `BARBEROS_ONLINE`/constantes de `lib/turnos.js`; `turnos/index.html` repite barberos y duraciones solo para mostrar. Los turnos cargados a mano sin `duracion` bloquean la duración del barbero. Lo que escribe el cliente se escapa al mostrarlo (recepcionista `escHtml`, anotar `esc`). Pendiente: WhatsApp automático de confirmación y recordatorio (API oficial de Meta + plantillas).

## Recepcionista (cierre de caja)

`recepcionista/index.html` calcula el cierre diario/semanal a partir de cortes, retiros, propinas y ajustes. Hay atajos de teclado Ctrl+Shift+7 (Tony) y Ctrl+Shift+6 (Stefa) que descuentan $5.000 del "A cobrar" de la semana: se guardan en `ajustes_semanales` (un doc por semana y barbero, idempotente) y el cierre semanal los resta en silencio, sin tocar retiros ni la caja diaria. No mostrar avisos ni filas por estos atajos (fue decisión explícita).

## Convenciones del repo

- Antes de trabajar: `git fetch` (el `main` local puede estar atrasado).
- Commits en formato `tipo(área): descripción` en español (`fix(tienda): ...`, `feat(recepcionista): ...`); push directo a `main`, que dispara el deploy.
- `docs/superpowers/plans|specs` guardan planes y diseños previos; `scripts/*.mjs` son migraciones de un solo uso con rutas locales a claves de servicio (no ejecutar sin revisar).
- Git de Windows avisa "LF will be replaced by CRLF": es normal, ignorar.
- El README está desactualizado (menciona `pro/` y sitio 100% estático); guiarse por esta guía y el código.
