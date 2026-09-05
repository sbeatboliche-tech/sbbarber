import fs from 'fs';
import path from 'path';

const FIREBASE_PROJECT_ID = 'sb-barber-6dc16';
const SITE_URL = 'https://tienda.sbbarber.com.ar';
const FALLBACK_IMAGE = 'https://i.imgur.com/PzcD4W2.jpeg';

export default async function handler(req, res) {
    const id = String(req.query.id || '').trim();
    if (!id) return res.redirect(302, '/');

    try {
        const product = await getProduct(id);
        if (!product) return res.redirect(302, '/');

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
        res.status(200).send(renderHtml(product, id));
    } catch (e) {
        console.error('producto.js error:', e);
        res.redirect(302, '/');
    }
}

// El catálogo "de la web" vive hardcodeado en index.html (PRODUCTS). Lo leemos y evaluamos
// una sola vez por instancia de la función para no duplicar esa lista acá y que se desincronice.
let _baseCache = null;
function getBaseProducts() {
    if (_baseCache) return _baseCache;
    try {
        const html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
        const match = html.match(/const PRODUCTS = (\[[\s\S]*?\n\]);/);
        _baseCache = match ? new Function('return ' + match[1])() : [];
    } catch (e) {
        console.error('No se pudo leer PRODUCTS de index.html:', e);
        _baseCache = [];
    }
    return _baseCache;
}

async function getProduct(id) {
    const custom = await fetchFirestoreDoc(`tienda_productos_custom/${encodeURIComponent(id)}`);
    let p = (custom && !custom.hidden) ? { ...custom, id } : getBaseProducts().find(x => x.id === id);
    if (!p) return null;

    const cfg = await fetchFirestoreDoc(`tienda_productos/${encodeURIComponent(id)}`) || {};
    return {
        id,
        name: cfg.name || p.name || '',
        description: cfg.description || p.description || '',
        price: p.price || 0,
        image: p.image || ''
    };
}

async function fetchFirestoreDoc(docPath) {
    try {
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${docPath}`;
        const r = await fetch(url);
        if (!r.ok) return null;
        const data = await r.json();
        return decodeFirestoreFields(data.fields);
    } catch (e) {
        return null;
    }
}

function decodeFirestoreFields(fields) {
    if (!fields) return {};
    const out = {};
    for (const [k, v] of Object.entries(fields)) out[k] = decodeFirestoreValue(v);
    return out;
}
function decodeFirestoreValue(v) {
    if (v.stringValue !== undefined) return v.stringValue;
    if (v.integerValue !== undefined) return Number(v.integerValue);
    if (v.doubleValue !== undefined) return v.doubleValue;
    if (v.booleanValue !== undefined) return v.booleanValue;
    if (v.nullValue !== undefined) return null;
    if (v.mapValue) return decodeFirestoreFields(v.mapValue.fields);
    if (v.arrayValue) return (v.arrayValue.values || []).map(decodeFirestoreValue);
    return null;
}

function esc(s = '') {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderHtml(p, id) {
    const title = `${p.name} · SB Barber Tienda`;
    const price = p.price ? `$${Number(p.price).toLocaleString('es-AR')}` : '';
    const desc = (p.description || 'Productos profesionales de barbería SB Barber.') + (price ? ` — ${price}` : '');
    const image = p.image || FALLBACK_IMAGE;
    const url = `${SITE_URL}/p/${encodeURIComponent(id)}`;
    const target = `/?p=${encodeURIComponent(id)}`;
    return `<!DOCTYPE html><html lang="es"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="SB Barber">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(url)}">
${p.price ? `<meta property="product:price:amount" content="${p.price}">\n<meta property="product:price:currency" content="ARS">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="canonical" href="${esc(target)}">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<script>location.replace(${JSON.stringify(target)});</script>
</head><body>
<p>Redirigiendo a <a href="${esc(target)}">${esc(p.name)}</a>…</p>
</body></html>`;
}
