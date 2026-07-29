import nodemailer from 'nodemailer';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { items, buyer, orderId, total, discount, shipping } = req.body;
    const ship = shipping || { mode: 'pickup', address: '', cost: 0 };
    const itemsSummary = items.map(i => `${i.quantity}x ${i.name}`).join(', ');

    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: 'sbbaarber@gmail.com', pass: process.env.GMAIL_APP_PASSWORD }
        });

        await transporter.sendMail({
            from: '"SB Barber Tienda" <sbbaarber@gmail.com>',
            to: 'sbbaarber@gmail.com',
            subject: `💸 Nueva orden por transferencia — ${orderId}`,
            html: sellerHtml(buyer.name, buyer.email, itemsSummary, total, discount||0, orderId, ship)
        });

        if (buyer.email) {
            await transporter.sendMail({
                from: '"SB Barber Tienda" <sbbaarber@gmail.com>',
                to: buyer.email,
                subject: '🖤 ¡Gracias por tu compra en SB Barber! — Datos para pagar',
                html: buyerHtml(buyer.name, itemsSummary, total, discount||0, orderId, ship)
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
        ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Descuento 10%</td><td style="padding:8px 0;color:#f1f5f9;">− $${Number(discount).toLocaleString('es-AR')}</td></tr>`
        : '';

    let shipRows = '';
    if (ship.mode === 'delivery') {
        const carrierName = ship.carrierLabel || (ship.carrier === 'andreani' ? 'Andreani' : ship.carrier === 'correo' ? 'Correo Argentino' : 'A definir');
        shipRows = `
            <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Entrega</td><td style="padding:8px 0;color:#f1f5f9;">Envío a domicilio</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Dirección</td><td style="padding:8px 0;color:#f1f5f9;font-weight:600;">${ship.address}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Transportista</td><td style="padding:8px 0;color:#fbbf24;font-weight:700;">${carrierName}</td></tr>
            ${ship.postalCode ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Código postal</td><td style="padding:8px 0;color:#f1f5f9;">${ship.postalCode}</td></tr>` : ''}
            ${ship.cost > 0 ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Costo de envío</td><td style="padding:8px 0;color:#f1f5f9;">$${Number(ship.cost).toLocaleString('es-AR')} (ya incluido en el total)</td></tr>` : ''}
        `;
    } else {
        shipRows = `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Entrega</td><td style="padding:8px 0;color:#f1f5f9;">Retiro en local</td></tr>`;
    }

    const shippingAlert = ship.mode === 'delivery' ? `
        <div style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:10px;padding:14px;margin-top:16px;">
            <p style="color:#93c5fd;font-size:12px;font-weight:700;margin:0 0 6px;text-transform:uppercase;letter-spacing:.08em;">📦 Acción requerida — Envío</p>
            <p style="color:#bfdbfe;font-size:13px;margin:0;">Confirmada la transferencia, generar etiqueta en el sitio de <strong>${ship.carrierLabel || 'la transportista'}</strong> y enviar el número de seguimiento al comprador.</p>
        </div>` : '';

    return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#080b12;margin:0;padding:24px;">
<div style="max-width:480px;margin:0 auto;background:#0d1320;border-radius:16px;padding:32px;border:1px solid rgba(255,255,255,0.08);">
  <p style="color:#f59e0b;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin:0 0 8px;">⏳ Pendiente de transferencia</p>
  <h1 style="color:#fff;font-size:22px;margin:0 0 24px;">💸 Nueva orden!</h1>
  <table style="width:100%;border-collapse:collapse;">
    <tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:40%;">Cliente</td><td style="padding:8px 0;color:#f1f5f9;font-weight:600;">${name}</td></tr>
    <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Email</td><td style="padding:8px 0;color:#f1f5f9;">${email || '—'}</td></tr>
    <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Productos</td><td style="padding:8px 0;color:#f1f5f9;">${items}</td></tr>
    ${shipRows}
    ${discountRow}
    <tr style="border-top:1px solid rgba(255,255,255,0.06);">
      <td style="padding:14px 0;color:#f59e0b;font-size:18px;font-weight:800;">Total a recibir</td>
      <td style="padding:14px 0;color:#f59e0b;font-size:18px;font-weight:800;">$${Number(total).toLocaleString('es-AR')}</td>
    </tr>
  </table>
  <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:10px;padding:12px;margin-top:16px;">
    <p style="color:#fbbf24;font-size:12px;margin:0;">Esperá la transferencia al alias <strong>sbeat.ar</strong> antes de ${ship.mode==='delivery'?'enviar':'entregar'} el producto.</p>
  </div>
  ${shippingAlert}
  <p style="color:#334155;font-size:11px;margin-top:16px;">Orden: ${orderId}</p>
</div></body></html>`;
}

function buyerHtml(name, items, total, discount, orderId, ship) {
    const discountLine = discount > 0
        ? `<p style="color:#15803d;font-size:13px;font-weight:700;margin:4px 0 0;">Descuento 10% transferencia: − $${Number(discount).toLocaleString('es-AR')}</p>`
        : '';

    let shipBlock = '';
    if (ship.mode === 'delivery') {
        shipBlock = `<div style="background:#eff6ff;border-radius:12px;padding:16px 20px;margin-bottom:16px;border:1px solid #bfdbfe;">
            <p style="color:#1d4ed8;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin:0 0 6px;">📦 Envío a domicilio</p>
            <p style="color:#1e40af;font-size:13px;margin:0 0 4px;">${ship.address || ''}</p>
            <p style="color:#3b82f6;font-size:12px;margin:4px 0 0;">Confirmado el pago, despachamos tu producto.</p>
        </div>`;
    } else {
        shipBlock = `<div style="background:#f0fdf4;border-radius:12px;padding:16px 20px;margin-bottom:16px;border:1px solid #bbf7d0;">
            <p style="color:#166534;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin:0 0 6px;">🏬 Retiro en local</p>
            <p style="color:#15803d;font-size:13px;margin:0;">Dávila 951, Parque Chacabuco · Lun–Sáb 12:00–19:30</p>
        </div>`;
    }

    const waMsg = encodeURIComponent(`Hola! Te paso la captura de mi pago. Orden: ${orderId}`);
    const waLink = `https://wa.me/541170583352?text=${waMsg}`;

    return `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;margin:0;padding:24px;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
  <div style="background:#0a0a0a;padding:28px 32px;text-align:center;">
    <p style="color:#d4af37;font-size:11px;font-weight:800;letter-spacing:.25em;text-transform:uppercase;margin:0 0 8px;">SB BARBER</p>
    <h1 style="color:#fff;font-size:23px;margin:0;">¡Gracias por tu compra! 🖤</h1>
    <p style="color:#a3a3a3;margin:8px 0 0;font-size:14px;">Hola ${name}, ya reservamos tu pedido.</p>
  </div>
  <div style="padding:28px 32px;">
    <div style="background:#f8fafc;border-radius:12px;padding:18px 20px;margin-bottom:18px;border:1px solid #e2e8f0;">
      <p style="color:#475569;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px;">Tu pedido</p>
      <p style="color:#1e293b;font-size:14px;margin:0 0 8px;">${items}</p>
      ${discountLine}
      <p style="color:#0f172a;font-size:18px;font-weight:800;margin:8px 0 0;">Total: $${Number(total).toLocaleString('es-AR')}</p>
    </div>
    ${shipBlock}
    <div style="background:#0a0a0a;border-radius:12px;padding:20px;margin-bottom:18px;">
      <p style="color:#d4af37;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;margin:0 0 12px;">💳 Datos para transferir</p>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="color:#8a8a8a;font-size:13px;padding:4px 0;">Alias</td><td style="color:#fff;font-size:15px;font-weight:800;text-align:right;padding:4px 0;">sbeat.ar</td></tr>
        <tr><td style="color:#8a8a8a;font-size:13px;padding:4px 0;">CVU</td><td style="color:#fff;font-size:12px;font-family:monospace;text-align:right;padding:4px 0;">0000003100061376563207</td></tr>
        <tr><td style="color:#8a8a8a;font-size:13px;padding:4px 0;">Titular</td><td style="color:#fff;font-size:13px;text-align:right;padding:4px 0;">Agustín Abalo</td></tr>
        <tr><td style="color:#8a8a8a;font-size:13px;padding:8px 0 0;">Monto</td><td style="color:#4ade80;font-size:16px;font-weight:800;text-align:right;padding:8px 0 0;">$${Number(total).toLocaleString('es-AR')}</td></tr>
      </table>
    </div>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:18px 20px;margin-bottom:20px;text-align:center;">
      <p style="color:#166534;font-size:14px;font-weight:800;margin:0 0 4px;">📸 Último paso</p>
      <p style="color:#15803d;font-size:13px;margin:0 0 14px;line-height:1.5;">Hacé la transferencia y mandanos la <b>captura del pago</b> por WhatsApp para confirmar tu pedido.</p>
      <a href="${waLink}" style="display:inline-block;background:#25D366;color:#fff;font-size:14px;font-weight:800;text-decoration:none;padding:13px 26px;border-radius:999px;">Enviar captura por WhatsApp</a>
    </div>
    <p style="text-align:center;color:#94a3b8;font-size:11px;margin:0;">SB Barber · Dávila 951, CABA · Orden: ${orderId}</p>
  </div>
</div></body></html>`;
}
