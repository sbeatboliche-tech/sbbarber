import nodemailer from 'nodemailer';
import { orderLabel, emailShell, itemRows } from '../lib/email.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { items, buyer, orderId, total, shipping } = req.body;
    if (!buyer?.email) return res.status(400).json({ error: 'El pedido no tiene email de contacto' });
    const ship = shipping || { mode: 'pickup', address: '', cost: 0 };

    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: 'sbbaarber@gmail.com', pass: process.env.GMAIL_APP_PASSWORD }
        });

        await transporter.sendMail({
            from: '"SB Barber Tienda" <sbbaarber@gmail.com>',
            to: buyer.email,
            subject: `⏰ Te esperamos tu transferencia — ${orderLabel(orderId)}`,
            html: reminderHtml(buyer.name, items, total, orderId, ship)
        });

        res.status(200).json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al enviar el recordatorio' });
    }
}

function reminderHtml(name, items, total, orderId, ship) {
    const entrega = ship.mode === 'delivery' ? `Envío a: ${ship.address || ''}` : 'Retiro en local · Dávila 951, CABA';
    const waMsg = encodeURIComponent(`Hola! Te paso la captura de mi pago. Pedido: ${orderLabel(orderId)}`);
    const waLink = `https://wa.me/541170583352?text=${waMsg}`;

    const body = `
    <p style="color:#18181b;margin:0 0 16px;font-size:15px;font-weight:700;">¡Hola ${name}! Tu pedido sigue reservado 🖤</p>
    <p style="color:#52525b;font-size:13px;margin:0 0 16px;">Todavía no nos llegó tu transferencia. Te dejamos de nuevo los datos para que puedas completarla.</p>
    <table style="width:100%;border-collapse:collapse;">${itemRows(items)}</table>
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
    return emailShell(body, { eyebrow: 'RECORDATORIO', title: '⏰ Todavía te esperamos' });
}
