# Migrar la tienda a un proyecto de Firebase separado — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sacar toda la tienda (`tienda.sbbarber.com.ar`) del proyecto Firebase compartido `sb-barber-6dc16` y pasarla a un proyecto propio (`sbbarbertienda`), para que el tráfico público de la tienda (la mayor fuente de lecturas) no compita por el límite gratis de 50k lecturas/día con recepcionista/anotar/turnos.

**Architecture:** El proyecto Firebase nuevo (`sbbarbertienda`) es completamente independiente: su propio Firestore, su propia Authentication (hay que recrear el/los usuario/s admin ahí) y su propio Firestore security rules. Todo el código bajo `tienda/` (cliente y funciones serverless de Vercel) pasa a apuntar a ese proyecto. `recepcionista` y `menu` (que hoy leen/escriben `tienda_productos` para gestionar stock desde el panel interno) **no se tocan y quedan leyendo el proyecto viejo** — decisión explícita del usuario: esa función de edición de stock desde recepcionista queda obsoleta a partir de este cambio; el stock se administra manualmente desde `tienda/admin.html`. Los datos existentes (`tienda_productos`, `tienda_pedidos`, etc.) se migran una sola vez del proyecto viejo al nuevo con un script.

**Tech Stack:** Firebase (Firestore + Auth), Firebase CLI, firebase-admin (Node, para el script de migración de datos), Vercel (env vars del proyecto `tienda`).

**Spec:** No hay spec formal — decisión operativa del usuario por el límite de 50k lecturas/día gratis de Firestore, comunicada en conversación. Contexto relacionado: `docs/superpowers/specs/2026-09-09-centro-estadisticas-design.md` (ese diseño asume un único Firestore compartido; si este plan se completa antes, hay que revisar ese spec — las ventas de "tienda online" para `stats_diarios` van a estar en un proyecto Firebase distinto al de recepcionista/anotar, y `stats_diarios` combinado ya no puede ser un solo `increment()` local: requiere sumar desde dos proyectos).

## Global Constraints

- Proyecto viejo: `sb-barber-6dc16` (cuenta Google `abalo7272@gmail.com`). Proyecto nuevo: `sbbarbertienda` (cuenta Google `sbbarber`, distinta a la anterior — prestar atención a con qué cuenta se está logueado en `firebase login` / Firebase Console en cada paso).
- `firebaseConfig` del proyecto nuevo (ya provisto por el usuario):
  ```js
  {
    apiKey: "AIzaSyDUtDcLaDXddPWxA0OGqb1TDES-QbvTXCE",
    authDomain: "sbbarbertienda.firebaseapp.com",
    projectId: "sbbarbertienda",
    storageBucket: "sbbarbertienda.firebasestorage.app",
    messagingSenderId: "567764819334",
    appId: "1:567764819334:web:5e83360b4e20e5dce76007",
    measurementId: "G-JQY8BTJPE6"
  }
  ```
- Colecciones que se migran enteras: `tienda_productos`, `tienda_productos_custom`, `tienda_kits_custom`, `tienda_cursos`, `tienda_config` (docs `orderCounter`, `general`, `categorias`, `envios`), `tienda_pedidos`, `tienda_visitas`.
- No se toca: `recepcionista/index.html`, `menu/index.html`, `anotar/index.html`, `turnos/index.html`, `resenas/`, `menu_bebidas` — siguen en `sb-barber-6dc16` sin cambios.
- Nunca commitear secretos (service account JSON, contenido de env vars) al repo — es público. Todo eso va en Vercel (env vars) o queda local fuera de git.
- Admins de la tienda: `abalo7272@gmail.com`, `carusomanu21@gmail.com` (mismo array `ADMINS` que ya existe en `tienda/index.html` y `tienda/admin.html`) — se recrean como usuarios de Authentication en el proyecto nuevo.

---

### Task 1: Preparar el proyecto nuevo en Firebase Console (manual, sin código)

**Files:** ninguno — solo consola de Firebase.

