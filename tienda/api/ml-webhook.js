// Notificaciones de MercadoLibre (topic orders_v2). Se configura en la app de developers.mercadolibre.com.ar
// como "URL de retorno de notificaciones": https://tienda.sbbarber.com.ar/api/ml-webhook
//
// Venta pagada  → descuenta el stock del producto enlazado y la registra en ventas_productos con canal 'ml'
//                 (el cierre de caja ya excluye ese canal: esa plata no pasa por la caja).
// Venta cancelada después de descontar → devuelve el stock y borra la venta registrada.
// ML reintenta las notificaciones, así que todo es idempotente: ml_ordenes/{orderId} guarda qué se hizo.
//
// Envíos Flex (topic shipments, logistic_type self_service): cuando el envío pasa a despachado se suma 1 paquete
// en flex_despachos/{día de despacho} en la zona que corresponde a la localidad (flex_config/zonas.localidades;
// si no coincide ninguna, Capital Federal va a "CABA" y el resto a "Sin zona"). Idempotente con ml_flex/{envío}.
//
// ML pide responder 200 en menos de 500 ms: se responde enseguida y el trabajo sigue con waitUntil
// (si no, Vercel congela la función apenas se manda la respuesta).
import { waitUntil } from '@vercel/functions';
import { FieldValue } from 'firebase-admin/firestore';
import { barberDb } from '../lib/barberAdmin.js';
import { mlFetch, getCuenta, PRODUCTOS } from '../lib/ml.js';
import { enviarPush } from '../lib/push.js';

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

    // Productos enlazados a alguna de las publicaciones de la orden (máximo 30 valores por 'in').
    const itemIds = [...new Set(lineas.map(l => l.itemId))].slice(0, 30);
    const prodSnap = await db.collection(PRODUCTOS).where('mlItemId', 'in', itemIds).get();
    const prods = prodSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const productoDe = l => prods.find(p => p.mlItemId === l.itemId && (!p.mlVariationId || String(p.mlVariationId) === l.variationId));

    const fechaAR = new Date(order.date_closed || order.date_created || Date.now())
        .toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    const marcaRef = db.doc(`ml_ordenes/${orderId}`);

    let ventaNueva = false;
    await db.runTransaction(async tx => {
        ventaNueva = false; // la transacción se puede reintentar: vale lo de la última pasada
        const marca = await tx.get(marcaRef);
        const estado = marca.exists ? marca.data().estado : null;

        if (pagada && !estado) {
            ventaNueva = true;
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

    // Aviso a los dueños en la app (solo la primera vez que entra la venta). Si falla, la venta ya quedó guardada.
    if (ventaNueva) {
        const total = lineas.reduce((t, l) => t + l.precio * l.cantidad, 0);
        const cuerpo = lineas.map(l => `${l.cantidad > 1 ? l.cantidad + '× ' : ''}${productoDe(l)?.name || l.titulo}`).join(', ')
            + ` · $${total.toLocaleString('es-AR')}`;
        await enviarPush({ admins: true }, { titulo: '🛒 Venta en MercadoLibre', cuerpo, datos: { tipo: 'ml', orderId } })
            .catch(e => console.error('ML webhook push:', orderId, e));
    }
}

// ---- Paquetes Flex ----
const norm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const DESPACHADO = ['shipped', 'delivered', 'not_delivered'];

async function procesarEnvio(envioId, userId) {
    const cuenta = await getCuenta();
    if (!cuenta || String(cuenta.userId) !== String(userId)) return;
    await anotarFlex(envioId);
}

// Zona de la logística según la localidad del comprador. Las localidades de cada zona se cargan en recepcionista
// (separadas por coma; también sirven códigos postales).
function zonaDe(dir, zonas) {
    const ciudad = norm(dir?.city?.name), barrio = norm(dir?.neighborhood?.name), cp = String(dir?.zip_code || '').replace(/\D/g, '');
    for (const z of zonas) {
        const lista = String(z.localidades || '').split(',').map(norm).filter(Boolean);
        if (lista.some(l => l === ciudad || l === barrio || (cp && /^\d+$/.test(l) && l === cp))) return z.nombre;
    }
    const caba = dir?.state?.id === 'AR-C' || /capital federal|ciudad autonoma/.test(norm(dir?.state?.name));
    if (caba) return zonas.find(z => norm(z.nombre) === 'caba')?.nombre || 'CABA';
    return 'Sin zona';
}

async function anotarFlex(envioId) {
    const db = barberDb();
    const marcaRef = db.doc(`ml_flex/${envioId}`);
    if ((await marcaRef.get()).exists) return; // ya anotado: no vuelve a consultar a ML

    const s = await mlFetch(`/shipments/${envioId}`);
    const tipo = s.logistic_type || s.logistic?.type;
    if (tipo !== 'self_service' || !DESPACHADO.includes(s.status)) return;

    const dir = s.receiver_address || s.destination?.shipping_address || {};
    const cfg = await db.doc('flex_config/zonas').get();
    const zonas = Array.isArray(cfg.data()?.zonas) ? cfg.data().zonas : [];
    const zona = zonaDe(dir, zonas);
    const cuando = s.status_history?.date_shipped || s.date_first_printed || s.last_updated || Date.now();
    const fecha = new Date(cuando).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    const diaRef = db.doc(`flex_despachos/${fecha}`);

    await db.runTransaction(async tx => {
        if ((await tx.get(marcaRef)).exists) return;
        tx.set(diaRef, {
            fecha,
            zonas: { [zona]: FieldValue.increment(1) },
            total: FieldValue.increment(1),
            envios: { [envioId]: { zona, ciudad: dir.city?.name || '', cp: String(dir.zip_code || ''), orden: String(s.order_id || '') } },
            actualizadoEn: FieldValue.serverTimestamp()
        }, { merge: true });
        tx.set(marcaRef, { fecha, zona, ordenId: String(s.order_id || ''), anotadoEn: FieldValue.serverTimestamp() });
    });
}
