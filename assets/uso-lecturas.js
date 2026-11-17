/* =========================================================
   Contador estimado de lecturas de Firestore (sb-barber-6dc16, plan gratis: 50.000 por día).
   Google no deja leer el número exacto sin facturación, así que cada app cuenta lo que le
   llega del servidor y lo suma cada pocos minutos en `uso_lecturas/{día de la cuota}`.
   tienda/api/uso.js lo lee y avisa al celu de los dueños si se acerca al límite.

   Uso: importar onSnapshot / getDocs / getDoc de acá en vez de firebase-firestore.js
   (mismas firmas) y llamar una vez a iniciarContador(db, nombre).

   Es un estimado: cuenta los documentos que llegan del servidor (no los de la caché local).
   Cuando un listener se reconecta cuenta la consulta entera, así que tiende a contar de más.
   ========================================================= */
import {
    onSnapshot as _onSnapshot, getDocs as _getDocs, getDoc as _getDoc,
    doc, setDoc, increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const FLUSH_MS = 3 * 60 * 1000;
let pendiente = 0, db = null, quien = 'desconocido', timer = null;

const sumar = n => { if (n > 0) pendiente += n; };

// Día y hora de la cuota: Google la reinicia a la medianoche de California
function diaYHoraCuota(ahora = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
    }).formatToParts(ahora).map(x => [x.type, x.value]));
    return { dia: `${p.year}-${p.month}-${p.day}`, hora: p.hour };
}

async function volcar() {
    if (!db || !pendiente) return;
    const n = pendiente;
    pendiente = 0;
    const { dia, hora } = diaYHoraCuota();
    try {
        await setDoc(doc(db, 'uso_lecturas', dia), {
            total: increment(n),
            horas: { [hora]: increment(n) },
            dispositivos: { [quien]: increment(n) },
            actualizado: serverTimestamp()
        }, { merge: true });
    } catch (e) { console.warn('uso-lecturas:', e.message); }
}

/** nombre: quién cuenta (email), para ver qué dispositivo lee más. */
export function iniciarContador(firestoreDb, nombre) {
    db = firestoreDb;
    if (nombre) quien = String(nombre).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
    if (timer) return;
    timer = setInterval(volcar, FLUSH_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') volcar(); });
    window.addEventListener('pagehide', volcar);
}

// Snapshot de consulta: la primera vez que llega del servidor se cuenta entera (mínimo 1, una consulta
// vacía también cobra); después, solo lo que cambió. Snapshot de un documento: 1.
function contador() {
    let primera = true;
    return snap => {
        try {
            const m = snap?.metadata;
            if (!m || m.fromCache || m.hasPendingWrites) return;
            if (typeof snap.docChanges === 'function') {
                sumar(primera ? Math.max(1, snap.size) : snap.docChanges().filter(c => c.type !== 'removed').length);
            } else sumar(1);
            primera = false;
        } catch {}
    };
}

export function onSnapshot(ref, ...args) {
    const contar = contador();
    // Firmas: (ref, cb, err?, done?), (ref, opciones, cb, ...), (ref, observer), (ref, opciones, observer)
    const i = args.findIndex(a => typeof a === 'function' || (a && typeof a.next === 'function'));
    if (i >= 0) {
        const a = args[i];
        args[i] = typeof a === 'function'
            ? (snap => { contar(snap); return a(snap); })
            : { ...a, next: snap => { contar(snap); return a.next(snap); } };
    }
    return _onSnapshot(ref, ...args);
}

export async function getDocs(q) {
    const snap = await _getDocs(q);
    if (!snap.metadata.fromCache) sumar(Math.max(1, snap.size));
    return snap;
}

export async function getDoc(ref) {
    const snap = await _getDoc(ref);
    if (!snap.metadata.fromCache) sumar(1);
    return snap;
}