- [ ] **Paso 1: Confirmar que Firestore está en modo producción** (no test mode) en `sbbarbertienda` → Firestore Database. Si está en test mode, las reglas por defecto permiten todo por 30 días; lo vamos a reemplazar en la Task 2 igual, pero confirmarlo evita sorpresas mientras tanto.
- [ ] **Paso 2: Habilitar Authentication → Sign-in method → Email/Password** en el proyecto `sbbarbertienda` (Firestore/Auth "ya habilitados" según el usuario, pero confirmar que el proveedor Email/Password específicamente está activo, no solo que Authentication existe).
- [ ] **Paso 3: Crear los usuarios admin** en Authentication → Users → Add user, para `abalo7272@gmail.com` y `carusomanu21@gmail.com`, con una contraseña que el usuario elija ahí mismo (Claude no debe generar ni manejar contraseñas). Anotar que son cuentas *nuevas* del proyecto nuevo — no comparten sesión con las del proyecto viejo aunque el email sea el mismo.
- [ ] **Paso 4: Generar la cuenta de servicio** para el script de migración y para Vercel: Firebase Console → ⚙️ Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada. Guardar el archivo JSON descargado **fuera del repo**, por ejemplo en `C:\Users\Agus\Desktop\sb_barber_secrets\sbbarbertienda-service-account.json` (crear esa carpeta si no existe, y confirmar que no está dentro de ningún repo git).
- [ ] **Paso 5: Igual que el paso 4 pero para el proyecto viejo** (`sb-barber-6dc16`), si no se tiene ya esa clave a mano — hace falta para leer los datos actuales en el script de migración de la Task 5. Guardarla junto a la otra, ej. `C:\Users\Agus\Desktop\sb_barber_secrets\sb-barber-6dc16-service-account.json`.

---

### Task 2: Reglas de seguridad de Firestore para el proyecto nuevo

**Files:**
- Create: `tienda/firestore.rules`
- Create: `tienda/firebase.json`
- Modify: `.firebaserc` (agregar el alias del proyecto nuevo)

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: reglas desplegadas en `sbbarbertienda`, que las Tasks 3-4 dan por hechas (asumen que login admin + escritura pública controlada ya funcionan igual que en el proyecto viejo).

