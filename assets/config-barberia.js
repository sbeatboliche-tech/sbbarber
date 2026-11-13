// Configuración de la barbería (multi-barbería, etapa 1): barberos, admins, comisiones, colores,
// servicios exclusivos, atajos y módulos salen del doc barberias/{id} en Firestore, no del código.
// Lo comparten recepcionista y anotar. Plan: docs/superpowers/plans/2026-11-13-multi-barberia-etapa-1.md
//
// Mientras el doc no llega (o si falla) se usa la última config guardada en este dispositivo y, si no
// hay, CONFIG_RESPALDO: los valores de SB Barber de hoy. Así la app nunca se queda sin barberos.

export const BARBERIA_ID = 'sb-barber';
const CACHE_KEY = `sb_config_barberia_${BARBERIA_ID}`;

export const CONFIG_RESPALDO = {
    nombre: 'SB Barber',
    admins: ['abalo7272@gmail.com', 'carusomanu21@gmail.com'],
    barberos: [
        { nombre: 'Tony',   email: 'ap1773508@gmail.com',            color: 'blue',   inicial: 'T',  comision: 0.5, activo: true },
        { nombre: 'Stefa',  email: 'stefanoacostasla@gmail.com',     color: 'purple', inicial: 'S',  comision: 0.5, activo: true },
        { nombre: 'Santi',  email: 'rodriguezsantiagoet5@gmail.com', color: 'orange', inicial: 'Sa', comision: 0.5, activo: true },
        { nombre: 'SantiF', etiqueta: 'Santi F', email: 'santiagofl551@gmail.com', color: 'pink', inicial: 'F', comision: 0.5, activo: true,
          serviciosExclusivos: ['Mechas', 'Global'],
          // Desde el 11/11/2026: Mechas, Global y Color al 40% para él; antes, todo al 40% (como se pagaba).
          reglasComision: [
              { hasta: '2026-11-10', comision: 0.4 },
              { desde: '2026-11-11', servicios: ['mechas', 'global', 'color'], comision: 0.4 }
          ] },
        // Ex barberos: no aparecen para elegir, pero sus cortes viejos se ven con su color.
        { nombre: 'Maxi',  color: 'emerald', inicial: 'M', comision: 0.5, activo: false },
        { nombre: 'Bauti', comision: 0.5, activo: false }
    ],
    atajos: [
        { tecla: 'Digit7', barbero: 'Tony',  monto: 5000 },
        { tecla: 'Digit6', barbero: 'Stefa', monto: 5000 }
    ],
    // Lo propio de este local; una barbería nueva arranca con todo en false.
    modulos: { mercadolibre: true, pickit: true }
};

const clonar = o => JSON.parse(JSON.stringify(o));

function valida(cfg) {
    return cfg && Array.isArray(cfg.admins) && cfg.admins.length && Array.isArray(cfg.barberos);
}

// Config para arrancar ya (sincrónica): la del dispositivo o el respaldo.
export function configInicial() {
    try {
        const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (valida(c)) return c;
    } catch {}
    return clonar(CONFIG_RESPALDO);
}

// Escucha el doc (1 lectura al abrir + los cambios). onCambio(cfg) solo si llega una config válida.
export function escucharConfig(db, { doc, onSnapshot }, onCambio) {
    return onSnapshot(doc(db, 'barberias', BARBERIA_ID), snap => {
        const cfg = snap.exists() ? snap.data() : null;
        if (!valida(cfg)) return;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(cfg)); } catch {}
        onCambio(cfg);
    }, err => console.warn('config barbería:', err));
}

// ---- Ayudas para armar las variables de siempre ----

export const barberosActivos = cfg => cfg.barberos.filter(b => b.activo !== false).map(b => b.nombre);
export const etiquetaBarbero = (cfg, nombre) => cfg.barberos.find(b => b.nombre === nombre)?.etiqueta || nombre;

export function mapaEmails(cfg) {
    const m = {};
    cfg.barberos.forEach(b => { if (b.email) m[b.email] = b.nombre; });
    return m;
}

export function temaDe(b) {
    if (!b.color) return null;
    return { color: b.color, text: `text-${b.color}-400`, border: `border-${b.color}-500`, bg: `bg-${b.color}-500`,
             initial: b.inicial || b.nombre.charAt(0).toUpperCase() };
}

export function comisionesBase(cfg) {
    const m = {};
    cfg.barberos.forEach(b => { if (typeof b.comision === 'number') m[b.nombre] = b.comision; });
    return m;
}

// Fecha local YYYY-MM-DD de un corte (createdAt de Firestore) o de hoy.
function fechaCorte(c) {
    const d = c.createdAt && c.createdAt.toDate ? c.createdAt.toDate() : new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Comisión de un corte: la primera regla especial del barbero que aplique (por fecha y servicio), si no la base.
export function comisionConReglas(cfg, c, base) {
    const reglas = cfg.barberos.find(b => b.nombre === c.barber)?.reglasComision;
    if (!reglas?.length) return base;
    const f = fechaCorte(c);
    const serv = String(c.service || '').toLowerCase();
    const r = reglas.find(r => (!r.desde || f >= r.desde) && (!r.hasta || f <= r.hasta)
        && (!r.servicios?.length || r.servicios.some(s => serv.includes(String(s).toLowerCase()))));
    return r ? r.comision : base;
}

// Servicios que solo hacen algunos barberos (hoy Mechas y Global, solo Santi F).
export function servicioDisponible(cfg, servicio, barbero) {
    const duenos = cfg.barberos.filter(b => b.serviciosExclusivos?.includes(servicio)).map(b => b.nombre);
    return !duenos.length || duenos.includes(barbero);
}

export const moduloActivo = (cfg, m) => !!cfg.modulos?.[m];
