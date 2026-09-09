import nodemailer from 'nodemailer';
import { getAdminDb } from '../lib/firebaseAdmin.js';
import { orderLabel, emailShell, itemRows } from '../lib/email.js';

export default async function handler(req, res) {
    // Respond immediately — MP requires fast response
    res.status(200).end();

    const { type, data } = req.body || {};
    if (type !== 'payment' || !data?.id) return;

    try {
        const payRes = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
            headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
        });
        const payment = await payRes.json();
        if (payment.status !== 'approved') return;

        const prefRes = await fetch(`https://api.mercadopago.com/checkout/preferences/${payment.preference_id}`, {
            headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
        });
        const pref = await prefRes.json();
        const meta = pref.metadata || {};

        const buyerName = meta.buyer_name || payment.payer?.first_name || 'Cliente';
        const buyerEmail = meta.buyer_email || payment.payer?.email;
        const lineItems = (pref.items || []).map(i => ({ name: i.title, quantity: i.quantity, price: i.unit_price }));
        const itemsSummary = meta.items_summary || lineItems.map(i => `${i.quantity}x ${i.name}`).join(', ') || '';
        const total = Number(meta.total || payment.transaction_amount || 0);
        const orderId = payment.external_reference || String(data.id);
        const shipping = { mode: meta.shipping_mode || 'pickup', address: meta.shipping_address || '', cost: Number(meta.shipping_cost || 0) };

        // Recién acá se confirma el pago: hasta este momento el pedido queda como
        // 'pendiente_pago' (creado en checkout.js) y el admin NO debe mostrarlo como
        // listo para enviar/retirar — solo la redirección a MP no significa que se pagó.
        // Las reglas de Firestore no dejan marcar "aprobado" sin auth (a propósito, para que
        // nadie se auto-apruebe un pedido) — por eso esto usa la cuenta de servicio.
        try {
            await getAdminDb().doc(`tienda_pedidos/${orderId}`).set({ aprobado: true, status: 'pagado' }, { merge: true });
        } catch (e) {
            console.error('No se pudo marcar el pedido como pagado en Firestore:', e);
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: 'sbbaarber@gmail.com', pass: process.env.GMAIL_APP_PASSWORD }
        });

        await transporter.sendMail({
            from: '"SB Barber Tienda" <sbbaarber@gmail.com>',
            to: 'sbbaarber@gmail.com',
            subject: `🛒 ¡Vendiste un producto! — ${orderLabel(orderId)}`,
            html: sellerHtml(buyerName, buyerEmail, lineItems, total, orderId, shipping)
        });

        if (buyerEmail) {
            await transporter.sendMail({
                from: '"SB Barber Tienda" <sbbaarber@gmail.com>',
                to: buyerEmail,
                subject: `✅ Compra confirmada — ${orderLabel(orderId)}`,
                html: buyerHtml(buyerName, lineItems, total, orderId, shipping)
            });
        }
    } catch (e) {
        console.error('Webhook error:', e);
    }
}

function sellerHtml(name, email, items, total, orderId, shipping) {
    const entrega = shipping.mode === 'delivery' ? `Envío — ${shipping.address}` : 'Retiro en local';
    const body = `
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:5px 0;color:#71717a;font-size:12px;width:38%;">Cliente</td><td style="padding:5px 0;color:#18181b;font-weight:700;text-align:right;">${name}</td></tr>
      <tr><td style="padding:5px 0;color:#71717a;font-size:12px;">Email</td><td style="padding:5px 0;color:#18181b;text-align:right;">${email || '—'}</td></tr>
      ${itemRows(items)}
      <tr><td style="padding:5px 0;color:#71717a;font-size:12px;">Entrega</td><td style="padding:5px 0;color:#18181b;text-align:right;">${entrega}</td></tr>
    </table>
    <div style="display:flex;justify-content:space-between;border-top:2px solid #18181b;padding-top:12px;margin-top:12px;">
      <span style="color:#18181b;font-weight:800;">Total</span>
      <span style="color:#16a34a;font-size:20px;font-weight:900;">$${total.toLocaleString('es-AR')}</span>
    </div>
    <p style="text-align:center;color:#a1a1aa;font-size:11px;margin:16px 0 0;">Pedido ${orderLabel(orderId)}</p>`;
    return emailShell(body, { eyebrow: 'NUEVA VENTA · MERCADOPAGO', title: '🛒 Venta nueva' });
}

function buyerHtml(name, items, total, orderId, shipping) {
    const entrega = shipping.mode === 'delivery'
        ? `Envío a: ${shipping.address}`
        : 'Retiro en local · Dávila 951, CABA · Lun–Sáb 12–19:30';
    const body = `
    <p style="color:#18181b;margin:0 0 16px;font-size:15px;font-weight:700;">¡Listo, ${name}! Pago confirmado.</p>
    <table style="width:100%;border-collapse:collapse;">${itemRows(items)}</table>
    <div style="display:flex;justify-content:space-between;border-top:2px solid #18181b;padding-top:12px;margin-top:12px;">
      <span style="color:#18181b;font-weight:800;">Total pagado</span>
      <span style="color:#18181b;font-size:20px;font-weight:900;">$${total.toLocaleString('es-AR')}</span>
    </div>
    <p style="color:#52525b;font-size:13px;margin:16px 0 0;">${entrega}</p>
    <p style="text-align:center;color:#a1a1aa;font-size:11px;margin:16px 0 0;">Pedido ${orderLabel(orderId)}</p>`;
    return emailShell(body, { title: '¡Gracias por tu compra! 🖤' });
}
