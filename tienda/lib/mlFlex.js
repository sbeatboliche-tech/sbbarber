// Paquetes Flex de MercadoLibre → flex_despachos/{día de despacho} en sb-barber-6dc16.
// Un envío self_service ya despachado suma 1 en la zona según la localidad (lib/flexZonas.js).
// Idempotente: ml_flex/{envío} marca lo anotado. Lo usan ml-webhook.js (al llegar avisos) y
// api/ml.js?action=flex (revisión de las ventas recientes al abrir el panel en recepcionista).
import { FieldValue } from 'firebase-admin/firestore';
import { barberDb } from './barberAdmin.js';
import { mlFetch, getCuenta } from './ml.js';
import { zonaDe } from './flexZonas.js';

const DESPACHADO = ['shipped', 'delivered', 'not_delivered'];

export async function anotarFlex(envioId, { yaRevisado = false } = {}) {
    const db = barberDb();
    const marcaRef = db.doc(`ml_flex/${envioId}`);
    if (!yaRevisado && (await marcaRef.get()).exists) return false; // ya anotado: no vuelve a consultar a ML

    const s = await mlFetch(`/shipments/${envioId}`);
    const tipo = s.logistic_type || s.logistic?.type;
    if (tipo !== 'self_service') {
        // No es Flex: se marca para no volver a consultarlo en cada revisión (no suma nada en flex_despachos)
        await marcaRef.set({ noFlex: true, tipo: tipo || null, anotadoEn: FieldValue.serverTimestamp() }).catch(() => {});
        return false;
    }
    if (!DESPACHADO.includes(s.status)) return false;

    const dir = s.receiver_address || s.destination?.shipping_address || {};
    const cfg = await db.doc('flex_config/zonas').get();
    const zonas = Array.isArray(cfg.data()?.zonas) ? cfg.data().zonas : [];
    const zona = zonaDe(dir, zonas);
    // Día en que salió el paquete (no el de la venta). Si ML no trae date_shipped, la última novedad del envío.
    const cuando = s.status_history?.date_shipped || s.last_updated || Date.now();
    const fecha = new Date(cuando).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    const diaRef = db.doc(`flex_despachos/${fecha}`);

    let nuevo = false;
    await db.runTransaction(async tx => {
        nuevo = false;
        if ((await tx.get(marcaRef)).exists) return;
        nuevo = true;
        tx.set(diaRef, {
            fecha,
            zonas: { [zona]: FieldValue.increment(1) },
            total: FieldValue.increment(1),
            envios: { [envioId]: { zona, ciudad: dir.city?.name || '', cp: String(dir.zip_code || ''), orden: String(s.order_id || '') } },
            actualizadoEn: FieldValue.serverTimestamp()
        }, { merge: true });
        tx.set(marcaRef, { fecha, zona, ordenId: String(s.order_id || ''), anotadoEn: FieldValue.serverTimestamp() });
    });
    return nuevo;
}

// Revisa las ventas pagadas de los últimos `dias` y anota las Flex despachadas que falten.
// No depende de que ML mande avisos de envíos. Como mucho una vez cada 3 minutos (ml_config/flex_revision).
export async function revisarFlex(dias = 10, { forzar = false } = {}) {
    const cuenta = await getCuenta();
    if (!cuenta) return { nuevos: 0, revisados: 0, sinCuenta: true };
    const db = barberDb();
    const revRef = db.doc('ml_config/flex_revision');
    const ultima = (await revRef.get()).data()?.en?.toMillis?.() || 0;
    if (!forzar && Date.now() - ultima < 3 * 60 * 1000) return { nuevos: 0, revisados: 0, reciente: true };
    await revRef.set({ en: FieldValue.serverTimestamp() });

    const desde = new Date(Date.now() - dias * 864e5).toISOString().replace(/\.\d{3}Z$/, '.000-00:00');
    const envios = new Set();
    for (let offset = 0; offset < 1000; offset += 50) {
        const q = new URLSearchParams({ seller: String(cuenta.userId), 'order.status': 'paid', 'order.date_created.from': desde, sort: 'date_desc', limit: '50', offset: String(offset) });
        const r = await mlFetch(`/orders/search?${q}`);
        (r.results || []).forEach(o => { if (o.shipping?.id) envios.add(String(o.shipping.id)); });
        if ((r.results || []).length < 50) break;
    }
    if (!envios.size) return { nuevos: 0, revisados: 0 };

    // Los ya anotados se descartan con una sola lectura agrupada
    const ids = [...envios];
    const marcas = await db.getAll(...ids.map(id => db.doc(`ml_flex/${id}`)));
    const pendientes = ids.filter((id, i) => !marcas[i].exists);

    let nuevos = 0;
    for (let i = 0; i < pendientes.length; i += 5) {
        const res = await Promise.all(pendientes.slice(i, i + 5).map(id =>
            anotarFlex(id, { yaRevisado: true }).catch(e => { console.error('ML flex revisar:', id, e.message); return false; })));
        nuevos += res.filter(Boolean).length;
    }
    return { nuevos, revisados: ids.length };
}
