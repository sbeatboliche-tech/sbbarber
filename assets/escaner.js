/* =========================================================
   Escáner de códigos de barras con la cámara (celu)
   Lo usan recepcionista y anotar. La librería (html5-qrcode) se
   carga recién la primera vez que se abre la cámara.

   abrirCamara(onCodigo)                 → lee seguido; cada código nuevo llama a onCodigo
   abrirCamara(onCodigo, { unaVez })     → lee uno, cierra y llama a onCodigo
   El mismo código no se vuelve a contar mientras siga en cuadro:
   para sumar otra unidad igual hay que sacarlo y volver a apuntar.
   ========================================================= */
const LIB_URL = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';

let overlay = null, scanner = null, onCodigoActual = null, unaVezActual = false;
let ultimo = { codigo: '', t: 0 };

export const normCodigo = v => String(v ?? '').replace(/\s+/g, '');

// Pitido corto (entró) o grave (no entró), para saber sin mirar la pantalla.
let beepCtx = null;
export function scanBeep(ok = true) {
    try {
        beepCtx = beepCtx || new (window.AudioContext || window.webkitAudioContext)();
        const o = beepCtx.createOscillator(), g = beepCtx.createGain();
        o.frequency.value = ok ? 1800 : 320;
        g.gain.value = 0.08;
        o.connect(g); g.connect(beepCtx.destination);
        o.start(); o.stop(beepCtx.currentTime + (ok ? 0.08 : 0.25));
    } catch (e) {}
    try { navigator.vibrate?.(ok ? 40 : [80, 60, 80]); } catch (e) {}
}

export function scanToast(msg, ok = true) {
    let el = document.getElementById('scan-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'scan-toast';
        el.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:10000;max-width:calc(100% - 32px);padding:10px 16px;border-radius:12px;font-size:13px;font-weight:700;pointer-events:none;transition:opacity .2s;box-shadow:0 8px 30px rgba(0,0,0,.5)';
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = ok ? '#fafafa' : '#dc2626';
    el.style.color = ok ? '#000' : '#fff';
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 1800);
    if (camaraAbierta()) overlay.querySelector('[data-ultimo]').textContent = msg;
}

function cargarLib() {
    if (window.Html5Qrcode) return Promise.resolve();
    return new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = LIB_URL;
        s.onload = res;
        s.onerror = () => rej(new Error('No se pudo cargar el lector de la cámara'));
        document.head.appendChild(s);
    });
}

function crearOverlay() {
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;background:#000;display:none;flex-direction:column';
    overlay.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:16px;padding-top:max(16px,env(safe-area-inset-top));flex-shrink:0">
            <p style="color:#fff;font-size:14px;font-weight:700;margin:0"><i class="fas fa-barcode" style="margin-right:6px"></i>Apuntá al código de barras</p>
            <button data-cerrar style="width:36px;height:36px;border-radius:999px;background:rgba(255,255,255,.1);color:#fff;border:none;cursor:pointer"><i class="fas fa-times"></i></button>
        </div>
        <div style="flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden"><div id="scan-camara-view" style="width:100%;max-width:28rem"></div></div>
        <p data-ultimo style="text-align:center;color:#d4d4d4;font-size:14px;font-weight:600;padding:16px;margin:0;min-height:3.5rem;flex-shrink:0"></p>
        <button data-cerrar style="margin:0 16px 16px;margin-bottom:max(16px,env(safe-area-inset-bottom));padding:14px;border-radius:12px;background:#fafafa;color:#000;font-size:14px;font-weight:700;border:none;cursor:pointer;flex-shrink:0">Listo</button>`;
    overlay.querySelectorAll('[data-cerrar]').forEach(b => b.onclick = () => cerrarCamara());
    document.body.appendChild(overlay);
}

export function camaraAbierta() {
    return !!overlay && overlay.style.display !== 'none';
}

export async function abrirCamara(onCodigo, { unaVez = false } = {}) {
    if (!overlay) crearOverlay();
    onCodigoActual = onCodigo;
    unaVezActual = unaVez;
    ultimo = { codigo: '', t: 0 };
    overlay.querySelector('[data-ultimo]').textContent = '';
    overlay.style.display = 'flex';
    if (scanner) return; // ya estaba leyendo: solo cambia qué se hace con el código
    try {
        await cargarLib();
        if (!camaraAbierta() || scanner) return; // se cerró mientras cargaba
        const F = window.Html5QrcodeSupportedFormats;
        scanner = new window.Html5Qrcode('scan-camara-view', {
            formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF, F.QR_CODE],
            experimentalFeatures: { useBarCodeDetectorIfSupported: true },
            verbose: false
        });
        await scanner.start({ facingMode: 'environment' }, {
            fps: 10,
            qrbox: (w, h) => ({ width: Math.floor(Math.min(300, w * 0.85)), height: Math.floor(Math.min(160, h * 0.5)) })
        }, leido, () => {});
    } catch (e) {
        console.warn('cámara:', e);
        overlay.querySelector('[data-ultimo]').textContent = 'No se pudo abrir la cámara. Revisá que el navegador tenga permiso.';
    }
}

function leido(texto) {
    const codigo = normCodigo(texto);
    const ahora = Date.now();
    const repetido = codigo === ultimo.codigo && ahora - ultimo.t < 1200;
    ultimo = { codigo, t: ahora };
    if (repetido || !onCodigoActual) return;
    const cb = onCodigoActual;
    if (unaVezActual) { cerrarCamara(); scanBeep(true); }
    cb(codigo);
}

export async function cerrarCamara() {
    if (overlay) overlay.style.display = 'none';
    onCodigoActual = null;
    const s = scanner;
    scanner = null;
    if (s) { try { if (s.isScanning) await s.stop(); s.clear(); } catch (e) {} }
}
