const FIRESTORE_PROJECT_ID = 'sb-barber-6dc16';
const FIRESTORE_API_KEY = 'AIzaSyAXUQmV19Z0VNbOlrrk_IcMc2GKQZ8yk7w';

// Precio real de los 10 productos base (tal como están hoy en tienda/index.html y
// tienda/admin.html — no se editan desde Firestore). Si cambia un precio ahí, hay que
// actualizarlo también acá para que el checkout no rechace el producto.
const BASE_PRICES = {
    'polvo-texturizador': 12000,
    'pomada-mate': 12000,
    'pomada-brillante': 12000,
    'polvo-texturizador-black': 10000,
    'aftershave-celeste-black': 10900,
    'aftershave-violeta-black': 10200,
    'quita-pelo-lujo': 6900,
    'peine-toniguy': 3900,
    'capa-everest': 17000,
    'desinfectante-everest': 10200
};

function decodeFirestoreValue(v) {
    if (!v) return null;
    if (v.integerValue !== undefined) return Number(v.integerValue);
    if (v.doubleValue !== undefined) return Number(v.doubleValue);
    if (v.stringValue !== undefined) return v.stringValue;
    if (v.booleanValue !== undefined) return v.booleanValue;
    return null;
}

async function fetchFirestorePrice(collection, id) {
    try {
        const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/${collection}/${encodeURIComponent(id)}?key=${FIRESTORE_API_KEY}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        const price = data.fields?.price ? decodeFirestoreValue(data.fields.price) : null;
        return price != null ? Number(price) : null;
    } catch (e) {
        return null;
    }
}

// Nunca confiar en el precio que manda el navegador: se resuelve acá el precio real
// (Firestore primero — ahí puede haber un override incluso para un id de la base, como
// cuando el admin lo "oculta" o edita — y recién si no hay nada ahí se usa BASE_PRICES).
async function resolveRealPrice(id) {
    const customPrice = await fetchFirestorePrice('tienda_productos_custom', id);
    if (customPrice != null) return customPrice;
    const kitPrice = await fetchFirestorePrice('tienda_kits_custom', id);
    if (kitPrice != null) return kitPrice;
    if (BASE_PRICES[id] != null) return BASE_PRICES[id];
    return null;
}

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

    const mpItems = [];
    for (const i of items) {
        const qty = Number(i.quantity);
        if (!qty || qty < 1) return res.status(400).json({ error: `Cantidad inválida para ${i.id}` });
        const realPrice = await resolveRealPrice(i.id);
        if (realPrice == null) {
            return res.status(400).json({ error: `Producto inválido: ${i.id}` });
        }
        mpItems.push({
            id: i.id,
            title: i.name,
            quantity: qty,
            unit_price: realPrice,
            currency_id: 'ARS'
        });
    }
    const shippingCost = Number(shipping?.cost || 0);
    if (shippingCost > 0) {
        mpItems.push({
            id: 'envio',
            title: 'Envío a domicilio',
            quantity: 1,
            unit_price: shippingCost,
            currency_id: 'ARS'
        });
    }

    const preference = {
        items: mpItems,
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
            total: String(mpItems.reduce((s, i) => s + i.unit_price * i.quantity, 0)),
            shipping_mode: shipping?.mode || 'pickup',
            shipping_address: shipping?.address || '',
            shipping_cost: String(shippingCost)
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
