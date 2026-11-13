// Notificaciones push de la app (Capacitor, app-movil/). Lo comparten recepcionista y anotar.
// En el navegador (PC, Electron, celu sin la app) no hace nada: solo la app nativa tiene el plugin.
// Los avisos los manda el servidor (tienda/api/push.js y ml-webhook.js) a los tokens de push_tokens.

const API_PUSH = 'https://tienda.sbbarber.com.ar/api/push';
let _registrado = false;

function pluginPush() {
    const cap = window.Capacitor;
    if (!cap?.isNativePlatform?.()) return null;
    return cap.Plugins?.PushNotifications || null;
}

// Pide permiso (la primera vez) y guarda el token del celu. guardar(token, plataforma) lo escribe
// en Firestore con los datos del usuario logueado; se llama de nuevo si el token cambia.
export async function registrarPush(guardar) {
    const PN = pluginPush();
    if (!PN || _registrado) return;
    _registrado = true;
    try {
        let perm = await PN.checkPermissions();
        if (perm.receive !== 'granted' && perm.receive !== 'denied') perm = await PN.requestPermissions();
        if (perm.receive !== 'granted') return;
        await PN.addListener('registration', t => guardar(t.value, window.Capacitor.getPlatform()).catch(e => console.warn('push token:', e)));
        await PN.addListener('registrationError', e => console.warn('push registro:', e));
        // Con la app abierta Android no muestra la notificación del sistema: se avisa adentro.
        await PN.addListener('pushNotificationReceived', n => toastPush(n.title, n.body));
        await PN.register();
    } catch (e) {
        _registrado = false;
        console.warn('push:', e);
    }
}

// Pide al servidor que avise al barbero del turno recién creado. No bloquea ni muestra errores:
// el turno ya está guardado, el aviso es un extra.
export async function avisarTurnoNuevo(user, turnoId) {
    try {
        const token = await user.getIdToken();
        await fetch(`${API_PUSH}?action=turno`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ turnoId })
        });
    } catch (e) { console.warn('aviso turno:', e); }
}

function toastPush(titulo, cuerpo) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 12px);z-index:99999;'
        + 'background:#111;color:#fff;border:1px solid #333;border-radius:14px;padding:12px 14px;'
        + 'box-shadow:0 10px 30px rgba(0,0,0,.6);font-family:inherit;transition:opacity .3s,transform .3s;'
        + 'opacity:0;transform:translateY(-10px);max-width:480px;margin:0 auto';
    const t = document.createElement('div'); t.style.cssText = 'font-weight:700;font-size:14px'; t.textContent = titulo || '';
    const b = document.createElement('div'); b.style.cssText = 'font-size:13px;color:#bbb;margin-top:2px'; b.textContent = cuerpo || '';
    el.append(t, b);
    el.onclick = () => el.remove();
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'none'; });
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 6000);
}
