// Bot de WhatsApp de SB Barber — WhatsApp Cloud API (Meta)
// Webhook: https://tienda.sbbarber.com.ar/api/whatsapp
// Env vars (en Vercel): WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN

const GRAPH = 'https://graph.facebook.com/v20.0';

const LINKS = {
  turnos: 'https://sbbarber.com.ar/turnos/',
  tienda: 'https://tienda.sbbarber.com.ar',
};

export default async function handler(req, res) {
  // 1) Verificación del webhook (Meta hace un GET al configurarlo)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  if (req.method !== 'POST') return res.status(405).end();

  // Responder rápido a Meta (obligatorio) y procesar aparte
  res.status(200).json({ ok: true });

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (!msg) return; // status updates (entregado/leído) u otros eventos: ignorar

    const from = msg.from; // número del cliente
    const nombre = change?.contacts?.[0]?.profile?.name || '';

    // ¿Qué mandó? texto libre o click en botón
    let intent = null;
    if (msg.type === 'interactive' && msg.interactive?.type === 'button_reply') {
      intent = msg.interactive.button_reply.id; // TURNO | TIENDA | DESPACHO
    } else if (msg.type === 'text') {
      intent = matchTextIntent(msg.text?.body || '');
    }

    if (intent === 'TURNO') {
      await sendText(from,
        `✂️ *Sacá tu turno online*\n\nElegí barbero, servicio y horario acá 👇\n${LINKS.turnos}\n\nSi necesitás otra cosa, escribí *menu*.`);
    } else if (intent === 'TIENDA') {
      await sendText(from,
        `🛒 *Tienda online SB Barber*\n\nProductos y combos profesionales, con envío a todo el país 👇\n${LINKS.tienda}\n\n¿Otra cosa? Escribí *menu*.`);
    } else if (intent === 'DESPACHO') {
      await sendText(from,
        `📦 *Despacho de tu pedido*\n\nPasame tu *número de pedido* (ej: #2345) y te confirmamos cómo viene el envío.\n\nSi todavía no compraste, mirá la tienda: ${LINKS.tienda}`);
    } else {
      // Primer mensaje o texto no reconocido → mostrar el menú de 3 botones
      await sendMenu(from, nombre);
    }
  } catch (e) {
    console.error('WhatsApp bot error:', e);
  }
}

// Detecta intención desde texto libre (por si escriben en vez de tocar el botón)
function matchTextIntent(text) {
  const t = text.toLowerCase();
  if (/(turno|reserv|cita|corte)/.test(t)) return 'TURNO';
  if (/(tienda|comprar|producto|combo|online)/.test(t)) return 'TIENDA';
  if (/(despacho|envio|env[ií]o|pedido|seguimiento|track)/.test(t)) return 'DESPACHO';
  return null; // → menú
}

// Menú principal con 3 botones interactivos
async function sendMenu(to, nombre) {
  const saludo = nombre ? `¡Hola ${nombre}! 👋` : '¡Hola! 👋';
  return waSend(to, {
    type: 'interactive',
    interactive: {
      type: 'button',
      header: { type: 'text', text: 'SB BARBER' },
      body: { text: `${saludo}\nSoy el asistente de *SB Barber*. ¿Con qué te ayudo?` },
      footer: { text: 'Dávila 951, Parque Chacabuco · CABA' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'TURNO', title: '✂️ Sacar turno' } },
          { type: 'reply', reply: { id: 'TIENDA', title: '🛒 Tienda online' } },
          { type: 'reply', reply: { id: 'DESPACHO', title: '📦 Despacho' } },
        ],
      },
    },
  });
}

async function sendText(to, body) {
  return waSend(to, { type: 'text', text: { preview_url: true, body } });
}

async function waSend(to, payload) {
  const url = `${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const body = { messaging_product: 'whatsapp', to, ...payload };
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) console.error('WhatsApp send error:', r.status, await r.text());
  return r;
}
