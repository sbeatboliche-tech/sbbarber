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
            subject: `💸 Nueva orden por transferencia — ${orderLabel(orderId)}`,
            html: sellerHtml(buyer.name, buyer.email, itemsSummary, total, discount || 0, orderId, ship)
        });

        if (buyer.email) {
            await transporter.sendMail({
                from: '"SB Barber Tienda" <sbbaarber@gmail.com>',
                to: buyer.email,
                subject: '🖤 ¡Gracias por tu compra en SB Barber! — Datos para pagar',
                html: buyerHtml(buyer.name, itemsSummary, total, discount || 0, orderId, ship)
            });
        }

        res.status(200).json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al enviar notificación' });
    }
}

function orderLabel(orderId) {
    return orderId?.startsWith('SBB-') ? '#' + orderId.slice(4) : orderId;
}

function emailShell(bodyHtml, { eyebrow = 'TIENDA', title, subtitle } = {}) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f4f4f5;margin:0;padding:24px;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 6px 30px rgba(0,0,0,.1);">
  <!-- Header con logo -->
  <div style="background:#0a0a0a;background-image:linear-gradient(180deg,#141414,#0a0a0a);padding:34px 32px 28px;text-align:center;">
    <img src="https://i.imgur.com/xyjMT6X.png" alt="SB BARBER" width="128" style="width:128px;max-width:60%;height:auto;margin:0 auto 18px;display:block;">
    <p style="color:#4ade80;font-size:10px;font-weight:800;letter-spacing:.3em;text-transform:uppercase;margin:0 0 8px;">${eyebrow}</p>
    <h1 style="color:#ffffff;font-size:22px;line-height:1.2;margin:0;font-weight:800;letter-spacing:-.01em;">${title}</h1>
    ${subtitle ? `<p style="color:#a3a3a3;margin:8px 0 0;font-size:14px;">${subtitle}</p>` : ''}
  </div>
  <!-- Cuerpo -->
  <div style="padding:28px 32px;">
    ${bodyHtml}
  </div>
  <!-- Footer -->
  <div style="background:#fafafa;border-top:1px solid #eeeeee;padding:22px 32px;text-align:center;">
    <p style="margin:0 0 6px;font-size:12px;font-weight:800;letter-spacing:.16em;color:#0a0a0a;text-transform:uppercase;">SB BARBER</p>
    <p style="margin:0 0 12px;font-size:12px;color:#71717a;line-height:1.6;">Dávila 951, Parque Chacabuco · CABA<br>Lun a Sáb · 12:00 a 19:30</p>
    <a href="https://wa.me/541170583352" style="display:inline-block;font-size:12px;font-weight:700;color:#16a34a;text-decoration:none;">WhatsApp</a>
    <span style="color:#d4d4d8;margin:0 8px;">·</span>
    <a href="https://tienda.sbbarber.com.ar" style="display:inline-block;font-size:12px;font-weight:700;color:#0a0a0a;text-decoration:none;">Nuestra tienda</a>
  </div>