- [ ] **Paso 1: Crear `tienda/firestore.rules`** con las mismas reglas que hoy tiene el bloque tienda-relacionado de `firestore.rules` (raíz del repo), pero sin el catch-all de "resto = requiere auth" (ese catch-all era para recepcionista/anotar, que no viven en este proyecto):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /tienda_productos/{d}        { allow read: if true; allow write: if request.auth != null; }
    match /tienda_productos_custom/{d} { allow read: if true; allow write: if request.auth != null; }
    match /tienda_kits_custom/{d}      { allow read: if true; allow write: if request.auth != null; }
    match /tienda_cursos/{d}           { allow read: if true; allow write: if request.auth != null; }
    match /tienda_config/{d}           { allow read: if true; allow write: if request.auth != null; }

    match /tienda_pedidos/{d} {
      allow read: if request.auth != null;
      allow create: if true;
      allow update: if request.auth != null || (
        (!('aprobado' in request.resource.data) || request.resource.data.aprobado == resource.data.aprobado) &&
        (!('enviado' in request.resource.data) || request.resource.data.enviado == resource.data.enviado) &&
        (!('retirado' in request.resource.data) || request.resource.data.retirado == resource.data.retirado)
      );
      allow delete: if request.auth != null;
    }

    match /tienda_visitas/{d} {
      allow read: if request.auth != null;
      allow write: if true;
    }
  }
}
```

- [ ] **Paso 2: Crear `tienda/firebase.json`** (config mínima, apunta a las reglas del mismo directorio):

```json
{
  "firestore": {
    "rules": "firestore.rules"
  }
}
```

- [ ] **Paso 3: Agregar el proyecto nuevo a `.firebaserc`** (raíz del repo) como alias adicional, sin tocar `"default"`:

```json
{
  "projects": {
    "default": "sb-barber-6dc16",
    "tienda": "sbbarbertienda"
  }
}
```

- [ ] **Paso 4: Loguearse con la cuenta correcta y desplegar** (correr desde la raíz del repo; usar la cuenta Google `sbbarber` cuando el navegador lo pida):

```bash
firebase login --reauth
firebase deploy --only firestore:rules --config tienda/firebase.json --project tienda
```

- [ ] **Paso 5: Confirmar en Firebase Console → `sbbarbertienda` → Firestore → Reglas** que el contenido publicado coincide con `tienda/firestore.rules`.

- [ ] **Paso 6: Commit**

```bash
git add tienda/firestore.rules tienda/firebase.json .firebaserc
git commit -m "chore(tienda): reglas de Firestore para el proyecto sbbarbertienda"
```

---

### Task 3: Migrar el frontend de la tienda al proyecto nuevo

**Files:**
- Modify: `tienda/index.html:1849-1856` (bloque `firebaseConfig`)
- Modify: `tienda/admin.html:482-489` (bloque `firebase.initializeApp`)

**Interfaces:**
- Consumes: nada de tasks anteriores (es independiente del deploy de reglas, pero no sirve probarlo end-to-end hasta que la Task 2 esté desplegada y la Task 1 tenga usuarios admin creados).
- Produces: `tienda/index.html` y `tienda/admin.html` hablando con `sbbarbertienda` en vez de `sb-barber-6dc16`.

- [ ] **Paso 1: Reemplazar el `firebaseConfig` en `tienda/index.html`** (bloque `<script type="module">`, alrededor de la línea 1849):

```js
const firebaseConfig = {
    apiKey: "AIzaSyDUtDcLaDXddPWxA0OGqb1TDES-QbvTXCE",
    authDomain: "sbbarbertienda.firebaseapp.com",
    projectId: "sbbarbertienda",
    storageBucket: "sbbarbertienda.firebasestorage.app",
    messagingSenderId: "567764819334",
    appId: "1:567764819334:web:5e83360b4e20e5dce76007"
};
```

(no hace falta `measurementId`/Analytics acá — la tienda ya tiene Meta Pixel para tracking, ver commit `63504e3`).

- [ ] **Paso 2: Reemplazar el `firebase.initializeApp({...})` en `tienda/admin.html`** (alrededor de la línea 482), mismos valores que el paso 1 pero con la sintaxis del SDK compat que ya usa ese archivo:

```js
firebase.initializeApp({
    apiKey: "AIzaSyDUtDcLaDXddPWxA0OGqb1TDES-QbvTXCE",
    authDomain: "sbbarbertienda.firebaseapp.com",
    projectId: "sbbarbertienda",
    storageBucket: "sbbarbertienda.firebasestorage.app",
    messagingSenderId: "567764819334",
    appId: "1:567764819334:web:5e83360b4e20e5dce76007"
});
```

- [ ] **Paso 3: Verificar manualmente** (no hay test suite en este repo para HTML estático): abrir `tienda/admin.html` en el navegador apuntando a un server local o directo desde archivo, intentar loguearse con uno de los usuarios creados en la Task 1 — debe autenticar contra `sbbarbertienda` (se puede confirmar viendo el usuario "last sign-in" actualizarse en Firebase Console → Authentication del proyecto nuevo).

- [ ] **Paso 4: Commit**

```bash
git add tienda/index.html tienda/admin.html
git commit -m "feat(tienda): migrar el frontend al proyecto Firebase sbbarbertienda"
```

---

### Task 4: Migrar el backend serverless (Vercel) al proyecto nuevo

**Files:**
- Modify: `tienda/lib/firestore.js:3-4` (constantes `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`)
- No modifica código: `tienda/lib/firebaseAdmin.js` (ya lee todo de la env var — solo cambia el *valor* de esa env var en Vercel, no el archivo)

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `checkout.js`, `catalogo.js`, `producto.js`, `notify-transfer.js` (que usan `tienda/lib/firestore.js`) y `webhook.js` (que usa `firebaseAdmin.js`) leyendo/escribiendo `sbbarbertienda`.

- [ ] **Paso 1: Actualizar las constantes en `tienda/lib/firestore.js`**:

```js
const FIREBASE_PROJECT_ID = 'sbbarbertienda';
const FIREBASE_API_KEY = 'AIzaSyDUtDcLaDXddPWxA0OGqb1TDES-QbvTXCE';
```

- [ ] **Paso 2: Actualizar la env var `FIREBASE_SERVICE_ACCOUNT` en Vercel** (proyecto `tienda`, no en el repo): Vercel Dashboard → proyecto de la tienda → Settings → Environment Variables → editar `FIREBASE_SERVICE_ACCOUNT` → pegar el **contenido completo del JSON** descargado en la Task 1 Paso 4 (el del proyecto `sbbarbertienda`, no el del viejo). Aplicar a Production y Preview. Esto es manual en el dashboard de Vercel — no se hace desde el repo.

- [ ] **Paso 3: Redeploy en Vercel** para que la función tome la nueva env var (un simple push del commit del paso 1 ya dispara esto; si se cambia solo la env var sin tocar código, hace falta un redeploy manual desde el dashboard).

- [ ] **Paso 4: Verificar manualmente**: hacer una compra de prueba de bajo monto (o revisar `tienda/api/catalogo.js` con una request directa a `https://tienda.sbbarber.com.ar/api/catalogo`) y confirmar en Firebase Console → `sbbarbertienda` → Firestore que aparecen documentos nuevos en `tienda_pedidos`/lecturas del catálogo, y que **no** aparece nada nuevo en el proyecto viejo `sb-barber-6dc16`.

