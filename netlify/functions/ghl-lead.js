/* ==========================================================================
   GO HIGH LEVEL (lado servidor)
   Recibe cada envío del formulario desde form.js (califique o no) y lo
   reenvía al disparador "Inbound Webhook" de un Workflow de GHL. La URL del
   webhook no va en el sitio: vive en Netlify, así nadie puede leerla.
   Variables de entorno en Netlify (Site configuration > Environment variables):
     GHL_WEBHOOK_URL   URL del Inbound Webhook del Workflow (obligatoria)
   ========================================================================== */

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "" };
  const url = process.env.GHL_WEBHOOK_URL;
  if (!url) return { statusCode: 503, body: "sin webhook" };

  let d;
  try { d = JSON.parse(event.body || "{}"); } catch (e) { return { statusCode: 400, body: "json" }; }
  const f = d.fields;
  if (!f || typeof f !== "object" || !f.lead_id) return { statusCode: 400, body: "fields" };
  if (d.hp) return { statusCode: 200, body: "" }; // honeypot: bot, se descarta en silencio

  // "Nombre y apellido" en un solo campo: GHL los tiene separados.
  const partes = String(f.nombre || "").trim().split(/\s+/).filter(Boolean);
  const payload = Object.assign({}, f, {
    first_name: partes[0] || "",
    last_name: partes.slice(1).join(" "),
    full_name: String(f.nombre || "").trim(),
    phone: f.whatsapp || "",
    email: f.email || "",
    source: "Landing Diagnóstico Black",
    tags: ["diagnostico-black", f.califica === "Sí" ? "califica" : "no-califica"],
  });

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { statusCode: r.ok ? 200 : 502, body: "" };
  } catch (e) {
    return { statusCode: 502, body: "" };
  }
};
