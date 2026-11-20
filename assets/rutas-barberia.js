// Rutas de Firestore por barbería (multi-barbería, etapa 2).
// SB Barber usa las rutas de siempre (no se mudó, para no gastar cuota ni arriesgar la caja);
// cualquier otra barbería guarda todo en barberias/{id}/{coleccion}.
// Plan: docs/superpowers/plans/2026-11-20-multi-barberia-etapa-2.md
import { BARBERIA_ID, ES_SB } from './config-barberia.js';

// Las únicas de SB que no se llaman igual que la colección
const RUTAS_SB = {
    all_cuts: 'artifacts/sb-barber-6dc16/public/data/all_cuts'
};

export function ruta(coleccion) {
    if (ES_SB) return RUTAS_SB[coleccion] ?? coleccion;
    return `barberias/${BARBERIA_ID}/${coleccion}`;
}

// Para claves de localStorage con datos de la barbería (SB conserva las de siempre)
export const claveLocal = k => ES_SB ? k : `${k}__${BARBERIA_ID}`;
