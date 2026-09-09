// Acceso privilegiado a Firestore (bypassa las Security Rules) para operaciones que un
// cliente público nunca debe poder hacer, como marcar un pedido como pagado. Requiere la
// env var FIREBASE_SERVICE_ACCOUNT en Vercel con el JSON de la cuenta de servicio
// (Firebase Console → Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada).
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

let db = null;

export function getAdminDb() {
    if (db) return db;
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('Falta la env var FIREBASE_SERVICE_ACCOUNT en Vercel');
    const serviceAccount = JSON.parse(raw);
    const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
    db = getFirestore(app);
    return db;
}
