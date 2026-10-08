// Conexión con la API de MercadoLibre para sincronizar el stock de productos_barber.
// Env vars en Vercel: ML_CLIENT_ID y ML_CLIENT_SECRET (de la app creada en developers.mercadolibre.com.ar).
//
// Los tokens se guardan en Firestore (ml_config/cuenta del proyecto de la barbería) CIFRADOS con una
// clave derivada de ML_CLIENT_SECRET: las reglas dejan leer cualquier doc a cualquier usuario logueado
// (incluida la sesión anónima de recepción), así que en claro cualquiera podría manejar la cuenta de ML.
import crypto from 'node:crypto';
import { barberDb } from './barberAdmin.js';

export const ML_API = 'https://api.mercadolibre.com';
export const ML_AUTH_URL = 'https://auth.mercadolibre.com.ar/authorization';
export const CONFIG_DOC = 'ml_config/cuenta';
export const PRODUCTOS = 'productos_barber';
const ITEM_ID_RE = /^ML[A-Z]{1,2}\d+$/; // IDs de publicación de ML, ej. MLA123456789

export function redirectUri() {
    return `${process.env.STORE_URL || 'https://tienda.sbbarber.com.ar'}/api/ml`;
}

function key() {
    const secret = process.env.ML_CLIENT_SECRET;
    if (!secret) throw new Error('Falta la env var ML_CLIENT_SECRET en Vercel');
    return crypto.createHash('sha256').update('sb-ml-tokens:' + secret).digest();
}

function encrypt(obj) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
    return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function decrypt(enc) {
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(enc.iv, 'base64'));
    d.setAuthTag(Buffer.from(enc.tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(enc.data, 'base64')), d.final()]).toString('utf8'));
}

