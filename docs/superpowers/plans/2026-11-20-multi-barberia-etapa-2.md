# Multi-barbería — Etapa 2: datos separados por barbería

**Objetivo:** que cada barbería guarde sus cortes, ventas, caja, retiros, stock, etc. en su propio lugar, sin
poder ver los de otra. **SB Barber no cambia nada visible** y sigue andando durante todo el proceso.

Etapa 1 (hecha, commit 0d59160): config en `barberias/{id}` + `assets/config-barberia.js`.
Fuera de esta etapa: login que elige la barbería (etapa 3), panel del dueño (etapa 4), turnos públicos/ML por barbería (etapa 5).

## Decisión clave: SB Barber NO se muda (cambio respecto de lo hablado el 2026-11-04)

Lo hablado era "migrar los datos de SB Barber con backup". Propuesta nueva: **SB Barber se queda en las rutas
de hoy y las barberías nuevas van debajo de `barberias/{id}/...`.** Motivos:

| | Mudar SB Barber | Dejarla donde está (propuesto) |
|---|---|---|
| Cuota Firebase (Spark, 50k lecturas / 20k escrituras por día, hoy ~50% usado) | 1 lectura + 1 escritura por documento: `all_cuts` + ventas + retiros pueden pasar las 20k escrituras → un día sin caja | 0 lecturas extra |
| Riesgo con la caja en vivo | Ventana donde unos dispositivos escriben en la ruta vieja y otros en la nueva | Ninguno: las rutas de SB no cambian |
| App vieja instalada en celus (APK sin actualizar) | Escribe en la ruta vieja → datos "perdidos" | Sigue andando |
| Backup / estadísticas / tienda/api (ML, Flex, push, uso) | Hay que tocarlos todos a la vez | No se tocan |
| Prolijidad | Todas iguales | SB es "la barbería 1" con rutas propias (un `if` en un solo lugar) |

Si algún día conviene unificar (por ejemplo al pasar a Blaze o a Supabase), se muda con un script en un domingo, con backup.

## Diseño

### Una función para todas las rutas: `assets/rutas-barberia.js`

```js
// SB Barber usa las rutas de siempre; las demás, barberias/{id}/{coleccion}
export function ruta(coleccion) {
  const id = barberiaActual();               // de config-barberia.js; por defecto 'sb-barber'
  if (id === 'sb-barber') return RUTAS_SB[coleccion] ?? coleccion;
  return `barberias/${id}/${coleccion}`;
}
const RUTAS_SB = { cortes: 'artifacts/sb-barber-6dc16/public/data/all_cuts' };   // única que no es 1:1
```

En recepcionista, anotar, estadísticas y `assets/*.js` las constantes `PATH_*` pasan a `ruta('...')`
(se arman al cargar, después de saber la barbería). Para SB Barber dan **exactamente el mismo texto** que hoy,
así que el resto del código no cambia.

### Qué colecciones son de cada barbería

| Por barbería (pasan por `ruta()`) | Siguen globales / solo SB |
|---|---|
| `all_cuts` (cortes), `barber_profiles`, `settings`, `expenses`, `stock_items`, `stock_movimientos`, `stock_conteos`, `perdidos`, `ventas_productos`, `productos_barber`, `productos_movimientos`, `turnos`, `gastos`, `conteos_caja`, `sessions`, `retiros`, `propinas`, `ajustes_semanales`, `pagos_semanales`, `config_precios`, `clientes`, `retiros_socios` | `barberias` (config), `push_tokens` (se le suma el campo `barberia`), `uso_lecturas`/`uso_avisos` (la cuota es del proyecto entero), `ml_*`, `flex_*`, `pickit_despachos`, `ml_despachos`, `menu_bebidas`, `tienda_*` (módulos solo de SB, ya ocultos por `modulos`), `barbershop` (legacy, solo lectura en SB) |

### Reglas de Firestore

1. **Arreglo necesario:** hoy la regla comodín `/{coleccion}/{document=**}` también cubriría
   `barberias/otra/retiros/...` (con `coleccion == 'barberias'`), o sea que un barbero de SB podría leer datos de otra
   barbería. Hay que excluir `barberias` del comodín: `!(coleccion in ['ml_config','ml_ordenes','barberias'])`.
   `barberias/{id}` (el doc de config) sigue con su regla propia.
2. Nueva: `match /barberias/{id}/{col}/{doc=**}`, que mientras no exista la etapa 3 sea **solo dueños** (nosotros,
   para probar con una barbería de prueba). En la etapa 3 se abre con *custom claims* (`request.auth.token.barberia == id`),
   sin `get()` (cada `get()` en reglas cuesta una lectura).

### Cómo se elige la barbería en esta etapa

Todavía no hay login por barbería (etapa 3). Para probar: `?barberia=prueba` en la URL, **solo si el usuario
logueado es dueño**; cualquier otro caso → `sb-barber`. Así nadie puede caer en otra barbería por error.

## Pasos

1. `assets/rutas-barberia.js` + `barberiaActual()` en `config-barberia.js` (con `?barberia=` solo para dueños).
2. Recepcionista: `PATH_*` y los nombres sueltos (`'clientes'`, `'productos_movimientos'`, `'propinas'`, `'perdidos'`, `'turnos'`) → `ruta()`.
3. Anotar, estadísticas, `assets/clientes.js`, `assets/retiros-socios.js`: lo mismo.
4. **Verificación "sin cambio" en SB:** un script compara, para cada constante, la ruta vieja con `ruta()` de SB → tienen que ser idénticas (prueba automática, sin tocar Firestore). Además, abrir recepcionista y anotar y ver los mismos números del día.
5. Reglas: excluir `barberias` del comodín + regla nueva; publicar.
6. Crear `barberias/prueba` (config mínima, sin módulos) y probar con `?barberia=prueba`: anotar un corte, una venta, un retiro, cerrar caja → todo queda en `barberias/prueba/...` y SB no lo ve.
7. Backup semanal: sumar las subcolecciones de `barberias/*` (topes actuales alcanzan).
8. Commit y push. APK: no hace falta recompilar (la app abre la web).

## Costo en cuota

Cero lecturas extra para SB Barber (mismas consultas, mismas rutas). La barbería de prueba suma unas decenas de lecturas al probar.
