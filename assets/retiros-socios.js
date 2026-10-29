/* =========================================================
   Contraseña de Retiros + sección de los socios (Agus y Manu)
   Lo usan recepcionista y anotar.

   El botón de Retiros pide la contraseña cada vez:
     "sbsb"     → abre Retiros y Propinas de siempre
     "sbsb2004" → abre la sección de los socios
   Todo va a la colección retiros_socios y no toca el cierre de caja
   ni las cuentas de los barberos. Dos tipos de doc:
     tipo 'retiro': un monto que se reparten los dos socios. retiros.{Agus,Manu}
                    dice quién ya lo sacó (se marca con un toque).
     tipo 'deuda':  plata que la barbería le debe a un socio; pagada se marca con un toque.

   initRetirosSocios({ getDb, contenedor, abrirRetiros, getEmail, confirmar, fondo })
   pedirClaveRetiros()
   ========================================================= */
import { collection, query, orderBy, limit, onSnapshot, addDoc, updateDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CLAVE_RETIROS = 'sbsb';
const CLAVE_SOCIOS = 'sbsb2004';
const SOCIOS = ['Agus', 'Manu'];
const PATH = 'retiros_socios';
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

let cfg = null;
let items = [], unsub = null;
let tab = 'retiros';
let mesSel = mesActual();
let form = { socios: {}, socio: SOCIOS[0], metodo: 'efectivo' };

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plata = n => '$' + (n || 0).toLocaleString('es-AR');
const mostrar = el => { el.classList.remove('hidden'); el.classList.add('flex', 'flex-col'); };
const ocultar = el => { el.classList.add('hidden'); el.classList.remove('flex', 'flex-col'); };
function mesActual() { return new Date().toLocaleDateString('en-CA').slice(0, 7); }
const fechaCorta = r => r.creadoEn ? r.creadoEn.toDate().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : (r.fecha || '').split('-').reverse().slice(0, 2).join('/');

const INPUT = 'w-full p-4 bg-black/40 rounded-xl border border-gray-700 focus:border-white/60 outline-none transition text-white placeholder-gray-500 mt-1';
const BTN_ON = 'p-3 rounded-xl border font-bold text-sm transition bg-white/15 border-white/70 text-white';
const BTN_OFF = 'p-3 rounded-xl border font-bold text-sm transition bg-black/30 border-gray-700 text-gray-400';
const CHIP_SI = 'px-3 py-2 rounded-xl border text-xs font-bold transition active:scale-95 bg-emerald-500/15 border-emerald-500/50 text-emerald-300';
const CHIP_NO = 'px-3 py-2 rounded-xl border text-xs font-bold transition active:scale-95 bg-black/30 border-gray-600 border-dashed text-gray-400 hover:text-white hover:border-white/50';
const TAB_ON = 'flex-1 py-2.5 rounded-xl text-sm font-bold transition bg-white text-black';
const TAB_OFF = 'flex-1 py-2.5 rounded-xl text-sm font-bold transition text-gray-400 hover:text-white';
const TITULO = t => `<h3 class="text-xs md:text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">${t}</h3>`;
const VACIO = t => `<p class="text-sm text-gray-600 text-center py-4">${t}</p>`;

export function initRetirosSocios(opciones) {
    cfg = { confirmar: async msg => confirm(msg), fondo: '#0a0a0a', ...opciones };
    const html = `
    <div id="rs-clave-modal" class="absolute inset-0 bg-black/90 backdrop-blur-sm z-[60] hidden flex-col justify-end md:justify-center animate-enter">
        <div class="glass-modal md:rounded-3xl md:max-w-sm md:mx-auto w-full border-t md:border border-white/10 p-6 shadow-2xl rounded-t-3xl">
            <div class="flex justify-between items-center mb-5">
                <h2 class="text-xl font-bold text-white flex items-center gap-2"><i class="fas fa-lock text-base text-gray-400"></i> Retiros</h2>
                <button type="button" data-rs="cerrar-clave" class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-gray-400"><i class="fas fa-times"></i></button>
            </div>
            <form id="rs-clave-form" class="space-y-4" autocomplete="off">
                <div>
                    <label class="text-[10px] font-bold text-gray-500 uppercase ml-1">Contraseña</label>
                    <input type="password" id="rs-clave-input" data-scan="nativo" autocomplete="off" autocapitalize="none" spellcheck="false" class="${INPUT}">
                    <p id="rs-clave-error" class="hidden text-xs text-red-400 font-semibold ml-1 mt-2">Contraseña incorrecta</p>
                </div>
                <button type="submit" class="w-full bg-white text-black p-4 rounded-xl font-bold text-lg shadow-lg uppercase tracking-widest active:scale-[0.98] transition">Entrar</button>
            </form>
        </div>
    </div>

    <div id="rs-panel" class="absolute inset-0 z-40 flex-col hidden" style="background:${cfg.fondo};animation:slideIn 0.35s cubic-bezier(0.16,1,0.3,1)">
        <header class="px-5 md:px-8 py-4 md:py-5 glass flex items-center justify-between flex-shrink-0 border-b border-white/5">
            <div class="flex items-center gap-4">
                <button type="button" data-rs="cerrar-panel" class="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition">
                    <i class="fas fa-arrow-left text-sm"></i>
                </button>
                <div>
                    <h1 class="text-base md:text-xl font-bold text-white leading-none tracking-wide">Socios</h1>
                    <span class="text-[10px] md:text-xs text-gray-400 font-medium">Agus y Manu</span>
                </div>
            </div>
            <button type="button" data-rs="nuevo" class="flex items-center gap-2 bg-white text-black font-bold px-4 py-2 rounded-xl text-xs md:text-sm transition hover:bg-gray-200 active:scale-95">
                <i class="fas fa-plus text-[10px] md:text-xs"></i><span id="rs-nuevo-lbl">Retiro</span>
            </button>
        </header>
        <div class="flex-1 overflow-y-auto">
            <div class="p-4 md:p-8 pb-10 max-w-3xl md:mx-auto w-full space-y-5">
                <div class="flex gap-1 p-1 rounded-2xl bg-white/5 border border-white/10">
                    <button type="button" data-rs-tab="retiros" class="${TAB_ON}">Retiros</button>
                    <button type="button" data-rs-tab="deudas" class="${TAB_OFF}">Deudas</button>
                </div>
                <div id="rs-contenido"></div>
            </div>
        </div>
    </div>

    <div id="rs-retiro-modal" class="absolute inset-0 bg-black/90 backdrop-blur-sm z-[60] hidden flex-col justify-end md:justify-center animate-enter">
        <div class="glass-modal md:rounded-3xl md:max-w-sm md:mx-auto w-full border-t md:border border-white/10 p-6 shadow-2xl rounded-t-3xl">
            <div class="flex justify-between items-center mb-2">
                <h2 class="text-xl font-bold text-white">Nuevo retiro</h2>
                <button type="button" data-rs="cerrar-modales" class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-gray-400"><i class="fas fa-times"></i></button>
            </div>
            <p class="text-xs text-gray-500 mb-5">El monto es lo que saca cada uno (ej: $20.000 Agus y $20.000 Manu).</p>
            <form id="rs-retiro-form" class="space-y-4" autocomplete="off">
                <div>
                    <label class="text-[10px] font-bold text-gray-500 uppercase ml-1">Monto por socio</label>
                    <input type="number" id="rs-retiro-monto" data-scan="nativo" inputmode="numeric" placeholder="Ej: 20000" min="1" required class="${INPUT}">
                </div>
                <div>
                    <label class="text-[10px] font-bold text-gray-500 uppercase ml-1">¿Quién ya lo retiró?</label>
                    <div class="grid grid-cols-2 gap-2 mt-1">
                        ${SOCIOS.map(s => `<button type="button" data-rs-ya="${s}" class="${BTN_OFF}">${s}</button>`).join('')}
                    </div>
                    <p class="text-[10px] text-gray-600 ml-1 mt-1.5">Al que le falte, después se le marca con un toque.</p>
                </div>
                <div>
                    <label class="text-[10px] font-bold text-gray-500 uppercase ml-1">¿De dónde sale?</label>
                    <div class="grid grid-cols-2 gap-2 mt-1">
                        <button type="button" data-rs-metodo="efectivo" class="${BTN_OFF}">💵 Efectivo</button>
                        <button type="button" data-rs-metodo="transferencia" class="${BTN_OFF}">📲 Transferencia</button>
                    </div>
                </div>
                <div>
                    <label class="text-[10px] font-bold text-gray-500 uppercase ml-1">Nota (opcional)</label>
                    <input type="text" id="rs-retiro-nota" data-scan="nativo" placeholder="Ej: ganancia de la semana" maxlength="80" class="${INPUT}">
                </div>
                <button type="submit" id="rs-retiro-guardar" class="w-full bg-white text-black p-4 rounded-xl font-bold text-lg shadow-lg uppercase tracking-widest active:scale-[0.98] transition">Guardar</button>
            </form>
        </div>
    </div>

    <div id="rs-deuda-modal" class="absolute inset-0 bg-black/90 backdrop-blur-sm z-[60] hidden flex-col justify-end md:justify-center animate-enter">
        <div class="glass-modal md:rounded-3xl md:max-w-sm md:mx-auto w-full border-t md:border border-white/10 p-6 shadow-2xl rounded-t-3xl">
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-xl font-bold text-white">Nueva deuda</h2>
                <button type="button" data-rs="cerrar-modales" class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-gray-400"><i class="fas fa-times"></i></button>
            </div>
            <form id="rs-deuda-form" class="space-y-4" autocomplete="off">
                <div>
                    <label class="text-[10px] font-bold text-gray-500 uppercase ml-1">La barbería le debe a</label>
                    <div class="grid grid-cols-2 gap-2 mt-1">
                        ${SOCIOS.map(s => `<button type="button" data-rs-socio="${s}" class="${BTN_OFF}">${s}</button>`).join('')}
                    </div>
                </div>
                <div>
                    <label class="text-[10px] font-bold text-gray-500 uppercase ml-1">Monto</label>
                    <input type="number" id="rs-deuda-monto" data-scan="nativo" inputmode="numeric" placeholder="Ej: 35000" min="1" required class="${INPUT}">
                </div>
                <div>
                    <label class="text-[10px] font-bold text-gray-500 uppercase ml-1">Motivo (opcional)</label>
                    <input type="text" id="rs-deuda-nota" data-scan="nativo" placeholder="Ej: pagó la luz con su plata" maxlength="80" class="${INPUT}">
                </div>
                <button type="submit" id="rs-deuda-guardar" class="w-full bg-white text-black p-4 rounded-xl font-bold text-lg shadow-lg uppercase tracking-widest active:scale-[0.98] transition">Guardar</button>
            </form>
        </div>
    </div>`;
    cfg.contenedor.insertAdjacentHTML('beforeend', html);

    $('rs-clave-form').addEventListener('submit', e => {
        e.preventDefault();
        const input = $('rs-clave-input');
        const clave = input.value.trim();
        if (clave === CLAVE_RETIROS) { ocultar($('rs-clave-modal')); cfg.abrirRetiros(); }
        else if (clave === CLAVE_SOCIOS) { ocultar($('rs-clave-modal')); abrirPanel(); }
        else {
            input.value = '';
            $('rs-clave-error').classList.remove('hidden');
            try { navigator.vibrate?.([80, 60, 80]); } catch (err) {}
            input.focus();
        }
    });
    $('rs-retiro-form').addEventListener('submit', guardarRetiro);
    $('rs-deuda-form').addEventListener('submit', guardarDeuda);
    cfg.contenedor.addEventListener('click', e => {
        const b = e.target.closest('[data-rs],[data-rs-tab],[data-rs-ya],[data-rs-socio],[data-rs-metodo],[data-rs-marcar],[data-rs-pagar],[data-rs-borrar]');
        if (!b) return;
        const d = b.dataset;
        if (d.rsTab) { tab = d.rsTab; render(); }
        else if (d.rsYa) { form.socios[d.rsYa] = !form.socios[d.rsYa]; pintarForm(); }
        else if (d.rsSocio) { form.socio = d.rsSocio; pintarForm(); }
        else if (d.rsMetodo) { form.metodo = d.rsMetodo; pintarForm(); }
        else if (d.rsMarcar) marcarRetiro(d.rsMarcar, d.socio);
        else if (d.rsPagar) marcarPagada(d.rsPagar);
        else if (d.rsBorrar) borrar(d.rsBorrar);
        else if (d.rs === 'cerrar-clave') ocultar($('rs-clave-modal'));
        else if (d.rs === 'cerrar-panel') cerrarPanel();
        else if (d.rs === 'cerrar-modales') cerrarModales();
        else if (d.rs === 'nuevo') abrirNuevo();
        else if (d.rs === 'mes-ant') moverMes(-1);
        else if (d.rs === 'mes-sig') moverMes(1);
    });
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        ocultar($('rs-clave-modal'));
        cerrarModales();
    });
}