async function tokenRequest(params) {
    const r = await fetch(`${ML_API}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
            client_id: process.env.ML_CLIENT_ID,
            client_secret: process.env.ML_CLIENT_SECRET,
            ...params
        })
    });
    const j = await r.json();
    if (!r.ok || !j.access_token) throw new Error(`ML token: ${j.message || j.error || r.status}`);
    return j;
}

// Guarda tokens nuevos. Los datos que no son secretos (usuario, fecha) quedan en claro para mostrarlos en la app.
export async function saveTokens(t, extra = {}) {
    await barberDb().doc(CONFIG_DOC).set({
        tokens: encrypt({ access: t.access_token, refresh: t.refresh_token }),
        expiraEn: Date.now() + (Number(t.expires_in) || 21600) * 1000,
        userId: t.user_id,
        actualizadoEn: new Date(),
        ...extra
    }, { merge: true });
}

export async function exchangeCode(code) {
    return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
}

export async function getCuenta() {
    const snap = await barberDb().doc(CONFIG_DOC).get();
    return snap.exists && snap.data().tokens ? snap.data() : null;
}

// Devuelve un access token válido, renovándolo si está por vencer. El refresh token de ML es de un
// solo uso: si dos funciones renuevan a la vez, la segunda falla; en ese caso se relee el doc y se
// usa el token que guardó la otra.
export async function getAccessToken() {
    let cuenta = await getCuenta();
    if (!cuenta) throw new Error('MercadoLibre no está conectado');
    if (cuenta.expiraEn - Date.now() > 5 * 60 * 1000) return { token: decrypt(cuenta.tokens).access, userId: cuenta.userId };
    try {
        const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: decrypt(cuenta.tokens).refresh });
        await saveTokens(t);
        return { token: t.access_token, userId: t.user_id };
    } catch (e) {
        cuenta = await getCuenta();
        if (cuenta && cuenta.expiraEn - Date.now() > 5 * 60 * 1000) return { token: decrypt(cuenta.tokens).access, userId: cuenta.userId };
        throw e;
    }
}

export async function mlFetch(path, { method = 'GET', body } = {}) {
    const { token } = await getAccessToken();
    const r = await fetch(`${ML_API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
        const causa = Array.isArray(j.cause) && j.cause.length ? ` (${j.cause.map(c => c.message || c.code).join('; ')})` : '';
        throw new Error(`ML ${method} ${path}: ${j.message || r.status}${causa}`);
    }
    return j;
}

// Publicaciones activas y pausadas del vendedor, aplanadas: una fila por publicación o por variante.
export async function listarPublicaciones() {
    const { userId } = await getAccessToken();
    const ids = [];
    for (const status of ['active', 'paused']) {
        for (let offset = 0; offset < 1000; offset += 50) {
            const r = await mlFetch(`/users/${userId}/items/search?status=${status}&limit=50&offset=${offset}`);
            ids.push(...(r.results || []));
            if (offset + 50 >= (r.paging?.total || 0)) break;
        }
    }
    const filas = [];
    for (let i = 0; i < ids.length; i += 20) {
        const lote = await mlFetch(`/items?ids=${ids.slice(i, i + 20).join(',')}&attributes=id,title,available_quantity,thumbnail,variations,status`);
        for (const { code, body: it } of lote) {
            if (code !== 200 || !it) continue;
            const base = { itemId: it.id, title: it.title, thumbnail: it.thumbnail, status: it.status };
            if (Array.isArray(it.variations) && it.variations.length) {
                for (const v of it.variations) {
                    const nombre = (v.attribute_combinations || []).map(a => a.value_name).filter(Boolean).join(' / ');
                    filas.push({ ...base, variationId: v.id, variacion: nombre, stock: v.available_quantity });
                }
            } else {
                filas.push({ ...base, variationId: null, variacion: '', stock: it.available_quantity });
            }
        }
    }
    return filas;
}

// Pone en ML el stock que tiene la app para los productos enlazados indicados (o todos si ids es null).
// Siempre "copia" el valor actual de Firestore, así que llamarla de más no hace daño.
export async function sincronizarStock(ids = null) {
    const db = barberDb();
    let docs;
    if (ids && ids.length) {
        docs = (await Promise.all(ids.slice(0, 50).map(id => db.doc(`${PRODUCTOS}/${id}`).get()))).filter(d => d.exists);
    } else {
        docs = (await db.collection(PRODUCTOS).where('mlItemId', '!=', null).get()).docs;
    }
    // mlItemId/mlVariationId los escribe el cliente (cualquier usuario logueado puede), así que se
    // validan antes de meterlos en una URL que se llama con el token del vendedor.
    const valido = p => ITEM_ID_RE.test(p.mlItemId || '') && (!p.mlVariationId || /^\d+$/.test(String(p.mlVariationId)));
    const todos = docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.mlItemId && !p.oculto);
    const enlazados = todos.filter(valido);
    for (const p of todos.filter(p => !valido(p))) {
        await db.doc(`${PRODUCTOS}/${p.id}`).set({ mlSync: { ok: false, error: 'Enlace inválido: volvé a enlazar el producto', en: new Date() } }, { merge: true });
    }

    // Agrupar por publicación: con variantes, ML borra las que no se mandan en el PUT, así que
    // hay que mandar todas las variantes de la publicación (cambiando solo las enlazadas).
    const porItem = {};
    enlazados.forEach(p => (porItem[p.mlItemId] ||= []).push(p));

    const resultados = [];
    for (const [itemId, prods] of Object.entries(porItem)) {
        const qtyDe = p => Math.max(0, Math.floor(Number(p.stock) || 0));
        try {
            const conVariante = prods.filter(p => p.mlVariationId);
            if (conVariante.length) {
                const item = await mlFetch(`/items/${encodeURIComponent(itemId)}?attributes=variations`);
                const variations = (item.variations || []).map(v => {
                    const p = conVariante.find(x => String(x.mlVariationId) === String(v.id));
                    return { id: v.id, available_quantity: p ? qtyDe(p) : v.available_quantity };
                });
                await mlFetch(`/items/${encodeURIComponent(itemId)}`, { method: 'PUT', body: { variations } });
            } else {
                await mlFetch(`/items/${encodeURIComponent(itemId)}`, { method: 'PUT', body: { available_quantity: qtyDe(prods[0]) } });
            }
            for (const p of prods) {
                await db.doc(`${PRODUCTOS}/${p.id}`).set({ mlSync: { ok: true, stock: qtyDe(p), en: new Date() } }, { merge: true });
                resultados.push({ id: p.id, ok: true, stock: qtyDe(p) });
            }
        } catch (e) {
            for (const p of prods) {
                await db.doc(`${PRODUCTOS}/${p.id}`).set({ mlSync: { ok: false, error: String(e.message).slice(0, 300), en: new Date() } }, { merge: true });
                resultados.push({ id: p.id, ok: false, error: e.message });
            }
        }
    }
    return resultados;
}
