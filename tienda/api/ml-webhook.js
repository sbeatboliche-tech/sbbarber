// Notificaciones de MercadoLibre (topic orders_v2). Se configura en la app de developers.mercadolibre.com.ar
// como "URL de retorno de notificaciones": https://tienda.sbbarber.com.ar/api/ml-webhook
//
// Venta pagada  → se registra SIEMPRE en ventas_productos con canal 'ml' (sin enlace: sinEnlazar, no toca stock);
//                 si la publicación está enlazada (mlEnlaces, ver enlacesDe en lib/ml.js) descuenta unidades × cantidad
//                 y copia el stock nuevo a las otras publicaciones del producto
//                 (el cierre de caja ya excluye ese canal: esa plata no pasa por la caja).
// Venta cancelada después de descontar → devuelve el stock y borra la venta registrada.
// ML reintenta las notificaciones, así que todo es idempotente: ml_ordenes/{orderId} guarda qué se hizo.
//
// Envíos Flex (topic shipments, logistic_type self_service): cuando el envío pasa a despachado se suma 1 paquete
// en flex_despachos/{día de despacho} en la zona según la localidad (lib/flexZonas.js: CABA / Zona 1 / 2 / 3, con
// prioridad para las localidades cargadas en flex_config/zonas; si no se reconoce, "Sin zona"). Idempotente con ml_flex/{envío}.
//
// ML pide responder 200 en menos de 500 ms: se responde enseguida y el trabajo sigue con waitUntil
// (si no, Vercel congela la función apenas se manda la respuesta).
import { waitUntil } from '@vercel/functions';
import { FieldValue } from 'firebase-admin/firestore';
import { barberDb } from '../lib/barberAdmin.js';
import { mlFetch, getCuenta, PRODUCTOS, enlacesDe, sincronizarStock } from '../lib/ml.js';
import { enviarPush } from '../lib/push.js';
import { anotarFlex } from '../lib/mlFlex.js';

const PATH_VENTAS = 'ventas_productos';

export default async function handler(req, res) {
    const { topic, resource, user_id } = req.body || {};
    const orderId = topic === 'orders_v2' && /^\/orders\/(\d+)$/.exec(resource || '')?.[1];
    const envioId = topic === 'shipments' && /^\/shipments\/(\d+)$/.exec(resource || '')?.[1];
    if (orderId) waitUntil(procesarOrden(orderId, user_id).catch(e => console.error('ML webhook:', orderId, e)));
    if (envioId) waitUntil(procesarEnvio(envioId, user_id).catch(e => console.error('ML webhook envío:', envioId, e)));
    res.status(200).end();
}

