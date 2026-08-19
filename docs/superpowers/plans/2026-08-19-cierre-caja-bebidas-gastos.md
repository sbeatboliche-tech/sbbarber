# Cierre de Caja: Retiros de Bebida, Gastos y FEME/Santi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir el cierre de caja de `anotar/index.html` y `recepcionista/index.html` para que: (a) los retiros de bebida de barberos/FEME no resten de Efectivo/Transferencia (sí de lo que se le paga al barbero), (b) los gastos resten de Efectivo o Transferencia según su método de pago, (c) las bebidas vendidas a clientes sumen al cierre y las ventas por ML no sumen nada, y (d) FEME y Santi estén disponibles en todos los selectores de "quién retira/compra" una bebida.

**Architecture:** Sin build step ni framework — son dos archivos HTML monolíticos con JS inline (`anotar/index.html`, `recepcionista/index.html`) que leen/escriben las mismas colecciones de Firestore (`ventas_productos`, `retiros`, `gastos`, `stock_items`). El fix agrega dos campos nuevos al escribir documentos (`esConsumoStaff` en `ventas_productos`, `origen` en `retiros`) y usa esos campos (más los ya existentes `metodoPago`/`canal`) para recalcular los totales de cierre. No se migra ni se reescribe ningún documento histórico.

**Tech Stack:** HTML + vanilla JS + Firebase Firestore (modular SDK vía `<script type="module">`). Sin test runner — este proyecto se valida con `node --check` sobre el `<script>` extraído (sintaxis) y verificación manual en navegador (dato real). Ver spec para el detalle de decisiones: `docs/superpowers/specs/2026-08-19-cierre-caja-bebidas-gastos-design.md`.

## Global Constraints

- No modificar `gastos fijos` (doc único `PATH_SETTINGS/fixed_expenses`) ni la colección `expenses` ("gastos variables") — no participan del cierre de caja.
- No migrar/reclasificar documentos ya existentes en `retiros` / `ventas_productos`.
- No agregar tiles de Efectivo/Transferencia a las vistas semanales (`renderCierreCajaSemanal` en recepcionista, `renderCierreSemana` en anotar) — hoy no existen ahí y no se piden.
- No agregar FEME a los arrays `BARBERS`/`BARBERS_LIST` (eso lo haría contar como barbero en cortes/comisiones). FEME se maneja siempre como caso especial aparte.
- Commits cortos en español, formato `feat:`/`fix:`, uno por task.
- Verificar sintaxis con `node --check` sobre el `<script type="module">` extraído de cada archivo editado, antes de cada commit.

---

## Task 1: Marcar consumo interno al vender bebida a barbero/FEME (anotar)

**Files:**
- Modify: `anotar/index.html:1826-1841`
- Test: script temporal en `C:\Users\Agus\AppData\Local\Temp\claude\...\scratchpad\test-calc-anotar.mjs` (se borra al final del Task 5)

**Interfaces:**
- Produces: los docs de `ventas_productos` creados acá ahora incluyen `esConsumoStaff: true` cuando `esRetiro` es true (barbero o FEME). Los docs de `retiros` creados acá ahora incluyen `origen: 'bebida'`. Estos dos campos son los que leen las Tasks 4 y 5.

- [ ] **Step 1: Ubicar el bloque a modificar**

Abrí `anotar/index.html` y confirmá que las líneas 1826-1841 son exactamente:

```js
                await addDoc(collection(db,PATH_VENTAS),{
                    producto:currentStockAction.itemName, tipo:'bebida',
                    precio, cantidad:qty, total,
                    barbero:'Admin', userEmail:currentUser.email,
                    comprador: esRetiro ? persona : (cliente||null),
                    compradorTipo: ventaComprador,
                    metodoPago: esRetiro ? null : ventaMetodoPago,
                    fecha:hoy, creadoEn:serverTimestamp()
                });
                if(esRetiro){
                    await addDoc(collection(db,PATH_RETIROS),{
                        barbero:persona, userEmail:currentUser.email, monto:total,
                        fecha:hoy, estado:'confirmado',
                        descripcion:`🥤 ${currentStockAction.itemName}${qty>1?' ×'+qty:''}`,
                        creadoEn:serverTimestamp()
                    });
                }
```

Si no coincide (el archivo cambió desde la exploración), buscá el bloque equivalente dentro del submit handler de `stock-item-form` (rama `currentStockAction.type==='venta'`) y usalo como referencia en vez de los números de línea.

- [ ] **Step 2: Editar el bloque**

Reemplazalo por:

```js
                await addDoc(collection(db,PATH_VENTAS),{
                    producto:currentStockAction.itemName, tipo:'bebida',
                    precio, cantidad:qty, total,
                    barbero:'Admin', userEmail:currentUser.email,
                    comprador: esRetiro ? persona : (cliente||null),
                    compradorTipo: ventaComprador,
                    metodoPago: esRetiro ? null : ventaMetodoPago,
                    esConsumoStaff: esRetiro,
                    fecha:hoy, creadoEn:serverTimestamp()
                });
                if(esRetiro){
                    await addDoc(collection(db,PATH_RETIROS),{
                        barbero:persona, userEmail:currentUser.email, monto:total,
                        fecha:hoy, estado:'confirmado', origen:'bebida',
                        descripcion:`🥤 ${currentStockAction.itemName}${qty>1?' ×'+qty:''}`,
                        creadoEn:serverTimestamp()
                    });
                }
```

