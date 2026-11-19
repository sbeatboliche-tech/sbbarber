// Clasificación de envíos Flex por zona según la localidad del comprador (lo que ML manda en city.name).
// Zona 1 = primer cordón del conurbano, Zona 2 = segundo, Zona 3 = tercero / más lejos. Capital = CABA.
// Si la logística usa otro corte, en recepcionista se cargan localidades por zona y esas mandan sobre esta tabla.

export const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const TABLA = {
    'Zona 1': [
        // Avellaneda
        'avellaneda', 'dock sud', 'sarandi', 'wilde', 'villa dominico', 'pineyro', 'crucecita', 'gerli',
        // Lanús
        'lanus', 'remedios de escalada', 'valentin alsina', 'monte chingolo',
        // Lomas de Zamora
        'lomas de zamora', 'banfield', 'temperley', 'turdera', 'llavallol', 'villa fiorito', 'fiorito', 'ingeniero budge', 'villa centenario', 'villa albertina',
        // Quilmes
        'quilmes', 'bernal', 'don bosco', 'ezpeleta', 'san francisco solano', 'villa la florida',
        // La Matanza (norte)
        'san justo', 'ramos mejia', 'lomas del mirador', 'tapiales', 'la tablada', 'villa madero', 'aldo bonzi', 'villa luzuriaga', 'isidro casanova', 'villa celina', 'la matanza',
        // Morón, Hurlingham, Ituzaingó
        'moron', 'castelar', 'haedo', 'el palomar', 'villa sarmiento', 'hurlingham', 'william morris', 'villa tesei', 'ituzaingo', 'villa udaondo',
        // Tres de Febrero
        'tres de febrero', 'caseros', 'ciudadela', 'santos lugares', 'saenz pena', 'villa bosch', 'martin coronado', 'ciudad jardin lomas del palomar', 'ciudad jardin', 'pablo podesta', 'loma hermosa', 'villa raffo', 'jose ingenieros', 'churruca', 'once de septiembre', '11 de septiembre', 'remedios de escalada de san martin',
        // San Martín
        'general san martin', 'san martin', 'villa ballester', 'san andres', 'villa lynch', 'billinghurst', 'villa maipu', 'jose leon suarez', 'chilavert', 'villa libertad', 'villa martelli',
        // Vicente López, San Isidro
        'vicente lopez', 'olivos', 'florida', 'florida oeste', 'munro', 'carapachay', 'la lucila', 'villa adelina',
        'san isidro', 'martinez', 'acassuso', 'beccar', 'boulogne', 'boulogne sur mer'
    ],
    'Zona 2': [
        // La Matanza (sur)
        'gregorio de laferrere', 'laferrere', 'gonzalez catan', 'rafael castillo', 'ciudad evita', 'virrey del pino', '20 de junio', 'veinte de junio',
        // Berazategui, Florencio Varela
        'berazategui', 'hudson', 'ranelagh', 'sourigues', 'platanos', 'guillermo hudson', 'villa espana', 'gutierrez',
        'florencio varela', 'bosques', 'zeballos', 'ingeniero allan', 'villa vatteone',
        // Almirante Brown, Esteban Echeverría, Ezeiza
        'almirante brown', 'adrogue', 'burzaco', 'claypole', 'jose marmol', 'longchamps', 'rafael calzada', 'san jose', 'glew', 'ministro rivadavia', 'don orione', 'malvinas argentinas almirante brown',
        'esteban echeverria', 'monte grande', 'luis guillon', 'el jaguel', '9 de abril', 'canning',
        'ezeiza', 'tristan suarez', 'carlos spegazzini', 'la union',
        // Merlo, Moreno
        'merlo', 'san antonio de padua', 'padua', 'libertad', 'pontevedra', 'mariano acosta', 'parque san martin',
        'moreno', 'paso del rey', 'la reja', 'francisco alvarez', 'cuartel v', 'trujui',
        // José C. Paz, San Miguel, Malvinas Argentinas
        'jose c paz', 'san miguel', 'bella vista', 'muniz', 'santa maria',
        'malvinas argentinas', 'los polvorines', 'grand bourg', 'tortuguitas', 'pablo nogues', 'ingeniero pablo nogues', 'villa de mayo', 'tierras altas', 'ing adolfo sourdeaux', 'adolfo sourdeaux',
        // San Fernando, Tigre
        'san fernando', 'victoria', 'virreyes',
        'tigre', 'don torcuato', 'general pacheco', 'el talar', 'benavidez', 'rincon de milberg', 'troncos del talar', 'dique lujan', 'nordelta', 'ricardo rojas', 'los troncos del talar'
    ],
    'Zona 3': [
        'pilar', 'del viso', 'derqui', 'presidente derqui', 'manuel alberti', 'villa rosa', 'fatima', 'manzanares', 'la lonja', 'villa astolfi', 'pilar sur',
        'escobar', 'belen de escobar', 'garin', 'ingeniero maschwitz', 'maschwitz', 'matheu', 'maquinista savio',
        'la plata', 'city bell', 'gonnet', 'manuel b gonnet', 'villa elisa', 'tolosa', 'los hornos', 'berisso', 'ensenada', 'melchor romero', 'abasto',
        'canuelas', 'marcos paz', 'general rodriguez', 'lujan', 'open door', 'san vicente', 'alejandro korn',
        'presidente peron', 'guernica', 'exaltacion de la cruz', 'capilla del senor', 'campana', 'zarate', 'brandsen', 'coronel brandsen'
    ]
};
const INDICE = new Map();
Object.entries(TABLA).forEach(([zona, lista]) => lista.forEach(l => INDICE.set(norm(l), zona)));

