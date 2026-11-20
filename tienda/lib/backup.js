// Se ejecuta como /api/uso?action=backup (cron de vercel.json): el plan Hobby de Vercel permite como máximo
// 12 funciones en api/, y como función propia era la número 13 y hacía fallar todos los deploys.
// Copia de seguridad semanal de las bases de Firestore (barbería sb-barber-6dc16 + tienda sbbarbertienda).
// La dispara el cron de Vercel (vercel.json) los domingos a la madrugada, recién arrancada la cuota diaria
// de lecturas (se renueva a medianoche de California). Arma un JSON comprimido por proyecto y lo manda
// adjunto por mail a sbbaarber@gmail.com: así quedan copias guardadas en Gmail sin pagar almacenamiento.
//
// Cuidado con la cuota gratis (50.000 lecturas por día): cada documento copiado es una lectura. Antes de
// copiar se cuentan los documentos (count() casi no gasta) y se saltea lo que pase de los topes.
// Como cualquiera puede llamar a esta URL, solo corre una vez cada 6 días (chequeo atómico en Firestore).
import zlib from 'node:zlib';
import nodemailer from 'nodemailer';
import { FieldValue } from 'firebase-admin/firestore';
import { barberDb } from './barberAdmin.js';
import { getAdminDb } from './firebaseAdmin.js';

const TOPE_COLECCION = 15000;
const TOPE_TOTAL = 20000;
const SALTEAR = new Set(['tienda_visitas']); // contador de visitas: mucho volumen y no hace falta respaldarlo
const MAIL = 'sbbaarber@gmail.com';

// maxDuration (300 s) se declara en api/uso.js, que es la función que la ejecuta.

async function colecciones(db) {
    const raiz = await db.listCollections();
    const lista = raiz.filter(c => c.id !== 'artifacts').map(c => c.path);
    // Datos viejos de la barbería: artifacts/sb-barber-6dc16/public/data/{colección}
    const data = db.doc('artifacts/sb-barber-6dc16/public/data');
    try { (await data.listCollections()).forEach(c => lista.push(c.path)); } catch {}
    // Datos de las otras barberías (multi-barbería etapa 2): barberias/{id}/{colección}
    try {
        for (const b of await db.collection('barberias').listDocuments()) {
            (await b.listCollections()).forEach(c => lista.push(c.path));
        }
    } catch {}
    return lista;
}

async function copiar(db, nombre, presupuesto) {
    const out = { proyecto: nombre, fecha: new Date().toISOString(), colecciones: {}, salteadas: {} };
    let usados = 0;
    for (const path of await colecciones(db)) {
        if (SALTEAR.has(path)) { out.salteadas[path] = 'excluida'; continue; }
        const n = (await db.collection(path).count().get()).data().count;
        if (n > TOPE_COLECCION || usados + n > presupuesto.restante) { out.salteadas[path] = `${n} docs (supera el tope)`; continue; }
        const snap = await db.collection(path).get();
        out.colecciones[path] = Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
        usados += snap.size;
        presupuesto.restante -= snap.size;
    }
    out.documentos = usados;
    return out;
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    // Solo el cron: con CRON_SECRET en Vercel, Vercel lo manda en el header; sin él, solo se acepta
    // en la ventana del cron (domingo 8 a 11 UTC), así nadie puede adelantarla y gastar lecturas.
    const ahora = new Date();
    const autorizado = process.env.CRON_SECRET
        ? req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`
        : ahora.getUTCDay() === 0 && ahora.getUTCHours() >= 8 && ahora.getUTCHours() < 11;
    if (!autorizado) return res.status(403).json({ error: 'No autorizado' });
    try {
        const marca = barberDb().doc('backup_estado/ultimo');
        const libre = await barberDb().runTransaction(async tx => {
            const ult = (await tx.get(marca)).data()?.en?.toMillis?.() || 0;
            if (Date.now() - ult < 6 * 864e5) return false;
            tx.set(marca, { en: FieldValue.serverTimestamp(), estado: 'corriendo' });
            return true;
        });
        if (!libre) return res.json({ ok: true, salteado: 'ya se hizo esta semana' });

        const presupuesto = { restante: TOPE_TOTAL };
        const copias = [await copiar(barberDb(), 'sb-barber-6dc16', presupuesto)];
        try { copias.push(await copiar(getAdminDb(), 'sbbarbertienda', { restante: TOPE_TOTAL })); }
        catch (e) { console.error('backup tienda:', e); }

        const dia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
        const adjuntos = copias.map(c => ({
            filename: `backup-${c.proyecto}-${dia}.json.gz`,
            content: zlib.gzipSync(JSON.stringify(c))
        }));
        const resumen = copias.map(c => {
            const cols = Object.entries(c.colecciones).map(([p, docs]) => `  ${p}: ${Object.keys(docs).length}`).join('\n');
            const salt = Object.entries(c.salteadas).map(([p, m]) => `  ${p}: ${m}`).join('\n');
            return `${c.proyecto} — ${c.documentos} documentos\n${cols}${salt ? `\nNo copiadas:\n${salt}` : ''}`;
        }).join('\n\n');

        await nodemailer.createTransport({ service: 'gmail', auth: { user: MAIL, pass: process.env.GMAIL_APP_PASSWORD } }).sendMail({
            from: `"SB Barber Backups" <${MAIL}>`, to: MAIL,
            subject: `Copia de seguridad ${dia}`,
            text: `Copia semanal automática de las bases de datos. Guardá este mail (no lo borres).\n\n${resumen}\n\nPara restaurar algo, pasale el archivo adjunto a quien te arma el sistema.`,
            attachments: adjuntos
        });
        await marca.set({ en: FieldValue.serverTimestamp(), estado: 'ok', resumen }, { merge: true });
        return res.json({ ok: true, documentos: copias.map(c => c.documentos) });
    } catch (e) {
        console.error('backup:', e);
        await barberDb().doc('backup_estado/ultimo').set({ estado: 'error', error: e.message }, { merge: true }).catch(() => {});
        return res.status(500).json({ error: 'Falló la copia' });
    }
}
