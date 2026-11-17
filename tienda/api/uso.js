// Uso de Firestore de hoy en sb-barber-6dc16 (plan Spark: 50.000 lecturas, 20.000 escrituras y 20.000 borrados
// por día; la cuota se reinicia a la medianoche de California = 4 o 5 de la mañana en Argentina).
//   GET /api/uso (solo dueños, con el ID token de Firebase) → { lecturas, escrituras, borrados, limites, porHora, reinicio }
// Los números salen de Cloud Monitoring (los mismos de la consola de Firebase, con unos minutos de atraso) y
// consultarlos no gasta lecturas de Firestore. Si las lecturas pasan el 80% / 95%, avisa una vez por día a los
// celus de los dueños.
import { barberApp, barberDb, verifyBarberUser, OWNERS } from '../lib/barberAdmin.js';
import { enviarPush } from '../lib/push.js';

const LIMITES = { lecturas: 50000, escrituras: 20000, borrados: 20000 };
const METRICAS = {
    lecturas: 'firestore.googleapis.com/document/read_count',
    escrituras: 'firestore.googleapis.com/document/write_count',
    borrados: 'firestore.googleapis.com/document/delete_count'
};
const AVISOS = [0.95, 0.8];   // de mayor a menor: se manda el más alto alcanzado que no se haya mandado
let _cache = null;            // { t, datos }: la función queda tibia entre pedidos, así no se consulta de más

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

// Medianoche de hoy en California (America/Los_Angeles), que es cuando Google reinicia la cuota.
function inicioDiaCuota(ahora = new Date()) {
    const f = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const p = Object.fromEntries(f.formatToParts(ahora).map(x => [x.type, x.value]));
    const ms = ((+p.hour * 60 + +p.minute) * 60 + +p.second) * 1000 + ahora.getMilliseconds();
    return new Date(ahora.getTime() - ms);
}

async function medirUso() {
    const app = barberApp();
    const proyecto = app.options.credential.projectId || 'sb-barber-6dc16';
    const { access_token } = await app.options.credential.getAccessToken();
    const ahora = new Date();
    const desde = inicioDiaCuota(ahora);

    const datos = { limites: LIMITES, desde: desde.toISOString(), reinicio: new Date(desde.getTime() + 864e5).toISOString(), actualizado: ahora.toISOString() };
    await Promise.all(Object.entries(METRICAS).map(async ([clave, metrica]) => {
        const q = new URLSearchParams({
            filter: `metric.type="${metrica}"`,
            'interval.startTime': desde.toISOString(),
            'interval.endTime': ahora.toISOString(),
            'aggregation.alignmentPeriod': '3600s',
            'aggregation.perSeriesAligner': 'ALIGN_SUM',
            'aggregation.crossSeriesReducer': 'REDUCE_SUM'
        });
        const r = await fetch(`https://monitoring.googleapis.com/v3/projects/${proyecto}/timeSeries?${q}`, {
            headers: { Authorization: `Bearer ${access_token}` }
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(`Monitoring ${r.status}: ${j.error?.message || 'sin detalle'}`);
        const puntos = (j.timeSeries?.[0]?.points || []).map(pt => ({
            hora: pt.interval.endTime,
            n: Number(pt.value.int64Value ?? pt.value.doubleValue ?? 0)
        })).reverse(); // Monitoring los devuelve del más nuevo al más viejo
        datos[clave] = puntos.reduce((s, pt) => s + pt.n, 0);
        if (clave === 'lecturas') datos.porHora = puntos;
    }));
    return datos;
}

// Un aviso por umbral y por día de cuota: uso_avisos/{fecha} guarda el último umbral avisado.
// Solo se toca Firestore cuando ya se pasó el 80%, así en un día normal no gasta nada.
async function avisarSiHaceFalta(datos) {
    const frac = datos.lecturas / LIMITES.lecturas;
    const umbral = AVISOS.find(u => frac >= u);
    if (!umbral) return;
    const db = barberDb();
    const ref = db.doc(`uso_avisos/${datos.desde.slice(0, 10)}`);
    const mandar = await db.runTransaction(async tx => {
        const s = await tx.get(ref);
        if ((s.data()?.umbral || 0) >= umbral) return false;
        tx.set(ref, { umbral, lecturas: datos.lecturas, fecha: new Date() }, { merge: true });
        return true;
    });
    if (!mandar) return;
    const n = datos.lecturas.toLocaleString('es-AR');
    await enviarPush({ admins: true }, {
        titulo: umbral >= 0.95 ? '🚨 Firebase casi sin lecturas' : '⚠️ Firebase al 80% de lecturas',
        cuerpo: `Van ${n} de 50.000 lecturas de hoy. Se reinicia a la madrugada.`,
        datos: { tipo: 'uso' }
    });
}
