// Lecturas de Firestore de hoy en sb-barber-6dc16 (plan Spark: 50.000 por día; la cuota se reinicia a la
// medianoche de California = 4 o 5 de la mañana en Argentina).
//   GET /api/uso (solo dueños, con el ID token de Firebase) → { lecturas, limites, porHora, dispositivos, reinicio }
// El número exacto (Cloud Monitoring) exige facturación, así que es un ESTIMADO: recepcionista, anotar y
// estadísticas cuentan lo que reciben y lo suman en uso_lecturas/{día} (assets/uso-lecturas.js).
// Si pasa el 70% / 85%, avisa una vez por día a los celus de los dueños (más temprano que el límite
// real porque el estimado puede quedarse corto).
import { barberDb, verifyBarberUser, OWNERS } from '../lib/barberAdmin.js';
import { enviarPush } from '../lib/push.js';

const LIMITES = { lecturas: 50000 };
const AVISOS = [0.85, 0.7];   // de mayor a menor: se manda el más alto alcanzado que no se haya mandado
let _cache = null;            // { t, datos }: la función queda tibia entre pedidos, así no se lee de más

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const user = await verifyBarberUser(req);
    if (!user) return res.status(401).json({ error: 'Sesión inválida' });
    if (!OWNERS.includes(user.email)) return res.status(403).json({ error: 'Solo dueños' });

    try {
        if (!_cache || Date.now() - _cache.t > 2 * 60 * 1000) {
            _cache = { t: Date.now(), datos: await medirUso() };
            await avisarSiHaceFalta(_cache.datos).catch(e => console.warn('uso aviso:', e.message));
        }
        return res.json(_cache.datos);
    } catch (e) {
        console.error('uso:', e);
        return res.status(500).json({ error: e.message });
    }
}

// Medianoche de hoy en California (America/Los_Angeles) y la fecha de ese día (YYYY-MM-DD).
function diaCuota(ahora = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(ahora).map(x => [x.type, x.value]));
    const ms = ((+p.hour * 60 + +p.minute) * 60 + +p.second) * 1000 + ahora.getMilliseconds();
    return { dia: `${p.year}-${p.month}-${p.day}`, desde: new Date(ahora.getTime() - ms) };
}

async function medirUso() {
    const ahora = new Date();
    const { dia, desde } = diaCuota(ahora);
    const s = await barberDb().doc(`uso_lecturas/${dia}`).get();
    const d = s.exists ? s.data() : {};
    const horas = d.horas || {};
    // "HH" en hora de California → fin de esa hora como fecha
    const porHora = Object.keys(horas).sort().map(h => ({
        hora: new Date(desde.getTime() + (Number(h) + 1) * 3600e3).toISOString(),
        n: Number(horas[h]) || 0
    }));
    const dispositivos = Object.entries(d.dispositivos || {})
        .map(([quien, n]) => ({ quien, n: Number(n) || 0 })).sort((a, b) => b.n - a.n);
    return {
        estimado: true, dia, limites: LIMITES,
        lecturas: Number(d.total) || 0, porHora, dispositivos,
        desde: desde.toISOString(), reinicio: new Date(desde.getTime() + 864e5).toISOString(), actualizado: ahora.toISOString()
    };
}

// Un aviso por umbral y por día de cuota: uso_avisos/{día} guarda el último umbral avisado.
// Solo se toca Firestore cuando ya se pasó el primer umbral, así en un día normal no gasta nada.
async function avisarSiHaceFalta(datos) {
    const frac = datos.lecturas / LIMITES.lecturas;
    const umbral = AVISOS.find(u => frac >= u);
    if (!umbral) return;
    const db = barberDb();
    const ref = db.doc(`uso_avisos/${datos.dia}`);
    const mandar = await db.runTransaction(async tx => {
        const s = await tx.get(ref);
        if ((s.data()?.umbral || 0) >= umbral) return false;
        tx.set(ref, { umbral, lecturas: datos.lecturas, fecha: new Date() }, { merge: true });
        return true;
    });
    if (!mandar) return;
    const n = datos.lecturas.toLocaleString('es-AR');
    await enviarPush({ admins: true }, {
        titulo: umbral >= 0.85 ? '🚨 Firebase cerca del límite de lecturas' : '⚠️ Firebase al 70% de lecturas',
        cuerpo: `Van unas ${n} de 50.000 lecturas de hoy. Se reinicia a la madrugada.`,
        datos: { tipo: 'uso' }
    });
}
