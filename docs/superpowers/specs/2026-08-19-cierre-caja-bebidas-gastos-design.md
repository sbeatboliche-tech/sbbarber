# Cierre de caja: retiros de bebida, gastos por método de pago, y ventas de bebida — Design

Fecha: 2026-08-19

## Contexto / problema

El cierre de caja (`anotar/index.html` y `recepcionista/index.html`, funciones `renderCierreDia`/`renderCierreCaja` y sus variantes semanales) tiene varias inconsistencias entre lo que representan los tiles Efectivo/Transferencia/Total del día y la plata real del negocio:

1. Cuando un barbero o FEME retira una bebida para consumo propio, hoy se registra como un `retiro` más y se resta del tile de Efectivo en `recepcionista` — pero esa bebida ya fue pagada por el dueño con otra plata (no la que está en la caja ese día), así que no debería restar de la caja.
2. Los `gastos` ya tienen un campo `metodoPago` (efectivo/transferencia) pero hoy solo se restan del "Total del día" para armar "Neto real" — nunca se restan de los tiles Efectivo/Transferencia específicamente.
3. Las ventas de bebida a clientes reales quedan totalmente excluidas de Productos/Total del día/Efectivo/Transferencia (el filtro excluye `tipo==='bebida'` sin distinguir cliente de consumo interno), a pesar de haber sido pagadas.
4. Las ventas de productos por canal ML (`canal==='ml'`) hoy sí entran al Total del día, aunque esa plata no pasa por la caja física del local.
5. FEME y Santi faltan de forma inconsistente en varios selectores de "quién retira/compra" una bebida, en ambas apps.

## Alcance

Archivos afectados: `anotar/index.html`, `recepcionista/index.html`. No se toca `gastos fijos` (doc único de costos mensuales) ni la colección `expenses` ("gastos variables" del widget de ganancia neta semanal en `anotar`) — son conceptos separados que no participan del cierre de caja.

No se migran/reclasifican documentos ya existentes en Firestore (`retiros`, `ventas_productos`). El fix aplica hacia adelante.

## 1. Modelo de datos: distinguir consumo interno de venta real

**`ventas_productos`** — al crear un doc de venta de bebida donde el "comprador" es un barbero o FEME (no un cliente), agregar:
```js
esConsumoStaff: true
```
No se agrega este campo (o queda `false`/ausente) en ventas a clientes reales y en ventas de productos no-bebida.

Sitios a modificar:
- `anotar/index.html` — submit de `stock-item-form` (rama `esRetiro`, alrededor de línea 1826).
- `recepcionista/index.html` — submit de `movement-form` (rama bebida/venta con comprador barbero, alrededor de línea 1608) y `window.quickSale` (alrededor de línea 1783).

**`retiros`** — al crear el doc de retiro que se genera automáticamente por consumo de bebida, agregar:
```js
origen: 'bebida'
```
Los retiros manuales de plata en efectivo (auto-solicitud del barbero, o carga manual del admin en `openRetiroManualModal`) no llevan este campo — se los sigue tratando como retiro de efectivo normal.

Sitios a modificar:
- `anotar/index.html` — creación de retiro dentro del submit de `stock-item-form` (alrededor de línea 1836).
- `recepcionista/index.html` — creación de retiro dentro de `movement-form` (alrededor de línea 1617) y dentro de `quickSale` (alrededor de línea 1790).

## 2. Retiros de bebida no restan de Efectivo/Transferencia, pero sí de lo que se le paga al barbero

**`recepcionista/index.html` — `renderCierreCaja()` (diario, ~líneas 2449-2453):**
Filtrar `retirosHoy` para excluir `origen === 'bebida'` antes de calcular `retiroEfectivo`/`retiroTransferencia`. Los retiros de bebida ya no aparecen restando en los tiles Efectivo/Transferencia.

**Confirmado sin cambios:** el cálculo de "a cobrar"/balance de cada barbero (en `anotar/index.html` — `renderCierreDia`/`renderCierreSemana`, y en `recepcionista/index.html` — `renderCierreCajaSemanal`) sigue restando **todos** los retiros del período (efectivo + bebida) de lo que se le paga a ese barbero. Ejemplo: si Tony cortó $100.000 en la semana (50% = $50.000 le corresponde) y retiró una Coca de $2.000, su "a cobrar" sigue siendo $48.000 — solo cambia que esos $2.000 dejan de restar del efectivo/transferencia del negocio.

