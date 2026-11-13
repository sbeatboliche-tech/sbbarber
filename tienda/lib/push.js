// Notificaciones push de la app (Android/iOS, Capacitor) vía Firebase Cloud Messaging del proyecto
// sb-barber-6dc16. Cada celu con la app guarda su token en push_tokens/{token} al loguearse
// (assets/push.js): { email, barbero, admin, plataforma }.
import { getMessaging } from 'firebase-admin/messaging';
import { barberApp, barberDb } from './barberAdmin.js';

const TOKENS = 'push_tokens';
const TOKEN_MUERTO = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'];

// para: { barbero: 'Santi' } | { admins: true }. excluirEmail: no avisarle a quien hizo la acción.
export async function enviarPush(para, { titulo, cuerpo, datos = {} }, { excluirEmail } = {}) {
    const db = barberDb();
    let q = db.collection(TOKENS);
    q = para.admins ? q.where('admin', '==', true) : q.where('barbero', '==', para.barbero);
    const snap = await q.get();
    const tokens = snap.docs.filter(d => !excluirEmail || d.data().email !== excluirEmail).map(d => d.id);
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
