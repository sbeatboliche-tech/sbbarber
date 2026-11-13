// Avisos push que disparan recepcionista y anotar (otro dominio: GitHub Pages), con el ID token de Firebase.
//   POST /api/push?action=turno {turnoId} → "Turno nuevo" al barbero del turno (no a quien lo anotó).
// El contenido sale del turno guardado en Firestore, no del cliente; turnos/{id}.pushEnviado evita duplicados.
import { barberDb, verifyBarberUser } from '../lib/barberAdmin.js';
import { enviarPush } from '../lib/push.js';

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const user = await verifyBarberUser(req);
    if (!user) return res.status(401).json({ error: 'Sesión inválida' });

    try {
        if (req.query.action === 'turno') return res.json(await avisarTurno(req.body?.turnoId, user));
        return res.status(400).json({ error: 'Acción desconocida' });
    } catch (e) {
        console.error('push:', e);
        return res.status(500).json({ error: e.message });
    }
}

async function avisarTurno(turnoId, user) {
    if (typeof turnoId !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(turnoId)) throw new Error('turnoId inválido');
    const db = barberDb();
    const ref = db.doc(`turnos/${turnoId}`);
    // Marca primero (transacción) así dos llamadas seguidas no mandan dos avisos.
    const turno = await db.runTransaction(async tx => {
        const s = await tx.get(ref);
        if (!s.exists || s.data().pushEnviado || s.data().eliminado) return null;
        tx.update(ref, { pushEnviado: true });
        return s.data();
    });
    if (!turno?.barbero) return { enviados: 0 };

    const [a, m, d] = String(turno.fecha || '').split('-').map(Number);
    const fecha = a ? `${DIAS[new Date(a, m - 1, d).getDay()]} ${d}/${m}` : turno.fecha;
    const partes = [turno.clientName, `${fecha} ${turno.hora || ''}`.trim(), turno.servicio].filter(Boolean);
    const enviados = await enviarPush({ barbero: turno.barbero }, {
        titulo: '📅 Turno nuevo',
        cuerpo: partes.join(' · '),
        datos: { tipo: 'turno', turnoId }
    }, { excluirEmail: user.email });
    return { enviados };
}
