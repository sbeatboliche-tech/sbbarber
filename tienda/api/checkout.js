export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { items, buyer, orderId, shipping } = req.body;
    if (!items?.length || !buyer?.name || !buyer?.email) {
        return res.status(400).json({ error: 'Faltan datos' });
    }

    const baseUrl = process.env.STORE_URL || 'https://tienda.sbbarber.com.ar';

    const preference = {
        items: items.map(i => ({
            id: i.id,
            title: i.name,
            quantity: Number(i.quantity),
            unit_price: Number(i.price),
            currency_id: 'ARS'
        })),
        payer: {
            name: buyer.name,
            email: buyer.email,
            ...(buyer.phone && { phone: { area_code: '54', number: buyer.phone.replace(/\D/g, '') } })
        },
        back_urls: {
            success: `${baseUrl}/gracias.html?order=${orderId}&status=success&shipping=${shipping?.mode||'pickup'}`,
            failure: `${baseUrl}/?error=1`,
            pending: `${baseUrl}/gracias.html?order=${orderId}&status=pending&shipping=${shipping?.mode||'pickup'}`
        },
        auto_return: 'approved',
        notification_url: `${baseUrl}/api/webhook`,
        external_reference: orderId,
        statement_descriptor: 'SB BARBER',
        metadata: {
            buyer_name: buyer.name,
            buyer_email: buyer.email,
            buyer_phone: buyer.phone || '',
            items_summary: items.map(i => `${i.quantity}x ${i.name}`).join(', '),
            total: String(items.reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0)),
            shipping_mode: shipping?.mode || 'pickup',
            shipping_address: shipping?.address || '',
            shipping_cost: String(shipping?.cost || 0)
        }
    };

    try {
        const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
            },
            body: JSON.stringify(preference)
        });
        const data = await mpRes.json();
        if (!mpRes.ok) return res.status(500).json({ error: 'Error MercadoPago', detail: data });
        res.json({ init_point: data.init_point, id: data.id });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error del servidor' });
    }
}
