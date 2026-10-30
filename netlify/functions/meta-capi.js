/* ==========================================================================
   API DE CONVERSIONES DE META (lado servidor)
   Recibe eventos desde form.js y los reenvía a Meta con el mismo event_id
   que el Píxel (Meta deduplica): InitiateCheckout (abre el formulario),
   FormularioPaso (avanza un paso), Lead (envío calificado),
   LeadNoCalifica (envío que no califica), CotizacionVista (ve la pantalla
   con su cotización) y Contact (toca el botón de WhatsApp del resultado).
   Nombre, email y teléfono se hashean acá
   (SHA-256), nunca viajan en claro a Meta.
   Variables de entorno en Netlify (Site configuration > Environment variables):
     META_CAPI_TOKEN   token de acceso de la API de Conversiones (obligatoria)
     META_PIXEL_ID     opcional; si falta usa el de abajo
     META_TEST_CODE    opcional; código de "Probar eventos" para depurar
   ========================================================================== */

const crypto = require("crypto");

const PIXEL_ID = process.env.META_PIXEL_ID || "1638281244623196";
const API = "https://graph.facebook.com/v21.0/";

const EVENTOS = ["Lead", "InitiateCheckout", "FormularioPaso", "LeadNoCalifica", "CotizacionVista", "Contact"];

const sha = (v) => crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "" };
  const token = process.env.META_CAPI_TOKEN;
  if (!token) return { statusCode: 503, body: "sin token" };

  let d;
  try { d = JSON.parse(event.body || "{}"); } catch (e) { return { statusCode: 400, body: "json" }; }
  if (!d.event_id || typeof d.event_id !== "string") return { statusCode: 400, body: "event_id" };
  const nombreEvento = d.event_name || "Lead";
  if (EVENTOS.indexOf(nombreEvento) < 0) return { statusCode: 400, body: "event_name" };
  const custom = { content_name: "Diagnóstico Black" };
  if (d.custom_data && typeof d.custom_data === "object") {
    Object.keys(d.custom_data).slice(0, 15).forEach((k) => {
      const v = d.custom_data[k];
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") custom[k] = v;
    });
  }

  const h = event.headers || {};
  const ip = (h["x-nf-client-connection-ip"] || h["x-forwarded-for"] || "").split(",")[0].trim();

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
  // El email es opcional: vacío o mal escrito no se manda (nunca el hash
  // de un texto vacío).
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
