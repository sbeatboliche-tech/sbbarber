// Notificaciones push de la app (Android/iOS, Capacitor) vía Firebase Cloud Messaging del proyecto
// sb-barber-6dc16. Cada celu con la app guarda su token en push_tokens/{token} al loguearse
// (assets/push.js): { email, plataforma, ... }.
// A quién le llega se decide acá por el email (dueños fijos y la colección barberos), nunca por los
// campos admin/barbero que escribe el celu: cualquier logueado puede escribir en push_tokens.
import { getMessaging } from 'firebase-admin/messaging';
import { barberApp, barberDb, OWNERS } from './barberAdmin.js';

const TOKENS = 'push_tokens';
const TOKEN_MUERTO = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'];
// Respaldo si no se puede leer la config de la barbería (barberias/sb-barber, assets/config-barberia.js).
const BARBEROS_BASE = { 'ap1773508@gmail.com': 'Tony', 'stefanoacostasla@gmail.com': 'Stefa', 'rodriguezsantiagoet5@gmail.com': 'Santi', 'santiagofl551@gmail.com': 'SantiF' };

async function emailsDeBarbero(db, nombre) {
    const cfg = (await db.doc('barberias/sb-barber').get().catch(() => null))?.data();
    if (Array.isArray(cfg?.barberos)) return cfg.barberos.filter(b => b.nombre === nombre && b.email).map(b => b.email);
    return Object.entries(BARBEROS_BASE).filter(([, n]) => n === nombre).map(([e]) => e);
}

// para: { barbero: 'Santi' } | { admins: true }. excluirEmail: no avisarle a quien hizo la acción.
export async function enviarPush(para, { titulo, cuerpo, datos = {} }, { excluirEmail } = {}) {
    const db = barberDb();
    const emails = (para.admins ? OWNERS : await emailsDeBarbero(db, para.barbero)).filter(e => e !== excluirEmail);
    if (!emails.length) return 0;
    const snap = await db.collection(TOKENS).where('email', 'in', emails.slice(0, 30)).get();
    const tokens = snap.docs.map(d => d.id);
    if (!tokens.length) return 0;

    const r = await getMessaging(barberApp()).sendEachForMulticast({
        tokens,
        notification: { title: titulo, body: cuerpo },
        data: Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, String(v)])),
        android: { priority: 'high', notification: { sound: 'default', color: '#000000' } },
        apns: { payload: { aps: { sound: 'default' } } }
    });
    // Tokens de apps desinstaladas o vencidas: se borran para no reintentarlos.
    await Promise.all(r.responses.map((x, i) =>
        !x.success && TOKEN_MUERTO.includes(x.error?.code) ? db.doc(`${TOKENS}/${tokens[i]}`).delete().catch(() => {}) : null));
    return r.successCount;
}
