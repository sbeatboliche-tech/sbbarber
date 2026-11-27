// Acceso privilegiado al proyecto Firebase de la barbería (sb-barber-6dc16), donde vive el stock
// de productos que usan recepcionista y anotar. Es otro proyecto que el de la tienda, así que usa
// su propia cuenta de servicio: env var FIREBASE_SERVICE_ACCOUNT_BARBER en Vercel (Firebase Console
// del proyecto sb-barber-6dc16 → Configuración → Cuentas de servicio → Generar nueva clave privada).
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const APP_NAME = 'barber';
export const OWNERS = ['abalo7272@gmail.com', 'carusomanu21@gmail.com'];

export function barberApp() {
    const existing = getApps().find(a => a.name === APP_NAME);
    if (existing) return existing;
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_BARBER;
    if (!raw) throw new Error('Falta la env var FIREBASE_SERVICE_ACCOUNT_BARBER en Vercel');
    return initializeApp({ credential: cert(JSON.parse(raw)) }, APP_NAME);
}

export const barberDb = () => getFirestore(barberApp());

// Valida el ID token de Firebase que manda recepcionista/anotar (header Authorization: Bearer ...).
// Devuelve el usuario decodificado o null.
// checkRevoked: además rechaza sesiones dadas de baja o deshabilitadas (1 consulta extra a Auth; se usa en lo sensible).
export async function verifyBarberUser(req, { checkRevoked = false } = {}) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return null;
    try { return await getAuth(barberApp()).verifyIdToken(token, checkRevoked); }
    catch { return null; }
}
