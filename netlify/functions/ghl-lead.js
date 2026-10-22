/* ==========================================================================
   GO HIGH LEVEL (lado servidor)
   Recibe cada envío del formulario desde form.js (califique o no) y lo
   reenvía al disparador "Inbound Webhook" del Workflow "Black – Nuevo lead".
   La URL del webhook no va en el sitio: vive en Netlify, así nadie la lee.
   Variables de entorno en Netlify (Site configuration > Environment variables):
     GHL_WEBHOOK_URL   URL del Inbound Webhook del Workflow (obligatoria)
     FORM_TOKEN        opcional; si falta usa el de config.js (sheets.token)

   Claves que llegan al webhook (todas planas, sin tildes ni espacios, para
   mapearlas fácil en el Workflow):
     contacto:    first_name, last_name, full_name, phone, email, source, tags
     respuestas:  situacion, zona, presupuesto, plazo, visito_propiedad,
                  que_busca, disposicion_invertir (+ cualquier pregunta nueva,
                  con su `columna` pasada a snake_case)
     lead:        lead_id, ref_whatsapp, ruta, califica, motivo_descalificacion
     atribución:  cta_origen, ctas_sesion, utm_source, utm_medium,
                  utm_campaign, utm_term, utm_content, campaign_id, adset_id,
                  ad_id, placement, fbclid, fbp, fbc, external_id,
                  ft_campaign, ft_adset, ft_ad, ft_fecha, dispositivo, url,
                  referrer
   ========================================================================== */

const FORM_TOKEN = process.env.FORM_TOKEN || "blk_1c8fdfbb46be0a9ec65a444f";

// Columnas del formulario con nombre corto conocido. Las demás se pasan a
// snake_case solas (una pregunta nueva no rompe nada).
const CLAVES = {
  "Situación": "situacion",
  "Zona": "zona",
  "Presupuesto": "presupuesto",
  "Plazo": "plazo",
  "¿Visitó la propiedad?": "visito_propiedad",
  "Qué busca": "que_busca",
  "Disposición a invertir": "disposicion_invertir",
};
/* --- Guardia contra envíos falsos ---------------------------------------
   Origen: se rechaza solo un pedido que viene de OTRO sitio web (un
   formulario o script ajeno que use esta función desde el navegador). El
   sitio propio llama por el mismo dominio, así que su Origin coincide con el
   Host. Sin Origin ni Referer pasa (algunos navegadores no lo mandan): para
   eso está el límite por IP. Hosts extra: variable ALLOWED_HOSTS en Netlify
   (separados por coma). */
const HOSTS_EXTRA = String(process.env.ALLOWED_HOSTS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
function origenPermitido(h) {
  const o = h.origin || h.referer || "";
  if (!o || o === "null") return true;
  let host;
  try { host = new URL(o).hostname.toLowerCase(); } catch (e) { return false; }
  if (host === String(h.host || "").split(":")[0].toLowerCase()) return true;
  if (HOSTS_EXTRA.indexOf(host) >= 0) return true;
  return /(^|\.)blackarquitectura\.com$/.test(host) || /\.netlify\.app$/.test(host) ||
    host === "localhost" || host === "127.0.0.1";
}
/* Límite por IP dentro de cada instancia de la función (se reinicia cuando
   Netlify la recicla). Alto a propósito: varias personas pueden compartir IP
   (datos móviles), y un visitante real nunca llega a este número. */
const VENTANA_MS = 60 * 1000;
const golpes = new Map();
function excedido(ip, max) {
  if (!ip) return false;
  const ahora = Date.now();
  const r = golpes.get(ip);
  if (!r || ahora - r.t > VENTANA_MS) {
    if (golpes.size > 5000) golpes.clear();
    golpes.set(ip, { t: ahora, n: 1 });
    return false;
  }
  r.n += 1;
  return r.n > max;
}
const ipDe = (h) => String(h["x-nf-client-connection-ip"] || h["x-forwarded-for"] || "").split(",")[0].trim();

const snake = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "" };
  const hd = event.headers || {};
  if (!origenPermitido(hd)) return { statusCode: 403, body: "" };
  // 429: form.js deja el envío en la cola y lo reintenta en la próxima carga.
  if (excedido(ipDe(hd), 12)) return { statusCode: 429, body: "" };
  if ((event.body || "").length > 30000) return { statusCode: 413, body: "" };
  const url = process.env.GHL_WEBHOOK_URL;
  if (!url) return { statusCode: 503, body: "sin webhook" };

  let d;
  try { d = JSON.parse(event.body || "{}"); } catch (e) { return { statusCode: 400, body: "json" }; }
  if (d.token !== FORM_TOKEN) return { statusCode: 403, body: "" };
  const f = d.fields;
  if (!f || typeof f !== "object" || !f.lead_id) return { statusCode: 400, body: "fields" };
  if (d.hp) return { statusCode: 200, body: "" }; // honeypot: bot, se descarta en silencio
  // El formulario exige un WhatsApp válido: sin al menos 10 dígitos el envío
  // no viene del sitio. 400 = form.js lo saca de la cola (no se reintenta).
  if (String(f.whatsapp || "").replace(/\D/g, "").length < 10) return { statusCode: 400, body: "whatsapp" };

  const payload = {};
  Object.keys(f).forEach((k) => {
    if (k === "nombre" || k === "whatsapp") return;
    const v = f[k] == null ? "" : String(f[k]).slice(0, 2000);
    payload[CLAVES[k] || (/^[a-z0-9_]+$/.test(k) ? k : snake(k))] = v;
  });

  // "Nombre y apellido" en un solo campo: GHL los tiene separados.
  const partes = String(f.nombre || "").trim().split(/\s+/).filter(Boolean);
  Object.assign(payload, {
    first_name: partes[0] || "",
    last_name: partes.slice(1).join(" "),
    full_name: String(f.nombre || "").trim(),
    phone: f.whatsapp || "",
    email: f.email || "",
    country: "AR",
    source: "Landing Diagnóstico Black",
    tags: ["diagnostico-black", f.califica === "Sí" ? "califica" : "no-califica"],
  });

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) console.error("GHL webhook", r.status, (await r.text()).slice(0, 300));
    return { statusCode: r.ok ? 200 : 502, body: "" };
  } catch (e) {
    console.error("GHL webhook", e);
    return { statusCode: 502, body: "" };
  }
};
