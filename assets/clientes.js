/* =========================================================
   Fichas de clientes (colección `clientes`, proyecto sb-barber-6dc16)
   Lo usan recepcionista y anotar para buscar al cliente por nombre
   al anotar un corte o un turno, y así cada corte queda atado a una
   ficha (`clienteId`) en vez de a un texto suelto.

   Para no gastar lecturas de Firebase la lista se guarda en
   localStorage y solo se piden las fichas nuevas (por `creadoEn`).
   ========================================================= */
const COL = 'clientes';
const LS_KEY = 'sb_clientes_v1';
const DAY = 864e5;
const RESYNC_MS = 5 * 60 * 1000;

export const normNombre = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
// Mismo criterio que estadísticas: estos no son un cliente de verdad
const GENERICOS = new Set(['cliente', 'clienta', 'x', 'xx', 'nn', 'sin nombre', 'nuevo', 'amigo']);
export const esNombreValido = n => n.length >= 2 && !GENERICOS.has(n);

let db = null, fb = null, getEmail = () => null;
let lista = [];          // [{ id, nombre, n }]
let porId = new Map();
let syncedAt = 0, syncing = null;

function guardarLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ syncedAt, docs: lista })); } catch {}
}
function agregar(c) {
    if (porId.has(c.id)) { Object.assign(porId.get(c.id), c); return; }
    lista.push(c); porId.set(c.id, c);
}
function quitar(id) {
    if (!porId.has(id)) return;
    porId.delete(id);
    lista = lista.filter(c => c.id !== id);
}

async function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
        const ahora = Date.now();
        const q = syncedAt
            ? fb.query(fb.collection(db, COL), fb.where('creadoEn', '>=', new Date(syncedAt - DAY)))
            : fb.collection(db, COL);
        const snap = await fb.getDocs(q);
        snap.docs.forEach(d => {
            const x = d.data();
            // Sacado de la lista desde estadísticas (ahí se actualiza creadoEn para que llegue acá)
            if (x.eliminado) { quitar(d.id); return; }
            agregar({ id: d.id, nombre: x.nombre || '', n: x.n || normNombre(x.nombre), alias: Array.isArray(x.alias) ? x.alias : [] });
        });
        syncedAt = ahora;
        guardarLocal();
    })().catch(err => console.warn('clientes: no se pudo sincronizar', err)).finally(() => { syncing = null; });
    return syncing;
}

/** fbFns: { collection, query, where, getDocs, doc, setDoc, serverTimestamp } */
export function initClientes(firestoreDb, fbFns, emailFn) {
    db = firestoreDb; fb = fbFns; if (emailFn) getEmail = emailFn;
    try {
        const c = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
        if (c && Array.isArray(c.docs)) { c.docs.forEach(agregar); syncedAt = c.syncedAt || 0; }
    } catch {}
    sync();
}

function buscar(texto, max = 6) {
    const q = normNombre(texto);
    if (!q) return [];
    const tokens = q.split(' ');
    return lista
        .filter(c => tokens.every(t => c.n.includes(t)))
        .map(c => ({ c, s: c.n.startsWith(q) ? 0 : c.n.split(' ').some(w => w.startsWith(tokens[0])) ? 1 : 2 }))
        .sort((a, b) => a.s - b.s || a.c.nombre.localeCompare(b.c.nombre))
        .slice(0, max).map(x => x.c);
}

// Celular / tablet (recepcionista en el celu del admin, anotar): filas más grandes y sin zoom
const esTactil = () => matchMedia('(pointer: coarse)').matches || matchMedia('(max-width: 767px)').matches;