export function pedirClaveRetiros() {
    $('rs-clave-input').value = '';
    $('rs-clave-error').classList.add('hidden');
    mostrar($('rs-clave-modal'));
    setTimeout(() => $('rs-clave-input').focus(), 50);
}

// Se escucha solo con el panel abierto, para no sumar lecturas al resto del día.
function abrirPanel() {
    mesSel = mesActual();
    mostrar($('rs-panel'));
    render();
    if (unsub) return;
    unsub = onSnapshot(query(collection(cfg.getDb(), PATH), orderBy('creadoEn', 'desc'), limit(1000)), snap => {
        items = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        render();
    }, () => { $('rs-contenido').innerHTML = '<p class="text-sm text-red-400 text-center py-4">No se pudo cargar</p>'; });
}
function cerrarPanel() {
    ocultar($('rs-panel'));
    if (unsub) { unsub(); unsub = null; }
}
function cerrarModales() { ocultar($('rs-retiro-modal')); ocultar($('rs-deuda-modal')); }

function moverMes(delta) {
    const [a, m] = mesSel.split('-').map(Number);
    const d = new Date(a, m - 1 + delta, 1);
    mesSel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    render();
}

function render() {
    document.querySelectorAll('[data-rs-tab]').forEach(b => { b.className = b.dataset.rsTab === tab ? TAB_ON : TAB_OFF; });
    $('rs-nuevo-lbl').textContent = tab === 'retiros' ? 'Retiro' : 'Deuda';
    $('rs-contenido').innerHTML = tab === 'retiros' ? htmlRetiros() : htmlDeudas();
}

