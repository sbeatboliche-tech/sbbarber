const CORREO_BASE = 'https://api.correoargentino.com.ar/micorreo/v1';

async function getToken() {
    const user = process.env.CORREO_USER;
    const pass = process.env.CORREO_PASSWORD;
    const credentials = Buffer.from(`${user}:${pass}`).toString('base64');
    const res = await fetch(`${CORREO_BASE}/token`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${credentials}` }
    });
    if (!res.ok) throw new Error('Auth fallida');
    const data = await res.json();
    return data.token;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { postalCodeDestination, deliveredType = 'D' } = req.body;
    if (!postalCodeDestination) return res.status(400).json({ error: 'Falta código postal' });

    try {
        const token = await getToken();
        const ratesRes = await fetch(`${CORREO_BASE}/rates`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                customerId: process.env.CORREO_CUSTOMER_ID,
                postalCodeOrigin: process.env.CORREO_POSTAL_ORIGIN || '1406',
                postalCodeDestination,
                deliveredType,
                dimensions: {
                    weight: 500,
                    height: 15,
                    width: 15,
                    length: 20
                }
            })
        });
        const data = await ratesRes.json();
        if (!ratesRes.ok) return res.status(400).json({ error: data.message || 'Error Correo' });
        return res.status(200).json(data);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
