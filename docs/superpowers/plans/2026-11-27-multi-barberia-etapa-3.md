# Multi-barbería — Etapa 3: el login abre la barbería de cada usuario

**Objetivo:** que un admin o barbero de otra barbería entre con su mail y contraseña (en la app del celu o en la web)
y caiga directo en **su** barbería, viendo y escribiendo solo sus datos. **SB Barber no cambia nada visible.**

Hecho antes: etapa 1 (config en `barberias/{id}`, commit 0d59160) y etapa 2 (datos en `barberias/{id}/...` vía
`ruta()`, commit f92fb94; probado con `?barberia=prueba` como dueño).
Fuera de esta etapa: panel del dueño con pantallas para dar de alta barberías (etapa 4), servicios/precios por
barbería, turnos públicos y ML por barbería (etapa 5).

## Cómo sabe la app de qué barbería es cada usuario: *custom claims*

Firebase Auth deja guardar datos fijos dentro de la sesión del usuario (los ve la app y los ven las reglas,
**sin leer Firestore**, o sea sin gastar cuota). A cada usuario de otra barbería se le pone:

```js
{ barberia: 'la-barberia-de-juan', rol: 'admin' }   // o rol: 'barbero'
```

- Solo se pueden poner desde el servidor (cuenta de servicio). Nadie los puede cambiar desde el celu.
- **Las cuentas de SB Barber no se tocan:** sin claim = SB Barber, como hoy. Las reglas de SB siguen por email.

## Pasos

### 1. Servidor: dar de alta usuarios (`tienda/api/uso.js?action=usuario`, solo dueños)

Va como `action` en una función existente (límite de 12 en Vercel). Con `FIREBASE_SERVICE_ACCOUNT_BARBER`:

- Recibe `{ barberia, email, nombre, rol, password? }`. Valida que `barberias/{barberia}` exista y que no sea `sb-barber`.
- Crea el usuario en Auth (o lo busca si ya existe) y le pone `{ barberia, rol }`.
- Lo agrega a la config de esa barbería: a `admins` si es admin, a `barberos` (con nombre y email) si es barbero.
- Si no se manda contraseña, genera una y la devuelve **una sola vez** para que se la pases a la persona.
- También `action=usuario-baja` (saca el claim y lo desactiva en Auth; los cortes viejos quedan).

Mientras no exista el panel (etapa 4) lo llamo yo desde tu sesión de recepcionista, como con ML.

### 2. `assets/config-barberia.js`: la barbería sale del login

Hoy `BARBERIA_ID` sale de la URL y se calcula al cargar (antes del login). Las rutas se arman con eso, así que
tiene que saberse al arrancar. Queda así:

1. Al cargar: `?barberia=` de la URL (dueños, para soporte) → si no, la última guardada en el dispositivo
   (`sb_barberia_actual`) → si no, `sb-barber`.
2. Al iniciar sesión, `exigirAcceso(user)` lee los claims (`getIdTokenResult`):
   - **Dueño:** puede estar en cualquiera (como hoy).
   - **Usuario con claim:** si la barbería cargada no es la suya, guarda la suya en el dispositivo y recarga.
   - **Usuario sin claim (staff de SB):** si está en otra que no sea SB, vuelve a SB.
3. Al cerrar sesión se borra `sb_barberia_actual`, así el próximo que entre en ese celu arranca limpio.

Costo: una recarga la primera vez que alguien de otra barbería entra en un dispositivo. Después ya arranca en la suya.

### 3. Quién va a recepcionista y quién a anotar

- `panel/` (la app del celu): hoy usa una lista fija de admins. Pasa a: dueños y `rol: 'admin'` → recepcionista;
  el resto → anotar. Staff de SB sin claim: igual que hoy (lista de admins de SB).
- Recepcionista y anotar ya toman `ADMINS` de la config de la barbería (etapa 1). Se agrega que un barbero que
  abre recepcionista lo mande a anotar (hoy depende de la lista de SB).

### 4. Reglas de Firestore

```
function miBarberia(id) { return request.auth != null && request.auth.token.barberia == id; }
function esAdminDe(id)  { return miBarberia(id) && request.auth.token.rol == 'admin'; }

match /barberias/{id} {                       // la config
  allow read:  if esStaff() || miBarberia(id);
  allow write: if esDueno();                  // los barberos/admins los da de alta el servidor
}
match /barberias/{id}/{col}/{d=**} {          // sus datos
  allow read, create, update: if esDueno() || miBarberia(id);
  allow delete: if esDueno() || esAdminDe(id);
}
match /push_tokens/{t} {                      // también los de otras barberías, con su propio email
  allow create, update: if (esStaff() || request.auth.token.barberia is string)
                        && request.resource.data.email == request.auth.token.email;
}
match /uso_lecturas/{d} {                     // la cuota es del proyecto entero: también cuentan
  allow create, update: if request.auth.token.barberia is string;
}
```

- Sin `get()` en ninguna regla (no gasta lecturas).
- El staff de SB sigue sin ver `barberias/x/...` (el comodín ya excluye `barberias` desde la etapa 2).
- Un usuario de otra barbería **no** es `esStaff()`: no ve nada de SB (cortes, caja, tienda admin, ML).
- `esDueno()` sigue por email (somos nosotros, para soporte).

### 5. Push

`assets/push.js` guarda también `barberia` en el token. `tienda/api/push.js` elige destinatarios por email
(config de la barbería del turno): ya funciona así; se revisa que un turno de otra barbería no le llegue a SB.

### 6. Prueba (con `barberias/prueba`, que ya existe)

1. Dar de alta con el paso 1 un admin y un barbero de prueba (mails tuyos o inventados; Firebase no los verifica).
2. **Vos** entrás en la app/web con esas cuentas (yo no ingreso contraseñas): el admin tiene que caer en
   recepcionista de "prueba" y el barbero en anotar de "prueba". Cargar un corte y una venta.
3. Yo verifico por consola: los datos quedaron en `barberias/prueba/...` y nada en SB.
4. Con la cuenta de prueba, intentar leer `all_cuts` de SB → tiene que dar *permiso denegado*.
5. SB Barber: abrir recepcionista y anotar con las cuentas de siempre → todo igual, sin errores, cierre igual.
6. Publicar reglas por Chrome (como en la etapa 2).

## Riesgos

| Riesgo | Cómo se evita |
|---|---|
| Romper el login de SB | SB no usa claims: el camino "sin claim" es el de hoy. Las reglas de SB no cambian. |
| Un usuario de otra barbería ve datos de SB | No está en `esStaff()` (lista por email) y el comodín excluye `barberias`. Se prueba en el paso 6.4. |
| Claims viejos en el celu tras cambiarlos | Se fuerza `getIdToken(true)` al entrar; los claims nuevos se ven en el próximo login o en ≤1 h. |
| Contraseñas | Las genera el servidor, se muestran una vez y no quedan en el repo ni en Firestore. |
| Cuota Firebase | Claims = 0 lecturas. Solo 1 recarga por dispositivo nuevo. |

## Archivos

`assets/config-barberia.js`, `assets/push.js`, `panel/index.html`, `recepcionista/index.html` (logout + rol),
`anotar/index.html` (logout), `tienda/api/uso.js` + `tienda/lib/usuarios.js` (nuevo), `firestore.rules`, `CLAUDE.md`.
