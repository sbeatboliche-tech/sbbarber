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
        const itemsSummary = meta.items_summary || pref.items?.map(i => `${i.quantity}x ${i.title}`).join(', ') || '';
        const total = Number(meta.total || payment.transaction_amount || 0);
        const orderId = payment.external_reference || String(data.id);
        const shipping = { mode: meta.shipping_mode || 'pickup', address: meta.shipping_address || '', cost: Number(meta.shipping_cost || 0) };

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: 'sbbaarber@gmail.com', pass: process.env.GMAIL_APP_PASSWORD }
        });

        await transporter.sendMail({
            from: '"SB Barber Tienda" <sbbaarber@gmail.com>',
            to: 'sbbaarber@gmail.com',
            subject: `🛒 ¡Vendiste un producto! — ${orderLabel(orderId)}`,
            html: sellerHtml(buyerName, buyerEmail, itemsSummary, total, orderId, shipping)
        });

        if (buyerEmail) {
            await transporter.sendMail({
                from: '"SB Barber Tienda" <sbbaarber@gmail.com>',
                to: buyerEmail,
                subject: '✅ Tu compra en SB Barber fue confirmada',
                html: buyerHtml(buyerName, itemsSummary, total, orderId, shipping)
            });
        }
    } catch (e) {
        console.error('Webhook error:', e);
    }
}

function orderLabel(orderId) {
    return orderId?.startsWith('SBB-') ? '#' + orderId.slice(4) : orderId;
}

function emailShell(bodyHtml, { eyebrow = 'TIENDA', title, subtitle } = {}) {
    return `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;background:#f4f4f5;margin:0;padding:24px;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
  <div style="background:#0a0a0a;padding:30px 32px;text-align:center;">
    <p style="color:#4ade80;font-size:11px;font-weight:800;letter-spacing:.25em;text-transform:uppercase;margin:0 0 8px;">SB BARBER · ${eyebrow}</p>
    <h1 style="color:#fff;font-size:22px;margin:0;font-weight:800;">${title}</h1>
    ${subtitle ? `<p style="color:#a3a3a3;margin:8px 0 0;font-size:14px;">${subtitle}</p>` : ''}
  </div>
  <div style="padding:28px 32px;">
    ${bodyHtml}
  </div>
</div></body></html>`;
}

function sellerHtml(name, email, items, total, orderId, shipping) {
    const shipRow = shipping.mode === 'delivery'
        ? `<tr><td style="padding:9px 0;color:#71717a;font-size:12px;">Entrega</td><td style="padding:9px 0;color:#18181b;text-align:right;">Envío — ${shipping.address}</td></tr>`
        : `<tr><td style="padding:9px 0;color:#71717a;font-size:12px;">Entrega</td><td style="padding:9px 0;color:#18181b;text-align:right;">Retiro en local</td></tr>`;
    const body = `
    <div style="background:rgba(74,222,128,.1);border:1px solid rgba(74,222,128,.25);border-radius:12px;padding:14px 16px;margin-bottom:20px;text-align:center;">
      <p style="color:#16a34a;font-size:13px;font-weight:800;margin:0;">💰 Pago confirmado por MercadoPago</p>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:9px 0;color:#71717a;font-size:12px;width:38%;">Cliente</td><td style="padding:9px 0;color:#18181b;font-weight:700;text-align:right;">${name}</td></tr>
      <tr style="border-top:1px solid #f0f0f0;"><td style="padding:9px 0;color:#71717a;font-size:12px;">Email</td><td style="padding:9px 0;color:#18181b;text-align:right;">${email || '—'}</td></tr>
      <tr style="border-top:1px solid #f0f0f0;"><td style="padding:9px 0;color:#71717a;font-size:12px;">Productos</td><td style="padding:9px 0;color:#18181b;text-align:right;">${items}</td></tr>
      <tr style="border-top:1px solid #f0f0f0;">${shipRow}</tr>
    </table>
    <div style="display:flex;justify-content:space-between;align-items:center;border-top:2px solid #18181b;padding-top:16px;margin-top:16px;">
      <span style="color:#18181b;font-weight:800;">Total</span>
      <span style="color:#16a34a;font-size:20px;font-weight:900;">$${total.toLocaleString('es-AR')}</span>
    </div>
    <p style="text-align:center;color:#a1a1aa;font-size:11px;margin:20px 0 0;">Pedido ${orderLabel(orderId)}</p>`;
    return emailShell(body, { eyebrow: 'NUEVA VENTA', title: '🛒 ¡Vendiste un producto!', subtitle: 'Pagado con MercadoPago' });
}

function buyerHtml(name, items, total, orderId, shipping) {
    const shipBlock = shipping.mode === 'delivery'
        ? `<div style="background:#f8f8f8;border-radius:12px;padding:16px 20px;margin-bottom:18px;border:1px solid #ececec;">
            <p style="color:#52525b;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin:0 0 6px;">📦 Envío a domicilio</p>
            <p style="color:#18181b;font-size:13px;margin:0;">${shipping.address}</p>
        </div>`
        : `<div style="background:#f8f8f8;border-radius:12px;padding:16px 20px;margin-bottom:18px;border:1px solid #ececec;">
            <p style="color:#52525b;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin:0 0 6px;">🏬 Retiro en local</p>
            <p style="color:#18181b;font-size:13px;margin:0;">Dávila 951, Parque Chacabuco<br>Lun–Sáb 12:00–19:30</p>
        </div>`;
    const body = `
    <div style="text-align:center;margin-bottom:24px;">
      <div style="width:56px;height:56px;background:rgba(74,222,128,.12);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:26px;">✅</div>
      <p style="color:#18181b;margin:0;font-size:15px;">Hola ${name}, tu pago fue confirmado.</p>
    </div>
    <div style="background:#f8f8f8;border-radius:12px;padding:18px 20px;margin-bottom:16px;border:1px solid #ececec;">
      <p style="color:#52525b;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px;">Tu pedido</p>
      <p style="color:#18181b;font-size:14px;margin:0;">${items}</p>
    </div>
    ${shipBlock}
    <div style="background:rgba(74,222,128,.08);border:1px solid rgba(74,222,128,.25);border-radius:12px;padding:16px 20px;margin-bottom:20px;text-align:center;">
      <p style="color:#16a34a;font-size:14px;font-weight:800;margin:0;">${shipping.mode === 'delivery' ? '🚚 En breve estaremos despachando tu producto' : '🏬 Ya podés pasar a retirarlo por el local'}</p>
      ${shipping.mode === 'delivery' ? '<p style="color:#16a34a;font-size:12px;margin:6px 0 0;opacity:.85;">Te avisamos cuando salga el envío.</p>' : ''}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;border-top:2px solid #18181b;padding-top:16px;margin-bottom:22px;">
      <span style="color:#18181b;font-weight:800;">Total pagado</span>
      <span style="color:#18181b;font-size:20px;font-weight:900;">$${total.toLocaleString('es-AR')}</span>
    </div>
    <p style="text-align:center;color:#a1a1aa;font-size:11px;margin:0;">SB Barber · Dávila 951, CABA<br>Pedido ${orderLabel(orderId)}</p>`;
    return emailShell(body, { title: '¡Gracias por tu compra! 🖤' });
}