- [ ] **Paso 5: Commit**

```bash
git add tienda/lib/firestore.js
git commit -m "feat(tienda): apuntar el backend serverless al proyecto sbbarbertienda"
```

---

### Task 5: Migrar los datos existentes del proyecto viejo al nuevo

**Files:**
- Create: `scripts/migrar-tienda-firebase.mjs` (script de uso único, se puede borrar después de correrlo con éxito — o dejarlo en el repo como referencia, a criterio del usuario)

**Interfaces:**
- Consumes: las dos claves de cuenta de servicio generadas en la Task 1 (paths locales, fuera del repo).
- Produces: las colecciones `tienda_*` copiadas en `sbbarbertienda`, con el mismo `id` de documento que tenían en `sb-barber-6dc16`.

- [ ] **Paso 1: Instalar `firebase-admin` en la raíz del repo** si no está ya disponible ahí (ya es dependencia de `tienda/api`, pero el script corre desde la raíz por simplicidad):

```bash
npm install --no-save firebase-admin
```

- [ ] **Paso 2: Escribir `scripts/migrar-tienda-firebase.mjs`**:

```js
// Uso único: copia las colecciones tienda_* del proyecto viejo al nuevo.
// Correr con: node scripts/migrar-tienda-firebase.mjs
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const OLD_KEY_PATH = 'C:/Users/Agus/Desktop/sb_barber_secrets/sb-barber-6dc16-service-account.json';
const NEW_KEY_PATH = 'C:/Users/Agus/Desktop/sb_barber_secrets/sbbarbertienda-service-account.json';

const COLLECTIONS = [
    'tienda_productos',
    'tienda_productos_custom',
    'tienda_kits_custom',
    'tienda_cursos',
    'tienda_config',
    'tienda_pedidos',
    'tienda_visitas'
];

const oldApp = initializeApp({ credential: cert(JSON.parse(readFileSync(OLD_KEY_PATH, 'utf8'))) }, 'old');
const newApp = initializeApp({ credential: cert(JSON.parse(readFileSync(NEW_KEY_PATH, 'utf8'))) }, 'new');
const oldDb = getFirestore(oldApp);
const newDb = getFirestore(newApp);

for (const col of COLLECTIONS) {
    const snap = await oldDb.collection(col).get();
    console.log(`${col}: ${snap.size} documentos`);
    let batch = newDb.batch();
    let count = 0;
    for (const docSnap of snap.docs) {
        batch.set(newDb.collection(col).doc(docSnap.id), docSnap.data());
        count++;
        if (count % 400 === 0) {
            await batch.commit();
            batch = newDb.batch();
        }
    }
    if (count % 400 !== 0) await batch.commit();
}

console.log('Migración completa.');
```

