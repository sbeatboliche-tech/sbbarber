import { fetchFirestoreDoc, listFirestoreCollection } from '../lib/firestore.js';

// Catálogo dinámico de la tienda (overrides de stock/precio, productos y kits cargados desde el
// admin, cursos, config de categorías/envíos) servido con caché de borde: durante la ventana de
// caché, mil visitas comparten UNA sola lectura a Firestore en vez de una tanda de lecturas cada
// una. Así evitamos repetir el agotamiento de cuota que tuvo el proyecto con el pico de tráfico
// de las campañas de Instagram.
export default async function handler(req, res) {
    try {
        const [productosOverride, extraProductos, extraKitsRaw, cursos, general, categorias, envios] = await Promise.all([
            listFirestoreCollection('tienda_productos'),
            listFirestoreCollection('tienda_productos_custom'),
            listFirestoreCollection('tienda_kits_custom'),
            listFirestoreCollection('tienda_cursos'),
            fetchFirestoreDoc('tienda_config/general'),
            fetchFirestoreDoc('tienda_config/categorias'),
            fetchFirestoreDoc('tienda_config/envios')
        ]);

        const productConfig = {};
        productosOverride.forEach(d => { productConfig[d.id] = d; });

        const courseConfig = {};
        cursos.forEach(d => { courseConfig[d.id] = d; });

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
        res.status(200).json({
            productConfig,
            extraProductos,
            extraKits: extraKitsRaw.map(k => ({ ...k, custom: true })),
            courseConfig,
            general: general || {},
            categorias: categorias || {},
            envios: envios || {}
        });
    } catch (e) {
        console.error('catalogo.js error:', e);
        res.status(500).json({ error: 'No se pudo cargar el catálogo' });
    }
}
