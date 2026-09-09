// Piezas compartidas por los mails de la tienda (webhook.js y notify-transfer.js).
export function orderLabel(orderId) {
    return orderId?.startsWith('SBB-') ? '#' + orderId.slice(4) : orderId;
}

export function emailShell(bodyHtml, { eyebrow = 'TIENDA', title } = {}) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f4f4f5;margin:0;padding:24px;">
<div style="max-width:440px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;">
  <div style="background:#0a0a0a;padding:24px 28px;text-align:center;">
    <p style="color:#4ade80;font-size:10px;font-weight:800;letter-spacing:.25em;text-transform:uppercase;margin:0 0 6px;">${eyebrow}</p>
    <h1 style="color:#ffffff;font-size:20px;line-height:1.3;margin:0;font-weight:800;">${title}</h1>
  </div>
  <div style="padding:24px 28px;">
    ${bodyHtml}
  </div>
  <div style="background:#fafafa;border-top:1px solid #eee;padding:16px 28px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#71717a;">SB Barber · Dávila 951, CABA · <a href="https://wa.me/541170583352" style="color:#16a34a;text-decoration:none;font-weight:700;">WhatsApp</a></p>
  </div>
</div>
</body></html>`;
}

export function itemRows(items, { withPrices = true } = {}) {
    return (items || []).map(i => {
        const lineTotal = (i.price || 0) * (i.quantity || 1);
        return `<tr>
            <td style="padding:5px 0;color:#18181b;font-size:13px;">${i.quantity}× ${i.name}</td>
            ${withPrices ? `<td style="padding:5px 0;color:#18181b;font-size:13px;text-align:right;white-space:nowrap;">$${lineTotal.toLocaleString('es-AR')}</td>` : ''}
        </tr>`;
    }).join('');
}