- [ ] **Paso 3: Correr el script**:

```bash
node scripts/migrar-tienda-firebase.mjs
```

Expected: imprime la cantidad de documentos de cada colección y termina con "Migración completa." sin errores.

- [ ] **Paso 4: Verificar en Firebase Console** que `sbbarbertienda` → Firestore tiene la misma cantidad de documentos por colección que se imprimió en la consola, comparando contra `sb-barber-6dc16` → Firestore para las mismas colecciones.

- [ ] **Paso 5: Commit** (el script, no los datos ni las claves):

```bash
git add scripts/migrar-tienda-firebase.mjs
git commit -m "chore(tienda): script de migración de datos a sbbarbertienda"
```

---

### Task 6: Verificación end-to-end y limpieza

**Files:** ninguno de código — checklist manual.

- [ ] **Paso 1: Storefront público** — abrir `https://tienda.sbbarber.com.ar` en una ventana de incógnito (sin cache), confirmar que el catálogo carga con los productos migrados y que `tienda_visitas` recibe un documento nuevo en `sbbarbertienda` (no en el proyecto viejo).
- [ ] **Paso 2: Checkout completo** — hacer un pedido de prueba de punta a punta (agregar al carrito, checkout, ver que aparece en `tienda_pedidos` de `sbbarbertienda` con el precio validado server-side).
- [ ] **Paso 3: Admin** — loguearse en `tienda/admin.html` con cada uno de los dos usuarios admin, confirmar que puede editar stock/precio/pedidos y que el cambio se refleja en `sbbarbertienda`.
- [ ] **Paso 4: Webhook de MercadoPago** — si es posible probarlo en un pedido de test, confirmar que `tienda/api/webhook.js` marca `aprobado: true` en el pedido correcto dentro de `sbbarbertienda`.
- [ ] **Paso 5: Confirmar que el proyecto viejo dejó de recibir tráfico de la tienda** — revisar Firebase Console → `sb-barber-6dc16` → Uso, y ver que las lecturas/escrituras bajan una vez migrado (dato progresivo, se nota en las horas/días siguientes, no al instante).
- [ ] **Paso 6 (opcional, esperar unos días de uso real antes de decidir):** una vez confirmado que todo funciona de forma estable en `sbbarbertienda`, evaluar borrar las colecciones `tienda_*` del proyecto viejo (`sb-barber-6dc16`) para liberar espacio — **no hacerlo en la misma sesión que la migración**, dejar un margen de días por si hace falta volver atrás.
- [ ] **Paso 7: Actualizar la memoria del proyecto** — pedirle a Claude (en cualquier sesión futura) que actualice `architecture-hosting.md` para reflejar que la tienda vive en su propio proyecto Firebase (`sbbarbertienda`), separado de `sb-barber-6dc16`, y que anote la limitación conocida: `recepcionista`/`menu` siguen leyendo `tienda_productos` del proyecto viejo (dato ahora desactualizado/no mantenido — el stock real se gestiona a mano en `tienda/admin.html`).

---

## Self-Review

- **Cobertura:** config cliente (Task 3), backend serverless + env var (Task 4), reglas de seguridad (Task 2), cuentas/Auth (Task 1), migración de datos (Task 5), verificación (Task 6) — cubre todo lo necesario para que la tienda funcione de forma autónoma en el proyecto nuevo.
- **Fuera de alcance, explícito:** no se toca `recepcionista`/`menu` (decisión del usuario); no se actualiza el spec del centro de estadísticas (queda como nota para revisar más adelante, ver sección Spec arriba); no se borra nada del proyecto viejo en este plan (Task 6 Paso 6 es una decisión posterior, deliberadamente pospuesta).
- **Placeholders:** ningún paso queda sin el código/comando exacto — el único dato que el propio usuario debe completar a mano son las contraseñas de Authentication (Task 1) y pegar el JSON de service account en Vercel (Task 4), que por diseño no deben pasar por el chat ni por el repo.
