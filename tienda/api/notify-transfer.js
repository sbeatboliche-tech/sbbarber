import nodemailer from 'nodemailer';
import { writeFirestoreDoc } from '../lib/firestore.js';
import { orderLabel, emailShell, itemRows } from '../lib/email.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { items, buyer, orderId, total, discount, shipping } = req.body;
    const ship = shipping || { mode: 'pickup', address: '', cost: 0 };

    // Registrar el pedido acá (servidor) además de en el navegador del comprador: si el
    // guardado del cliente falla (red, bloqueador de contenido), el pedido igual queda
    // registrado porque este write no depende de que el comprador siga en la página.
    await writeFirestoreDoc(`tienda_pedidos/${orderId}`, {
        buyer,
        shipping: ship,
        items: (items || []).map(i => ({ id: i.id, name: i.name, price: i.price, quantity: Number(i.quantity) })),
        total,
        discount: discount || 0,
        status: 'pendiente_transferencia',
        metodoPago: 'transferencia',
        creadoEn: new Date()
    });

    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: 'sbbaarber@gmail.com', pass: process.env.GMAIL_APP_PASSWORD }
        });

        await transporter.sendMail({
            from: '"SB Barber Tienda" <sbbaarber@gmail.com>',
            to: 'sbbaarber@gmail.com',
            subject: `💸 Nueva orden por transferencia — ${orderLabel(orderId)}`,
            html: sellerHtml(buyer.name, buyer.email, items, total, discount || 0, orderId, ship)
        });

        if (buyer.email) {
            await transporter.sendMail({
                from: '"SB Barber Tienda" <sbbaarber@gmail.com>',
                to: buyer.email,
                subject: `🖤 Datos para transferir — ${orderLabel(orderId)}`,
                html: buyerHtml(buyer.name, items, total, discount || 0, orderId, ship)
            });
        }

        res.status(200).json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al enviar notificación' });
    }
}

function sellerHtml(name, email, items, total, discount, orderId, ship) {
    const discountRow = discount > 0
        ? `<tr><td style="padding:5px 0;color:#71717a;font-size:12px;">Descuento 10%</td><td style="padding:5px 0;color:#18181b;text-align:right;">− $${Number(discount).toLocaleString('es-AR')}</td></tr>`
        : '';
    const entrega = ship.mode === 'delivery'
        ? `${ship.address}${ship.postalCode ? ' (CP ' + ship.postalCode + ')' : ''} — ${ship.carrierLabel || 'a definir'}`
        : 'Retiro en local';

    const body = `
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:5px 0;color:#71717a;font-size:12px;width:38%;">Cliente</td><td style="padding:5px 0;color:#18181b;font-weight:700;text-align:right;">${name}</td></tr>
      <tr><td style="padding:5px 0;color:#71717a;font-size:12px;">Email</td><td style="padding:5px 0;color:#18181b;text-align:right;">${email || '—'}</td></tr>
      ${itemRows(items)}
      <tr><td style="padding:5px 0;color:#71717a;font-size:12px;">Entrega</td><td style="padding:5px 0;color:#18181b;text-align:right;">${entrega}</td></tr>
      ${discountRow}
    </table>
    <div style="display:flex;justify-content:space-between;border-top:2px solid #18181b;padding-top:12px;margin-top:12px;">
      <span style="color:#18181b;font-weight:800;">Total a recibir</span>
      <span style="color:#d97706;font-size:20px;font-weight:900;">$${Number(total).toLocaleString('es-AR')}</span>
    </div>
    <p style="color:#92400e;font-size:12px;margin:12px 0 0;">⏳ Esperá el pago antes de ${ship.mode === 'delivery' ? 'enviar' : 'entregar'}.</p>
    <p style="text-align:center;color:#a1a1aa;font-size:11px;margin:16px 0 0;">Pedido ${orderLabel(orderId)}</p>`;
    return emailShell(body, { eyebrow: 'NUEVA ORDEN · TRANSFERENCIA', title: '💸 Nueva orden' });
}

function buyerHtml(name, items, total, discount, orderId, ship) {
    const discountLine = discount > 0
        ? `<p style="color:#16a34a;font-size:12px;font-weight:700;margin:6px 0 0;">Descuento 10% transferencia: − $${Number(discount).toLocaleString('es-AR')}</p>`
        : '';
    const entrega = ship.mode === 'delivery' ? `Envío a: ${ship.address || ''}` : 'Retiro en local · Dávila 951, CABA';
    const waMsg = encodeURIComponent(`Hola! Te paso la captura de mi pago. Pedido: ${orderLabel(orderId)}`);
    const waLink = `https://wa.me/541170583352?text=${waMsg}`;

    const body = `
    <p style="color:#18181b;margin:0 0 16px;font-size:15px;font-weight:700;">¡Pedido reservado, ${name}!</p>
    <table style="width:100%;border-collapse:collapse;">${itemRows(items)}</table>
    ${discountLine}
    <div style="display:flex;justify-content:space-between;border-top:2px solid #18181b;padding-top:12px;margin-top:12px;">
      <span style="color:#18181b;font-weight:800;">Total</span>
      <span style="color:#18181b;font-size:20px;font-weight:900;">$${Number(total).toLocaleString('es-AR')}</span>
    </div>
    <p style="color:#52525b;font-size:13px;margin:16px 0 0;">${entrega}</p>
    <div style="background:#0a0a0a;border-radius:12px;padding:18px;margin-top:16px;">
      <p style="color:#4ade80;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin:0 0 10px;">Datos para transferir</p>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="color:#8a8a8a;font-size:13px;padding:3px 0;">Alias</td><td style="color:#fff;font-size:14px;font-weight:800;text-align:right;padding:3px 0;">tienda.sbbarber</td></tr>
        <tr><td style="color:#8a8a8a;font-size:13px;padding:3px 0;">CVU</td><td style="color:#fff;font-size:12px;font-family:monospace;text-align:right;padding:3px 0;">0000003100061376563207</td></tr>
        <tr><td style="color:#8a8a8a;font-size:13px;padding:3px 0;">Titular</td><td style="color:#fff;font-size:13px;text-align:right;padding:3px 0;">Agustín Abalo</td></tr>
        <tr><td style="color:#8a8a8a;font-size:13px;padding:6px 0 0;">Monto</td><td style="color:#4ade80;font-size:15px;font-weight:800;text-align:right;padding:6px 0 0;">$${Number(total).toLocaleString('es-AR')}</td></tr>
      </table>
    </div>
    <div style="text-align:center;margin-top:18px;">
      <a href="${waLink}" style="display:inline-block;background:#25D366;color:#fff;font-size:14px;font-weight:800;text-decoration:none;padding:12px 24px;border-radius:999px;">Enviar captura por WhatsApp</a>
    </div>
    <p style="text-align:center;color:#a1a1aa;font-size:11px;margin:16px 0 0;">Pedido ${orderLabel(orderId)}</p>`;
    return emailShell(body, { title: '¡Gracias por tu compra! 🖤' });
}
