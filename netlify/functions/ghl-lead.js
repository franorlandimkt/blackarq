/* ==========================================================================
   LEADS → GOHIGHLEVEL (subcuenta Black Arquitectura)
   Recibe cada envío del formulario (califique o no) desde form.js y:
     1. Crea o actualiza el contacto (upsert por email/teléfono).
     2. Escribe TODAS las respuestas y la atribución en campos personalizados
        del contacto. Si un campo no existe en la subcuenta, lo crea solo.
     3. Le pone etiquetas (lead-web, califica / no-califica, ruta-…).
     4. Agrega una nota con el resumen completo (queda el historial si la
        misma persona completa el formulario más de una vez).
     5. Si califica, crea la oportunidad en el pipeline (etapa inicial).
        "¿Se vendió?" y el monto se registran en GHL marcando la oportunidad
        como Ganada/Perdida con su valor.

   Variables de entorno en Netlify (Site configuration > Environment variables):
     GHL_TOKEN          token de la Integración Privada de la subcuenta
                        (obligatoria). Permisos: contacts, contacts custom
                        fields (locations/customFields), opportunities.
     GHL_LOCATION_ID    ID de la subcuenta Black Arquitectura (obligatoria).
     GHL_PIPELINE_ID    opcional. Si falta, usa el pipeline cuyo nombre
                        contenga "diagn", "black" o "lead"; si no, el primero.
     GHL_STAGE_ID       opcional. Si falta, la primera etapa del pipeline.
     FORM_TOKEN         opcional; si falta usa el de config.js (sheets.token).

   Prueba de conexión sin crear nada:  GET /.netlify/functions/ghl-lead?check=1
   ========================================================================== */

const API = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";
const FORM_TOKEN = process.env.FORM_TOKEN || "blk_1c8fdfbb46be0a9ec65a444f";

/* Clave del payload → nombre del campo personalizado en GHL.
   Las respuestas del formulario llegan con el nombre de su `columna`
   (form-config.js) y se usan tal cual; esto es para el resto.             */
const ETIQUETAS = {
  lead_id: "Lead ID (web)",
  ref_whatsapp: "Ref. WhatsApp",
  ruta: "Ruta",
  califica: "Califica",
  motivo_descalificacion: "Motivo de descalificación",
  cta_origen: "CTA de origen",
  ctas_sesion: "CTAs de la sesión",
  utm_source: "UTM Source",
  utm_medium: "UTM Medium",
  utm_campaign: "Campaña (utm_campaign)",
  utm_term: "Conjunto (utm_term)",
  utm_content: "Anuncio (utm_content)",
  campaign_id: "Campaign ID",
  adset_id: "Adset ID",
  ad_id: "Ad ID",
  placement: "Ubicación (placement)",
  fbclid: "fbclid",
  fbp: "Meta fbp",
  fbc: "Meta fbc",
  ft_campaign: "Primer toque · campaña",
  ft_adset: "Primer toque · conjunto",
  ft_ad: "Primer toque · anuncio",
  ft_fecha: "Primer toque · fecha",
  dispositivo: "Dispositivo",
  url: "URL de conversión",
  referrer: "Referrer",
};
// Datos del contacto: van a los campos nativos, no a personalizados.
const NATIVOS = ["nombre", "whatsapp", "email"];
const LARGOS = ["Qué busca", "CTAs de la sesión", "URL de conversión", "Referrer", "Motivo de descalificación"];

const json = (status, obj) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

async function ghl(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: {
      Authorization: "Bearer " + process.env.GHL_TOKEN,
      Version: VERSION,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = { raw: txt }; }
  if (!r.ok) {
    const err = new Error("GHL " + method + " " + path + " → " + r.status + " " + txt.slice(0, 300));
    err.status = r.status;
    throw err;
  }
  return data;
}

/* ------------------------------------------------ campos personalizados */
// Caché por instancia caliente de la función: nombre (minúsculas) → id.
let CAMPOS = null;

async function cargarCampos(loc) {
  const d = await ghl("GET", "/locations/" + loc + "/customFields?model=contact");
  CAMPOS = {};
  (d.customFields || []).forEach((c) => { CAMPOS[String(c.name).trim().toLowerCase()] = c.id; });
  return CAMPOS;
}

let CARGANDO = null;
async function idCampo(loc, nombre) {
  if (!CAMPOS) {
    CARGANDO = CARGANDO || cargarCampos(loc).finally(() => { CARGANDO = null; });
    await CARGANDO;
  }
  const k = nombre.trim().toLowerCase();
  if (CAMPOS[k]) return CAMPOS[k];
  try {
    const d = await ghl("POST", "/locations/" + loc + "/customFields", {
      name: nombre,
      dataType: LARGOS.indexOf(nombre) >= 0 ? "LARGE_TEXT" : "TEXT",
      model: "contact",
    });
    const id = (d.customField || d).id;
    if (id) CAMPOS[k] = id;
    return id || null;
  } catch (e) {
    // Otra ejecución pudo haberlo creado al mismo tiempo: releer.
    await cargarCampos(loc);
    return CAMPOS[k] || null;
  }
}

/* ----------------------------------------------------------- pipeline */
let PIPE = null;

