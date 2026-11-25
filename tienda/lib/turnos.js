// Turnos online (sbbarber.com.ar/turnos/): el cliente reserva y queda confirmado solo en turnos/{id},
// la misma colección que usan recepcionista y anotar. Lo llama api/push.js (plan Hobby: máx. 12 funciones).
//   GET  /api/push?action=disponibilidad&barbero=Santi&fecha=2026-12-02&largo=1 → { horas: ['11:00', ...] }
//   POST /api/push?action=reservar {barbero, servicio, largo, fecha, hora, nombre, telefono} → { ok, turnoId }
// Las reglas de Firestore no dejan leer ni escribir turnos a clientes sin login, así que todo pasa por acá
// (con la cuenta de servicio) y al cliente solo le llegan las horas libres, nunca los datos de otros turnos.
import { FieldValue } from 'firebase-admin/firestore';
import { barberDb } from './barberAdmin.js';
import { enviarPush } from './push.js';

// Barberos que se pueden reservar online (nombre = el de recepcionista) y cuánto dura cada turno.
// Tony todavía no. Pelo largo suma LARGO_EXTRA minutos.
export const BARBEROS_ONLINE = {
    Santi:  { etiqueta: 'Santi',        duracion: 45 },
    SantiF: { etiqueta: 'Santi Flores', duracion: 45 },
    Stefa:  { etiqueta: 'Stefa',        duracion: 60 },
};
const LARGO_EXTRA = 15;
const SERVICIOS = ['Corte', 'Corte y Barba', 'Barba'];
const DIAS_ABIERTO = [2, 3, 4, 5, 6];       // martes a sábado
const APERTURA = 11 * 60, CIERRE = 19 * 60 + 30;
const DIAS_ADELANTE = 14;
const ANTICIPACION_MIN = 30;                 // no se reserva para dentro de menos de media hora
const MAX_TURNOS_POR_TEL = 2;                // turnos futuros por teléfono (que nadie llene la agenda)

const aMin = h => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
const aHora = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Fecha y minutos de "ahora" en Argentina (Vercel corre en UTC)
function ahoraAR() {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date()).map(x => [x.type, x.value]));
    return { fecha: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
}

function validarFecha(fecha) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return 'Fecha inválida';
    const [a, m, d] = fecha.split('-').map(Number);
    const dia = new Date(Date.UTC(a, m - 1, d));
    if (!DIAS_ABIERTO.includes(dia.getUTCDay())) return 'Ese día está cerrado';
    const hoy = ahoraAR().fecha;
    const dif = (dia - new Date(hoy + 'T00:00:00Z')) / 864e5;
    if (dif < 0 || dif > DIAS_ADELANTE) return 'Fecha fuera de rango';
    return null;
}

// Turnos que ocupan la agenda de ese barbero ese día: [inicio, fin) en minutos.
// Los cargados a mano en recepcionista no tienen duración: se toma la del barbero.
function ocupados(docs, barbero) {
    const base = BARBEROS_ONLINE[barbero]?.duracion || 45;
    return docs.map(d => d.data())
        .filter(t => t.barbero === barbero && !t.eliminado && t.estado !== 'cancelado' && /^\d{1,2}:\d{2}$/.test(t.hora || ''))
        .map(t => { const ini = aMin(t.hora); return [ini, ini + (Number(t.duracion) || base)]; });
}

// Horas libres: cada `duracion` desde la apertura, más justo después de cada turno ocupado (así no quedan huecos).
function horasLibres(fecha, barbero, duracion, ocup) {
    const ahora = ahoraAR();
    const desde = fecha === ahora.fecha ? ahora.min + ANTICIPACION_MIN : 0;
    const paso = BARBEROS_ONLINE[barbero].duracion;
    const candidatos = new Set();
    for (let m = APERTURA; m + duracion <= CIERRE; m += paso) candidatos.add(m);
    ocup.forEach(([, fin]) => { if (fin >= APERTURA && fin + duracion <= CIERRE) candidatos.add(fin); });
    return [...candidatos].sort((a, b) => a - b)
        .filter(m => m >= desde && !ocup.some(([i, f]) => m < f && m + duracion > i))
        .map(aHora);
}