Esto aplica igual para Santi y FEME una vez agregados de forma consistente (sección 5).

## 3. Gastos restan también de Efectivo o Transferencia según su método de pago

En los 4 sitios donde hoy se calcula `totalGastos`/`totalGastosW`/`totalGastosWeek` (recepcionista diario ~2456-2458, recepcionista semanal ~2618-2619, anotar diario ~2399-2401, anotar semanal ~2586-2589), calcular además:
```js
const gastoEfectivo = gastosHoy.filter(g => g.metodoPago !== 'transferencia').reduce((s,g) => s+(g.monto||0), 0);
const gastoTransferencia = gastosHoy.filter(g => g.metodoPago === 'transferencia').reduce((s,g) => s+(g.monto||0), 0);
```
Y restar `gastoEfectivo`/`gastoTransferencia` de los tiles `efectivo`/`transferencia` existentes, en los sitios donde esos tiles existen hoy: `recepcionista` diario y `anotar` diario (ambos ya tienen tiles Efectivo/Transferencia). Las vistas semanales de ambas apps no tienen hoy tiles Efectivo/Transferencia — quedan fuera de este punto (no se agregan tiles nuevos, solo se corrige el dato que ya existe).

"Neto real" (`totalGeneral - totalGastos`) no cambia — sigue restando el total de gastos sin separar por método, eso ya funciona bien.

## 4. Ventas de bebida a clientes suman al cierre; ML no suma nada

Se reemplaza el filtro `v.tipo !== 'bebida'` (usado para armar `ventasProductos`/Productos/Total del día, en los 4 render de cierre) por una condición que incluye una venta si:
```js
(v.canal !== 'ml') && !v.esConsumoStaff
```
Esto tiene el efecto de:
- **Bebida vendida a un cliente**: `tipo==='bebida'`, `esConsumoStaff` ausente/false, `canal` no es `'ml'` → **cuenta** en Productos/Total/Efectivo-Transferencia según su `metodoPago`.
- **Bebida retirada por barbero/FEME**: `esConsumoStaff===true` → **no cuenta** como venta (se seguía viendo reflejada solo como retiro, corregido en la sección 2).
- **Producto (no bebida) vendido por ML**: `canal==='ml'` → **no cuenta** en ningún tile del cierre (ni Productos, ni Total del día, ni Efectivo/Transferencia).
- **Producto vendido en el local**: sin cambios, sigue contando como hoy.

Para que las bebidas de cliente también se reflejen en Efectivo/Transferencia (no solo en el Total del día), se extiende el cálculo de `efectivoBruto`/`transferenciaBruto` (hoy armado solo desde `cuts`) para incluir también las ventas de productos que cumplen la condición de arriba, separadas por `metodoPago` de la misma forma que ya se hace con cortes y gastos. Aplica en `recepcionista` diario y `anotar` diario (los únicos con tiles Efectivo/Transferencia).

## 5. FEME y Santi consistentes en selectores de bebida

| App | Selector | Problema | Fix |
|---|---|---|---|
| `anotar` | `renderVentaBarberos` (~1780-1786) | Armado desde `BARBER_EMAIL_MAP`, que no tiene el email de Santi → Santi no aparece | Armar la lista desde `BARBERS_LIST` en vez de `BARBER_EMAIL_MAP` |
| `anotar` | `window.openRetiroManualModal` (~1300-1311) | Armado desde `BARBERS_LIST`, sin opción FEME | Agregar botón/opción FEME, igual que ya hace `recepcionista` en su modal equivalente |
| `recepcionista` | `movement-modal` botones "¿Para quién?" (~683-699) | Hardcodeado Tony/Maxi/Stefa, sin Santi ni FEME | Agregar botones Santi y FEME |
| `recepcionista` | `quick-sale-modal` grilla (~1747-1762) | Armado desde `BARBERS` (incluye Santi), sin FEME | Agregar FEME a la grilla |

## Fuera de alcance (para otra sesión)

- Vistas semanales de `recepcionista` y `anotar` no ganan tiles nuevos de Efectivo/Transferencia (hoy no existen ahí).
- No se toca `gastos fijos` ni la colección `expenses`.
- No se migran documentos históricos de `retiros`/`ventas_productos`.