// Un toque en el nombre marca (o desmarca) que ese socio ya sacó su parte
const chipSocio = (r, s) => {
    const si = !!r.retiros?.[s];
    return `<button type="button" data-rs-marcar="${esc(r.id)}" data-socio="${s}" class="${si ? CHIP_SI : CHIP_NO}">${si ? '✓' : '⏳'} ${s}</button>`;
};
const filaRetiro = r => `<div class="bg-black/30 p-3 md:p-4 rounded-xl border border-white/5">
    <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
            <div class="text-base md:text-lg font-extrabold text-white">${plata(r.monto)} <span class="text-xs font-semibold text-gray-500">c/u ${r.metodoPago === 'transferencia' ? '📲' : '💵'}</span></div>
            <div class="text-xs text-gray-500 mt-0.5 truncate">${esc(fechaCorta(r))}${r.nota ? ' · ' + esc(r.nota) : ''}</div>
        </div>
        <button type="button" data-rs-borrar="${esc(r.id)}" class="text-gray-700 hover:text-red-400 transition p-1" title="Eliminar"><i class="fas fa-trash text-xs"></i></button>
    </div>
    <div class="flex gap-2 mt-3">${SOCIOS.map(s => chipSocio(r, s)).join('')}</div>
</div>`;

function htmlRetiros() {
    const retiros = items.filter(r => r.tipo === 'retiro' && !r.eliminado);
    const pendientes = retiros.filter(r => SOCIOS.some(s => !r.retiros?.[s]));
    const delMes = retiros.filter(r => (r.fecha || '').startsWith(mesSel));
    const [a, m] = mesSel.split('-').map(Number);

    const tot = {};
    SOCIOS.forEach(s => { tot[s] = delMes.filter(r => r.retiros?.[s]).reduce((t, r) => t + (r.monto || 0), 0); });
    const falta = {};
    SOCIOS.forEach(s => { falta[s] = pendientes.filter(r => !r.retiros?.[s]).reduce((t, r) => t + (r.monto || 0), 0); });

    return `
    ${pendientes.length ? `<div class="glass-card rounded-2xl p-5 md:p-7 mb-5">
        ${TITULO('<i class="fas fa-clock"></i> Falta que retire')}
        <div class="flex flex-wrap gap-2 mb-4">${SOCIOS.filter(s => falta[s] > 0).map(s => `<span class="text-xs font-bold text-gray-300 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1">${s}: ${plata(falta[s])}</span>`).join('')}</div>
        <div class="space-y-2 md:space-y-3">${pendientes.map(filaRetiro).join('')}</div>
    </div>` : ''}
    <div class="flex items-center justify-between mb-3">
        <button type="button" data-rs="mes-ant" class="w-10 h-10 rounded-full bg-white/5 text-gray-300 hover:bg-white/10 transition"><i class="fas fa-chevron-left text-xs"></i></button>
        <span class="text-sm md:text-base font-bold text-white uppercase tracking-widest">${MESES[m - 1]} ${a}</span>
        <button type="button" data-rs="mes-sig" class="w-10 h-10 rounded-full bg-white/5 text-gray-300 hover:bg-white/10 transition"><i class="fas fa-chevron-right text-xs"></i></button>
    </div>
    <div class="grid grid-cols-2 gap-3 md:gap-4 mb-5">
        ${SOCIOS.map(s => `<div class="glass-card rounded-2xl p-4 md:p-5">
            <div class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">${s} retiró</div>
            <div class="text-xl md:text-3xl font-extrabold text-white">${plata(tot[s])}</div>
        </div>`).join('')}
    </div>
    <div class="glass-card rounded-2xl p-5 md:p-7">
        ${TITULO('<i class="fas fa-history"></i> Retiros del mes')}
        <div class="space-y-2 md:space-y-3">${delMes.length ? delMes.map(filaRetiro).join('') : VACIO('Sin retiros este mes')}</div>
    </div>`;
}