// Busca la localidad exacta y, si no, la más larga que sea el comienzo (ej. "lanus oeste" → "lanus").
function buscar(lugar, mapa) {
    if (!lugar) return null;
    if (mapa.has(lugar)) return mapa.get(lugar);
    let mejor = null, largo = 0;
    for (const [l, zona] of mapa) if (l.length > largo && lugar.startsWith(l + ' ')) { mejor = zona; largo = l.length; }
    return mejor;
}

// zonas = flex_config/zonas.zonas [{ nombre, localidades }]. Devuelve el nombre de zona tal como está configurado.
export function zonaDe(dir, zonas = []) {
    const lugares = [norm(dir?.city?.name), norm(dir?.neighborhood?.name)].filter(Boolean);
    const cp = String(dir?.zip_code || '').replace(/\D/g, '');

    // 1) Lo que cargó el usuario en cada zona (localidades o códigos postales) manda.
    const propio = new Map();
    zonas.forEach(z => String(z.localidades || '').split(',').map(norm).filter(Boolean).forEach(l => propio.set(l, z.nombre)));
    if (cp && propio.has(cp)) return propio.get(cp);
    for (const l of lugares) { const z = buscar(l, propio); if (z) return z; }

    // 2) Capital, por provincia o por código postal (C1000-C1499)
    const cpNum = Number(cp.slice(0, 4));
    const esCaba = dir?.state?.id === 'AR-C' || /capital federal|ciudad autonoma/.test(norm(dir?.state?.name)) || (cp.length >= 4 && cpNum >= 1000 && cpNum <= 1499);
    if (esCaba) return nombreConfigurado('CABA', zonas);

    // 3) Tabla del conurbano
    for (const l of lugares) { const z = buscar(l, INDICE); if (z) return nombreConfigurado(z, zonas); }
    return 'Sin zona';
}

// "Zona 1" se guarda con el nombre que el usuario le haya puesto (ej. "GBA 1", "Zona 1", "Z1").
function nombreConfigurado(base, zonas) {
    const clave = n => { const t = norm(n); if (t === 'caba' || t === 'capital' || t === 'capital federal') return 'caba'; const m = /(\d+)\s*$/.exec(t); return m ? 'n' + m[1] : t; };
    const buscada = clave(base);
    return zonas.find(z => clave(z.nombre) === buscada)?.nombre || base;
}
