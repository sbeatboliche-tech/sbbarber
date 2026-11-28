// Equipo de cada barbería (multi-barbería etapas 3 y 4). Plan: docs/superpowers/plans/2026-11-27-multi-barberia-etapa-3.md
//   POST /api/uso?action=barberia      { id, nombre, adminEmail, adminPassword? }   → solo dueños: crea la barbería y su primer admin
//   POST /api/uso?action=usuario       { barberia, email, nombre?, rol: 'admin'|'barbero', password? }
//   POST /api/uso?action=usuario-baja  { email }
// Quién puede:
//   - Dueños (OWNERS, nosotros): cualquier barbería menos SB (las cuentas de SB no llevan claim y se manejan como siempre).
//   - Admin de una barbería (claim rol 'admin'): solo la suya. El `barberia` que manda se ignora y se usa el de su claim,
//     así nunca puede tocar SB ni otra barbería.
// A cada usuario se le pone el custom claim { barberia, rol }: la app lo lee al iniciar sesión para abrir su barbería
// y las reglas de Firestore lo usan para dejarlo ver solo barberias/{su id}/... (sin get(), 0 lecturas).
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { barberApp, barberDb, OWNERS } from './barberAdmin.js';

const ID_RE = /^[a-z0-9-]{2,40}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const NOMBRE_RE = /^[\p{L}\p{M}0-9][\p{L}\p{M}0-9 '.-]{0,29}$/u;
const SB_ID = 'sb-barber';
// Ids que no puede tomar una barbería nueva (SB y nombres que se confunden con ella o con rutas)
const IDS_RESERVADOS = new Set([SB_ID, 'sb', 'sbbarber', 'sb-studio', 'prueba-sb', 'admin', 'barberias']);

const err = (status, msg) => Object.assign(new Error(msg), { status });

// Contraseña legible para pasar por WhatsApp (sin 0/O/1/l): 10 caracteres.
function generarPassword() {
    const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from(randomBytes(10), x => abc[x % abc.length]).join('');
}

const esDueno = caller => OWNERS.includes(caller?.email);

// Mails del equipo de SB: los de firestore.rules (esDueno/esStaff) + los de su config (admins y barberos).
const STAFF_SB = ['ap1773508@gmail.com', 'stefanoacostasla@gmail.com', 'rodriguezsantiagoet5@gmail.com', 'santiagofl551@gmail.com'];
async function esMailDeSB(email) {
    if (OWNERS.includes(email) || STAFF_SB.includes(email)) return true;
    const cfg = (await barberDb().doc(`barberias/${SB_ID}`).get()).data() || {};
    return (cfg.admins || []).includes(email) || (cfg.barberos || []).some(b => String(b.email || '').toLowerCase() === email);
}

// Barbería sobre la que puede actuar quien llama (o error).
function barberiaPermitida(caller, pedida) {
    if (esDueno(caller)) {
        const id = String(pedida || '').trim();
        if (!ID_RE.test(id)) throw err(400, 'Barbería inválida');
        if (id === SB_ID) throw err(400, 'Las cuentas de SB Barber no se manejan desde acá');
        return id;
    }
    if (caller?.rol === 'admin' && typeof caller.barberia === 'string' && ID_RE.test(caller.barberia) && caller.barberia !== SB_ID) {
        return caller.barberia;
    }
    throw err(403, 'Solo los admins de la barbería pueden manejar su equipo');
}

export async function altaUsuario(body, caller) {
    const barberia = barberiaPermitida(caller, body?.barberia);
    const email = String(body?.email || '').trim().toLowerCase();
    const rol = body?.rol === 'admin' ? 'admin' : body?.rol === 'barbero' ? 'barbero' : null;
    const nombre = String(body?.nombre || '').trim();
    let password = body?.password ? String(body.password) : null;

    if (!EMAIL_RE.test(email)) throw err(400, 'Email inválido');
    // Ningún mail del equipo de SB (aunque todavía no tenga cuenta): las reglas reconocen al staff de SB por email,
    // así que una cuenta creada acá con uno de esos mails podría ver datos de SB.
    if (await esMailDeSB(email)) throw err(400, 'Ese email es del equipo de SB Barber');
    if (!rol) throw err(400, 'Rol inválido (admin o barbero)');
    if (rol === 'barbero' && !NOMBRE_RE.test(nombre)) throw err(400, 'Falta el nombre del barbero (letras, hasta 30)');
    if (password && password.length < 8) throw err(400, 'La contraseña tiene que tener al menos 8 caracteres');
    if (!esDueno(caller) && email === String(caller.email || '').toLowerCase() && rol !== 'admin') throw err(400, 'No te podés sacar a vos mismo de admin');

    const db = barberDb();
    const cfgRef = db.doc(`barberias/${barberia}`);
    if (!(await cfgRef.get()).exists) throw err(404, 'No existe esa barbería');

    const auth = getAuth(barberApp());
    let user = await auth.getUserByEmail(email).catch(e => { if (e.code === 'auth/user-not-found') return null; throw e; });
    let creado = false;
    if (user) {
        // No se puede "robar" una cuenta de otra barbería ni una de SB (que no tiene claim)
        const actual = user.customClaims?.barberia;
        if (actual !== barberia) throw err(409, actual ? 'Ese email ya está en otra barbería' : 'Ese email ya tiene una cuenta (puede ser de SB Barber)');
        if (!password && body?.nuevaPassword) password = generarPassword();   // "Nueva contraseña" desde Equipo
        await auth.updateUser(user.uid, { ...(password ? { password } : {}), disabled: false });
    } else {
        if (!password) password = generarPassword();
        user = await auth.createUser({ email, password, displayName: nombre || undefined });
        creado = true;
    }
    await auth.setCustomUserClaims(user.uid, { barberia, rol });

    // Config de la barbería: admins (emails) y barberos ({nombre, email, ...})
    await db.runTransaction(async tx => {
        const cfg = (await tx.get(cfgRef)).data() || {};
        const admins = Array.isArray(cfg.admins) ? cfg.admins.filter(e => e !== email) : [];
        const barberos = Array.isArray(cfg.barberos) ? cfg.barberos.map(b => ({ ...b })) : [];
        if (rol === 'admin') {
            admins.push(email);
            barberos.forEach(b => { if (b.email === email) { delete b.email; } });
        } else {
            const yaEmail = barberos.find(b => b.email === email);
            const mismoNombre = barberos.find(b => b.nombre === nombre);
            if (mismoNombre?.email && mismoNombre.email !== email) throw err(409, `Ya hay un barbero "${nombre}" con otro email`);
            if (yaEmail && yaEmail !== mismoNombre) delete yaEmail.email;
            if (mismoNombre) Object.assign(mismoNombre, { email, activo: true });
            else barberos.push({ nombre, email, comision: 0.5, activo: true });
        }
        tx.update(cfgRef, { admins, barberos, actualizado: FieldValue.serverTimestamp() });
    });

    // La contraseña solo vuelve si la generó el servidor o se cambió; nunca se guarda.
    return { ok: true, email, barberia, rol, creado, ...(password ? { password } : {}) };
}

export async function bajaUsuario(body, caller) {
    const email = String(body?.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || OWNERS.includes(email)) throw err(400, 'Email inválido');
    if (email === String(caller?.email || '').toLowerCase()) throw err(400, 'No te podés dar de baja a vos mismo');
    const auth = getAuth(barberApp());
    const user = await auth.getUserByEmail(email).catch(() => null);
    if (!user) throw err(404, 'No existe ese usuario');
    const barberia = user.customClaims?.barberia;
    if (!barberia) throw err(400, 'Es una cuenta de SB Barber: no se da de baja desde acá');
    if (barberiaPermitida(caller, barberia) !== barberia) throw err(403, 'Ese usuario no es de tu barbería');
    return darDeBaja(auth, user, email, barberia);
}

// "Eliminar mi cuenta" desde la app (lo pide Apple, regla 5.1.1(v)). Solo cuentas de otras barberías:
// las de SB las manejan los dueños. El último admin de una barbería no se puede borrar solo (quedaría sin admin).
export async function eliminarMiCuenta(_body, caller) {
    const email = String(caller?.email || '').toLowerCase();
    if (OWNERS.includes(email)) throw err(400, 'Las cuentas de los dueños no se borran desde la app');
    const barberia = typeof caller?.barberia === 'string' ? caller.barberia : null;
    if (!barberia) throw err(400, 'Tu cuenta es de SB Barber: pedile la baja a los dueños');
    const auth = getAuth(barberApp());
    const user = await auth.getUser(caller.uid);
    if (caller.rol === 'admin') {
        const cfg = (await barberDb().doc(`barberias/${barberia}`).get()).data() || {};
        if ((cfg.admins || []).filter(e => e !== email).length === 0) {
            throw err(409, 'Sos el único admin de la barbería: agregá otro admin en Equipo antes de borrar tu cuenta');
        }
    }
    return darDeBaja(auth, user, email, barberia);
}

async function darDeBaja(auth, user, email, barberia) {
    await auth.updateUser(user.uid, { disabled: true });
    await auth.setCustomUserClaims(user.uid, null);
    await auth.revokeRefreshTokens(user.uid);   // el token que ya tiene vence en ≤1 h (las reglas no consultan revocados: costaría lecturas)
    const ref = barberDb().doc(`barberias/${barberia}`);
    await barberDb().runTransaction(async tx => {
        const cfg = (await tx.get(ref)).data() || {};
        const admins = (cfg.admins || []).filter(e => e !== email);
        // El barbero queda inactivo, sin email: sus cortes viejos se siguen viendo con su color
        const barberos = (cfg.barberos || []).map(b => {
            if (b.email !== email) return b;
            const { email: _, ...resto } = b;
            return { ...resto, activo: false };
        });
        tx.update(ref, { admins, barberos, actualizado: FieldValue.serverTimestamp() });
    });
    return { ok: true, email, barberia };
}

// Solo dueños: barbería nueva (config vacía, sin módulos de SB) + su primer admin.
export async function crearBarberia(body, caller) {
    if (!esDueno(caller)) throw err(403, 'Solo los dueños de SB crean barberías');
    const id = String(body?.id || '').trim().toLowerCase();
    const nombre = String(body?.nombre || '').trim().slice(0, 60);
    if (!ID_RE.test(id) || IDS_RESERVADOS.has(id)) throw err(400, 'Id inválido (minúsculas, números y guiones; no puede ser de SB)');
    if (!nombre) throw err(400, 'Falta el nombre de la barbería');
    const ref = barberDb().doc(`barberias/${id}`);
    await barberDb().runTransaction(async tx => {
        if ((await tx.get(ref)).exists) throw err(409, 'Ya existe una barbería con ese id');
        tx.set(ref, { nombre, admins: [], barberos: [], atajos: [], modulos: {}, creado: FieldValue.serverTimestamp(), creadoPor: caller.email });
    });
    const admin = await altaUsuario({ barberia: id, email: body?.adminEmail, rol: 'admin', password: body?.adminPassword }, caller)
        .catch(async e => { await ref.delete().catch(() => {}); throw e; });   // sin admin no sirve: se deshace
    return { ok: true, id, nombre, admin };
}
