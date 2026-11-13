# Multi-barbería — Etapa 1: configuración de la barbería en Firestore

**Objetivo:** que todo lo que hoy está escrito a mano para SB Barber (barberos, admins, comisiones, servicios,
colores, atajos) salga de **un documento de configuración** en Firestore. SB Barber pasa a ser "la barbería 1".
**Sin cambio visible:** recepcionista, anotar y la app tienen que verse y calcular exactamente igual que hoy.

Fuera de esta etapa: separar los datos por barbería (etapa 2), el login que elige la barbería (etapa 3),
el panel del dueño para dar de alta barberías (etapa 4), turnos públicos y ML por barbería (etapa 5).

## Qué está fijo hoy (relevado 2026-11-13)

| Dato | Dónde |
|---|---|
| Admins (2 emails) | `recepcionista` `ADMINS`, `anotar` `ADMINS`, `panel/` `ADMINS`, `tienda/lib/barberAdmin.js` `OWNERS`, `firestore.rules` `esDueno()` |
| Barberos y sus emails | `BARBER_EMAIL_MAP`, `BARBERS` / `BARBERS_LIST` (recepcionista y anotar), `esStaff()` en reglas, `BARBEROS_BASE` en `tienda/lib/push.js`; ya existe la colección `barberos` (hoy 1 doc: Santi) que suma barberos nuevos |
| Colores / inicial por barbero | `BARBER_THEME` (incluye ex barberos: Maxi) + `BARBER_EXTRA_THEMES` |
| Comisiones | `BARBER_COMISION` + `comisionCorte()` con la regla especial de Santi F (40% en Mechas/Global/Color desde 11/11/2026, 40% todo antes) |
| Servicios y precios | `SERVICES` en recepcionista y anotar; precios sobreescritos desde `config_precios/servicios`; Mechas y Global solo para SantiF (filtro fijo) |
| Botones con nombres | compradores de bebidas en recepcionista (`setDrinkComprador('Tony'...)`), `<option value="Tony">` en anotar |
| Atajos de descuento | Ctrl+Shift+7 Tony / Ctrl+Shift+6 Stefa, $5.000 (`ajustes_semanales`) |
| Productos base | `PRODUCTOS_BARBER_BASE` (recepcionista y anotar) |
| Rutas | `artifacts/sb-barber-6dc16/public/data/all_cuts` y ~20 colecciones sueltas (se tocan en la etapa 2, no acá) |

## Diseño

### Un documento: `barberias/sb-barber`

```js
{
  nombre: 'SB Barber',
  admins: ['abalo7272@gmail.com', 'carusomanu21@gmail.com'],
  barberos: [
    { nombre: 'Tony',   email: 'ap1773508@gmail.com',            color: 'blue',   inicial: 'T',  comision: 0.5, activo: true },
    { nombre: 'Stefa',  email: 'stefanoacostasla@gmail.com',     color: 'purple', inicial: 'S',  comision: 0.5, activo: true },
    { nombre: 'Santi',  email: 'rodriguezsantiagoet5@gmail.com', color: 'orange', inicial: 'Sa', comision: 0.5, activo: true },
    { nombre: 'SantiF', email: 'santiagofl551@gmail.com',        color: 'pink',   inicial: 'F',  comision: 0.5, activo: true,
      servicios: ['Mechas', 'Global'],                       // servicios que solo hace él
      reglasComision: [
        { hasta: '2026-11-10', comision: 0.4 },              // todo al 40% antes del 11/11
        { desde: '2026-11-11', servicios: ['mechas', 'global', 'color'], comision: 0.4 }
      ] },
    { nombre: 'Maxi', color: 'emerald', inicial: 'M', activo: false }   // ex: solo para ver datos viejos
  ],
  servicios: [ { nombre: 'Corte', precio: 16000 }, ... ],    // hoy SERVICES; config_precios/servicios sigue mandando en el precio
  atajos:    [ { tecla: 'Digit7', barbero: 'Tony', monto: 5000 }, { tecla: 'Digit6', barbero: 'Stefa', monto: 5000 } ],
  // Lo que es propio de este local. Una barbería nueva arranca con todo en false (no ve ni el botón).
  modulos:   { mercadolibre: true, pickit: true }
}
```

**Módulos por barbería (pedido del usuario 2026-11-13):** "Historial ML" (y todo lo de MercadoLibre: enlazar
productos, ventas por canal `ml`) es solo de SB Barber; en la versión que se vende **no tiene que aparecer**.
Cada pantalla/botón de un módulo se muestra solo si `modulos.<nombre>` es `true`. Sin config cargada
(respaldo), SB Barber los ve como hoy.

### Cómo lo cargan las apps (`assets/config-barberia.js`, compartido)

1. Al entrar se lee **una vez** el doc (1 lectura; con `onSnapshot` de un solo doc, los cambios llegan solos).
2. Mientras no llega: se usa la última config guardada en `localStorage`, y si no hay, **los valores de hoy escritos en el código** como respaldo. Así SB Barber nunca se rompe aunque falle la red o el doc.
3. Las variables actuales (`ADMINS`, `BARBER_EMAIL_MAP`, `BARBERS`, `BARBER_THEME`, `BARBER_COMISION`, `SERVICES`...) se arman desde la config, así el resto del código (miles de líneas) no se toca.
4. `comisionCorte()` pasa a ser genérica: lee `reglasComision` del barbero en vez del `if (barber === 'SantiF')`.
5. Los botones con nombres fijos (compradores de bebidas, `<option>` de anotar) se generan desde `barberos`.
6. Los atajos de teclado se arman desde `atajos`.
7. Botones y pantallas de MercadoLibre (Historial ML, enlazar con ML) y de Pickit, según `modulos`.

### Lo que queda igual en esta etapa (a propósito)

- **Reglas de Firestore:** siguen con los emails escritos. Leer la config desde las reglas (`get()`) **cuesta una lectura por cada operación** y hoy estamos al 50% de la cuota diaria. Se resuelve en la etapa 3 con *custom claims* (el rol va dentro del login, sin lecturas).
- **`panel/`, `tienda/lib/barberAdmin.js`, `tienda/lib/push.js`:** siguen con sus listas; pasan a leer la config en la etapa 3.
- Rutas y colecciones: etapa 2.

## Pasos

1. Script `scripts/crear-config-sb.mjs` que crea `barberias/sb-barber` con los valores de hoy (revisarlo antes de correrlo).
2. Regla: `barberias/{id}` lectura para staff, escritura solo dueños.
3. `assets/config-barberia.js` + conectar recepcionista (variables, comisiones, servicios, botones, atajos).
4. Lo mismo en anotar.
5. **Verificación de "sin cambio visible":** antes y después, comparar en recepcionista el cierre diario y semanal de una semana pasada (incluida la del 11/11 por la regla de Santi F) y en anotar los números de cada barbero. Tienen que dar idénticos.
6. Probar sin internet / con el doc borrado: tiene que seguir andando con el respaldo.
7. Commit y push; avisar a los barberos que no cambia nada.

## Para decidir antes de arrancar

- `settings/commissions` (lo edita anotar con "Guardar Cambios") — revisar qué guarda y si se unifica con `barberos[].comision` o queda aparte.
- La colección `barberos` (barberos agregados desde la app): ¿se mantiene como está o se pasa a la lista de la config? Propuesta: pasarla a la config en esta etapa y dejar de usar la colección.
- Productos base (`PRODUCTOS_BARBER_BASE`): propuesta, dejarlos para la etapa 2 (son datos de stock, no configuración).
