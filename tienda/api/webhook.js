import nodemailer from 'nodemailer';

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
        const buyerPhone = meta.buyer_phone || '';
        const itemsSummary = meta.items_summary || pref.items?.map(i => `${i.quantity}x ${i.title}`).join(', ') || '';
        const total = Number(meta.total || payment.transaction_amount || 0);
        const orderId = payment.external_reference || String(data.id);

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: 'sbbaarber@gmail.com', pass: process.env.GMAIL_APP_PASSWORD }
        });

        await transporter.sendMail({
            from: '"SB Barber Tienda" <sbbaarber@gmail.com>',
            to: 'sbbaarber@gmail.com',
            subject: `🛒 ¡Vendiste un producto! — ${orderId}`,
            html: sellerHtml(buyerName, buyerEmail, buyerPhone, itemsSummary, total, orderId)
        });

        if (buyerEmail) {
            await transporter.sendMail({
                from: '"SB Barber Tienda" <sbbaarber@gmail.com>',
                to: buyerEmail,
                subject: '✅ Tu compra en SB Barber fue confirmada',
                html: buyerHtml(buyerName, itemsSummary, total, orderId)
            });
        }
    } catch (e) {
        console.error('Webhook error:', e);
    }
}

function sellerHtml(name, email, phone, items, total, orderId) {
    return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#080b12;margin:0;padding:24px;">
<div style="max-width:480px;margin:0 auto;background:#0d1320;border-radius:16px;padding:32px;border:1px solid rgba(255,255,255,0.08);">
  <p style="color:#06b6d4;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin:0 0 8px;">SB Barber · Tienda</p>
  <h1 style="color:#fff;font-size:22px;margin:0 0 24px;">🛒 ¡Nueva venta!</h1>
  <table style="width:100%;border-collapse:collapse;">
    <tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:40%;">Cliente</td><td style="padding:8px 0;color:#f1f5f9;font-weight:600;">${name}</td></tr>
    <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Email</td><td style="padding:8px 0;color:#f1f5f9;">${email || '—'}</td></tr>
    <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Teléfono</td><td style="padding:8px 0;color:#f1f5f9;">${phone || '—'}</td></tr>
    <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Productos</td><td style="padding:8px 0;color:#f1f5f9;">${items}</td></tr>
    <tr style="border-top:1px solid rgba(255,255,255,0.06);">
      <td style="padding:14px 0;color:#06b6d4;font-size:18px;font-weight:800;">Total</td>
      <td style="padding:14px 0;color:#06b6d4;font-size:18px;font-weight:800;">$${total.toLocaleString('es-AR')}</td>
    </tr>
  </table>
  <p style="color:#334155;font-size:11px;margin-top:16px;">Pago ID: ${orderId}</p>
</div></body></html>`;
}

function buyerHtml(name, items, total, orderId) {
    return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f1f5f9;margin:0;padding:24px;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,.08);">
  <div style="text-align:center;margin-bottom:28px;">
    <div style="width:64px;height:64px;background:#d1fae5;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:28px;">✅</div>
    <h1 style="color:#0f172a;font-size:22px;margin:0 0 6px;">¡Gracias por tu compra!</h1>
    <p style="color:#64748b;margin:0;">Hola ${name}, tu pago fue confirmado.</p>
  </div>
  <div style="background:#f8fafc;border-radius:12px;padding:20px;margin-bottom:20px;border:1px solid #e2e8f0;">
    <p style="color:#475569;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px;">Tu pedido</p>
    <p style="color:#1e293b;font-size:14px;margin:0;">${items}</p>
  </div>
  <div style="display:flex;justify-content:space-between;align-items:center;border-top:2px solid #e2e8f0;padding-top:16px;margin-bottom:24px;">
    <span style="color:#0f172a;font-weight:700;">Total pagado</span>
    <span style="color:#0ea5e9;font-size:20px;font-weight:900;">$${total.toLocaleString('es-AR')}</span>
  </div>
  <p style="text-align:center;color:#94a3b8;font-size:11px;margin:0;">SB Barber · Dávila 951, CABA<br>Orden: ${orderId}</p>
</div></body></html>`;
}
