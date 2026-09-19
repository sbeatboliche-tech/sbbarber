# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Ecosistema web de la barbería SB Barber. No hay build, bundler, linter ni tests: cada app es un único `index.html` con HTML + CSS + JS vanilla (Firebase por CDN/ES modules), así que "correr" algo es abrir el archivo o servir la carpeta. Los archivos son grandes (`recepcionista/index.html` ~4800 líneas, `tienda/index.html` ~2400, `anotar/index.html` ~3250): leer por rangos con Grep/Read, no enteros. Los textos y comentarios del código están en español rioplatense; mantener ese estilo.

## Dos despliegues distintos (clave)

- **Raíz del repo → GitHub Pages** (`.github/workflows/deploy.yml`, cada push a `main` sube todo `.`). Sirve `index.html` (landing), `recepcionista/`, `anotar/`, `turnos/`, `menu/`, `cursos/`, `inscripciones/`, `resenas/`. GitHub Pages **no** ejecuta funciones serverless.
- **`tienda/` → Vercel** (dominio `tienda.sbbarber.com.ar`, `tienda/vercel.json`). Acá sí corren las funciones de `tienda/api/*.js`. `tienda/index.html` redirige a este dominio si detecta que se abrió desde `sbbarber.com.ar` (donde `/api/*` no existe). Es decir: cualquier cosa que llame a `/api/...` solo funciona en Vercel.

`electron-app/` es solo un wrapper (`main.js`) que abre la URL de GitHub Pages de `recepcionista/` en una ventana. Único lugar con comandos: `cd electron-app && npm start` (dev) / `npm run dist` (portable Windows).

Dependencias de las funciones serverless: `tienda/api/package.json` (`nodemailer`, `firebase-admin`).

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
- Env vars en Vercel (no hay `.env` en el repo): `MP_ACCESS_TOKEN`, `FIREBASE_SERVICE_ACCOUNT`, `GMAIL_APP_PASSWORD`, `WHATSAPP_*`, `CORREO_*`, `STORE_URL`, `ETHEREAL_*`.

## Recepcionista (cierre de caja)

`recepcionista/index.html` calcula el cierre diario/semanal a partir de cortes, retiros, propinas y ajustes. Hay atajos de teclado Ctrl+Shift+7 (Tony) y Ctrl+Shift+6 (Stefa) que descuentan $5.000 del "A cobrar" de la semana: se guardan en `ajustes_semanales` (un doc por semana y barbero, idempotente) y el cierre semanal los resta en silencio, sin tocar retiros ni la caja diaria. No mostrar avisos ni filas por estos atajos (fue decisión explícita).

## Convenciones del repo

- Antes de trabajar: `git fetch` (el `main` local puede estar atrasado).
- Commits en formato `tipo(área): descripción` en español (`fix(tienda): ...`, `feat(recepcionista): ...`); push directo a `main`, que dispara el deploy.
- `docs/superpowers/plans|specs` guardan planes y diseños previos; `scripts/*.mjs` son migraciones de un solo uso con rutas locales a claves de servicio (no ejecutar sin revisar).
- Git de Windows avisa "LF will be replaced by CRLF": es normal, ignorar.
- El README está desactualizado (menciona `pro/` y sitio 100% estático); guiarse por esta guía y el código.