async function pipeline(loc) {
  if (PIPE) return PIPE;
  if (process.env.GHL_PIPELINE_ID && process.env.GHL_STAGE_ID) {
    PIPE = { id: process.env.GHL_PIPELINE_ID, stage: process.env.GHL_STAGE_ID, name: "(env)" };
    return PIPE;
  }
  const d = await ghl("GET", "/opportunities/pipelines?locationId=" + loc);
  const lista = d.pipelines || [];
  if (!lista.length) return null;
  const p = lista.find((x) => x.id === process.env.GHL_PIPELINE_ID)
    || lista.find((x) => /diagn|black|lead/i.test(x.name || ""))
    || lista[0];
  const etapas = (p.stages || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
  PIPE = { id: p.id, stage: process.env.GHL_STAGE_ID || (etapas[0] && etapas[0].id), name: p.name };
  return PIPE.stage ? PIPE : null;
}

/* -------------------------------------------------------------- util */
const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function nota(f) {
  const lineas = ["📝 Formulario web — Diagnóstico Black", ""];
  Object.keys(f).forEach((k) => {
    if (NATIVOS.indexOf(k) >= 0 || f[k] === "" || f[k] == null) return;
    lineas.push((ETIQUETAS[k] || k) + ": " + f[k]);
  });
  return lineas.join("\n");
}

/* ----------------------------------------------------------- handler */
exports.handler = async (event) => {
  const loc = process.env.GHL_LOCATION_ID;
  if (!process.env.GHL_TOKEN || !loc) return json(503, { ok: false, error: "faltan GHL_TOKEN / GHL_LOCATION_ID" });

  // Diagnóstico: comprueba token, subcuenta, campos y pipeline sin escribir.
  if (event.httpMethod === "GET") {
    if (!(event.queryStringParameters || {}).check) return json(405, { ok: false });
    try {
      const campos = await cargarCampos(loc);
      const p = await pipeline(loc);
      return json(200, { ok: true, campos_existentes: Object.keys(campos).length, pipeline: p ? p.name : null });
    } catch (e) {
      return json(502, { ok: false, error: e.message });
    }
  }
  if (event.httpMethod !== "POST") return json(405, { ok: false });

  let d;
  try { d = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { ok: false, error: "json" }); }
  if (d.token !== FORM_TOKEN) return json(403, { ok: false });
  if (d.hp) return json(200, { ok: true, spam: true }); // honeypot: se descarta en silencio
  const f = d.fields || {};
  if (!f.lead_id || !(f.whatsapp || f.email)) return json(400, { ok: false, error: "faltan datos" });

  try {
    // 1. Campos personalizados (los que falten se crean en paralelo).
    const claves = Object.keys(f).filter((k) => NATIVOS.indexOf(k) < 0);
    const ids = await Promise.all(claves.map((k) => idCampo(loc, ETIQUETAS[k] || k)));
    const customFields = [];
    claves.forEach((k, i) => {
      if (ids[i] && f[k] !== "" && f[k] != null) customFields.push({ id: ids[i], field_value: String(f[k]) });
    });

    // 2. Contacto.
    const partes = String(f.nombre || "").trim().split(/\s+/).filter(Boolean);
    const contacto = {
      locationId: loc,
      name: String(f.nombre || "").trim() || undefined,
      firstName: partes[0] || undefined,
      lastName: partes.slice(1).join(" ") || undefined,
      email: f.email || undefined,
      phone: f.whatsapp || undefined,
      country: "AR",
      source: "Landing Diagnóstico Black" + (f.utm_campaign ? " · " + f.utm_campaign : ""),
      customFields,
    };
    const up = await ghl("POST", "/contacts/upsert", contacto);
    const c = up.contact || {};
    if (!c.id) throw new Error("upsert sin id: " + JSON.stringify(up).slice(0, 200));

    // Reintento de un envío que ya entró (la cola del navegador lo reenvía
    // si la respuesta no llegó): no duplicar nota ni oportunidad.
    const idLead = CAMPOS[ETIQUETAS.lead_id.toLowerCase()];
    const previo = up.new === false && (c.customFields || []).some((x) => x.id === idLead && x.value === f.lead_id);

    // 3. Etiquetas.
    const tags = ["lead-web", "diagnostico-black", f.califica === "Sí" ? "califica" : "no-califica"];
    if (f.ruta) tags.push("ruta-" + slug(f.ruta));
    await ghl("POST", "/contacts/" + c.id + "/tags", { tags }).catch((e) => console.error(e.message));

    let oportunidad = null;
    if (!previo) {
      // 4. Nota con todo.
      await ghl("POST", "/contacts/" + c.id + "/notes", { body: nota(f) }).catch((e) => console.error(e.message));

      // 5. Oportunidad (solo calificados).
      if (f.califica === "Sí") {
        try {
          const p = await pipeline(loc);
          if (p) {
            const o = await ghl("POST", "/opportunities/", {
              locationId: loc,
              pipelineId: p.id,
              pipelineStageId: p.stage,
              contactId: c.id,
              name: "Diagnóstico Black — " + (f.nombre || f.email || f.whatsapp),
              status: "open",
              source: f.utm_campaign ? "Meta · " + f.utm_campaign : "Web",
            });
            oportunidad = (o.opportunity || o).id || null;
          }
        } catch (e) {
          // Ej.: ya tiene una oportunidad abierta en ese pipeline. El contacto
          // y la nota ya quedaron: no se pierde el lead.
          console.error(e.message);
        }
      }
    }

    return json(200, { ok: true, contactId: c.id, nuevo: !!up.new, oportunidad, duplicado: previo });
  } catch (e) {
    console.error(e.message);
    return json(502, { ok: false, error: "ghl" });
  }
};
