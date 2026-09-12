// Uso único: borra los 5 registros huérfanos que quedaron en tienda_productos_custom
// (overrides "oculto" de productos que ya se sacaron del código).
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const KEY_PATH = 'C:/Users/Agus/Desktop/sb_barber_secrets/sbbarbertienda-service-account.json';
const IDS = [
    'aftershave-celeste-black',
    'aftershave-violeta-black',
    'quita-pelo-lujo',
    'peine-toniguy',
    'desinfectante-everest'
];

const app = initializeApp({ credential: cert(JSON.parse(readFileSync(KEY_PATH, 'utf8'))) });
const db = getFirestore(app);

for (const id of IDS) {
    await db.collection('tienda_productos_custom').doc(id).delete();
    console.log('Borrado:', id);
}
console.log('Listo.');