</div>
<p style="text-align:center;color:#a1a1aa;font-size:10px;margin:14px 0 0;">Correo automático de SB Barber · Dávila 951, CABA</p>
</body></html>`;
}

function sellerHtml(name, email, items, total, discount, orderId, ship) {
    const discountRow = discount > 0
        ? `<tr style="border-top:1px solid #f0f0f0;"><td style="padding:9px 0;color:#71717a;font-size:12px;">Descuento 10%</td><td style="padding:9px 0;color:#18181b;text-align:right;">− $${Number(discount).toLocaleString('es-AR')}</td></tr>`
        : '';

    let shipRows = '';
    if (ship.mode === 'delivery') {
        const carrierName = ship.carrierLabel || (ship.carrier === 'andreani' ? 'Andreani' : ship.carrier === 'correo' ? 'Correo Argentino' : 'A definir');
        shipRows = `
            <tr style="border-top:1px solid #f0f0f0;"><td style="padding:9px 0;color:#71717a;font-size:12px;">Entrega</td><td style="padding:9px 0;color:#18181b;text-align:right;">Envío a domicilio</td></tr>
            <tr style="border-top:1px solid #f0f0f0;"><td style="padding:9px 0;color:#71717a;font-size:12px;">Dirección</td><td style="padding:9px 0;color:#18181b;font-weight:700;text-align:right;">${ship.address}</td></tr>
            <tr style="border-top:1px solid #f0f0f0;"><td style="padding:9px 0;color:#71717a;font-size:12px;">Transportista</td><td style="padding:9px 0;color:#d97706;font-weight:700;text-align:right;">${carrierName}</td></tr>
            ${ship.postalCode ? `<tr style="border-top:1px solid #f0f0f0;"><td style="padding:9px 0;color:#71717a;font-size:12px;">Código postal</td><td style="padding:9px 0;color:#18181b;text-align:right;">${ship.postalCode}</td></tr>` : ''}
            ${ship.cost > 0 ? `<tr style="border-top:1px solid #f0f0f0;"><td style="padding:9px 0;color:#71717a;font-size:12px;">Costo de envío</td><td style="padding:9px 0;color:#18181b;text-align:right;">$${Number(ship.cost).toLocaleString('es-AR')} (incluido en el total)</td></tr>` : ''}
        `;
    } else {
        shipRows = `<tr style="border-top:1px solid #f0f0f0;"><td style="padding:9px 0;color:#71717a;font-size:12px;">Entrega</td><td style="padding:9px 0;color:#18181b;text-align:right;">Retiro en local</td></tr>`;
    }

    const shippingAlert = ship.mode === 'delivery' ? `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:14px 16px;margin-top:16px;">
            <p style="color:#1d4ed8;font-size:12px;font-weight:800;margin:0 0 6px;text-transform:uppercase;letter-spacing:.06em;">📦 Acción requerida — Envío</p>
            <p style="color:#1e40af;font-size:13px;margin:0;">Confirmada la transferencia, generá la etiqueta en <strong>${ship.carrierLabel || 'la transportista'}</strong> y mandale el seguimiento al comprador.</p>
        </div>` : '';

    const body = `
    <div style="background:#fff7ed;border:1px solid #fdba74;border-radius:12px;padding:14px 16px;margin-bottom:20px;text-align:center;">
      <p style="color:#c2410c;font-size:13px;font-weight:800;margin:0;">⏳ Pendiente de confirmar la transferencia</p>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:9px 0;color:#71717a;font-size:12px;width:38%;">Cliente</td><td style="padding:9px 0;color:#18181b;font-weight:700;text-align:right;">${name}</td></tr>
      <tr style="border-top:1px solid #f0f0f0;"><td style="padding:9px 0;color:#71717a;font-size:12px;">Email</td><td style="padding:9px 0;color:#18181b;text-align:right;">${email || '—'}</td></tr>
      <tr style="border-top:1px solid #f0f0f0;"><td style="padding:9px 0;color:#71717a;font-size:12px;">Productos</td><td style="padding:9px 0;color:#18181b;text-align:right;">${items}</td></tr>
      ${shipRows}
      ${discountRow}
    </table>
    <div style="display:flex;justify-content:space-between;align-items:center;border-top:2px solid #18181b;padding-top:16px;margin-top:16px;">
      <span style="color:#18181b;font-weight:800;">Total a recibir</span>
      <span style="color:#d97706;font-size:20px;font-weight:900;">$${Number(total).toLocaleString('es-AR')}</span>
    </div>
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:12px 16px;margin-top:16px;">
      <p style="color:#92400e;font-size:12px;margin:0;">Esperá la transferencia al alias <strong>tienda.sbbarber</strong> antes de ${ship.mode === 'delivery' ? 'enviar' : 'entregar'} el producto.</p>
    </div>
    ${shippingAlert}
    <p style="text-align:center;color:#a1a1aa;font-size:11px;margin:20px 0 0;">Pedido ${orderLabel(orderId)}</p>`;
    return emailShell(body, { eyebrow: 'NUEVA ORDEN', title: '💸 Nueva orden por transferencia' });
}

function buyerHtml(name, items, total, discount, orderId, ship) {
    const discountLine = discount > 0
        ? `<p style="color:#16a34a;font-size:13px;font-weight:700;margin:4px 0 0;">Descuento 10% transferencia: − $${Number(discount).toLocaleString('es-AR')}</p>`
        : '';

    const shipBlock = ship.mode === 'delivery'
        ? `<div style="background:#f8f8f8;border-radius:12px;padding:16px 20px;margin-bottom:16px;border:1px solid #ececec;">
            <p style="color:#52525b;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin:0 0 6px;">📦 Envío a domicilio</p>
            <p style="color:#18181b;font-size:13px;margin:0 0 4px;">${ship.address || ''}</p>
            <p style="color:#71717a;font-size:12px;margin:4px 0 0;">Confirmado el pago, despachamos tu producto.</p>
        </div>`
        : `<div style="background:#f8f8f8;border-radius:12px;padding:16px 20px;margin-bottom:16px;border:1px solid #ececec;">
            <p style="color:#52525b;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin:0 0 6px;">🏬 Retiro en local</p>
            <p style="color:#18181b;font-size:13px;margin:0;">Dávila 951, Parque Chacabuco · Lun–Sáb 12:00–19:30</p>
        </div>`;

    const waMsg = encodeURIComponent(`Hola! Te paso la captura de mi pago. Pedido: ${orderLabel(orderId)}`);
    const waLink = `https://wa.me/541170583352?text=${waMsg}`;

    const body = `
    <p style="color:#18181b;margin:0 0 20px;font-size:15px;text-align:center;">Hola ${name}, ya reservamos tu pedido.</p>
    <div style="background:#f8f8f8;border-radius:12px;padding:18px 20px;margin-bottom:18px;border:1px solid #ececec;">
      <p style="color:#52525b;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px;">Tu pedido</p>
      <p style="color:#18181b;font-size:14px;margin:0 0 8px;">${items}</p>
      ${discountLine}
      <p style="color:#18181b;font-size:18px;font-weight:800;margin:8px 0 0;">Total: $${Number(total).toLocaleString('es-AR')}</p>
    </div>
    ${shipBlock}
    <div style="background:#0a0a0a;border-radius:12px;padding:20px;margin-bottom:18px;">
      <p style="color:#4ade80;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;margin:0 0 12px;">💳 Datos para transferir</p>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="color:#8a8a8a;font-size:13px;padding:4px 0;">Alias</td><td style="color:#fff;font-size:15px;font-weight:800;text-align:right;padding:4px 0;">tienda.sbbarber</td></tr>
        <tr><td style="color:#8a8a8a;font-size:13px;padding:4px 0;">CVU</td><td style="color:#fff;font-size:12px;font-family:monospace;text-align:right;padding:4px 0;">0000003100061376563207</td></tr>
        <tr><td style="color:#8a8a8a;font-size:13px;padding:4px 0;">Titular</td><td style="color:#fff;font-size:13px;text-align:right;padding:4px 0;">Agustín Abalo</td></tr>
        <tr><td style="color:#8a8a8a;font-size:13px;padding:8px 0 0;">Monto</td><td style="color:#4ade80;font-size:16px;font-weight:800;text-align:right;padding:8px 0 0;">$${Number(total).toLocaleString('es-AR')}</td></tr>
      </table>
    </div>
    <div style="background:rgba(74,222,128,.08);border:1px solid rgba(74,222,128,.3);border-radius:12px;padding:18px 20px;margin-bottom:20px;text-align:center;">
      <p style="color:#16a34a;font-size:14px;font-weight:800;margin:0 0 4px;">📸 Último paso</p>
      <p style="color:#15803d;font-size:13px;margin:0 0 14px;line-height:1.5;">Hacé la transferencia y mandanos la <b>captura del pago</b> por WhatsApp para confirmar tu pedido.</p>
      <a href="${waLink}" style="display:inline-block;background:#25D366;color:#fff;font-size:14px;font-weight:800;text-decoration:none;padding:13px 26px;border-radius:999px;">Enviar captura por WhatsApp</a>
    </div>
    <p style="text-align:center;color:#a1a1aa;font-size:11px;margin:0;">SB Barber · Dávila 951, CABA · Pedido ${orderLabel(orderId)}</p>`;
    return emailShell(body, { title: '¡Gracias por tu compra! 🖤' });
}
