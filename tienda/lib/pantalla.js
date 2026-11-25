// Datos de las teles del mostrador (sbbarber.com.ar/pantalla/): precios de los servicios.
//   GET /api/catalogo?pantalla=1 → { servicios: [{nombre, precio}] }
// Va adentro de catalogo.js porque el plan Hobby de Vercel no deja más de 12 funciones en api/.
// Las reglas de Firestore solo dejan leer config_precios y productos_barber a cuentas logueadas, y loguear
// una tele es incómodo: se lee acá con la cuenta de servicio y solo se devuelve lo que se muestra en público.
// Caché de borde de 15 min: las dos teles juntas gastan 1 lectura cada 15 min (plan Spark, cuota justa).
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

// Servicios que existen para anotar cortes pero no van en las teles
const NO_MOSTRAR = new Set(['Corte Promo 50%']);

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
    return lista.filter(s => !ocultos.has(s.nombre) && !NO_MOSTRAR.has(s.nombre) && s.precio > 0);
}

export default async function pantallaHandler(req, res) {
    try {
        // Las teles muestran solo servicios (decisión del dueño): 1 lectura cada 15 min
        const cfgSnap = await barberDb().doc('config_precios/servicios').get();
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=900');
        res.status(200).json({ servicios: servicios(cfgSnap.exists ? cfgSnap.data() : {}), generado: new Date().toISOString() });
    } catch (e) {
        console.error('pantalla:', e);
        res.status(500).json({ error: 'No se pudieron cargar los precios' });
    }
}
