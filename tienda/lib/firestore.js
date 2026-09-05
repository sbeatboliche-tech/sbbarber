// Helpers livianos para leer Firestore por REST desde funciones serverless, sin el SDK de Admin
// (no hace falta cuenta de servicio: son las mismas colecciones que ya se leen en público desde el cliente).
const FIREBASE_PROJECT_ID = 'sb-barber-6dc16';
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

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
