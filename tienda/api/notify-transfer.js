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
                subject: '📋 Tu pedido en SB Barber — Datos para pagar',
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
    const discountRow = discount > 0 ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Descuento 5%</td><td style="padding:8px 0;color:#f1f5f9;">− $${Number(discount).toLocaleString('es-AR')}</td></tr>` : '';
    const shipRow = ship.mode === 'delivery'
        ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Entrega</td><td style="padding:8px 0;color:#f1f5f9;">Envío — ${ship.address}</td></tr>`
        : `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Entrega</td><td style="padding:8px 0;color:#f1f5f9;">Retiro en local</td></tr>`;
    return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#080b12;margin:0;padding:24px;">
<div style="max-width:480px;margin:0 auto;background:#0d1320;border-radius:16px;padding:32px;border:1px solid rgba(255,255,255,0.08);">
  <p style="color:#f59e0b;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin:0 0 8px;">⏳ Pendiente de transferencia</p>
  <h1 style="color:#fff;font-size:22px;margin:0 0 24px;">💸 Nueva orden!</h1>
  <table style="width:100%;border-collapse:collapse;">
    <tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:40%;">Cliente</td><td style="padding:8px 0;color:#f1f5f9;font-weight:600;">${name}</td></tr>
    <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Email</td><td style="padding:8px 0;color:#f1f5f9;">${email || '—'}</td></tr>
    <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Productos</td><td style="padding:8px 0;color:#f1f5f9;">${items}</td></tr>
    ${shipRow}
    ${discountRow}
    <tr style="border-top:1px solid rgba(255,255,255,0.06);">
      <td style="padding:14px 0;color:#f59e0b;font-size:18px;font-weight:800;">Total a recibir</td>
      <td style="padding:14px 0;color:#f59e0b;font-size:18px;font-weight:800;">$${Number(total).toLocaleString('es-AR')}</td>
    </tr>
  </table>
  <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:10px;padding:12px;margin-top:16px;">
    <p style="color:#fbbf24;font-size:12px;margin:0;">Esperá la transferencia al alias <strong>sbeat.ar</strong> antes de ${ship.mode==='delivery'?'enviar':'entregar'} el producto.</p>
  </div>
  <p style="color:#334155;font-size:11px;margin-top:16px;">Orden: ${orderId}</p>
</div></body></html>`;}

function buyerHtml(name, items, total, discount, orderId, ship) {
    const discountLine = discount > 0 ? `<p style="color:#15803d;font-size:13px;font-weight:700;margin:4px 0 0;">Descuento 5% transferencia: − $${Number(discount).toLocaleString('es-AR')}</p>` : '';
    const shipBlock = ship.mode === 'delivery'
        ? `<div style="background:#eff6ff;border-radius:12px;padding:16px 20px;margin-bottom:16px;border:1px solid #bfdbfe;"><p style="color:#1d4ed8;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin:0 0 6px;">Envío a domicilio</p><p style="color:#1e40af;font-size:13px;margin:0;">${ship.address}</p></div>`
        : `<div style="background:#f0fdf4;border-radius:12px;padding:16px 20px;margin-bottom:16px;border:1px solid #bbf7d0;"><p style="color:#166534;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin:0 0 6px;">Retiro en local</p><p style="color:#15803d;font-size:13px;margin:0;">Dávila 951, Parque Chacabuco · Lun–Sáb 12:00–19:30</p></div>`;
    return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f1f5f9;margin:0;padding:24px;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,.08);">
  <div style="text-align:center;margin-bottom:28px;">
    <div style="font-size:40px;margin-bottom:12px;">📋</div>
    <h1 style="color:#0f172a;font-size:22px;margin:0 0 6px;">¡Pedido recibido!</h1>
    <p style="color:#64748b;margin:0;">Hola ${name}, ya recibimos tu pedido.</p>
  </div>
  <div style="background:#f8fafc;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #e2e8f0;">
    <p style="color:#475569;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px;">Tu pedido</p>
    <p style="color:#1e293b;font-size:14px;margin:0 0 8px;">${items}</p>
    ${discountLine}
    <p style="color:#0f172a;font-size:17px;font-weight:800;margin:8px 0 0;">Total: $${Number(total).toLocaleString('es-AR')}</p>
  </div>
  ${shipBlock}
  <div style="background:#eff6ff;border-radius:12px;padding:20px;margin-bottom:24px;border:1px solid #bfdbfe;">
    <p style="color:#1d4ed8;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin:0 0 10px;">Datos para transferir</p>
    <p style="color:#1e40af;font-size:14px;margin:0 0 4px;">Alias: <strong>sbeat.ar</strong></p>
    <p style="color:#1e40af;font-size:13px;margin:0 0 4px;">CVU: 0000003100061376563207</p>
    <p style="color:#1e40af;font-size:13px;margin:0;">Titular: Agustín Abalo</p>
  </div>
  <p style="text-align:center;color:#94a3b8;font-size:11px;margin:0;">Una vez confirmado el pago, preparamos tu pedido.<br>SB Barber · Orden: ${orderId}</p>
</div></body></html>`;
}