const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** Mientras se escribe en el <input>, sugiere nombres ya guardados u ofrece agregar uno nuevo. */
export function pickerCliente(input) {
    if (!input || input.dataset.picker) return;
    input.dataset.picker = '1';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'words');
    input.setAttribute('enterkeyhint', 'done');
    // iPhone hace zoom al enfocar un input de menos de 16px y la lista queda fuera de pantalla
    if (esTactil()) input.style.fontSize = '16px';

    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const menu = document.createElement('div');
    menu.style.cssText = 'position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:60;background:#111827;border:1px solid rgba(255,255,255,.12);border-radius:14px;overflow:hidden;box-shadow:0 12px 30px rgba(0,0,0,.5);display:none';
    wrap.appendChild(menu);

    let items = [], activo = -1;
    const cerrar = () => { menu.style.display = 'none'; items = []; activo = -1; };
    const elegir = i => {
        const it = items[i];
        if (!it) return;
        if (it.c) { input.value = it.c.nombre; input.dataset.clienteId = it.c.id; }
        else input.dataset.clienteId = resolverCliente(input).clienteId; // crea la ficha ya
        cerrar();
    };
    const pintar = () => {
        const fila = esTactil() ? 'padding:13px 16px;font-size:15px;' : 'padding:10px 14px;font-size:13px;';
        menu.innerHTML = items.map((it, i) => {
            const bg = (i === activo ? 'background:rgba(255,255,255,.08);' : '') + fila;
            return it.c
                ? `<div data-i="${i}" style="${bg}color:#fff;cursor:pointer">${esc(it.c.nombre)}</div>`
                : `<div data-i="${i}" style="${bg}${i ? 'border-top:1px solid rgba(255,255,255,.08);' : ''}color:#67e8f9;cursor:pointer">+ Cliente nuevo: <b>${esc(it.nuevo)}</b></div>`;
        }).join('');
        menu.style.display = items.length ? 'block' : 'none';
    };
    const abrir = () => {
        const texto = input.value.trim(), n = normNombre(texto);
        // Si ya está escrito tal cual, no hace falta sugerir
        items = buscar(texto, esTactil() ? 5 : 6).filter(c => c.n !== n || c.nombre !== texto).map(c => ({ c }));
        // Nombre que no está en ninguna lista: ofrecer agregarlo
        if (esNombreValido(n) && !lista.some(c => c.n === n || c.alias?.includes(n))) items.push({ nuevo: texto });
        activo = -1;
        pintar();
    };

    input.addEventListener('input', () => { delete input.dataset.clienteId; abrir(); });
    input.addEventListener('focus', () => {
        if (Date.now() - syncedAt > RESYNC_MS) sync();
        if (input.value.trim() && !input.dataset.clienteId) abrir();
        // En el celu el teclado tapa lo de abajo: subir el campo para que las sugerencias se vean
        if (esTactil()) setTimeout(() => input.scrollIntoView({ block: 'start', behavior: 'smooth' }), 300);
    });
    input.addEventListener('blur', () => setTimeout(cerrar, 250));
    input.addEventListener('keydown', e => {
        if (menu.style.display === 'none' || !items.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); activo = (activo + 1) % items.length; pintar(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); activo = (activo - 1 + items.length) % items.length; pintar(); }
        else if (e.key === 'Enter' && activo >= 0) { e.preventDefault(); elegir(activo); }
        else if (e.key === 'Escape') cerrar();
    });
    // mousedown para que no se pierda el foco antes del click
    menu.addEventListener('mousedown', e => {
        const el = e.target.closest('[data-i]');
        if (!el) return;
        e.preventDefault();
        elegir(Number(el.dataset.i));
    });
    // form.reset() no dispara 'input': limpiar la ficha elegida también
    input.form?.addEventListener('reset', () => { delete input.dataset.clienteId; cerrar(); });
}

/** Deja el input vacío y sin ficha elegida. */
export function limpiarCliente(input) {
    if (!input) return;
    input.value = '';
    delete input.dataset.clienteId;
}

/**
 * Al guardar: devuelve { clienteId, clientName }. Si el nombre coincide con una ficha la usa
 * (con el nombre tal cual está en la ficha); si es nuevo, crea la ficha sin esperar al servidor.
 */
export function resolverCliente(input) {
    const texto = (input?.value || '').trim();
    const n = normNombre(texto);
    if (!texto) return { clienteId: null, clientName: '' };
    const elegido = input.dataset.clienteId && porId.get(input.dataset.clienteId);
    const c = (elegido && elegido.n === n) ? elegido : (lista.find(x => x.n === n) || lista.find(x => x.alias?.includes(n)));
    if (c) return { clienteId: c.id, clientName: c.nombre };
    if (!esNombreValido(n) || !db) return { clienteId: null, clientName: texto };
    const ref = fb.doc(fb.collection(db, COL));
    fb.setDoc(ref, { nombre: texto, n, creadoEn: fb.serverTimestamp(), creadoPor: getEmail() || null })
        .catch(err => console.warn('clientes: no se pudo crear la ficha', err));
    agregar({ id: ref.id, nombre: texto, n });
    guardarLocal();
    return { clienteId: ref.id, clientName: texto };
}
