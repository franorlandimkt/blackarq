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
const snake = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "" };
  const url = process.env.GHL_WEBHOOK_URL;
  if (!url) return { statusCode: 503, body: "sin webhook" };

  let d;
  try { d = JSON.parse(event.body || "{}"); } catch (e) { return { statusCode: 400, body: "json" }; }
  if (d.token !== FORM_TOKEN) return { statusCode: 403, body: "" };
  const f = d.fields;
  if (!f || typeof f !== "object" || !f.lead_id) return { statusCode: 400, body: "fields" };
  if (d.hp) return { statusCode: 200, body: "" }; // honeypot: bot, se descarta en silencio

  const payload = {};
  Object.keys(f).forEach((k) => {
    if (k === "nombre" || k === "whatsapp") return;
    const v = f[k] == null ? "" : String(f[k]);
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
