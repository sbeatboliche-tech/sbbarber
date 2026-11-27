// Pantalla "Equipo" de recepcionista (multi-barbería etapa 4).
//   - Admin de otra barbería: ve y maneja SU equipo (agregar barbero/admin, nueva contraseña, dar de baja).
//   - Dueños de SB (nosotros): además crean barberías y entran al equipo de cualquiera (menos SB, que se maneja como siempre).
// Todo lo que cambia pasa por el servidor (POST /api/uso?action=usuario|usuario-baja|barberia, tienda/lib/usuarios.js),
// que vuelve a chequear quién puede qué con el custom claim del token. Esta pantalla solo lee la config de Firestore.
// Las contraseñas generadas se muestran una sola vez y no se guardan en ningún lado.

const API = 'https://tienda.sbbarber.com.ar/api/uso';
const SB_ID = 'sb-barber';
let ctx = null;            // { auth, db, fs: { doc, getDoc, collection, getDocs }, esDueno, barberiaId }
let viendo = null;         // id de la barbería cuyo equipo se muestra

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => document.getElementById(id);

export function initEquipo(c) {
    ctx = c;
    if ($('equipo-modal')) return;
    const m = document.createElement('div');
    m.id = 'equipo-modal';
    m.className = 'fixed inset-0 bg-black/75 backdrop-blur-md z-[80] hidden flex-col justify-end md:justify-center';
    m.innerHTML = `
      <div class="glass-modal md:rounded-3xl md:max-w-lg md:mx-auto w-full border-t md:border border-white/10 pt-3 pb-8 px-5 shadow-2xl rounded-t-3xl max-h-[90vh] flex flex-col">
        <div class="w-10 h-1 bg-white/20 rounded-full mx-auto mb-5 md:hidden flex-shrink-0"></div>
        <div class="flex justify-between items-center mb-4 flex-shrink-0">
          <div class="min-w-0">
            <h2 id="eq-titulo" class="text-xl font-extrabold text-white tracking-tight">Equipo</h2>
            <p id="eq-sub" class="text-[11px] text-gray-500 mt-0.5 truncate"></p>
          </div>
          <button type="button" data-eq="cerrar" class="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-gray-400 hover:bg-white/15 transition active:scale-90 flex-shrink-0" aria-label="Cerrar">
            <i class="fas fa-times text-sm"></i>
          </button>
        </div>
        <div id="eq-cuerpo" class="overflow-y-auto flex-1 space-y-4 -mx-1 px-1"></div>
      </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => {
        if (e.target === m) return cerrar();
        const b = e.target.closest('[data-eq]');
        if (!b) return;
        const { eq, email, rol, nombre, id } = b.dataset;
        if (eq === 'cerrar') cerrar();
        else if (eq === 'ver') verEquipo(id);
        else if (eq === 'volver') verBarberias();
        else if (eq === 'clave') nuevaClave(email, rol, nombre);
        else if (eq === 'baja') darDeBaja(email);
        else if (eq === 'copiar') copiar(b);
        // Compartir del celu (WhatsApp, etc.): la contraseña no viaja en un link
        else if (eq === 'compartir') navigator.share({ text: b.dataset.msj }).catch(() => {});
    });
    m.addEventListener('submit', e => {
        e.preventDefault();
        if (e.target.id === 'eq-form-usuario') agregarUsuario(e.target);
        if (e.target.id === 'eq-form-barberia') crearBarberia(e.target);
    });
    m.addEventListener('input', e => {
        // id de la barbería sugerido a partir del nombre
        if (e.target.name === 'nombre' && e.target.form?.id === 'eq-form-barberia') {
            const idEl = e.target.form.elements.id;
            if (!idEl.dataset.tocado) idEl.value = slug(e.target.value);
        }
        if (e.target.name === 'id') e.target.dataset.tocado = '1';
        if (e.target.name === 'rol') e.target.form.querySelector('[data-solo-barbero]')?.classList.toggle('hidden', e.target.value !== 'barbero');
    });
}

const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);

export function abrirEquipo() {
    const m = $('equipo-modal');
    m.classList.remove('hidden'); m.classList.add('flex');
    if (!ctx.esDueno) return verEquipo(ctx.barberiaId);
    // Nosotros: si estamos dentro de otra barbería (soporte) va directo a esa; en SB, a la lista de barberías
    if (ctx.barberiaId !== SB_ID) return verEquipo(ctx.barberiaId);
    verBarberias();
}
function cerrar() { const m = $('equipo-modal'); m.classList.add('hidden'); m.classList.remove('flex'); }

async function api(action, body) {
    const token = await ctx.auth.currentUser.getIdToken();
    const r = await fetch(`${API}?action=${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
}

const cargando = txt => `<p class="text-sm text-gray-500 text-center py-6"><i class="fas fa-spinner fa-spin mr-2"></i>${esc(txt)}</p>`;
const input = 'w-full p-3 bg-black/30 border border-gray-700 rounded-xl text-white text-sm outline-none focus:border-white/60';
const boton = 'w-full bg-white text-black p-3 rounded-xl font-bold text-sm uppercase tracking-widest disabled:opacity-50';
const chico = 'text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 transition';

// ---- Barberías (solo dueños) ----
async function verBarberias() {
    viendo = null;
    $('eq-titulo').textContent = 'Barberías';
    $('eq-sub').textContent = 'Las que usan la app SB BARBER';
    const cuerpo = $('eq-cuerpo');
    cuerpo.innerHTML = cargando('Cargando barberías…');
    let lista = [];
    try {
        const snap = await ctx.fs.getDocs(ctx.fs.collection(ctx.db, 'barberias'));
        lista = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(b => b.id !== SB_ID);
    } catch (e) { cuerpo.innerHTML = `<p class="text-sm text-red-400">${esc(e.message)}</p>`; return; }
    lista.sort((a, b) => String(a.nombre || a.id).localeCompare(String(b.nombre || b.id)));
    cuerpo.innerHTML = `
      <div class="space-y-2">
        ${lista.length ? lista.map(b => `
          <button type="button" data-eq="ver" data-id="${esc(b.id)}" class="w-full flex items-center justify-between gap-3 bg-black/30 p-3.5 rounded-xl border border-white/10 hover:border-white/30 transition text-left">
            <span class="min-w-0">
              <span class="block text-sm font-bold text-white truncate">${esc(b.nombre || b.id)}${b.prueba ? ' <span class="text-[10px] text-gray-500 font-bold">PRUEBA</span>' : ''}</span>
              <span class="block text-[11px] text-gray-500">${(b.admins || []).length} admin · ${(b.barberos || []).filter(x => x.activo !== false).length} barberos</span>
            </span>
            <i class="fas fa-chevron-right text-gray-600 text-xs"></i>
          </button>`).join('') : '<p class="text-sm text-gray-500 text-center py-3">Todavía no hay otras barberías.</p>'}
      </div>
      <form id="eq-form-barberia" class="space-y-2.5 bg-black/20 border border-white/10 rounded-2xl p-4" autocomplete="off">
        <p class="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Nueva barbería</p>
        <input name="nombre" required maxlength="60" placeholder="Nombre (ej. Barbería Lo de Juan)" class="${input}">
        <input name="id" required pattern="[a-z0-9-]{2,40}" placeholder="Id (ej. lo-de-juan)" class="${input}">
        <input name="adminEmail" type="email" required placeholder="Mail del dueño de esa barbería" class="${input}" data-scan="nativo">
        <p class="text-[11px] text-gray-500">Va a ser su admin: entra con ese mail y la contraseña que te muestro al crearla.</p>
        <button class="${boton}">Crear barbería</button>
        <div data-resultado></div>
      </form>`;
}

async function crearBarberia(form) {
    const btn = form.querySelector('button'); const out = form.querySelector('[data-resultado]');
    btn.disabled = true; out.innerHTML = '';
    try {
        const r = await api('barberia', { nombre: form.elements.nombre.value.trim(), id: form.elements.id.value.trim(), adminEmail: form.elements.adminEmail.value.trim() });
        out.innerHTML = tarjetaClave(r.admin.email, r.admin.password, r.nombre);
        form.querySelectorAll('input').forEach(i => { i.value = ''; delete i.dataset.tocado; });
    } catch (e) { out.innerHTML = `<p class="text-sm text-red-400">${esc(e.message)}</p>`; }
    btn.disabled = false;
}

// ---- Equipo de una barbería ----
async function verEquipo(id) {
    viendo = id;
    const cuerpo = $('eq-cuerpo');
    $('eq-titulo').textContent = 'Equipo';
    $('eq-sub').textContent = '';
    if (id === SB_ID) {
        cuerpo.innerHTML = '<p class="text-sm text-gray-400">Las cuentas de SB Barber se manejan como siempre.</p>';
        return;
    }
    cuerpo.innerHTML = cargando('Cargando equipo…');
    let cfg;
    try {
        const s = await ctx.fs.getDoc(ctx.fs.doc(ctx.db, 'barberias', id));
        cfg = s.exists() ? s.data() : null;
    } catch (e) { cuerpo.innerHTML = `<p class="text-sm text-red-400">${esc(e.message)}</p>`; return; }
    if (!cfg) { cuerpo.innerHTML = '<p class="text-sm text-red-400">No existe esa barbería.</p>'; return; }
    $('eq-sub').textContent = cfg.nombre || id;
    const yo = ctx.auth.currentUser?.email;
    const admins = (cfg.admins || []).map(email => ({ email, rol: 'admin' }));
    const barberos = (cfg.barberos || []).filter(b => b.activo !== false && b.email).map(b => ({ email: b.email, nombre: b.nombre, rol: 'barbero' }));
    const sinCuenta = (cfg.barberos || []).filter(b => b.activo !== false && !b.email);
    const fila = u => `
      <div class="bg-black/30 p-3 rounded-xl border border-white/10">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="text-sm font-bold text-white truncate">${esc(u.nombre || u.email)}</div>
            ${u.nombre ? `<div class="text-[11px] text-gray-500 truncate">${esc(u.email)}</div>` : ''}
          </div>
          <span class="text-[10px] font-bold px-2 py-1 rounded-md ${u.rol === 'admin' ? 'bg-white text-black' : 'bg-white/10 text-gray-300'} flex-shrink-0">${u.rol === 'admin' ? 'ADMIN' : 'BARBERO'}</span>
        </div>
        ${u.email === yo ? '<p class="text-[10px] text-gray-600 mt-2">Sos vos</p>' : `
        <div class="flex gap-2 mt-2.5">
          <button type="button" class="${chico}" data-eq="clave" data-email="${esc(u.email)}" data-rol="${u.rol}" data-nombre="${esc(u.nombre || '')}"><i class="fas fa-key mr-1"></i>Nueva contraseña</button>
          <button type="button" class="${chico} !text-red-400" data-eq="baja" data-email="${esc(u.email)}"><i class="fas fa-user-slash mr-1"></i>Dar de baja</button>
        </div>`}
        <div data-res-email="${esc(u.email)}"></div>
      </div>`;
    cuerpo.innerHTML = `
      ${ctx.esDueno && ctx.barberiaId === SB_ID ? `<button type="button" data-eq="volver" class="text-xs font-bold text-gray-400 hover:text-white"><i class="fas fa-chevron-left mr-1"></i>Barberías</button>` : ''}
      <div class="space-y-2">${[...admins, ...barberos].map(fila).join('') || '<p class="text-sm text-gray-500">Sin usuarios.</p>'}</div>
      ${sinCuenta.length ? `<p class="text-[11px] text-gray-500">Sin cuenta todavía: ${sinCuenta.map(b => esc(b.nombre)).join(', ')}. Agregalos con su mail y el mismo nombre.</p>` : ''}
      <form id="eq-form-usuario" class="space-y-2.5 bg-black/20 border border-white/10 rounded-2xl p-4" autocomplete="off">
        <p class="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Agregar al equipo</p>
        <select name="rol" class="${input}">
          <option value="barbero">Barbero (usa anotar: sus cortes y su plata)</option>
          <option value="admin">Admin (usa recepción: caja, stock, estadísticas)</option>
        </select>
        <input name="nombre" maxlength="30" placeholder="Nombre como aparece en la app (ej. Juan)" class="${input}" data-solo-barbero>
        <input name="email" type="email" required placeholder="Mail" class="${input}" data-scan="nativo">
        <button class="${boton}">Agregar</button>
        <div data-resultado></div>
      </form>`;
}

async function agregarUsuario(form) {
    const btn = form.querySelector('button'); const out = form.querySelector('[data-resultado]');
    const rol = form.elements.rol.value;
    btn.disabled = true; out.innerHTML = '';
    try {
        const r = await api('usuario', { barberia: viendo, rol, email: form.elements.email.value.trim(), nombre: rol === 'barbero' ? form.elements.nombre.value.trim() : '' });
        await verEquipo(viendo);
        const out2 = $('eq-form-usuario')?.querySelector('[data-resultado]');
        if (out2) out2.innerHTML = r.password ? tarjetaClave(r.email, r.password) : `<p class="text-sm text-emerald-400">Listo: ${esc(r.email)} ahora es ${r.rol === 'admin' ? 'admin' : 'barbero'}.</p>`;
    } catch (e) { out.innerHTML = `<p class="text-sm text-red-400">${esc(e.message)}</p>`; btn.disabled = false; }
}

async function nuevaClave(email, rol, nombre) {
    if (!confirm(`¿Generar una contraseña nueva para ${email}? La que tiene deja de andar.`)) return;
    const out = document.querySelector(`[data-res-email="${CSS.escape(email)}"]`);
    out.innerHTML = cargando('Generando…');
    try {
        const r = await api('usuario', { barberia: viendo, email, rol, nombre, nuevaPassword: true });
        out.innerHTML = tarjetaClave(r.email, r.password);
    } catch (e) { out.innerHTML = `<p class="text-sm text-red-400 mt-2">${esc(e.message)}</p>`; }
}

async function darDeBaja(email) {
    if (!confirm(`¿Dar de baja a ${email}? No va a poder entrar más. Sus cortes y ventas viejos quedan.`)) return;
    const out = document.querySelector(`[data-res-email="${CSS.escape(email)}"]`);
    out.innerHTML = cargando('Dando de baja…');
    try { await api('usuario-baja', { email }); await verEquipo(viendo); }
    catch (e) { out.innerHTML = `<p class="text-sm text-red-400 mt-2">${esc(e.message)}</p>`; }
}

// Contraseña recién generada: se ve una sola vez, con botones para copiar el mensaje o compartirlo (WhatsApp).
function tarjetaClave(email, password, barberia) {
    if (!password) return '';
    const msj = `Tu acceso a la app SB BARBER${barberia ? ` (${barberia})` : ''}:\nMail: ${email}\nContraseña: ${password}\nBajá la app o entrá a https://sbbarber.com.ar/panel/`;
    return `
      <div class="mt-2 p-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 space-y-2">
        <p class="text-[11px] text-emerald-300 font-bold">Pasale estos datos. La contraseña no se vuelve a mostrar.</p>
        <div class="text-sm text-white break-all">${esc(email)}</div>
        <div class="font-mono text-lg font-bold text-white tracking-wider select-all">${esc(password)}</div>
        <div class="flex gap-2">
          <button type="button" class="${chico}" data-eq="copiar" data-msj="${esc(msj)}"><i class="far fa-copy mr-1"></i>Copiar mensaje</button>
          ${navigator.share ? `<button type="button" class="${chico}" data-eq="compartir" data-msj="${esc(msj)}"><i class="fas fa-share-nodes mr-1"></i>Compartir</button>` : ''}
        </div>
      </div>`;
}

async function copiar(b) {
    try { await navigator.clipboard.writeText(b.dataset.msj); b.innerHTML = '<i class="fas fa-check mr-1"></i>Copiado'; }
    catch { b.textContent = 'No se pudo copiar'; }
}
