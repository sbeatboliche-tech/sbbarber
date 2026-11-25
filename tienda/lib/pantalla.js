// Datos de las teles del mostrador (sbbarber.com.ar/pantalla/): precios de servicios y productos con foto.
//   GET /api/catalogo?pantalla=1 → { servicios: [{nombre, precio}], productos: [{nombre, precio, foto}] }
// Va adentro de catalogo.js porque el plan Hobby de Vercel no deja más de 12 funciones en api/.
// Las reglas de Firestore solo dejan leer config_precios y productos_barber a cuentas logueadas, y loguear
// una tele es incómodo: se lee acá con la cuenta de servicio y solo se devuelve lo que se muestra en público.
// Caché de borde de 15 min: las dos teles juntas gastan ~25 lecturas cada 15 min (plan Spark, cuota justa).
import { barberDb } from './barberAdmin.js';

// MISMA lista base que SERVICES en recepcionista/index.html (si se agrega un servicio fijo ahí, agregarlo acá).
// Los precios, el orden, los servicios nuevos y los eliminados vienen de config_precios/servicios.
const SERVICIOS_BASE = [
    { nombre: 'Corte Promo 50%', precio: 12000 },
    { nombre: 'Corte', precio: 16000 },
    { nombre: 'Corte y Barba', precio: 20000 },
    { nombre: 'Corte + Pomada', precio: 18000 },
    { nombre: 'Barba', precio: 14000 },
    { nombre: 'Pelo largo', precio: 18000 },
    { nombre: 'Mechas', precio: 55000 },
    { nombre: 'Global', precio: 60000 },
];

// Mismo criterio que applyServicePrices en recepcionista
function servicios(cfg) {
    const lista = SERVICIOS_BASE.map(s => ({ ...s }));
    (cfg.__customServices || []).forEach(cs => {
        if (cs?.name && !lista.find(s => s.nombre === cs.name)) lista.push({ nombre: cs.name, precio: 0 });
    });
    lista.forEach(s => { if (cfg[s.nombre] != null) s.precio = Number(cfg[s.nombre]) || 0; });
    if (Array.isArray(cfg.__order) && cfg.__order.length) {
        const pos = new Map(cfg.__order.map((n, i) => [n, i]));
        lista.sort((a, b) => (pos.has(a.nombre) ? pos.get(a.nombre) : Infinity) - (pos.has(b.nombre) ? pos.get(b.nombre) : Infinity));
    }
    const ocultos = new Set(cfg.__ocultos || []);
    return lista.filter(s => !ocultos.has(s.nombre) && s.precio > 0);
}

export default async function pantallaHandler(req, res) {
    try {
        const db = barberDb();
        const [cfgSnap, prodSnap] = await Promise.all([
            db.doc('config_precios/servicios').get(),
            db.collection('productos_barber').get(),
        ]);
        // Para la vidriera: con foto, precio y stock, en el orden de Stock de productos
        const productos = prodSnap.docs.map(d => d.data())
            .filter(p => !p.oculto && p.photoURL && Number(p.precio) > 0 && Number(p.stock) > 0)
            .sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
            .map(p => ({ nombre: p.name, precio: Number(p.precio), foto: p.photoURL }));

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=900');
        res.status(200).json({ servicios: servicios(cfgSnap.exists ? cfgSnap.data() : {}), productos, generado: new Date().toISOString() });
    } catch (e) {
        console.error('pantalla:', e);
        res.status(500).json({ error: 'No se pudieron cargar los precios' });
    }
}
