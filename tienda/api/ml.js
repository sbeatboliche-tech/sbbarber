// MercadoLibre ↔ stock de la barbería (productos_barber en sb-barber-6dc16).
// Lo llaman recepcionista y anotar (otro dominio: GitHub Pages / Electron), con el ID token de Firebase.
//   GET  /api/ml?action=status            → si hay cuenta conectada y cuál
//   POST /api/ml?action=connect           → (solo dueños) devuelve la URL para autorizar en ML
//   GET  /api/ml?code=...&state=...       → vuelta de la autorización de ML (redirect URI registrada)
//   GET  /api/ml?action=items             → publicaciones del vendedor para enlazar productos
//   POST /api/ml?action=sync {ids?: []}   → copia a ML el stock de la app (todos si no hay ids)
import crypto from 'node:crypto';
import { barberDb, verifyBarberUser, OWNERS } from '../lib/barberAdmin.js';
import { ML_AUTH_URL, CONFIG_DOC, redirectUri, exchangeCode, saveTokens, mlFetch, getCuenta, listarPublicaciones, sincronizarStock } from '../lib/ml.js';

const APP_URL = 'https://sbbarber.com.ar/recepcionista/';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();

    // Vuelta de ML después de autorizar: no trae token de Firebase, la valida el "state" de un solo uso.
    if (req.method === 'GET' && (req.query.code || req.query.error)) return callback(req, res);

    if (!process.env.ML_CLIENT_ID || !process.env.ML_CLIENT_SECRET) {
        return res.status(500).json({ error: 'Faltan ML_CLIENT_ID / ML_CLIENT_SECRET en Vercel' });
    }
    const user = await verifyBarberUser(req);
    if (!user) return res.status(401).json({ error: 'Sesión inválida' });

    try {
        switch (req.query.action) {
            case 'status': {
                const cuenta = await getCuenta();
                return res.json({ conectado: !!cuenta, nickname: cuenta?.nickname || null });
            }
            case 'connect': {
                if (!OWNERS.includes(user.email)) return res.status(403).json({ error: 'Solo los dueños pueden conectar la cuenta' });
                const state = firmarState(user.email);
                const url = `${ML_AUTH_URL}?${new URLSearchParams({ response_type: 'code', client_id: process.env.ML_CLIENT_ID, redirect_uri: redirectUri(), state })}`;
                return res.json({ url });
            }
            case 'items':
                // Enlazar productos: dueños o la sesión de recepción (anónima con la clave del local), no barberos.
                if (!OWNERS.includes(user.email) && user.firebase?.sign_in_provider !== 'anonymous') {
                    return res.status(403).json({ error: 'Solo recepción o los dueños pueden enlazar productos' });
                }
                return res.json({ items: await listarPublicaciones() });
            case 'sync': {
                if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
                const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : null;
                return res.json({ resultados: await sincronizarStock(ids) });
            }
            default:
                return res.status(400).json({ error: 'Acción desconocida' });
        }
    } catch (e) {
        console.error('ML api:', e);
        return res.status(500).json({ error: e.message });
    }
}

async function callback(req, res) {
    const volver = (msg) => res.status(302).setHeader('Location', `${APP_URL}#ml=${encodeURIComponent(msg)}`).end();
    const { code, state, error } = req.query;
    if (error) return volver('cancelado');
    try {
        const email = verificarState(state);
        if (!email) return volver('vencido');
        const t = await exchangeCode(code);
        await saveTokens(t, { conectadoPor: email, conectadoEn: new Date() });
        try {
            const me = await mlFetch('/users/me');
            await barberDb().doc(CONFIG_DOC).set({ nickname: me.nickname || null }, { merge: true });
        } catch (e) { console.error('ML users/me:', e); }
        return volver('ok');
    } catch (e) {
        console.error('ML callback:', e);
        return volver('error');
    }
}

// El "state" de OAuth va firmado con HMAC (clave derivada de ML_CLIENT_SECRET) en vez de guardarse en
// Firestore: las reglas dejan crear docs a cualquier logueado, así que alguien podía fabricarse un state
// válido y conectar SU cuenta de ML en lugar de la del local.
function hmac(txt) {
    return crypto.createHmac('sha256', 'sb-ml-state:' + process.env.ML_CLIENT_SECRET).update(txt).digest('base64url');
}
function firmarState(email) {
    const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + 10 * 60 * 1000, n: crypto.randomBytes(8).toString('hex') })).toString('base64url');
    return `${payload}.${hmac(payload)}`;
}
function verificarState(state) {
    const [payload, firma] = String(state || '').split('.');
    if (!payload || !firma) return null;
    const esperada = hmac(payload);
    if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
    try {
        const { email, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return exp > Date.now() && OWNERS.includes(email) ? email : null;
    } catch { return null; }
}