const duracionDe = (barbero, largo) => BARBEROS_ONLINE[barbero].duracion + (largo ? LARGO_EXTRA : 0);

export async function disponibilidad(q) {
    const barbero = String(q.barbero || '');
    if (!BARBEROS_ONLINE[barbero]) throw Object.assign(new Error('Barbero inválido'), { status: 400 });
    const err = validarFecha(q.fecha);
    if (err) return { horas: [], motivo: err };
    const snap = await barberDb().collection('turnos').where('fecha', '==', q.fecha).get();
    return { horas: horasLibres(q.fecha, barbero, duracionDe(barbero, q.largo === '1'), ocupados(snap.docs, barbero)) };
}

export async function reservar(b) {
    const barbero = String(b?.barbero || '');
    const servicio = String(b?.servicio || '');
    const largo = !!b?.largo && servicio !== 'Barba';
    const nombre = String(b?.nombre || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const telefono = String(b?.telefono || '').replace(/\D/g, '');
    const fecha = String(b?.fecha || ''), hora = String(b?.hora || '');
    const mal = msg => Object.assign(new Error(msg), { status: 400 });
    if (!BARBEROS_ONLINE[barbero]) throw mal('Barbero inválido');
    if (!SERVICIOS.includes(servicio)) throw mal('Servicio inválido');
    if (nombre.length < 2) throw mal('Poné tu nombre');
    if (telefono.length < 8 || telefono.length > 15) throw mal('Teléfono inválido');
    const errFecha = validarFecha(fecha);
    if (errFecha) throw mal(errFecha);
    if (!/^\d{2}:\d{2}$/.test(hora)) throw mal('Hora inválida');

    const db = barberDb();
    const duracion = duracionDe(barbero, largo);
    const ref = db.collection('turnos').doc();
    const hoy = ahoraAR().fecha;
    // Transacción: si dos personas reservan el mismo horario a la vez, la segunda falla al releer.
    await db.runTransaction(async tx => {
        const [delDia, delTel] = await Promise.all([
            tx.get(db.collection('turnos').where('fecha', '==', fecha)),
            tx.get(db.collection('turnos').where('telefono', '==', telefono)),
        ]);
        if (!horasLibres(fecha, barbero, duracion, ocupados(delDia.docs, barbero)).includes(hora)) {
            throw Object.assign(new Error('Ese horario se acaba de ocupar. Elegí otro.'), { status: 409 });
        }
        const futuros = delTel.docs.map(d => d.data()).filter(t => !t.eliminado && t.estado !== 'cancelado' && t.fecha >= hoy);
        if (futuros.length >= MAX_TURNOS_POR_TEL) {
            throw Object.assign(new Error(`Ya tenés ${futuros.length} turnos reservados. Si necesitás otro, escribinos por WhatsApp.`), { status: 409 });
        }
        tx.set(ref, {
            barbero, clientName: nombre, telefono, servicio: largo ? `${servicio} (pelo largo)` : servicio,
            pelolargo: largo, duracion, fecha, hora, estado: 'pendiente', confirmado: true,
            origen: 'online', anotadoPor: 'Online', userEmail: null,
            pushEnviado: true, creadoEn: FieldValue.serverTimestamp()
        });
    });

    // Aviso al barbero y a los dueños (si falla, el turno ya quedó guardado)
    const [a, m, d] = fecha.split('-').map(Number);
    const dia = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
    const aviso = { titulo: '📅 Turno online', cuerpo: `${nombre} · ${dia} ${d}/${m} ${hora} · ${servicio}${largo ? ' (pelo largo)' : ''} · ${BARBEROS_ONLINE[barbero].etiqueta}`, datos: { tipo: 'turno', turnoId: ref.id } };
    await Promise.all([
        enviarPush({ barbero }, aviso).catch(e => console.error('turno push barbero:', e)),
        enviarPush({ admins: true }, aviso).catch(e => console.error('turno push admins:', e)),
    ]);
    return { ok: true, turnoId: ref.id, duracion };
}
