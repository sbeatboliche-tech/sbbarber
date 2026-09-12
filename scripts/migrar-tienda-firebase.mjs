// Uso único: copia las colecciones tienda_* del proyecto viejo al nuevo.
// Correr con: node scripts/migrar-tienda-firebase.mjs
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const OLD_KEY_PATH = 'C:/Users/Agus/Desktop/sb_barber_secrets/sb-barber-6dc16-service-account.json';
const NEW_KEY_PATH = 'C:/Users/Agus/Desktop/sb_barber_secrets/sbbarbertienda-service-account.json';

const COLLECTIONS = [
    'tienda_productos',
    'tienda_productos_custom',
    'tienda_kits_custom',
    'tienda_cursos',
    'tienda_config',
    'tienda_pedidos',
    'tienda_visitas'
];

const oldApp = initializeApp({ credential: cert(JSON.parse(readFileSync(OLD_KEY_PATH, 'utf8'))) }, 'old');
const newApp = initializeApp({ credential: cert(JSON.parse(readFileSync(NEW_KEY_PATH, 'utf8'))) }, 'new');
const oldDb = getFirestore(oldApp);
const newDb = getFirestore(newApp);

for (const col of COLLECTIONS) {
    const snap = await oldDb.collection(col).get();
    console.log(`${col}: ${snap.size} documentos`);
    let batch = newDb.batch();
    let count = 0;
    for (const docSnap of snap.docs) {
        batch.set(newDb.collection(col).doc(docSnap.id), docSnap.data());
        count++;
        if (count % 400 === 0) {
            await batch.commit();
            batch = newDb.batch();
        }
    }
    if (count % 400 !== 0) await batch.commit();
}

console.log('Migración completa.');
