// Notificaciones de MercadoLibre (topic orders_v2). Se configura en la app de developers.mercadolibre.com.ar
// como "URL de retorno de notificaciones": https://tienda.sbbarber.com.ar/api/ml-webhook
//
// Venta pagada  → descuenta el stock del producto enlazado y la registra en ventas_productos con canal 'ml'
//                 (el cierre de caja ya excluye ese canal: esa plata no pasa por la caja).
// Venta cancelada después de descontar → devuelve el stock y borra la venta registrada.
// ML reintenta las notificaciones, así que todo es idempotente: ml_ordenes/{orderId} guarda qué se hizo.
//
// ML pide responder 200 en menos de 500 ms: se responde enseguida y el trabajo sigue con waitUntil
// (si no, Vercel congela la función apenas se manda la respuesta).
import { waitUntil } from '@vercel/functions';
import { FieldValue } from 'firebase-admin/firestore';
import { barberDb } from '../lib/barberAdmin.js';
import { mlFetch, getCuenta, PRODUCTOS } from '../lib/ml.js';

const PATH_VENTAS = 'ventas_productos';

export default async function handler(req, res) {
    const { topic, resource, user_id } = req.body || {};
    const orderId = topic === 'orders_v2' && /^\/orders\/(\d+)$/.exec(resource || '')?.[1];
    if (orderId) waitUntil(procesarOrden(orderId, user_id).catch(e => console.error('ML webhook:', orderId, e)));
    res.status(200).end();
}

async function procesarOrden(orderId, userId) {
    const cuenta = await getCuenta();
    if (!cuenta || String(cuenta.userId) !== String(userId)) return; // notificación de otra cuenta

    const order = await mlFetch(`/orders/${orderId}`);
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

    // Productos enlazados a alguna de las publicaciones de la orden (máximo 30 valores por 'in').
    const itemIds = [...new Set(lineas.map(l => l.itemId))].slice(0, 30);
    const prodSnap = await db.collection(PRODUCTOS).where('mlItemId', 'in', itemIds).get();
    const prods = prodSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const productoDe = l => prods.find(p => p.mlItemId === l.itemId && (!p.mlVariationId || String(p.mlVariationId) === l.variationId));

    const fechaAR = new Date(order.date_closed || order.date_created || Date.now())
        .toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    const marcaRef = db.doc(`ml_ordenes/${orderId}`);

    await db.runTransaction(async tx => {
        const marca = await tx.get(marcaRef);
        const estado = marca.exists ? marca.data().estado : null;

        if (pagada && !estado) {
            const enlazadas = lineas.map((l, i) => ({ ...l, i, prod: productoDe(l) })).filter(l => l.prod);
            // En una transacción todas las lecturas van antes que las escrituras.
            const refs = enlazadas.map(l => db.doc(`${PRODUCTOS}/${l.prod.id}`));
            const snaps = await Promise.all(refs.map(r => tx.get(r)));
            const stockNuevo = {};
            enlazadas.forEach((l, k) => {
                const actual = stockNuevo[l.prod.id] ?? (Number(snaps[k].data()?.stock) || 0);
                stockNuevo[l.prod.id] = Math.max(0, actual - l.cantidad);
            });
            Object.entries(stockNuevo).forEach(([id, stock]) => tx.update(db.doc(`${PRODUCTOS}/${id}`), { stock }));
            enlazadas.forEach(l => {
                tx.set(db.doc(`${PATH_VENTAS}/ml-${orderId}-${l.i}`), {
                    producto: l.prod.name || l.titulo,
                    precio: l.precio,
                    cantidad: l.cantidad,
                    total: l.precio * l.cantidad,
                    tipo: 'producto',
                    canal: 'ml',
                    barbero: 'MercadoLibre',
                    userEmail: null,
                    fecha: fechaAR,
                    grupoVenta: `ml-${orderId}`,
                    origen: 'ml_auto',
                    mlOrderId: String(orderId),
                    creadoEn: FieldValue.serverTimestamp()
                });
            });
            tx.set(marcaRef, {
                estado: 'descontado',
                lineas: enlazadas.map(l => ({ i: l.i, productoId: l.prod.id, cantidad: l.cantidad })),
                sinEnlazar: lineas.filter(l => !productoDe(l)).map(l => ({ itemId: l.itemId, titulo: l.titulo, cantidad: l.cantidad })),
                procesadoEn: FieldValue.serverTimestamp()
            });
        } else if (cancelada && estado === 'descontado') {
            const lineasMarca = marca.data().lineas || [];
            const refs = lineasMarca.map(l => db.doc(`${PRODUCTOS}/${l.productoId}`));
            await Promise.all(refs.map(r => tx.get(r)));
            lineasMarca.forEach(l => {
                tx.update(db.doc(`${PRODUCTOS}/${l.productoId}`), { stock: FieldValue.increment(l.cantidad) });
                tx.delete(db.doc(`${PATH_VENTAS}/ml-${orderId}-${l.i}`));
            });
            tx.update(marcaRef, { estado: 'devuelto', devueltoEn: FieldValue.serverTimestamp() });
        }
    });
}
