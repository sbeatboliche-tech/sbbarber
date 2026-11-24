// Impresión de fotos que llegan por WhatsApp.
//
// Queda conectado al WhatsApp del celu como un WhatsApp Web más (whatsapp-web.js, con el Chrome de la compu).
// Cuando alguien escribe "imprimir" (o "imprimí", "quiero imprimir esto"...), las fotos/PDF que mandó en los
// 30 minutos de antes y los que mande en los 30 de después entran a la cola. La cola se ve en el panel
// http://localhost:3939, donde se confirma cada impresión; con "Imprimir automático" prendido salen solas.
// Las fotos de chats que no pidieron imprimir quedan solo en memoria 30 minutos y se descartan: no se guardan.
// Los grupos y los estados se ignoran.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const PUERTO = 3939;
const PANEL = `http://localhost:${PUERTO}`;
const VENTANA_MS = 30 * 60 * 1000;
const PALABRA = /imprim/i;
const COLA_DIR = path.join(__dirname, 'cola');
const ESTADO = path.join(__dirname, 'estado.json');
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/webp': 'webp', 'application/pdf': 'pdf' };
fs.mkdirSync(COLA_DIR, { recursive: true });

// ---- Estado guardado en disco: trabajos de la cola y la impresora elegida ----
let estado = (() => {
    try { return JSON.parse(fs.readFileSync(ESTADO, 'utf8')); }
    catch { return { trabajos: [], impresora: '' }; }
})();
const guardar = () => fs.writeFileSync(ESTADO, JSON.stringify(estado, null, 1));

// ---- WhatsApp ----
let wa = { estado: 'iniciando', qr: null, cuenta: null };
const activos = new Map();  // chat → hasta cuándo entra a la cola lo que mande
const enEspera = new Map(); // chat → fotos de los últimos 30 min, por si después escribe "imprimir"