function htmlDeudas() {
    const deudas = items.filter(r => r.tipo === 'deuda' && !r.eliminado);
    const abiertas = deudas.filter(r => !r.pagada);
    const pagadas = deudas.filter(r => r.pagada).slice(0, 20);
    const debe = {};
    SOCIOS.forEach(s => { debe[s] = abiertas.filter(r => r.socio === s).reduce((t, r) => t + (r.monto || 0), 0); });

    const fila = r => `<div class="flex items-center justify-between gap-3 bg-black/30 p-3 md:p-4 rounded-xl border border-white/5 ${r.pagada ? 'opacity-50' : ''}">
        <div class="min-w-0">
            <div class="text-sm md:text-base font-bold text-gray-100 ${r.pagada ? 'line-through' : ''}">${esc(r.socio)} · ${plata(r.monto)}</div>
            <div class="text-xs text-gray-500 mt-0.5 truncate">${esc(fechaCorta(r))}${r.nota ? ' · ' + esc(r.nota) : ''}</div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
            <button type="button" data-rs-pagar="${esc(r.id)}" class="${r.pagada ? CHIP_SI : CHIP_NO}">${r.pagada ? '✓ Pagada' : 'Marcar pagada'}</button>
            <button type="button" data-rs-borrar="${esc(r.id)}" class="text-gray-700 hover:text-red-400 transition p-1" title="Eliminar"><i class="fas fa-trash text-xs"></i></button>
        </div>
    </div>`;

    return `
    <div class="grid grid-cols-2 gap-3 md:gap-4 mb-5">
        ${SOCIOS.map(s => `<div class="glass-card rounded-2xl p-4 md:p-5">
            <div class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Se le debe a ${s}</div>
            <div class="text-xl md:text-3xl font-extrabold ${debe[s] > 0 ? 'text-white' : 'text-gray-600'}">${plata(debe[s])}</div>
        </div>`).join('')}
    </div>
    <div class="glass-card rounded-2xl p-5 md:p-7 mb-5">
        ${TITULO('<i class="fas fa-file-invoice-dollar"></i> Deudas sin pagar')}
        <div class="space-y-2 md:space-y-3">${abiertas.length ? abiertas.map(fila).join('') : VACIO('La barbería no le debe nada a nadie')}</div>
    </div>
    ${pagadas.length ? `<div class="glass-card rounded-2xl p-5 md:p-7">
        ${TITULO('<i class="fas fa-check"></i> Pagadas')}
        <div class="space-y-2 md:space-y-3">${pagadas.map(fila).join('')}</div>
    </div>` : ''}`;
}

