const ANDREANI_BASE = 'https://apis.andreani.com';

async function getToken() {
    const user = process.env.ANDREANI_USER;
    const pass = process.env.ANDREANI_PASSWORD;
    if (!user || !pass) throw new Error('Credenciales Andreani no configuradas');
    const credentials = Buffer.from(`${user}:${pass}`).toString('base64');
    const res = await fetch(`${ANDREANI_BASE}/v1/usuarios/tokens`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${credentials}` }
    });
    if (!res.ok) throw new Error('Auth Andreani fallida');
    const data = await res.json();
    return data.access_token;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { postalCodeDestination } = req.body;
    if (!postalCodeDestination) return res.status(400).json({ error: 'Falta código postal' });

    try {
        const token = await getToken();
        const params = new URLSearchParams({
            codigoPostalOrigen: process.env.ANDREANI_POSTAL_ORIGIN || '1406',
            codigoPostalDestino: postalCodeDestination,
            servicio: process.env.ANDREANI_SERVICIO || 'AND00EXP',
            volumenDeclarado: '3375',
            pesoDeclarado: '500'
        });
        const ratesRes = await fetch(`${ANDREANI_BASE}/v2/tarifas?${params}`, {
            headers: { 'X-Authorization-Token': token }
        });
        const data = await ratesRes.json();
        if (!ratesRes.ok) return res.status(400).json({ error: data.message || 'Error Andreani' });

        // Normalizar respuesta al formato estándar { rates: [{ price, deliveryTimeMin, deliveryTimeMax }] }
        const tarifas = Array.isArray(data) ? data : [data];
        const rates = tarifas.map(t => ({
            price: t.total ?? t.precio ?? t.tarifaConIva ?? 0,
            deliveryTimeMin: t.diasEntregaEstimadosMin ?? t.plazoEntrega ?? 3,
            deliveryTimeMax: t.diasEntregaEstimadosMax ?? t.plazoEntrega ?? 7
        }));
        return res.status(200).json({ rates });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