- [ ] **Step 3: Validar sintaxis**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('anotar/index.html', 'utf8');
const m = html.match(/<script type=\"module\">([\s\S]*?)<\/script>/);
fs.writeFileSync('/tmp/anotar-script.mjs', m[1]);
"
node --check /tmp/anotar-script.mjs
```

Nota: en Git Bash, `/tmp` existe; si el `node -e` de arriba falla por el path, usá el directorio scratchpad de la sesión en su lugar.

Expected: sin output (sintaxis válida). Si falla, revisá que las comas y llaves del bloque editado cierren igual que el original.

- [ ] **Step 4: Commit**

```bash
git add anotar/index.html
git commit -m "fix(anotar): marcar consumo staff de bebida (esConsumoStaff/origen) para no confundirlo con venta real"
```

---

## Task 2: Marcar consumo interno al vender bebida a barbero/FEME (recepcionista, movement-form)

**Files:**
- Modify: `recepcionista/index.html:1599-1623`

**Interfaces:**
- Consumes: nada de otras tasks.
- Produces: igual que Task 1 pero para el flujo de "Salida marcada como venta" de `recepcionista`. `esConsumoStaff` se determina por `BARBERS.includes(comprador) || comprador === 'FEME'` — **importante**: aunque FEME todavía no tiene botón en este modal (eso lo agrega la Task 7), dejar ya la condición contemplando FEME evita tener que volver a tocar este bloque después.

- [ ] **Step 1: Ubicar el bloque a modificar**

Confirmá que `recepcionista/index.html:1599-1623` es:

```js
        const { itemId, itemName, type } = currentMovement;
        const delta = type === 'compra' ? qty : -qty;
        await updateDoc(doc(db, PATH_STOCK, itemId), { quantity: increment(delta) });
        if (type === 'venta' && drinkSalidaTipo === 'venta') {
            const item = allStock.find(i => i.id === itemId);
            const precio = item?.price || 0;
            const hoy = new Date().toLocaleDateString('en-CA');
            const comprador = document.getElementById('mv-comprador').value || 'cliente';
            const metodo = BARBERS.includes(comprador) ? null : (document.getElementById('mv-metodo-pago').value || 'efectivo');
            await addDoc(collection(db, PATH_VENTAS), {
                producto: itemName, tipo: 'bebida',
                precio, cantidad: qty, total: precio * qty,
                barbero: comprador,
                ...(metodo ? { metodoPago: metodo } : {}),
                userEmail: currentUser.email,
                fecha: hoy, creadoEn: serverTimestamp()
            });
            if (BARBERS.includes(comprador)) {
                await addDoc(collection(db, PATH_RETIROS), {
                    barbero: comprador, monto: Number(precio) * qty, fecha: hoy,
                    estado: 'confirmado', tipo: 'retiro',
                    descripcion: `Bebida: ${itemName}${qty > 1 ? ' ×' + qty : ''}`,
                    userEmail: currentUser?.email || null, creadoEn: serverTimestamp()
                });
            }
        } else if (type === 'venta' && drinkSalidaTipo === 'regalo') {
```

- [ ] **Step 2: Editar el bloque**

Reemplazá desde `const { itemId, itemName, type } = currentMovement;` hasta la línea `} else if (type === 'venta' && drinkSalidaTipo === 'regalo') {` (sin tocar esa última línea del `else if`, que se deja igual) por:

```js
        const { itemId, itemName, type } = currentMovement;
        const delta = type === 'compra' ? qty : -qty;
        await updateDoc(doc(db, PATH_STOCK, itemId), { quantity: increment(delta) });
        if (type === 'venta' && drinkSalidaTipo === 'venta') {
            const item = allStock.find(i => i.id === itemId);
            const precio = item?.price || 0;
            const hoy = new Date().toLocaleDateString('en-CA');
            const comprador = document.getElementById('mv-comprador').value || 'cliente';
            const esStaff = BARBERS.includes(comprador) || comprador === 'FEME';
            const metodo = esStaff ? null : (document.getElementById('mv-metodo-pago').value || 'efectivo');
            await addDoc(collection(db, PATH_VENTAS), {
                producto: itemName, tipo: 'bebida',
                precio, cantidad: qty, total: precio * qty,
                barbero: comprador,
                ...(metodo ? { metodoPago: metodo } : {}),
                esConsumoStaff: esStaff,
                userEmail: currentUser.email,
                fecha: hoy, creadoEn: serverTimestamp()
            });
            if (esStaff) {
                await addDoc(collection(db, PATH_RETIROS), {
                    barbero: comprador, monto: Number(precio) * qty, fecha: hoy,
                    estado: 'confirmado', tipo: 'retiro', origen: 'bebida',
                    descripcion: `Bebida: ${itemName}${qty > 1 ? ' ×' + qty : ''}`,
                    userEmail: currentUser?.email || null, creadoEn: serverTimestamp()
                });
            }
        } else if (type === 'venta' && drinkSalidaTipo === 'regalo') {
```

- [ ] **Step 3: Validar sintaxis**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('recepcionista/index.html', 'utf8');
const m = html.match(/<script type=\"module\">([\s\S]*?)<\/script>/);
fs.writeFileSync('/tmp/recepcionista-script.mjs', m[1]);
"
node --check /tmp/recepcionista-script.mjs
```

Expected: sin output.

- [ ] **Step 4: Commit**

```bash
git add recepcionista/index.html
git commit -m "fix(recepcionista): marcar consumo staff de bebida (esConsumoStaff/origen) en salida por venta, contempla FEME"
```

---

## Task 3: Marcar consumo interno en Venta Rápida (recepcionista, quickSale)

**Files:**
- Modify: `recepcionista/index.html:1774-1798`

**Interfaces:**
- Consumes: nada de otras tasks.
- Produces: igual patrón que Task 2. `quickSale` siempre es consumo de barbero/FEME (el modal no tiene opción "cliente"), así que `esConsumoStaff` y `origen:'bebida'` van siempre en `true`/`'bebida'`, sin condicional.

- [ ] **Step 1: Ubicar el bloque a modificar**

Confirmá que `recepcionista/index.html:1774-1798` es:

```js
window.quickSale = async id => {
    const barbero = document.getElementById('qs-barbero').value;
    if (!barbero) return alert('Seleccioná un barbero primero');
    const item = allStock.find(i => i.id === id);
    if (!item || (item.quantity || 0) < 1) return alert('Sin stock');
    const metodo = document.getElementById('qs-metodo-pago').value;
    try {
        const hoy = new Date().toLocaleDateString('en-CA');
        await updateDoc(doc(db, PATH_STOCK, id), { quantity: increment(-1) });
        await addDoc(collection(db, PATH_VENTAS), {
            producto: item.name, tipo: 'bebida',
            precio: item.price || 0, cantidad: 1, total: item.price || 0,
            metodoPago: metodo,
            barbero, userEmail: currentUser.email,
            fecha: hoy, creadoEn: serverTimestamp()
        });
        await addDoc(collection(db, PATH_RETIROS), {
            barbero, monto: Number(item.price) || 0, fecha: hoy,
            estado: 'confirmado', tipo: 'retiro',
            descripcion: `Bebida: ${item.name}`,
            userEmail: currentUser?.email || null, creadoEn: serverTimestamp()
        });
        closeModals();
    } catch(err) { console.error('quickSale error:', err); alert('Error: ' + (err?.message || err)); }
};
```

- [ ] **Step 2: Editar el bloque**

Reemplazalo por:

```js
window.quickSale = async id => {
    const barbero = document.getElementById('qs-barbero').value;
    if (!barbero) return alert('Seleccioná un barbero primero');
    const item = allStock.find(i => i.id === id);
    if (!item || (item.quantity || 0) < 1) return alert('Sin stock');
    const metodo = document.getElementById('qs-metodo-pago').value;
    try {
        const hoy = new Date().toLocaleDateString('en-CA');
        await updateDoc(doc(db, PATH_STOCK, id), { quantity: increment(-1) });
        await addDoc(collection(db, PATH_VENTAS), {
            producto: item.name, tipo: 'bebida',
            precio: item.price || 0, cantidad: 1, total: item.price || 0,
            metodoPago: metodo,
            esConsumoStaff: true,
            barbero, userEmail: currentUser.email,
            fecha: hoy, creadoEn: serverTimestamp()
        });
        await addDoc(collection(db, PATH_RETIROS), {
            barbero, monto: Number(item.price) || 0, fecha: hoy,
            estado: 'confirmado', tipo: 'retiro', origen: 'bebida',
            descripcion: `Bebida: ${item.name}`,
            userEmail: currentUser?.email || null, creadoEn: serverTimestamp()
        });
        closeModals();
    } catch(err) { console.error('quickSale error:', err); alert('Error: ' + (err?.message || err)); }
};
```

- [ ] **Step 3: Validar sintaxis**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('recepcionista/index.html', 'utf8');
const m = html.match(/<script type=\"module\">([\s\S]*?)<\/script>/);
fs.writeFileSync('/tmp/recepcionista-script.mjs', m[1]);
"
node --check /tmp/recepcionista-script.mjs
```

Expected: sin output.

- [ ] **Step 4: Commit**

```bash
git add recepcionista/index.html
git commit -m "fix(recepcionista): marcar consumo staff de bebida en Venta Rápida (siempre es retiro de barbero/FEME)"
```

---

## Task 4: Recalcular Efectivo/Transferencia/Productos en el cierre diario de recepcionista

**Files:**
- Modify: `recepcionista/index.html:2441-2458`

**Interfaces:**
- Consumes: campos `esConsumoStaff` (Tasks 1-3) y `origen` (Tasks 1-3) en los documentos nuevos de `ventas_productos`/`retiros`. Campo `canal` (ya existente, escrito por `submitVenta`/`producto-movement-form`) y `metodoPago` (ya existente en `gastos`, `ventas_productos`, `retiros`).
- Produces: variables `ventasProductos`, `totalCortes`, `efectivoBruto`, `transferenciaBruto`, `retiroEfectivo`, `retiroTransferencia`, `gastosHoy`, `totalGastos`, `gastoEfectivo`, `gastoTransferencia`, `efectivo`, `transferencia`, `totalProductos`, `totalGeneral`, `netoReal` — mismos nombres que ya usa el resto de `renderCierreCaja()` más abajo (no se renombra nada, solo cambia cómo se calculan).

Antes de escribir código, un test standalone en Node que reproduce la fórmula nueva con datos de ejemplo, para verificar la lógica antes de tocar el HTML real.

- [ ] **Step 1: Escribir el test de la fórmula (falla porque el archivo de fórmula no existe todavía)**

Creá `C:\Users\Agus\AppData\Local\Temp\claude\C--Users-Agus-Desktop-sb-barber\cf3df40e-5336-40f3-b265-2c0a2be45d50\scratchpad\test-cierre-calc.mjs`:

```js
import assert from 'node:assert/strict';
import { calcularCierre } from './cierre-calc.mjs';

// Escenario: 1 corte $10000 efectivo, 1 gasto $2000 efectivo, 1 retiro de bebida $2000
// (no debe restar de efectivo), 1 bebida vendida a cliente $1500 efectivo, 1 producto por ML $5000 (no debe sumar a nada).
const cuts = [{ price: 10000, metodoPago: 'efectivo' }];
const ventasHoy = [
    { tipo: 'bebida', total: 1500, metodoPago: 'efectivo', canal: undefined, esConsumoStaff: false },
    { tipo: 'bebida', total: 2000, metodoPago: null, canal: undefined, esConsumoStaff: true },
    { tipo: 'producto', total: 5000, metodoPago: undefined, canal: 'ml', esConsumoStaff: false },
];
const retiros = [
    { estado: 'confirmado', monto: 2000, metodoPago: null, origen: 'bebida' },
    { estado: 'confirmado', monto: 1000, metodoPago: 'efectivo', origen: undefined },
];
const gastos = [{ monto: 2000, metodoPago: 'efectivo' }];

const r = calcularCierre({ cuts, ventasHoy, retiros, gastos });

assert.equal(r.totalProductos, 1500, 'solo la bebida de cliente cuenta como producto (ML y consumo staff quedan afuera)');
assert.equal(r.totalCortes, 10000);
assert.equal(r.totalGeneral, 11500);
assert.equal(r.retiroEfectivo, 1000, 'el retiro de bebida no debe contar acá, solo el retiro de plata');
assert.equal(r.gastoEfectivo, 2000);
// efectivo = cortes(10000) + productos cliente(1500) - retiro efectivo real(1000) - gasto efectivo(2000) = 8500
assert.equal(r.efectivo, 8500);
assert.equal(r.netoReal, 11500 - 2000);

console.log('OK: todos los asserts pasaron');
```

- [ ] **Step 2: Correr el test y confirmar que falla**

```bash
node C:\Users\Agus\AppData\Local\Temp\claude\C--Users-Agus-Desktop-sb-barber\cf3df40e-5336-40f3-b265-2c0a2be45d50\scratchpad\test-cierre-calc.mjs
```

Expected: `Error: Cannot find module '.../cierre-calc.mjs'` (todavía no existe).

- [ ] **Step 3: Escribir la fórmula standalone**

Creá `C:\Users\Agus\AppData\Local\Temp\claude\C--Users-Agus-Desktop-sb-barber\cf3df40e-5336-40f3-b265-2c0a2be45d50\scratchpad\cierre-calc.mjs` — esta es la misma lógica que después se traslada al HTML en el Step 5:

```js
export function calcularCierre({ cuts, ventasHoy, retiros, gastos }) {
    const ventasProductos = ventasHoy.filter(v => v.canal !== 'ml' && !v.esConsumoStaff);

    const totalCortes = cuts.reduce((s, c) => s + (c.price || 0), 0);
    const productosEfectivo = ventasProductos.filter(v => v.metodoPago !== 'transferencia').reduce((s, v) => s + (v.total || 0), 0);
    const productosTransferencia = ventasProductos.filter(v => v.metodoPago === 'transferencia').reduce((s, v) => s + (v.total || 0), 0);
    const efectivoBruto = cuts.filter(c => c.metodoPago !== 'transferencia').reduce((s, c) => s + (c.price || 0), 0) + productosEfectivo;
    const transferenciaBruto = cuts.filter(c => c.metodoPago === 'transferencia').reduce((s, c) => s + (c.price || 0), 0) + productosTransferencia;

    const retirosHoy = retiros.filter(r => r.estado === 'confirmado' && r.origen !== 'bebida');
    const retiroEfectivo = retirosHoy.filter(r => r.metodoPago !== 'transferencia').reduce((s, r) => s + (r.monto || 0), 0);
    const retiroTransferencia = retirosHoy.filter(r => r.metodoPago === 'transferencia').reduce((s, r) => s + (r.monto || 0), 0);

    const totalGastos = gastos.reduce((s, g) => s + (g.monto || 0), 0);
    const gastoEfectivo = gastos.filter(g => g.metodoPago !== 'transferencia').reduce((s, g) => s + (g.monto || 0), 0);
    const gastoTransferencia = gastos.filter(g => g.metodoPago === 'transferencia').reduce((s, g) => s + (g.monto || 0), 0);

    const efectivo = efectivoBruto - retiroEfectivo - gastoEfectivo;
    const transferencia = transferenciaBruto - retiroTransferencia - gastoTransferencia;
    const totalProductos = ventasProductos.reduce((s, v) => s + (v.total || 0), 0);
    const totalGeneral = totalCortes + totalProductos;
    const netoReal = totalGeneral - totalGastos;

    return { ventasProductos, totalCortes, efectivoBruto, transferenciaBruto, retiroEfectivo, retiroTransferencia, totalGastos, gastoEfectivo, gastoTransferencia, efectivo, transferencia, totalProductos, totalGeneral, netoReal };
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

```bash
node C:\Users\Agus\AppData\Local\Temp\claude\C--Users-Agus-Desktop-sb-barber\cf3df40e-5336-40f3-b265-2c0a2be45d50\scratchpad\test-cierre-calc.mjs
```

Expected: `OK: todos los asserts pasaron`

- [ ] **Step 5: Trasladar la fórmula validada a `recepcionista/index.html`**

Ubicá el bloque `recepcionista/index.html:2441-2458` (dentro de `renderCierreCaja()`), que hoy es:

```js
    const cuts = allCuts.filter(c => !c.eliminado && c.createdAt && c.createdAt.toDate() >= today);
    const ventasHoy = allVentas.filter(v => v.fecha === hoy && !v.eliminado);
    const ventasProductos = ventasHoy.filter(v => v.tipo !== 'bebida');

    const totalCortes   = cuts.reduce((s, c) => s + (c.price || 0), 0);
    const efectivoBruto = cuts.filter(c => c.metodoPago !== 'transferencia').reduce((s, c) => s + (c.price || 0), 0);
    const transferenciaBruto = cuts.filter(c => c.metodoPago === 'transferencia').reduce((s, c) => s + (c.price || 0), 0);
    // Retiros de hoy (por cuándo se hicieron), restados según su método
    const retirosHoy = allRetiros.filter(r => !r.eliminado && r.estado === 'confirmado' && r.creadoEn && r.creadoEn.toDate() >= today);
    const retiroEfectivo = retirosHoy.filter(r => r.metodoPago !== 'transferencia').reduce((s, r) => s + (r.monto || 0), 0);
    const retiroTransferencia = retirosHoy.filter(r => r.metodoPago === 'transferencia').reduce((s, r) => s + (r.monto || 0), 0);
    const efectivo      = efectivoBruto - retiroEfectivo;
    const transferencia = transferenciaBruto - retiroTransferencia;
    const totalProductos = ventasProductos.reduce((s, v) => s + (v.total || 0), 0);
    const totalGeneral   = totalCortes + totalProductos;
    const gastosHoy = allGastos.filter(g => !g.eliminado && g.fecha === hoy);
    const totalGastos = gastosHoy.reduce((s, g) => s + (g.monto || 0), 0);
    const netoReal = totalGeneral - totalGastos;
```

Reemplazalo por:

```js
    const cuts = allCuts.filter(c => !c.eliminado && c.createdAt && c.createdAt.toDate() >= today);
    const ventasHoy = allVentas.filter(v => v.fecha === hoy && !v.eliminado);
    // Cuenta como venta real (Productos + caja) solo lo vendido en el local a un cliente:
    // se excluyen las ventas por canal ML (esa plata no pasa por la caja física) y el
    // consumo interno de barberos/FEME (esConsumoStaff — eso ya se resta de lo que se le
    // paga al barbero, no de la caja del negocio).
    const ventasProductos = ventasHoy.filter(v => v.canal !== 'ml' && !v.esConsumoStaff);

    const totalCortes   = cuts.reduce((s, c) => s + (c.price || 0), 0);
    const productosEfectivo = ventasProductos.filter(v => v.metodoPago !== 'transferencia').reduce((s, v) => s + (v.total || 0), 0);
    const productosTransferencia = ventasProductos.filter(v => v.metodoPago === 'transferencia').reduce((s, v) => s + (v.total || 0), 0);
    const efectivoBruto = cuts.filter(c => c.metodoPago !== 'transferencia').reduce((s, c) => s + (c.price || 0), 0) + productosEfectivo;
    const transferenciaBruto = cuts.filter(c => c.metodoPago === 'transferencia').reduce((s, c) => s + (c.price || 0), 0) + productosTransferencia;
    // Retiros de hoy (por cuándo se hicieron), restados según su método.
    // Los retiros de bebida (origen:'bebida') NO restan de la caja: ya se le descontó al
    // barbero/FEME de lo que se le paga, pero la bebida la pagó la barbería con otra plata.
    const retirosHoy = allRetiros.filter(r => !r.eliminado && r.estado === 'confirmado' && r.creadoEn && r.creadoEn.toDate() >= today && r.origen !== 'bebida');
    const retiroEfectivo = retirosHoy.filter(r => r.metodoPago !== 'transferencia').reduce((s, r) => s + (r.monto || 0), 0);
    const retiroTransferencia = retirosHoy.filter(r => r.metodoPago === 'transferencia').reduce((s, r) => s + (r.monto || 0), 0);
    const gastosHoy = allGastos.filter(g => !g.eliminado && g.fecha === hoy);
    const totalGastos = gastosHoy.reduce((s, g) => s + (g.monto || 0), 0);
    const gastoEfectivo = gastosHoy.filter(g => g.metodoPago !== 'transferencia').reduce((s, g) => s + (g.monto || 0), 0);
    const gastoTransferencia = gastosHoy.filter(g => g.metodoPago === 'transferencia').reduce((s, g) => s + (g.monto || 0), 0);
    const efectivo      = efectivoBruto - retiroEfectivo - gastoEfectivo;
    const transferencia = transferenciaBruto - retiroTransferencia - gastoTransferencia;
    const totalProductos = ventasProductos.reduce((s, v) => s + (v.total || 0), 0);
    const totalGeneral   = totalCortes + totalProductos;
    const netoReal = totalGeneral - totalGastos;
```

- [ ] **Step 6: Validar sintaxis**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('recepcionista/index.html', 'utf8');
const m = html.match(/<script type=\"module\">([\s\S]*?)<\/script>/);
fs.writeFileSync('/tmp/recepcionista-script.mjs', m[1]);
"
node --check /tmp/recepcionista-script.mjs
```

Expected: sin output.

- [ ] **Step 7: Commit**

```bash
git add recepcionista/index.html
git commit -m "fix(recepcionista): cierre diario — retiros de bebida no restan caja, gastos restan por método de pago, bebidas de cliente suman, ML no suma"
```

---

## Task 5: Recalcular Efectivo/Transferencia/Productos en el cierre diario de anotar

**Files:**
- Modify: `anotar/index.html:2390-2401`

**Interfaces:**
- Consumes: mismos campos que Task 4 (`esConsumoStaff`, `canal`, `metodoPago` en `ventas_productos`; `origen` en `retiros` — aunque acá `retiros` no participa del cálculo de caja, ver nota abajo).
- Produces: mismos nombres de variable que ya usa el resto de `renderCierreDia()` (`ventasProductos`, `totalCortes`, `efectivo`, `transferencia`, `totalProductos`, `totalGeneral`, `gastosHoy`, `totalGastos`, `netoReal`).

**Nota importante:** a diferencia de recepcionista, el cierre diario de `anotar` **nunca restó retiros de Efectivo/Transferencia** (ese tile ahí siempre fue solo cortes) — eso ya es correcto según el diseño (los retiros, incluidos los de bebida, siguen restando de "A pagar" por barbero más abajo en la misma función, sin cambios). Esta task solo agrega: (1) que gastos resten de Efectivo/Transferencia por método de pago, y (2) que las ventas de bebida/producto sumen a Productos/Efectivo/Transferencia con el mismo criterio que Task 4 (cliente local sí, ML y consumo staff no).

- [ ] **Step 1: Reusar el test de fórmula de la Task 4, adaptado (sin retiros)**

Editá `C:\Users\Agus\AppData\Local\Temp\claude\C--Users-Agus-Desktop-sb-barber\cf3df40e-5336-40f3-b265-2c0a2be45d50\scratchpad\test-cierre-calc.mjs` agregando al final del archivo (antes del `console.log` final, o en un nuevo archivo `test-cierre-calc-anotar.mjs` que importe `calcularCierreSinRetiros` — se define en el Step 2):

```js
import { calcularCierreSinRetiros } from './cierre-calc.mjs';

const r2 = calcularCierreSinRetiros({ cuts, ventasHoy, gastos });
assert.equal(r2.totalProductos, 1500);
assert.equal(r2.totalCortes, 10000);
// efectivo = cortes(10000) + productos cliente(1500) - gasto efectivo(2000) = 9500  (sin retiro, a diferencia de recepcionista)
assert.equal(r2.efectivo, 9500);
assert.equal(r2.netoReal, 11500 - 2000);
console.log('OK: anotar también pasa');
```

- [ ] **Step 2: Agregar la variante sin retiros a la fórmula standalone y correr el test**

Agregá a `cierre-calc.mjs` (mismo archivo del Task 4):

```js
export function calcularCierreSinRetiros({ cuts, ventasHoy, gastos }) {
    const ventasProductos = ventasHoy.filter(v => v.canal !== 'ml' && !v.esConsumoStaff);
    const totalCortes = cuts.reduce((s, c) => s + (c.price || 0), 0);
    const productosEfectivo = ventasProductos.filter(v => v.metodoPago !== 'transferencia').reduce((s, v) => s + (v.total || 0), 0);
    const productosTransferencia = ventasProductos.filter(v => v.metodoPago === 'transferencia').reduce((s, v) => s + (v.total || 0), 0);
    const gastoEfectivo = gastos.filter(g => g.metodoPago !== 'transferencia').reduce((s, g) => s + (g.monto || 0), 0);
    const gastoTransferencia = gastos.filter(g => g.metodoPago === 'transferencia').reduce((s, g) => s + (g.monto || 0), 0);
    const totalGastos = gastos.reduce((s, g) => s + (g.monto || 0), 0);
    const efectivo = cuts.filter(c => c.metodoPago !== 'transferencia').reduce((s, c) => s + (c.price || 0), 0) + productosEfectivo - gastoEfectivo;
    const transferencia = cuts.filter(c => c.metodoPago === 'transferencia').reduce((s, c) => s + (c.price || 0), 0) + productosTransferencia - gastoTransferencia;
    const totalProductos = ventasProductos.reduce((s, v) => s + (v.total || 0), 0);
    const totalGeneral = totalCortes + totalProductos;
    const netoReal = totalGeneral - totalGastos;
    return { ventasProductos, totalCortes, efectivo, transferencia, totalProductos, totalGeneral, totalGastos, netoReal };
}
```

Correr:
```bash
node C:\Users\Agus\AppData\Local\Temp\claude\C--Users-Agus-Desktop-sb-barber\cf3df40e-5336-40f3-b265-2c0a2be45d50\scratchpad\test-cierre-calc.mjs
```
Expected: ambos `OK:` en consola, sin error de assert.

- [ ] **Step 3: Trasladar la fórmula validada a `anotar/index.html`**

Ubicá `anotar/index.html:2390-2401`, hoy:

```js
    const cuts = allCuts.filter(c => !c.eliminado && c.createdAt && c.createdAt.toDate() >= today);
    const ventasHoy = allVentas.filter(v => v.fecha === hoy && !v.eliminado);
    const ventasProductos = ventasHoy.filter(v => v.tipo !== 'bebida');

    const totalCortes    = cuts.reduce((s, c) => s + (c.price || 0), 0);
    const efectivo       = cuts.filter(c => c.metodoPago !== 'transferencia').reduce((s, c) => s + (c.price || 0), 0);
    const transferencia  = cuts.filter(c => c.metodoPago === 'transferencia').reduce((s, c) => s + (c.price || 0), 0);
    const totalProductos = ventasProductos.reduce((s, v) => s + (v.total || 0), 0);
    const totalGeneral   = totalCortes + totalProductos;
    const gastosHoy      = allGastos.filter(g => !g.eliminado && g.fecha === hoy);
    const totalGastos    = gastosHoy.reduce((s, g) => s + (g.monto || 0), 0);
    const netoReal       = totalGeneral - totalGastos;
```

Reemplazalo por:

```js
    const cuts = allCuts.filter(c => !c.eliminado && c.createdAt && c.createdAt.toDate() >= today);
    const ventasHoy = allVentas.filter(v => v.fecha === hoy && !v.eliminado);
    // Cuenta como venta real (Productos + caja) solo lo vendido en el local a un cliente:
    // se excluyen las ventas por canal ML y el consumo interno de barberos/FEME
    // (esConsumoStaff — eso resta de lo que se le paga al barbero, no de la caja).
    const ventasProductos = ventasHoy.filter(v => v.canal !== 'ml' && !v.esConsumoStaff);

    const totalCortes    = cuts.reduce((s, c) => s + (c.price || 0), 0);
    const productosEfectivo = ventasProductos.filter(v => v.metodoPago !== 'transferencia').reduce((s, v) => s + (v.total || 0), 0);
    const productosTransferencia = ventasProductos.filter(v => v.metodoPago === 'transferencia').reduce((s, v) => s + (v.total || 0), 0);
    const gastosHoy      = allGastos.filter(g => !g.eliminado && g.fecha === hoy);
    const totalGastos    = gastosHoy.reduce((s, g) => s + (g.monto || 0), 0);
    const gastoEfectivo  = gastosHoy.filter(g => g.metodoPago !== 'transferencia').reduce((s, g) => s + (g.monto || 0), 0);
    const gastoTransferencia = gastosHoy.filter(g => g.metodoPago === 'transferencia').reduce((s, g) => s + (g.monto || 0), 0);
    const efectivo       = cuts.filter(c => c.metodoPago !== 'transferencia').reduce((s, c) => s + (c.price || 0), 0) + productosEfectivo - gastoEfectivo;
    const transferencia  = cuts.filter(c => c.metodoPago === 'transferencia').reduce((s, c) => s + (c.price || 0), 0) + productosTransferencia - gastoTransferencia;
    const totalProductos = ventasProductos.reduce((s, v) => s + (v.total || 0), 0);
    const totalGeneral   = totalCortes + totalProductos;
    const netoReal       = totalGeneral - totalGastos;
```

- [ ] **Step 4: Validar sintaxis**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('anotar/index.html', 'utf8');
const m = html.match(/<script type=\"module\">([\s\S]*?)<\/script>/);
fs.writeFileSync('/tmp/anotar-script.mjs', m[1]);
"
node --check /tmp/anotar-script.mjs
```

Expected: sin output.

- [ ] **Step 5: Commit y limpiar el scratchpad**

```bash
git add anotar/index.html
git commit -m "fix(anotar): cierre diario — gastos restan por método de pago, bebidas de cliente suman, ML no suma"
rm -f "C:\Users\Agus\AppData\Local\Temp\claude\C--Users-Agus-Desktop-sb-barber\cf3df40e-5336-40f3-b265-2c0a2be45d50\scratchpad\test-cierre-calc.mjs" "C:\Users\Agus\AppData\Local\Temp\claude\C--Users-Agus-Desktop-sb-barber\cf3df40e-5336-40f3-b265-2c0a2be45d50\scratchpad\test-cierre-calc-anotar.mjs" "C:\Users\Agus\AppData\Local\Temp\claude\C--Users-Agus-Desktop-sb-barber\cf3df40e-5336-40f3-b265-2c0a2be45d50\scratchpad\cierre-calc.mjs"
```

(Los archivos de test son temporales del scratchpad de la sesión — no forman parte del repo, no se commitean.)

---

## Task 6: Santi y FEME en los selectores de bebida de anotar

**Files:**
- Modify: `anotar/index.html:1780-1786` (`renderVentaBarberos`)
- Modify: `anotar/index.html:1300-1311` (`window.openRetiroManualModal`)

**Interfaces:**
- Consumes: `BARBERS_LIST` (ya definido más arriba en el archivo, incluye Santi).
- Produces: nada que otras tasks consuman — son cambios de UI aislados.

- [ ] **Step 1: Arreglar `renderVentaBarberos` para que incluya a Santi**

Ubicá `anotar/index.html:1780-1786`, hoy:

```js
function renderVentaBarberos() {
    const nombres = [...new Set(Object.values(BARBER_EMAIL_MAP))];
    document.getElementById('venta-barbero-list').innerHTML = nombres.map(n =>
        `<button type="button" data-name="${n}" onclick="window.setVentaBarbero('${n.replace(/'/g,"\\'")}')" class="${_btnOff}">${n}</button>`
    ).join('');
    ventaBarbero = null;
}
```

Reemplazá `Object.values(BARBER_EMAIL_MAP)` por `BARBERS_LIST` (que ya incluye Tony/Maxi/Stefa/Santi, y capta automáticamente cualquier barbero nuevo que se agregue a futuro):

```js
function renderVentaBarberos() {
    const nombres = [...new Set(BARBERS_LIST)];
    document.getElementById('venta-barbero-list').innerHTML = nombres.map(n =>
        `<button type="button" data-name="${n}" onclick="window.setVentaBarbero('${n.replace(/'/g,"\\'")}')" class="${_btnOff}">${n}</button>`
    ).join('');
    ventaBarbero = null;
}
```

- [ ] **Step 2: Agregar FEME al modal de retiro manual**

Ubicá `anotar/index.html:1300-1311`, hoy:

```js
window.openRetiroManualModal = () => {
    const today = new Date();
    const wd = today.getDay() || 7;
    const ws = new Date(today);
    if (wd !== 1) ws.setDate(today.getDate() - (wd - 1));
    document.getElementById('retiro-manual-fecha').value = ws.toLocaleDateString('en-CA');
    document.getElementById('retiro-manual-monto').value = '';
    // Poblar barberos dinámicamente (incluye los agregados nuevos)
    document.getElementById('retiro-manual-barbero').innerHTML =
        '<option value="">Seleccioná un barbero</option>'
        + BARBERS_LIST.map(b => `<option value="${b}">${b}</option>`).join('');
    showModal('retiro-manual-modal');
};
```

Reemplazá el `innerHTML` para agregar la opción FEME al final, igual que ya hace `recepcionista` en su modal equivalente:

```js
window.openRetiroManualModal = () => {
    const today = new Date();
    const wd = today.getDay() || 7;
    const ws = new Date(today);
    if (wd !== 1) ws.setDate(today.getDate() - (wd - 1));
    document.getElementById('retiro-manual-fecha').value = ws.toLocaleDateString('en-CA');
    document.getElementById('retiro-manual-monto').value = '';
    // Poblar barberos dinámicamente (incluye los agregados nuevos) + FEME
    document.getElementById('retiro-manual-barbero').innerHTML =
        '<option value="">Seleccioná un barbero</option>'
        + BARBERS_LIST.map(b => `<option value="${b}">${b}</option>`).join('')
        + '<option value="FEME">FEME</option>';
    showModal('retiro-manual-modal');
};
```

- [ ] **Step 3: Validar sintaxis**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('anotar/index.html', 'utf8');
const m = html.match(/<script type=\"module\">([\s\S]*?)<\/script>/);
fs.writeFileSync('/tmp/anotar-script.mjs', m[1]);
"
node --check /tmp/anotar-script.mjs
```

Expected: sin output.

- [ ] **Step 4: Commit**

```bash
git add anotar/index.html
git commit -m "fix(anotar): Santi aparece al vender/retirar bebida; FEME disponible en retiro manual"
```

---

## Task 7: Santi y FEME en los selectores de bebida de recepcionista

**Files:**
- Modify: `recepcionista/index.html:680-712` (botones `mv-comprador-wrap`)
- Modify: `recepcionista/index.html:1552-1565` (`window.setDrinkComprador`)
- Modify: `recepcionista/index.html:1747-1762` (`window.openQuickSaleModal`, grilla `qs-barber-grid`)

**Interfaces:**
- Consumes: `BARBERS` y `BARBER_THEME` (ya definidos arriba, `BARBER_THEME` ya tiene entrada `FEME`). `esStaff` de Task 2 (`BARBERS.includes(comprador) || comprador === 'FEME'`) — esta task agrega los botones que hacen que ese `comprador` pueda valer `'Santi'`/`'FEME'`.

- [ ] **Step 1: Agregar botones de Santi y FEME en `movement-modal`**

Ubicá `recepcionista/index.html:683-699`, hoy:

```html
                    <div class="grid grid-cols-2 gap-2">
                        <button type="button" onclick="window.setDrinkComprador('cliente', this)" id="mv-comp-cliente"
                            class="p-3 rounded-xl border text-sm font-bold transition bg-cyan-600/20 border-cyan-500 text-cyan-300">
                            🧔 Cliente
                        </button>
                        <button type="button" onclick="window.setDrinkComprador('Tony', this)" id="mv-comp-Tony"
                            class="p-3 rounded-xl border text-sm font-bold transition bg-black/30 border-gray-700 text-gray-400 hover:border-gray-500">
                            Tony
                        </button>
                        <button type="button" onclick="window.setDrinkComprador('Maxi', this)" id="mv-comp-Maxi"
                            class="p-3 rounded-xl border text-sm font-bold transition bg-black/30 border-gray-700 text-gray-400 hover:border-gray-500">
                            Maxi
                        </button>
                        <button type="button" onclick="window.setDrinkComprador('Stefa', this)" id="mv-comp-Stefa"
                            class="p-3 rounded-xl border text-sm font-bold transition bg-black/30 border-gray-700 text-gray-400 hover:border-gray-500">
                            Stefa
                        </button>
                    </div>
```

Reemplazalo por (se agregan botones Santi y FEME):

```html
                    <div class="grid grid-cols-2 gap-2">
                        <button type="button" onclick="window.setDrinkComprador('cliente', this)" id="mv-comp-cliente"
                            class="p-3 rounded-xl border text-sm font-bold transition bg-cyan-600/20 border-cyan-500 text-cyan-300">
                            🧔 Cliente
                        </button>
                        <button type="button" onclick="window.setDrinkComprador('Tony', this)" id="mv-comp-Tony"
                            class="p-3 rounded-xl border text-sm font-bold transition bg-black/30 border-gray-700 text-gray-400 hover:border-gray-500">
                            Tony
                        </button>
                        <button type="button" onclick="window.setDrinkComprador('Maxi', this)" id="mv-comp-Maxi"
                            class="p-3 rounded-xl border text-sm font-bold transition bg-black/30 border-gray-700 text-gray-400 hover:border-gray-500">
                            Maxi
                        </button>
                        <button type="button" onclick="window.setDrinkComprador('Stefa', this)" id="mv-comp-Stefa"
                            class="p-3 rounded-xl border text-sm font-bold transition bg-black/30 border-gray-700 text-gray-400 hover:border-gray-500">
                            Stefa
                        </button>
                        <button type="button" onclick="window.setDrinkComprador('Santi', this)" id="mv-comp-Santi"
                            class="p-3 rounded-xl border text-sm font-bold transition bg-black/30 border-gray-700 text-gray-400 hover:border-gray-500">
                            Santi
                        </button>
                        <button type="button" onclick="window.setDrinkComprador('FEME', this)" id="mv-comp-FEME"
                            class="p-3 rounded-xl border text-sm font-bold transition bg-black/30 border-gray-700 text-gray-400 hover:border-gray-500">
                            FEME
                        </button>
                    </div>
```

- [ ] **Step 2: Hacer que `setDrinkComprador` reconozca FEME como staff y estilice su botón**

Ubicá `recepcionista/index.html:1552-1565`, hoy:

```js
window.setDrinkComprador = (quien, el) => {
    document.getElementById('mv-comprador').value = quien;
    const esBarber = BARBERS.includes(quien);
    ['cliente', ...BARBERS].forEach(k => {
        const btn = document.getElementById(`mv-comp-${k}`);
        if (!btn) return;
        const t = BARBER_THEME[k];
        const isSelected = k === quien;
        btn.className = `p-3 rounded-xl border text-sm font-bold transition ${isSelected
            ? (t ? `bg-${t.color}-600/20 border-${t.color}-500 text-${t.color}-300` : 'bg-cyan-600/20 border-cyan-500 text-cyan-300')
            : 'bg-black/30 border-gray-700 text-gray-400 hover:border-gray-500'}`;
    });
    document.getElementById('mv-metodo-wrap').classList.toggle('hidden', esBarber);
};
```

Reemplazalo por:

```js
window.setDrinkComprador = (quien, el) => {
    document.getElementById('mv-comprador').value = quien;
    const esBarber = BARBERS.includes(quien) || quien === 'FEME';
    ['cliente', ...BARBERS, 'FEME'].forEach(k => {
        const btn = document.getElementById(`mv-comp-${k}`);
        if (!btn) return;
        const t = BARBER_THEME[k];
        const isSelected = k === quien;
        btn.className = `p-3 rounded-xl border text-sm font-bold transition ${isSelected
            ? (t ? `bg-${t.color}-600/20 border-${t.color}-500 text-${t.color}-300` : 'bg-cyan-600/20 border-cyan-500 text-cyan-300')
            : 'bg-black/30 border-gray-700 text-gray-400 hover:border-gray-500'}`;
    });
    document.getElementById('mv-metodo-wrap').classList.toggle('hidden', esBarber);
};
```

- [ ] **Step 3: Agregar FEME a la grilla de Venta Rápida**

Ubicá `recepcionista/index.html:1747-1762`, hoy:

```js
window.openQuickSaleModal = () => {
    window.setQsMetodo('efectivo');
    document.getElementById('qs-barbero').value = '';
    document.getElementById('qs-barber-grid').innerHTML = BARBERS.map(b => {
        const t = BARBER_THEME[b];
        return `
        <label class="cursor-pointer select-none">
            <input type="radio" name="qs-barber" value="${b}" class="peer sr-only" onchange="document.getElementById('qs-barbero').value='${b}'">
            <div class="flex flex-col items-center gap-1.5 p-2.5 rounded-xl border-2 border-transparent
                peer-checked:border-${t.color}-500 peer-checked:bg-${t.color}-500/10
                bg-white/5 hover:bg-white/8 transition-all duration-150 active:scale-95">
                <div class="w-11 h-11 rounded-full overflow-hidden shadow">${barberAvatar(b, 11)}</div>
                <span class="font-bold text-xs text-gray-400 peer-checked:text-${t.color}-300 transition-colors">${b}</span>
            </div>
        </label>`;
    }).join('');
```

Reemplazá `BARBERS.map(b => {` por `[...BARBERS, 'FEME'].map(b => {` (una sola línea cambia):

```js
window.openQuickSaleModal = () => {
    window.setQsMetodo('efectivo');
    document.getElementById('qs-barbero').value = '';
    document.getElementById('qs-barber-grid').innerHTML = [...BARBERS, 'FEME'].map(b => {
        const t = BARBER_THEME[b];
        return `
        <label class="cursor-pointer select-none">
            <input type="radio" name="qs-barber" value="${b}" class="peer sr-only" onchange="document.getElementById('qs-barbero').value='${b}'">
            <div class="flex flex-col items-center gap-1.5 p-2.5 rounded-xl border-2 border-transparent
                peer-checked:border-${t.color}-500 peer-checked:bg-${t.color}-500/10
                bg-white/5 hover:bg-white/8 transition-all duration-150 active:scale-95">
                <div class="w-11 h-11 rounded-full overflow-hidden shadow">${barberAvatar(b, 11)}</div>
                <span class="font-bold text-xs text-gray-400 peer-checked:text-${t.color}-300 transition-colors">${b}</span>
            </div>
        </label>`;
    }).join('');
```

- [ ] **Step 4: Verificar que `barberAvatar('FEME', 11)` no rompe**

Buscá la función `barberAvatar` en `recepcionista/index.html` (`grep -n "function barberAvatar"`) y confirmá que no asume que el nombre está en `BARBERS` (por ejemplo, indexando un array por posición). Si usa `BARBER_THEME[nombre]?.initial || nombre[0]` o similar, FEME funciona sin cambios porque `BARBER_THEME.FEME` ya existe (con `initial:'F'`, confirmado en la exploración previa). Si en cambio asume que el nombre siempre está en `BARBERS`, ajustalo para usar `BARBER_THEME[b]` con fallback seguro — pero no se espera que haga falta.

- [ ] **Step 5: Validar sintaxis**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('recepcionista/index.html', 'utf8');
const m = html.match(/<script type=\"module\">([\s\S]*?)<\/script>/);
fs.writeFileSync('/tmp/recepcionista-script.mjs', m[1]);
"
node --check /tmp/recepcionista-script.mjs
```

Expected: sin output.

- [ ] **Step 6: Commit**

```bash
git add recepcionista/index.html
git commit -m "fix(recepcionista): Santi y FEME disponibles al marcar salida de bebida y en Venta Rápida"
```

---

## Task 8: Verificación manual end-to-end en navegador

**Files:** ninguno (solo verificación).

Este proyecto no tiene test runner ni entorno de staging separado — corre contra la Firestore real de producción. Hacé esta verificación con datos de prueba fácilmente identificables (ej. un item de stock llamado "TEST bebida" con precio $1, o montos redondos como $1234) para poder borrarlos después sin dudar cuáles son.

- [ ] **Step 1: Levantar ambos archivos localmente**

```bash
cd C:\Users\Agus\Desktop\sb_barber
python -m http.server 8080
```

Abrí `http://localhost:8080/anotar/index.html` y `http://localhost:8080/recepcionista/index.html` (necesitás estar logueado con un usuario admin/barbero válido de la app — usá tus credenciales reales, es la misma Firestore de siempre).

- [ ] **Step 2: Caso "retiro de bebida no resta de la caja" (recepcionista)**

1. Anotá el valor actual de los tiles Efectivo/Transferencia en `recepcionista` → pestaña Cierre de caja.
2. Registrá una salida de stock de una bebida marcada como venta, comprador = un barbero (ej. Tony).
3. Volvé al cierre de caja: el tile Efectivo/Transferencia **no debe haber bajado** por esa bebida.
4. Confirmá en la pestaña de retiros/balance semanal que a Tony sí se le restó ese monto de lo que se le paga.

- [ ] **Step 3: Caso "bebida vendida a cliente suma a la caja" (recepcionista y anotar)**

1. Registrá una venta de bebida con comprador = Cliente, método de pago = Efectivo, por un monto fácil de identificar (ej. $1234).
2. Confirmá que el tile Efectivo del cierre subió exactamente $1234, y que "Total del día" también subió $1234.
3. Repetí en `anotar` (pestaña Cierre) y confirmá el mismo comportamiento ahí.

- [ ] **Step 4: Caso "venta por ML no suma nada" (recepcionista)**

1. Registrá una venta de producto (no bebida) por canal ML.
2. Confirmá que ni "Total del día" ni Efectivo/Transferencia se movieron.

- [ ] **Step 5: Caso "gasto resta del método de pago correcto" (recepcionista y anotar)**

1. Cargá un gasto nuevo con método de pago Efectivo, monto identificable (ej. $1111).
2. Confirmá que el tile Efectivo bajó $1111 en ambos cierres (recepcionista y anotar), y que "Neto real" también bajó $1111.
3. Repetí con un gasto por Transferencia y confirmá que baja el tile Transferencia, no Efectivo.

- [ ] **Step 6: Caso FEME y Santi disponibles**

1. En `anotar`, al vender/retirar una bebida, confirmá que aparece Santi en la lista de barberos y que FEME sigue disponible como opción top-level.
2. En `anotar`, abrí el modal de retiro manual (admin) y confirmá que FEME aparece en el `<select>`.
3. En `recepcionista`, al marcar una salida de bebida como venta, confirmá que aparecen los 6 botones: Cliente, Tony, Maxi, Stefa, Santi, FEME.
4. En `recepcionista`, abrí Venta Rápida y confirmá que la grilla incluye a FEME (además de Tony/Maxi/Stefa/Santi).

- [ ] **Step 7: Borrar los datos de prueba**

Borrá (soft-delete, con los botones de eliminar de la propia UI) todos los cortes/ventas/retiros/gastos de prueba que hayas creado en los pasos anteriores, para no ensuciar el cierre real del día.

- [ ] **Step 8: Push**

```bash
git push
```

Confirmá con el usuario antes de este paso si no fue pedido explícitamente — el deploy es automático al pushear.