async function procesarOrden(orderId, userId) {
    const cuenta = await getCuenta();
    if (!cuenta || String(cuenta.userId) !== String(userId)) return; // notificación de otra cuenta

    const order = await mlFetch(`/orders/${orderId}`);
    // Por si la notificación del envío no llegó: si la orden ya figura despachada, se anota igual (es idempotente)
    if (order.shipping?.id) await anotarFlex(String(order.shipping.id)).catch(e => console.error('ML flex:', order.shipping.id, e));
    const pagada = order.status === 'paid';
    const cancelada = order.status === 'cancelled';
    if (!pagada && !cancelada) return;

    const db = barberDb();
    const lineas = (order.order_items || []).map(oi => ({
        itemId: oi.item?.id,
        variationId: oi.item?.variation_id ? String(oi.item.variation_id) : null,
        cantidad: Number(oi.quantity) || 0,
        precio: Number(oi.unit_price) || 0,
        titulo: oi.item?.title || ''
    })).filter(l => l.itemId && l.cantidad > 0);
    if (!lineas.length) return;

    // Productos de cada línea: todos los que tengan un enlace a esa publicación (y variante, si el enlace la fija).
    // Normalmente es uno; un kit armado (ej. Kit x3 = 1 celeste + 1 verde + 1 violeta) descuenta de varios.
    // Son pocos productos (~20): se leen todos.
    const prods = (await db.collection(PRODUCTOS).get()).docs.map(d => ({ id: d.id, ...d.data() })).filter(p => !p.oculto);
    const componentesDe = l => prods.flatMap(p => {
        const e = enlacesDe(p).find(e => e.itemId === l.itemId && (!e.variationId || e.variationId === l.variationId));
        return e ? [{ prod: p, unidades: e.unidades }] : [];
    });

    const fechaAR = new Date(order.date_closed || order.date_created || Date.now())
        .toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    const marcaRef = db.doc(`ml_ordenes/${orderId}`);

    let ventaNueva = false;
    let tocados = [];
    await db.runTransaction(async tx => {
        ventaNueva = false; tocados = []; // la transacción se puede reintentar: vale lo de la última pasada
        const marca = await tx.get(marcaRef);
        const estado = marca.exists ? marca.data().estado : null;

        if (pagada && !estado) {
            ventaNueva = true;
            const todas = lineas.map((l, i) => ({ ...l, i, comps: componentesDe(l) }));
            // Una fila por producto descontado (o una sin producto si la publicación no está enlazada).
            // La primera conserva el id de siempre (ml-{orden}-{i}); las otras del kit suman -{k}.
            const filas = todas.flatMap(l => {
                if (!l.comps.length) return [{ l, sufijo: `${l.i}`, comp: null, parte: 1 }];
                const totalU = l.comps.reduce((t, c) => t + c.unidades, 0);
                return l.comps.map((c, k) => ({ l, sufijo: k ? `${l.i}-${k}` : `${l.i}`, comp: c, parte: c.unidades / totalU }));
            });
            const enlazadas = filas.filter(f => f.comp);
            // En una transacción todas las lecturas van antes que las escrituras.
            const ids = [...new Set(enlazadas.map(f => f.comp.prod.id))];
            const snaps = await Promise.all(ids.map(id => tx.get(db.doc(`${PRODUCTOS}/${id}`))));
            const stockNuevo = Object.fromEntries(ids.map((id, k) => [id, Number(snaps[k].data()?.stock) || 0]));
            enlazadas.forEach(f => { stockNuevo[f.comp.prod.id] = Math.max(0, stockNuevo[f.comp.prod.id] - f.l.cantidad * f.comp.unidades); });
            Object.entries(stockNuevo).forEach(([id, stock]) => tx.update(db.doc(`${PRODUCTOS}/${id}`), { stock }));
            tocados = ids;
            // Toda venta de ML queda registrada, esté enlazada o no (sin enlace no descuenta stock).
            // Se anota en unidades de cada producto; la plata del kit se reparte según las unidades de cada uno.
            filas.forEach(({ l, sufijo, comp, parte }) => {
                const u = comp?.unidades || 1;
                const total = l.precio * l.cantidad * parte;
                tx.set(db.doc(`${PATH_VENTAS}/ml-${orderId}-${sufijo}`), {
                    producto: comp ? (comp.prod.name || l.titulo) : l.titulo,
                    precio: total / (l.cantidad * u),
                    cantidad: l.cantidad * u,
                    total,
                    tipo: 'producto',
                    canal: 'ml',
                    barbero: 'MercadoLibre',
                    userEmail: null,
                    fecha: fechaAR,
                    grupoVenta: `ml-${orderId}`,
                    origen: 'ml_auto',
                    mlOrderId: String(orderId),
                    mlItemId: l.itemId,
                    mlTitulo: l.titulo,
                    ...(comp ? { productoId: comp.prod.id } : { sinEnlazar: true }),
                    creadoEn: FieldValue.serverTimestamp()
                });
            });
            tx.set(marcaRef, {
                estado: 'descontado',
                lineas: enlazadas.map(f => ({ i: f.l.i, productoId: f.comp.prod.id, cantidad: f.l.cantidad * f.comp.unidades })),
                ventas: filas.map(f => f.sufijo),
                sinEnlazar: todas.filter(l => !l.comps.length).map(l => ({ itemId: l.itemId, titulo: l.titulo, cantidad: l.cantidad })),
                procesadoEn: FieldValue.serverTimestamp()
            });
        } else if (cancelada && estado === 'descontado') {
            const m = marca.data();
            const lineasMarca = m.lineas || [];
            const refs = lineasMarca.map(l => db.doc(`${PRODUCTOS}/${l.productoId}`));
            await Promise.all(refs.map(r => tx.get(r)));
            lineasMarca.forEach(l => tx.update(db.doc(`${PRODUCTOS}/${l.productoId}`), { stock: FieldValue.increment(l.cantidad) }));
            // Las marcas viejas no tienen `ventas`: ahí solo se registraban las enlazadas.
            (m.ventas || lineasMarca.map(l => l.i)).forEach(i => tx.delete(db.doc(`${PATH_VENTAS}/ml-${orderId}-${i}`)));
            tocados = [...new Set(lineasMarca.map(l => l.productoId))];
            tx.update(marcaRef, { estado: 'devuelto', devueltoEn: FieldValue.serverTimestamp() });
        }
    });

    // El producto puede estar en otras publicaciones (o en un kit): se les copia el stock nuevo.
    if (tocados.length) await sincronizarStock(tocados).catch(e => console.error('ML webhook sync:', orderId, e));

    // Aviso a los dueños en la app (solo la primera vez que entra la venta). Si falla, la venta ya quedó guardada.
    if (ventaNueva) {
        const total = lineas.reduce((t, l) => t + l.precio * l.cantidad, 0);
        const cuerpo = lineas.map(l => `${l.cantidad > 1 ? l.cantidad + '× ' : ''}${l.titulo}`).join(', ')
            + ` · $${total.toLocaleString('es-AR')}`;
        await enviarPush({ admins: true }, { titulo: '🛒 Venta en MercadoLibre', cuerpo, datos: { tipo: 'ml', orderId } })
            .catch(e => console.error('ML webhook push:', orderId, e));
    }
}

// ---- Paquetes Flex ----
async function procesarEnvio(envioId, userId) {
    const cuenta = await getCuenta();
    if (!cuenta || String(cuenta.userId) !== String(userId)) return;
    await anotarFlex(envioId);
}
