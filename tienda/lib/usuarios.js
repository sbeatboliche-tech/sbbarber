// Alta y baja de usuarios de otras barberías (multi-barbería etapa 3, solo dueños).
// Plan: docs/superpowers/plans/2026-11-27-multi-barberia-etapa-3.md
//   POST /api/uso?action=usuario       { barberia, email, nombre?, rol: 'admin'|'barbero', password? }
//   POST /api/uso?action=usuario-baja  { email }
// A cada usuario se le pone el custom claim { barberia, rol }: la app lo lee al iniciar sesión para abrir
// su barbería y las reglas de Firestore lo usan para dejarlo ver solo barberias/{su id}/... (sin get(), 0 lecturas).
// Las cuentas de SB Barber no llevan claim (sin claim = SB, como siempre), por eso acá no se puede tocar sb-barber.
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { barberApp, barberDb, OWNERS } from './barberAdmin.js';

const ID_RE = /^[a-z0-9-]{2,40}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const NOMBRE_RE = /^[\p{L}\p{M}0-9][\p{L}\p{M}0-9 '.-]{0,29}$/u;
const SB_ID = 'sb-barber';

// Contraseña legible para pasar por WhatsApp (sin 0/O/1/l): 10 caracteres.
function generarPassword() {
    const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const b = randomBytes(10);
    return Array.from(b, x => abc[x % abc.length]).join('');
}

const err = (status, msg) => Object.assign(new Error(msg), { status });

export async function altaUsuario(body) {
    const barberia = String(body?.barberia || '').trim();
    const email = String(body?.email || '').trim().toLowerCase();
    const rol = body?.rol === 'admin' ? 'admin' : body?.rol === 'barbero' ? 'barbero' : null;
    const nombre = String(body?.nombre || '').trim();
    let password = body?.password ? String(body.password) : null;

    if (!ID_RE.test(barberia)) throw err(400, 'Barbería inválida');
    if (barberia === SB_ID) throw err(400, 'Las cuentas de SB Barber no llevan barbería (se manejan como siempre)');
    if (!EMAIL_RE.test(email)) throw err(400, 'Email inválido');
    if (OWNERS.includes(email)) throw err(400, 'Ese email es de un dueño');
    if (!rol) throw err(400, 'Rol inválido (admin o barbero)');
    if (rol === 'barbero' && !NOMBRE_RE.test(nombre)) throw err(400, 'Falta el nombre del barbero');
    if (password && password.length < 8) throw err(400, 'La contraseña tiene que tener al menos 8 caracteres');

    const db = barberDb();
    const cfgRef = db.doc(`barberias/${barberia}`);
    const cfgSnap = await cfgRef.get();
    if (!cfgSnap.exists) throw err(404, 'No existe esa barbería');

    const auth = getAuth(barberApp());
    let user = await auth.getUserByEmail(email).catch(e => { if (e.code === 'auth/user-not-found') return null; throw e; });
    let creado = false;
    if (user) {
        // No se puede "robar" una cuenta de otra barbería (ni una de SB, que no tiene claim)
        const actual = user.customClaims?.barberia;
        if (actual !== barberia) throw err(409, actual ? `Ese email ya es de la barbería "${actual}"` : 'Ese email ya tiene una cuenta (puede ser de SB Barber)');
        if (password) await auth.updateUser(user.uid, { password, disabled: false });
        else await auth.updateUser(user.uid, { disabled: false });
    } else {
        if (!password) password = generarPassword();
        user = await auth.createUser({ email, password, displayName: nombre || undefined });
        creado = true;
    }
    await auth.setCustomUserClaims(user.uid, { barberia, rol });

    // Config de la barbería: admins (emails) o barberos ({nombre, email, ...})
    await db.runTransaction(async tx => {
        const s = await tx.get(cfgRef);
        const cfg = s.data() || {};
        const admins = Array.isArray(cfg.admins) ? cfg.admins.filter(e => e !== email) : [];
        const barberos = Array.isArray(cfg.barberos) ? cfg.barberos.map(b => ({ ...b })) : [];
        if (rol === 'admin') {
            admins.push(email);
            barberos.forEach(b => { if (b.email === email) delete b.email; });
        } else {
            const yaEmail = barberos.find(b => b.email === email);
            const mismoNombre = barberos.find(b => b.nombre === nombre);
            if (mismoNombre && mismoNombre.email && mismoNombre.email !== email) throw err(409, `Ya hay un barbero "${nombre}" con otro email`);
            if (yaEmail && yaEmail !== mismoNombre) delete yaEmail.email;
            if (mismoNombre) Object.assign(mismoNombre, { email, activo: true });
            else barberos.push({ nombre, email, comision: 0.5, activo: true });
        }
        tx.update(cfgRef, { admins, barberos, actualizado: FieldValue.serverTimestamp() });
    });

    // La contraseña solo vuelve si la generó el servidor (o se cambió), y nunca se guarda.
    return { ok: true, email, barberia, rol, creado, ...(password ? { password } : {}) };
}

export async function bajaUsuario(body) {
    const email = String(body?.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || OWNERS.includes(email)) throw err(400, 'Email inválido');
    const auth = getAuth(barberApp());
    const user = await auth.getUserByEmail(email).catch(() => null);
    if (!user) throw err(404, 'No existe ese usuario');
    const barberia = user.customClaims?.barberia;
    if (!barberia) throw err(400, 'Es una cuenta de SB Barber: no se da de baja desde acá');
    await auth.updateUser(user.uid, { disabled: true });
    await auth.setCustomUserClaims(user.uid, null);
    await auth.revokeRefreshTokens(user.uid);
    // En la config: sale de admins; el barbero queda inactivo (sus cortes viejos se siguen viendo con su color)
    const ref = barberDb().doc(`barberias/${barberia}`);
    await barberDb().runTransaction(async tx => {
        const cfg = (await tx.get(ref)).data() || {};
        const admins = (cfg.admins || []).filter(e => e !== email);
        const barberos = (cfg.barberos || []).map(b => {
            if (b.email !== email) return b;
            const { email: _, ...resto } = b;
            return { ...resto, activo: false };
        });
        tx.update(ref, { admins, barberos, actualizado: FieldValue.serverTimestamp() });
    });
    return { ok: true, email, barberia };
}