function pintarForm() {
    document.querySelectorAll('[data-rs-ya]').forEach(b => { b.className = form.socios[b.dataset.rsYa] ? BTN_ON : BTN_OFF; b.textContent = (form.socios[b.dataset.rsYa] ? '✓ ' : '') + b.dataset.rsYa; });
    document.querySelectorAll('[data-rs-socio]').forEach(b => { b.className = b.dataset.rsSocio === form.socio ? BTN_ON : BTN_OFF; });
    document.querySelectorAll('[data-rs-metodo]').forEach(b => { b.className = b.dataset.rsMetodo === form.metodo ? BTN_ON : BTN_OFF; });
}

function abrirNuevo() {
    form = { socios: {}, socio: SOCIOS[0], metodo: 'efectivo' };
    pintarForm();
    const id = tab === 'retiros' ? 'retiro' : 'deuda';
    $(`rs-${id}-monto`).value = '';
    $(`rs-${id}-nota`).value = '';
    mostrar($(`rs-${id}-modal`));
    setTimeout(() => $(`rs-${id}-monto`).focus(), 50);
}

async function guardarDoc(tipo, campos) {
    const monto = parseInt($(`rs-${tipo}-monto`).value);
    const nota = $(`rs-${tipo}-nota`).value.trim();
    if (!monto || monto <= 0) return;
    const btn = $(`rs-${tipo}-guardar`);
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    try {
        await addDoc(collection(cfg.getDb(), PATH), {
            tipo, monto, ...campos,
            fecha: new Date().toLocaleDateString('en-CA'),
            ...(nota ? { nota } : {}),
            userEmail: cfg.getEmail() || '', creadoEn: serverTimestamp()
        });
        cerrarModales();
    } catch (err) { alert('Error al guardar'); }
    btn.disabled = false; btn.textContent = 'Guardar';
}
function guardarRetiro(e) {
    e.preventDefault();
    const retiros = {};
    SOCIOS.forEach(s => { retiros[s] = !!form.socios[s]; });
    guardarDoc('retiro', { retiros, metodoPago: form.metodo });
}
function guardarDeuda(e) {
    e.preventDefault();
    guardarDoc('deuda', { socio: form.socio, pagada: false });
}