function rutaChrome() {
    const e = process.env;
    return [
        e.PROGRAMFILES && path.join(e.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
        e['PROGRAMFILES(X86)'] && path.join(e['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
        e.LOCALAPPDATA && path.join(e.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    ].find(p => p && fs.existsSync(p));
}

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
    puppeteer: { headless: true, executablePath: rutaChrome(), args: ['--no-sandbox'] },
    // El user agent que trae la librería (Chrome 101) WhatsApp ya no lo acepta y la página no termina de cargar
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    authTimeoutMs: 120000,
    // Versión de WhatsApp Web fija, compatible con whatsapp-web.js 1.34.8 (con la última de WhatsApp no termina
    // de conectar). WhatsApp acepta cada versión ~2 meses (esta vence el 12/01/2027): antes de esa fecha,
    // `npm update whatsapp-web.js` y elegir una versión más nueva de https://github.com/wppconnect-team/wa-version
    webVersion: process.env.WA_VERSION || '2.3000.1054241206-alpha',
    webVersionCache: { type: 'remote', remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html' },
});

client.on('qr', async qr => {
    wa = { estado: 'qr', qr: await QRCode.toDataURL(qr, { margin: 1, width: 300 }), cuenta: null };
    console.log('Escaneá el código QR desde el panel:', PANEL);
});
client.on('authenticated', () => { wa.estado = 'conectando'; wa.qr = null; });
client.on('auth_failure', m => { wa = { estado: 'error', qr: null, cuenta: null, error: String(m) }; console.error('Falló el inicio de sesión:', m); });
client.on('ready', () => {
    wa = { estado: 'listo', qr: null, cuenta: client.info?.pushname || client.info?.wid?.user || null };
    console.log('WhatsApp conectado:', wa.cuenta);
});
client.on('disconnected', motivo => {
    wa = { estado: 'desconectado', qr: null, cuenta: null, error: String(motivo) };
    console.warn('WhatsApp desconectado:', motivo, '— reintentando en 10 s');
    setTimeout(() => client.initialize().catch(e => console.error(e)), 10000);
});

client.on('message', async msg => {
    try {
        const chat = msg.from || '';
        // Solo chats individuales (los ids nuevos de WhatsApp pueden ser @lid); nada de grupos ni estados
        if (msg.fromMe || msg.isStatus || !/@(c\.us|lid)$/.test(chat)) return;
        const ahora = Date.now();

        if (PALABRA.test(msg.body || '')) { // en una foto, msg.body es el texto que la acompaña
            activos.set(chat, ahora + VENTANA_MS);
            for (const f of enEspera.get(chat) || []) if (ahora - f.t < VENTANA_MS) encolar(f);
            enEspera.delete(chat);
        }
        if (!msg.hasMedia || !['image', 'document'].includes(msg.type)) return;

        const media = await msg.downloadMedia();
        if (!media || !EXT[media.mimetype]) return;
        const contacto = await msg.getContact().catch(() => null);
        const f = {
            media, t: ahora, chat,
            nombre: contacto?.pushname || contacto?.name || '',
            numero: contacto?.number || chat.split('@')[0],
        };
        if ((activos.get(chat) || 0) > ahora) encolar(f);
        else enEspera.set(chat, [...(enEspera.get(chat) || []).filter(x => ahora - x.t < VENTANA_MS), f].slice(-30));
    } catch (e) {
        console.error('Mensaje:', e);
    }
});

// Lo que no pidió imprimir se olvida a los 30 minutos
setInterval(() => {
    const ahora = Date.now();
    for (const [chat, l] of enEspera) {
        const vigentes = l.filter(x => ahora - x.t < VENTANA_MS);
        if (vigentes.length) enEspera.set(chat, vigentes); else enEspera.delete(chat);
    }
    for (const [chat, hasta] of activos) if (hasta < ahora) activos.delete(chat);
}, 60000);

function encolar(f) {
    const id = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    const archivo = `${id}.${EXT[f.media.mimetype]}`;
    fs.writeFileSync(path.join(COLA_DIR, archivo), Buffer.from(f.media.data, 'base64'));
    estado.trabajos.push({
        id, archivo, mimetype: f.media.mimetype, nombreArchivo: f.media.filename || null,
        nombre: f.nombre, numero: f.numero, recibido: new Date(f.t).toISOString(), estado: 'pendiente',
    });
    guardar();
    console.log(`Nueva foto para imprimir de ${f.nombre || f.numero}`);
    // Con "Imprimir automático" prendido en el panel sale sola (1 copia); si no, espera que la confirmen
    if (estado.automatico) colaImpresion = colaImpresion.then(() => imprimirTrabajo(id, 1)).catch(() => {});
}
let colaImpresion = Promise.resolve(); // de a una, en el orden en que llegaron

async function imprimirTrabajo(id, copias) {
    const t = estado.trabajos.find(x => x.id === id);
    if (!t || t.estado === 'descartado') return null;
    t.estado = 'imprimiendo'; guardar();
    try {
        await imprimir(t, copias);
        Object.assign(t, { estado: 'impreso', copias, impresoEn: new Date().toISOString(), error: null });
    } catch (e) {
        Object.assign(t, { estado: 'error', error: e.message });
    }
    guardar();
    return t;
}

// ---- Impresión ----
let impresorasCache = { t: 0, lista: [] };
function impresoras() {
    if (Date.now() - impresorasCache.t < 60000) return Promise.resolve(impresorasCache.lista);
    return new Promise(resolve => {
        execFile('powershell.exe', ['-NoProfile', '-Command',
            'Get-CimInstance Win32_Printer | Select-Object Name, Default | ConvertTo-Json -Compress'],
            { windowsHide: true }, (err, out) => {
                let lista = [];
                try { lista = [].concat(JSON.parse(out || '[]')).map(p => ({ nombre: p.Name, predeterminada: !!p.Default })); } catch {}
                impresorasCache = { t: Date.now(), lista };
                resolve(lista);
            });
    });
}

function imprimir(t, copias) {
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'imprimir.ps1'),
        '-Archivo', path.join(COLA_DIR, t.archivo), '-Copias', String(copias)];
    if (estado.impresora) args.push('-Impresora', estado.impresora);
    return new Promise((resolve, reject) => execFile('powershell.exe', args, { windowsHide: true, timeout: 120000 },
        (err, _out, errOut) => err ? reject(new Error((errOut || err.message).trim().split('\n')[0])) : resolve()));
}

// ---- Panel (solo desde esta compu) ----
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const leerBody = req => new Promise(resolve => {
    let b = ''; req.on('data', c => { b += c; if (b.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
});

http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, PANEL);
        if (req.method === 'POST') {
            // Que ninguna página de internet pueda mandar a imprimir: solo el propio panel
            const origen = req.headers.origin;
            if (origen && origen !== PANEL && origen !== `http://127.0.0.1:${PUERTO}`) return json(res, 403, { error: 'Origen no permitido' });
            if (!String(req.headers['content-type']).startsWith('application/json')) return json(res, 415, { error: 'JSON' });
        }

        if (req.method === 'GET' && url.pathname === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(fs.readFileSync(path.join(__dirname, 'panel.html')));
        }
        if (req.method === 'GET' && url.pathname === '/api/estado') {
            const desde = Date.now() - 3 * 864e5; // lo impreso/descartado se muestra 3 días
            return json(res, 200, {
                wa, impresora: estado.impresora, impresoras: await impresoras(), automatico: !!estado.automatico,
                trabajos: estado.trabajos.filter(t => t.estado === 'pendiente' || t.estado === 'error' || t.estado === 'imprimiendo' || Date.parse(t.recibido) > desde),
            });
        }
        if (req.method === 'GET' && url.pathname.startsWith('/archivo/')) {
            const t = estado.trabajos.find(x => x.id === url.pathname.slice(9));
            const ruta = t && path.join(COLA_DIR, t.archivo);
            if (!ruta || !fs.existsSync(ruta)) { res.writeHead(404); return res.end(); }
            res.writeHead(200, { 'Content-Type': t.mimetype });
            return fs.createReadStream(ruta).pipe(res);
        }
        if (req.method === 'POST' && url.pathname === '/api/imprimir') {
            const { id, copias } = await leerBody(req);
            const t = await imprimirTrabajo(id, Math.min(50, Math.max(1, parseInt(copias) || 1)));
            return t ? json(res, 200, t) : json(res, 404, { error: 'No está' });
        }
        if (req.method === 'POST' && url.pathname === '/api/automatico') {
            const { activo } = await leerBody(req);
            estado.automatico = !!activo; guardar();
            return json(res, 200, { automatico: estado.automatico });
        }
        if (req.method === 'POST' && url.pathname === '/api/descartar') {
            const { id } = await leerBody(req);
            const t = estado.trabajos.find(x => x.id === id);
            if (!t) return json(res, 404, { error: 'No está' });
            t.estado = 'descartado';
            fs.rmSync(path.join(COLA_DIR, t.archivo), { force: true });
            guardar();
            return json(res, 200, t);
        }
        if (req.method === 'POST' && url.pathname === '/api/impresora') {
            const { nombre } = await leerBody(req);
            const lista = await impresoras();
            if (nombre && !lista.some(p => p.nombre === nombre)) return json(res, 400, { error: 'Impresora desconocida' });
            estado.impresora = nombre || ''; guardar();
            return json(res, 200, { impresora: estado.impresora });
        }
        res.writeHead(404); res.end();
    } catch (e) {
        console.error('Panel:', e);
        json(res, 500, { error: e.message });
    }
}).on('error', e => {
    // Ya hay otro abierto (por ejemplo, arrancó solo con Windows y lo abrieron de nuevo): no se duplica
    if (e.code === 'EADDRINUSE') { console.log('El programa ya está abierto:', PANEL); process.exit(0); }
    throw e;
}).listen(PUERTO, '127.0.0.1', () => {
    console.log('Panel de impresión:', PANEL);
    // Abre el panel en Chrome (si no está, en el navegador predeterminado)
    const chrome = rutaChrome();
    if (chrome) execFile(chrome, [PANEL], () => {});
    else execFile('cmd', ['/c', 'start', '', PANEL], { windowsHide: true }, () => {});
});

// Limpieza: las fotos impresas se borran del disco a los 7 días
setInterval(() => {
    const limite = Date.now() - 7 * 864e5;
    let cambio = false;
    estado.trabajos = estado.trabajos.filter(t => {
        if (t.estado === 'pendiente' || Date.parse(t.recibido) > limite) return true;
        fs.rmSync(path.join(COLA_DIR, t.archivo), { force: true });
        cambio = true;
        return false;
    });
    if (cambio) guardar();
}, 3600e3);

client.initialize().catch(e => {
    wa = { estado: 'error', qr: null, cuenta: null, error: e.message };
    console.error('No se pudo iniciar WhatsApp:', e);
});
