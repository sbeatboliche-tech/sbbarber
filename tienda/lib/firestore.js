// Helpers livianos para leer/escribir Firestore por REST desde funciones serverless, sin el SDK de Admin
// (no hace falta cuenta de servicio: son las mismas colecciones que ya se leen/escriben en público desde el cliente).
const FIREBASE_PROJECT_ID = 'sb-barber-6dc16';
const FIREBASE_API_KEY = 'AIzaSyAXUQmV19Z0VNbOlrrk_IcMc2GKQZ8yk7w';
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// Escribe (crea o pisa) un documento. Se usa como respaldo server-side de un pedido: si el
// guardado que hace el navegador del comprador falla (red, bloqueador de contenido, o la
// redirección a MercadoPago corta el fetch de setDoc antes de que termine), el pedido igual
// queda registrado porque este write corre en el servidor antes de responder al cliente.
export async function writeFirestoreDoc(docPath, data) {
    try {
        const url = `${BASE_URL}/${docPath}?key=${FIREBASE_API_KEY}`;
        const r = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: encodeFirestoreFields(data) })
        });
        return r.ok;
    } catch (e) {
        return false;
    }
}

function encodeFirestoreValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (v instanceof Date) return { timestampValue: v.toISOString() };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeFirestoreValue) } };
    if (typeof v === 'object') return { mapValue: { fields: encodeFirestoreFields(v) } };
    return { stringValue: String(v) };
}

function encodeFirestoreFields(obj) {
    const out = {};
    for (const [k, val] of Object.entries(obj || {})) {
        if (val !== undefined) out[k] = encodeFirestoreValue(val);
    }
    return out;
}

export async function fetchFirestoreDoc(docPath) {
    try {
        const r = await fetch(`${BASE_URL}/${docPath}`);
        if (!r.ok) return null;
        const data = await r.json();
        return decodeFirestoreFields(data.fields);
    } catch (e) {
        return null;
    }
}

// Devuelve todos los documentos de una colección como [{ id, ...campos }], paginando si hace falta.
export async function listFirestoreCollection(collectionPath) {
    const out = [];
    let pageToken = '';
    try {
        do {
            const url = `${BASE_URL}/${collectionPath}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
            const r = await fetch(url);
            if (!r.ok) break;
            const data = await r.json();
            (data.documents || []).forEach(docEntry => {
                const id = docEntry.name.split('/').pop();
                out.push({ id, ...decodeFirestoreFields(docEntry.fields) });
            });
            pageToken = data.nextPageToken || '';
        } while (pageToken);
    } catch (e) {
        // devolvemos lo que se haya podido leer hasta el corte
    }
    return out;
}

function decodeFirestoreFields(fields) {
    if (!fields) return {};
    const out = {};
    for (const [k, v] of Object.entries(fields)) out[k] = decodeFirestoreValue(v);
    return out;
}

function decodeFirestoreValue(v) {
    if (v.stringValue !== undefined) return v.stringValue;
    if (v.integerValue !== undefined) return Number(v.integerValue);
    if (v.doubleValue !== undefined) return v.doubleValue;
    if (v.booleanValue !== undefined) return v.booleanValue;
    if (v.nullValue !== undefined) return null;
    if (v.mapValue) return decodeFirestoreFields(v.mapValue.fields);
    if (v.arrayValue) return (v.arrayValue.values || []).map(decodeFirestoreValue);
    return null;
}