async function marcarRetiro(id, socio) {
    const r = items.find(x => x.id === id);
    if (!r) return;
    const ya = !!r.retiros?.[socio];
    // Marcar es un toque; desmarcar pide confirmación para que un toque sin querer no lo borre
    if (ya && !await cfg.confirmar(`¿${socio} todavía no retiró los ${plata(r.monto)}?`, 'Sí, desmarcar')) return;
    try { await updateDoc(doc(cfg.getDb(), PATH, id), { [`retiros.${socio}`]: !ya }); } catch (err) { alert('Error al guardar'); }
}
async function marcarPagada(id) {
    const r = items.find(x => x.id === id);
    if (!r) return;
    if (r.pagada && !await cfg.confirmar('¿Volver a marcarla como sin pagar?', 'Sí, desmarcar')) return;
    try { await updateDoc(doc(cfg.getDb(), PATH, id), { pagada: !r.pagada }); } catch (err) { alert('Error al guardar'); }
}

// Borrado lógico (eliminado: true): borrar docs de verdad es solo para los dueños en las reglas.
async function borrar(id) {
    const r = items.find(x => x.id === id);
    if (!r) return;
    const que = r.tipo === 'deuda' ? `la deuda con ${r.socio} por ${plata(r.monto)}` : `el retiro de ${plata(r.monto)}`;
    if (!await cfg.confirmar(`¿Eliminar ${que}?`)) return;
    try { await updateDoc(doc(cfg.getDb(), PATH, id), { eliminado: true }); } catch (err) { alert('Error al eliminar'); }
}
