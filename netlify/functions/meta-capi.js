/* ==========================================================================
   API DE CONVERSIONES DE META (lado servidor)
   Recibe eventos desde form.js y los reenvía a Meta con el mismo event_id
   que el Píxel (Meta deduplica): InitiateCheckout (abre el formulario),
   FormularioPaso (avanza un paso), Lead (envío calificado) y
   LeadNoCalifica (envío que no califica). Nombre, email y teléfono se hashean acá
   (SHA-256), nunca viajan en claro a Meta.
   Variables de entorno en Netlify (Site configuration > Environment variables):
     META_CAPI_TOKEN   token de acceso de la API de Conversiones (obligatoria)
     META_PIXEL_ID     opcional; si falta usa el de abajo
     META_TEST_CODE    opcional; código de "Probar eventos" para depurar
   ========================================================================== */

const crypto = require("crypto");

const PIXEL_ID = process.env.META_PIXEL_ID || "1638281244623196";
const API = "https://graph.facebook.com/v21.0/";

const EVENTOS = ["Lead", "InitiateCheckout", "FormularioPaso", "LeadNoCalifica"];

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

const sha = (v) => crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "" };
  const hd = event.headers || {};
  if (!origenPermitido(hd)) return { statusCode: 403, body: "" };
  if (excedido(ipDe(hd), 120)) return { statusCode: 429, body: "" };
  if ((event.body || "").length > 20000) return { statusCode: 413, body: "" };
  const token = process.env.META_CAPI_TOKEN;
  if (!token) return { statusCode: 503, body: "sin token" };

  let d;
  try { d = JSON.parse(event.body || "{}"); } catch (e) { return { statusCode: 400, body: "json" }; }
  if (!d.event_id || typeof d.event_id !== "string" || d.event_id.length > 100) return { statusCode: 400, body: "event_id" };
  const nombreEvento = d.event_name || "Lead";
  if (EVENTOS.indexOf(nombreEvento) < 0) return { statusCode: 400, body: "event_name" };
  // Lead y LeadNoCalifica solo salen al enviar el formulario, que siempre
  // trae un WhatsApp válido (form.js lo exige). Sin teléfono, no es real.
  if ((nombreEvento === "Lead" || nombreEvento === "LeadNoCalifica") &&
      String(d.telefono || "").replace(/\D/g, "").length < 10) return { statusCode: 400, body: "telefono" };
  const custom = { content_name: "Diagnóstico Black" };
  if (d.custom_data && typeof d.custom_data === "object") {
    Object.keys(d.custom_data).slice(0, 15).forEach((k) => {
      const v = d.custom_data[k];
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") custom[k] = v;
    });
  }

  const h = hd;
  const ip = ipDe(h);

  const user = { client_user_agent: h["user-agent"] || "" };
  if (ip) user.client_ip_address = ip;
  if (d.fbp) user.fbp = String(d.fbp);
  if (d.fbc) user.fbc = String(d.fbc);
  const tel = String(d.telefono || "").replace(/\D/g, "");
  if (tel) user.ph = [sha(tel)];
  // "Nombre y apellido" en un solo campo: Meta los pide por separado
  // (fn = primera palabra, ln = el resto).
  const partes = String(d.nombre || "").trim().split(/\s+/).filter(Boolean);
  if (partes.length) user.fn = [sha(partes[0])];
  if (partes.length > 1) user.ln = [sha(partes.slice(1).join(" "))];
  const em = String(d.email || "").trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) user.em = [sha(em)];
  user.country = [sha("ar")];
  // external_id estable por visitante (lead_id una vez enviado; antes, el
  // id de sesión del formulario) para unir los pasos con el Lead.
  user.external_id = [sha(d.external_id || d.event_id)];

  const payload = {
    data: [{
      event_name: nombreEvento,
      event_time: Math.floor(Date.now() / 1000),
      event_id: d.event_id,
      action_source: "website",
      event_source_url: String(d.url || ""),
      user_data: user,
      custom_data: custom,
    }],
  };
  if (process.env.META_TEST_CODE) payload.test_event_code = process.env.META_TEST_CODE;

  try {
    const r = await fetch(API + PIXEL_ID + "/events?access_token=" + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const txt = await r.text();
    if (!r.ok) console.error("CAPI", r.status, txt);
    return { statusCode: r.ok ? 200 : 502, body: r.ok ? "ok" : "error" };
  } catch (e) {
    console.error("CAPI", e);
    return { statusCode: 502, body: "error" };
  }
};
