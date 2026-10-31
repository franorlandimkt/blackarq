/* ==========================================================================
   VERIFICACIÓN DEL TRACKING (Meta Píxel + API de Conversiones + GA4)
   Levanta site/ en local, simula visitas en un iPhone con el navegador de
   Instagram y comprueba las reglas que tienen que cumplirse siempre:

     - Abrir el formulario manda InitiateCheckout + FormularioPaso paso 1,
       por Píxel y CAPI con el mismo eventID (Meta deduplica).
     - Nunca sale un Lead sin un InitiateCheckout antes en esa visita.
     - El Lead sale una sola vez (doble tap incluido), en el envío, por
       Píxel y CAPI con el mismo eventID, con email/teléfono/nombre por CAPI.
     - Un envío que no califica manda LeadNoCalifica, nunca Lead.
     - Volver de WhatsApp no repite eventos.
     - Retomar el formulario después de recargar vuelve a mandar el paso 1.
     - El fbc armado a mano usa la hora del clic, no la del envío.
     - Volver a entrar a la landing días después NO reenvía el lead a GHL
       (antes se reenviaba y GHL lo tomaba como un contacto nuevo de ese día).
     - Un reenvío real (GHL no confirmó) va marcado reintento = "si" con la
       fecha_envio original; los pendientes viejos (> 7 días o sin fecha) se
       descartan.
   Cotizador (v6):
     - Después del envío (ruta compra): pantalla de carga y después la de
       resultado, que muestra SOLO el rango del caso (ningún otro monto).
       CotizacionVista sale una vez, Píxel y CAPI con el mismo eventID
       (lead_id + "-cot"), con el rango que dice la regla (se prueban las 5
       combinaciones).
     - Contact sale solo al tocar el botón de WhatsApp, una vez aunque se
       toque dos veces (eventID lead_id + "-wa"). Nunca se va a wa.me sin
       ese toque.
     - Ruta reforma: Lead sí, CotizacionVista no, la pantalla no muestra
       montos.
     - Email vacío: el envío pasa, GHL recibe email "" y la función de CAPI
       no manda el hash de un texto vacío.
     - El payload a GHL trae las claves del cotizador y las viejas vacías.
     - Cerrar y volver a abrir muestra el resultado (sin eventos nuevos) y
       no hay forma de cotizar otro caso. Un borrador con las preguntas
       anteriores se descarta.

   Uso (con Playwright instalado, local o global):
     node scripts/verificar-tracking.mjs
   Correrlo antes de publicar cualquier cambio en form.js, site.js o
   form-config.js. Si algo falla, termina con código 1 y dice qué.
   No manda nada a Meta, GHL ni GA4: todo se intercepta.
   ========================================================================== */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch (e) {
  pw = require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}
const { chromium, devices } = pw;

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAIZ = path.join(REPO, "site");
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".avif": "image/avif" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(RAIZ, p);
  if (!f.startsWith(RAIZ) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TIPOS[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
// "localhost" para que GA4 no cargue (index.html lo saltea en local; el
// dataLayer existe igual y se lee desde acá).
const BASE = "http://localhost:" + server.address().port + "/";

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 345.0.0.0";
let fallas = 0;
function ok(cond, msg) {
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) fallas++;
}

const browser = await chromium.launch({ headless: true });

async function visita() {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], userAgent: UA });
  const v = { ctx, capi: [], crm: 0, crmBodies: [], pvImg: 0, wa: 0 };
  await ctx.route("**/*", (route) => {
    const u = route.request().url();
    if (u.includes("/.netlify/functions/meta-capi")) { v.capi.push(JSON.parse(route.request().postData() || "{}")); return route.fulfill({ status: 200, body: "ok" }); }
    if (u.includes("/.netlify/functions/ghl-lead")) { v.crm++; v.crmBodies.push(JSON.parse(route.request().postData() || "{}")); return route.fulfill({ status: 200, body: "" }); }
    if (u.startsWith("https://wa.me/")) { v.wa++; return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>WhatsApp</body></html>" }); }
    // PageView por píxel de imagen (sale desde el <head>, sin fbevents.js).
    if (u.startsWith("https://www.facebook.com/tr") && /[?&]ev=PageView/.test(u)) v.pvImg++;
    if (u.startsWith(BASE)) return route.continue();
    return route.abort(); // fbevents, fuentes, etc.: sin red
  });
  v.page = await ctx.newPage();
  // Copia de cada llamada a fbq, que sobrevive a la cola interna del Píxel.
  await v.page.addInitScript(() => {
    window.__fbq = [];
    let real;
    Object.defineProperty(window, "fbq", {
      configurable: true,
      get() { return real; },
      set(f) {
        real = function () { window.__fbq.push(JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments)))); return f.apply(this, arguments); };
        Object.assign(real, f);
        real.queue = f.queue;
      },
    });
  });
  v.fbq = () => v.page.evaluate(() => window.__fbq.filter((a) => a[0] !== "init").map((a) => ({ ev: a[1], id: (a[3] || {}).eventID || "", data: a[2] || {} })));
  // Eventos de GA4 (dataLayer), sin las funciones de callback.
  v.ga = () => v.page.evaluate(() => (window.dataLayer || []).filter((a) => a && a[0] === "event").map((a) => {
    const p = {};
    Object.keys(a[2] || {}).forEach((k) => { if (typeof a[2][k] !== "function") p[k] = a[2][k]; });
    return { ev: a[1], p };
  }));
  return v;
}

async function abrirDesdeCta(page) {
  await page.waitForFunction(() => !!window.BlackForm);
  await page.locator('[data-cta="cta_hero"]').click();
  await page.waitForSelector("#modal:not([hidden])");
}

// Respuestas por paso: texto de la opción (única) o lista de textos (múltiple).
const MOMENTO_COMPRA = "Encontré una propiedad y estoy por ofertar o ya reservé";
const MOMENTO_REFORMA = "Ya es mía y quiero reformarla";
const D_ESTADO = "No sé en qué estado real está (humedades, instalaciones, estructura)";
const D_PRECIO = "No sé si el precio que piden es el correcto";
const D_DOCS = "No sé si los planos y la documentación están en regla";
const PLAN_COMPRA = [MOMENTO_COMPRA, "Una", "CABA", [D_ESTADO], "Tengo que ofertar esta semana"]; // rango 2
const PLAN_NO_CALIFICA = [MOMENTO_REFORMA, "Puntual (baño, cocina, un ambiente)", "CABA", [D_ESTADO], "Sin apuro todavía"];
const PLAN_REFORMA = [MOMENTO_REFORMA, "Integral o ampliación", "Zona Norte", [D_ESTADO, D_DOCS], "En los próximos 15 días"];

async function responder(page, plan) {
  for (const r of plan) {
    if (Array.isArray(r)) {
      for (const t of r) await page.locator("label.f-op", { hasText: t }).click();
      await page.locator(".f-nav .btn-1").click();
    } else {
      await page.getByRole("radio", { name: r, exact: true }).click();
    }
    await page.waitForTimeout(400);
  }
}

async function completar(page, { plan = PLAN_COMPRA, dobleTap = false, email = "ana@prueba.com" } = {}) {
  // Responde lo que falte desde el paso en el que está (retomar borrador).
  const n = Number(((await page.textContent("[data-form-paso]")) || "").match(/Paso (\d+)/)?.[1] || 1);
  await responder(page, plan.slice(n - 1));
  await page.waitForSelector("#f-nombre");
  await page.fill("#f-nombre", "Ana Prueba");
  await page.fill("#f-whatsapp", "11 6480 3777");
  await page.fill("#f-email", email);
  const btn = page.locator('form.f-paso button[type="submit"]');
  if (dobleTap) {
    await page.evaluate(() => { const f = document.querySelector("form.f-paso"); f.requestSubmit(); f.requestSubmit(); });
  } else {
    await btn.click();
  }
}

/** Espera la pantalla de resultado (después de la carga). */
async function esperarResultado(page) {
  await page.waitForSelector(".f-final", { timeout: 6000 });
}

const n = (lista, ev) => lista.filter((x) => (x.ev || x.event_name) === ev);

// ---------------------------------------------------------------- 1
console.log("\n1. Visita desde anuncio → completa → califica → toca WhatsApp");
{
  const v = await visita();
  await v.page.goto(BASE + "?utm_source=fb&fbclid=CLICK123");
  const llegada = Date.now();
  // Lee la landing unos segundos antes de abrir: el fbc tiene que quedar con
  // la hora de llegada, no con la de este momento.
  await v.page.waitForTimeout(6000);
  await abrirDesdeCta(v.page);
  const alAbrir = await v.fbq();
  ok(n(alAbrir, "InitiateCheckout").length === 1, "InitiateCheckout al abrir (Píxel)");
  ok(alAbrir.some((x) => x.ev === "FormularioPaso" && x.data.paso === 1), "FormularioPaso paso 1 al abrir (Píxel)");
  const icCapi = n(v.capi, "InitiateCheckout")[0];
  ok(icCapi && icCapi.event_id === n(alAbrir, "InitiateCheckout")[0].id, "InitiateCheckout por CAPI con el mismo eventID");
  ok(icCapi && /^fb\.1\.\d+\.CLICK123$/.test(icCapi.fbc), "fbc presente en el InitiateCheckout");
  if (icCapi) {
    const t = Number(icCapi.fbc.split(".")[2]);
    ok(Math.abs(t - llegada) < 3000, "fbc con la hora del clic, no la del evento");
  }
  await v.page.waitForTimeout(1500);
  await completar(v.page);
  const hayCarga = await v.page.waitForSelector(".f-carga", { timeout: 2000 }).then(() => true, () => false);
  const enCarga = await v.fbq();
  ok(hayCarga && (await v.page.locator(".f-carga-barra").count()) === 1, "pantalla de carga (con barra) después del envío");
  ok(n(enCarga, "Lead").length === 1 && n(enCarga, "CotizacionVista").length === 0, "el Lead sale en el envío, antes de la cotización");
  await esperarResultado(v.page);
  await v.page.waitForTimeout(300);
  const fbq = await v.fbq();
  const leadsPx = n(fbq, "Lead"), leadsCapi = n(v.capi, "Lead");
  ok(leadsPx.length === 1 && leadsCapi.length === 1, "un Lead por Píxel y uno por CAPI");
  ok(leadsPx[0] && leadsCapi[0] && leadsPx[0].id === leadsCapi[0].event_id, "Lead con el mismo eventID en Píxel y CAPI");
  ok(fbq.findIndex((x) => x.ev === "InitiateCheckout") < fbq.findIndex((x) => x.ev === "Lead"), "InitiateCheckout antes que el Lead");
  ok(leadsCapi[0] && leadsCapi[0].email && leadsCapi[0].telefono && leadsCapi[0].nombre, "Lead por CAPI con email, teléfono y nombre");
  ok(leadsPx[0] && leadsPx[0].data.propiedades === "Una" && leadsPx[0].data.rango === "2" && !!leadsPx[0].data.urgencia && !("presupuesto" in leadsPx[0].data), "Lead con propiedades, rango y urgencia (sin presupuesto ni plazo)");
  const cotPx = n(fbq, "CotizacionVista"), cotCapi = n(v.capi, "CotizacionVista");
  ok(cotPx.length === 1 && cotCapi.length === 1, "CotizacionVista una vez por Píxel y una por CAPI");
  ok(cotPx[0] && cotCapi[0] && cotPx[0].id === cotCapi[0].event_id && cotPx[0].id === leadsPx[0].id + "-cot", "CotizacionVista con el mismo eventID (lead_id-cot)");
  ok(v.crm === 1, "un envío a GoHighLevel");
  await v.page.waitForTimeout(3000);
  ok(v.wa === 0 && !/wa\.me/.test(v.page.url()), "no va a WhatsApp sin tocar el botón");
  ok(n(await v.fbq(), "Contact").length === 0 && n(v.capi, "Contact").length === 0, "sin Contact antes del toque");

  await v.page.locator(".f-final a.btn").click();
  await v.page.waitForURL(/wa\.me/, { timeout: 4000 }).catch(() => {});
  ok(/wa\.me/.test(v.page.url()), "el botón lleva a WhatsApp");
  const contactCapi = n(v.capi, "Contact");
  ok(contactCapi.length === 1 && contactCapi[0].event_id === leadsPx[0].id + "-wa", "Contact por CAPI con eventID lead_id-wa");
  const waUrl = decodeURIComponent(v.page.url());
  ok(/Rango estimado: \$500\.000 – \$900\.000/.test(waUrl) && /Propiedades: Una/.test(waUrl) && /Ref\. BLK-/.test(waUrl), "mensaje de WhatsApp con propiedades, rango y referencia");

  const antes = v.capi.length;
  await v.page.goBack();
  await v.page.waitForTimeout(1500);
  ok(v.capi.length === antes && n(await v.fbq(), "Lead").length === 0, "volver de WhatsApp no repite eventos");
  await v.ctx.close();
}

// ---------------------------------------------------------------- 2
console.log("\n2. Doble tap en Enviar y en el botón de WhatsApp");
{
  const v = await visita();
  await v.page.goto(BASE);
  await abrirDesdeCta(v.page);
  await completar(v.page, { dobleTap: true });
  await esperarResultado(v.page);
  await v.page.waitForTimeout(300);
  ok(n(v.capi, "Lead").length === 1, "un solo Lead");
  ok(v.crm === 1, "un solo envío a GoHighLevel");
  // Doble toque en el botón de WhatsApp: un solo Contact.
  const pxAntes = await v.fbq();
  await v.page.evaluate(() => { const a = document.querySelector(".f-final a.btn"); a.click(); a.click(); });
  await v.page.waitForTimeout(150);
  const px = n((await v.fbq().catch(() => pxAntes)), "Contact");
  ok(px.length === 1, "un solo Contact por Píxel aunque toque dos veces");
  await v.page.waitForURL(/wa\.me/, { timeout: 4000 }).catch(() => {});
  ok(n(v.capi, "Contact").length === 1, "un solo Contact por CAPI");
  await v.ctx.close();
}

// ---------------------------------------------------------------- 3
console.log("\n3. No califica");
{
  const v = await visita();
  await v.page.goto(BASE);
  await abrirDesdeCta(v.page);
  await completar(v.page, { plan: PLAN_NO_CALIFICA });
  await v.page.waitForTimeout(800);
  const fbq = await v.fbq();
  ok(n(fbq, "Lead").length === 0 && n(v.capi, "Lead").length === 0, "no manda Lead");
  ok(n(fbq, "LeadNoCalifica").length === 1 && n(v.capi, "LeadNoCalifica").length === 1, "manda LeadNoCalifica (Píxel y CAPI)");
  ok(n(fbq, "CotizacionVista").length === 0, "sin CotizacionVista");
  ok(v.crm === 1, "igual va a GoHighLevel");
  ok(await v.page.locator(".f-final a[href*='instagram']").count() === 1, "pantalla con Instagram");
  await v.ctx.close();
}

// ---------------------------------------------------------------- 4
console.log("\n4. Recarga a mitad del formulario y retoma");
{
  const v = await visita();
  await v.page.goto(BASE);
  await abrirDesdeCta(v.page);
  await responder(v.page, PLAN_COMPRA.slice(0, 3));
  await v.page.reload();
  v.capi.length = 0;
  await abrirDesdeCta(v.page);
  const fbq = await v.fbq();
  ok(/Paso 4 de 6/.test(await v.page.textContent("[data-form-paso]")), "retoma en el paso 4 de 6");
  ok(n(fbq, "InitiateCheckout").length === 1 && n(v.capi, "InitiateCheckout").length === 1, "InitiateCheckout de nuevo");
  ok(fbq.some((x) => x.ev === "FormularioPaso" && x.data.paso === 1), "FormularioPaso paso 1 de nuevo (Píxel)");
  ok(v.capi.some((x) => x.event_name === "FormularioPaso" && x.custom_data.paso === 1), "FormularioPaso paso 1 de nuevo (CAPI)");
  await v.page.waitForTimeout(800);
  await completar(v.page);
  await esperarResultado(v.page);
  ok(n(v.capi, "Lead").length === 1, "el Lead llega igual");
  await v.ctx.close();
}

// ---------------------------------------------------------------- 5
console.log("\n5. Entrada directa con #diagnostico");
{
  const v = await visita();
  await v.page.goto(BASE + "#diagnostico");
  await v.page.waitForSelector("#modal:not([hidden])");
  await v.page.waitForTimeout(300);
  const fbq = await v.fbq();
  ok(n(fbq, "InitiateCheckout").length === 1, "InitiateCheckout");
  ok(fbq.some((x) => x.ev === "FormularioPaso" && x.data.paso === 1), "FormularioPaso paso 1");
  await v.ctx.close();
}

// ---------------------------------------------------------------- 6
console.log("\n6. Abrir, cerrar y volver a abrir sin enviar");
{
  const v = await visita();
  await v.page.goto(BASE);
  await abrirDesdeCta(v.page);
  await v.page.locator(".modal-x").click();
  await v.page.waitForSelector("#modal[hidden]", { state: "attached" });
  await abrirDesdeCta(v.page);
  const fbq = await v.fbq();
  ok(n(fbq, "InitiateCheckout").length === 1, "un solo InitiateCheckout por visita");
  ok(v.pvImg === 1 && n(fbq, "PageView").length === 0, "un solo PageView, por píxel de imagen (abrir/cerrar no suma páginas)");
  await v.ctx.close();
}

// ---------------------------------------------------------------- 7
console.log("\n7. Completa, va a WhatsApp y días después vuelve a entrar");
{
  const v = await visita();
  const envios = [];
  // La función de Netlify + GHL tardan ~0,7 s en responder (como en producción).
  await v.ctx.route("**/.netlify/functions/ghl-lead", async (route) => {
    envios.push(JSON.parse(route.request().postData() || "{}").fields || {});
    await new Promise((r) => setTimeout(r, 700));
    return route.fulfill({ status: 200, body: "" });
  });
  await v.page.goto(BASE);
  await abrirDesdeCta(v.page);
  await completar(v.page);
  await esperarResultado(v.page);
  await v.page.locator(".f-final a.btn").click();
  await v.page.waitForURL(/wa\.me/, { timeout: 4000 }).catch(() => {});
  ok(envios.length === 1 && envios[0].reintento === "no" && !!envios[0].fecha_envio, "un envío a GHL con fecha_envio y reintento = no");
  const p2 = await v.ctx.newPage();
  await p2.goto(BASE);
  await p2.waitForTimeout(2500);
  ok(envios.length === 1, "volver a entrar no reenvía el lead a GHL");
  await v.ctx.close();
}

// ---------------------------------------------------------------- 8
console.log("\n8. Pendientes viejos en el celular");
{
  const v = await visita();
  const envios = [];
  await v.ctx.route("**/.netlify/functions/ghl-lead", (route) => {
    envios.push(JSON.parse(route.request().postData() || "{}").fields || {});
    return route.fulfill({ status: 200, body: "" });
  });
  await v.page.addInitScript(() => {
    if (sessionStorage.getItem("seed")) return;
    sessionStorage.setItem("seed", "1");
    const body = (id) => JSON.stringify({ token: "x", hp: "", fields: { lead_id: id, reintento: "no" } });
    localStorage.setItem("black:crm_cola", JSON.stringify([
      { id: "sin-fecha", body: body("sin-fecha") },                                       // código viejo
      { id: "viejo", t: Date.now() - 8 * 24 * 3600e3, body: body("viejo") },              // > 7 días
      { id: "reciente", t: Date.now() - 3600e3, body: body("reciente") },                 // 1 h
    ]));
  });
  await v.page.goto(BASE);
  await v.page.waitForTimeout(2500);
  ok(envios.length === 1 && envios[0].lead_id === "reciente", "solo se reintenta el pendiente reciente");
  ok(envios[0] && envios[0].reintento === "si", "el reintento va marcado reintento = si");
  await v.ctx.close();
}

// ---------------------------------------------------------------- 9
console.log("\n9. Rango de la cotización según la regla");
{
  const casos = [
    { nombre: "1 propiedad sin dudas de estado ni papeles", prop: "Una", dudas: [D_PRECIO], rango: "1", min: 300000, max: 500000 },
    { nombre: "1 propiedad + estado (visita)", prop: "Una", dudas: [D_ESTADO], rango: "2", min: 500000, max: 900000 },
    { nombre: "2 propiedades + papeles", prop: "Dos", dudas: [D_DOCS], rango: "3", min: 900000, max: 1400000 },
    { nombre: "Todavía no sé", prop: "Todavía no sé, quiero que me asesoren", dudas: [D_PRECIO], rango: "2", min: 500000, max: 900000 },
    { nombre: "Cuatro o más", prop: "Cuatro o más", dudas: [D_PRECIO], rango: "3", min: 900000, max: 1400000 },
  ];
  for (const c of casos) {
    const v = await visita();
    await v.page.goto(BASE);
    await abrirDesdeCta(v.page);
    await completar(v.page, { plan: [MOMENTO_COMPRA, c.prop, "CABA", c.dudas, "Sin apuro todavía"] });
    await esperarResultado(v.page);
    await v.page.waitForTimeout(300);
    const cot = n(await v.fbq(), "CotizacionVista")[0];
    const cotCapi = n(v.capi, "CotizacionVista")[0];
    const ga = n(await v.ga(), "cotizacion_vista")[0];
    const f = (v.crmBodies[0] || {}).fields || {};
    const mio = await v.page.locator(".f-incluye").textContent();
    // Solo su rango: en pantalla tienen que aparecer su mínimo y su máximo y
    // ningún otro monto (los otros packs no se muestran).
    const pesos = (x) => "$" + String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const montos = [...new Set(((await v.page.locator(".modal-body").innerText()).match(/\$[\d.]+\d/g) || []))].sort();
    const texto = await v.page.locator(".modal-body").innerText();
    ok(montos.join(" ") === [pesos(c.min), pesos(c.max)].sort().join(" ") && !/Lorena|devolvemos|Te responde|otro caso/i.test(texto),
      c.nombre + ": muestra solo su rango (" + montos.join(" y ") + " · " + mio + ")");
    ok(cot && cot.data.rango === c.rango && cot.data.cotizacion_min === c.min && cot.data.cotizacion_max === c.max
      && cotCapi && cotCapi.custom_data.rango === c.rango && cotCapi.event_id === cot.id
      && ga && ga.p.rango === c.rango
      && f.rango === c.rango && f.cotizacion_min === String(c.min) && f.cotizacion_max === String(c.max),
      c.nombre + " → rango " + c.rango + " (Píxel, CAPI, GA4 y GHL)");
    await v.ctx.close();
  }
}

// ---------------------------------------------------------------- 10
console.log("\n10. Ruta reforma");
{
  const v = await visita();
  await v.page.goto(BASE);
  await abrirDesdeCta(v.page);
  await completar(v.page, { plan: PLAN_REFORMA });
  await esperarResultado(v.page);
  await v.page.waitForTimeout(300);
  const fbq = await v.fbq();
  ok(n(fbq, "Lead").length === 1 && n(v.capi, "Lead").length === 1, "manda Lead");
  ok(n(fbq, "CotizacionVista").length === 0 && n(v.capi, "CotizacionVista").length === 0, "sin CotizacionVista");
  const txt = await v.page.locator(".modal-body").innerText();
  ok(!/\$\s?\d/.test(txt) && (await v.page.locator(".f-incluye").count()) === 0, "la pantalla no muestra montos");
  const f = (v.crmBodies[0] || {}).fields || {};
  ok(f.rango === "" && f.cotizacion_texto === "" && f["Tipo de reforma"] === "Integral o ampliación", "GHL: rango vacío y tipo de reforma");
  await v.page.locator(".f-final a.btn").click();
  await v.page.waitForURL(/wa\.me/, { timeout: 4000 }).catch(() => {});
  const waUrl = decodeURIComponent(v.page.url());
  ok(/Reforma: Integral o ampliación\./.test(waUrl) && !/Rango estimado/.test(waUrl) && !/Propiedades:/.test(waUrl), "mensaje de WhatsApp con la reforma, sin rango ni propiedades");
  ok(n(v.capi, "Contact").length === 1, "Contact al tocar el botón");
  await v.ctx.close();
}

// ---------------------------------------------------------------- 11
console.log("\n11. Email vacío y payload a GHL");
{
  const v = await visita();
  await v.page.goto(BASE + "?utm_source=meta&utm_campaign=C1&campaign_id=11&adset_id=22&ad_id=33&placement=ig&fbclid=CLK");
  await abrirDesdeCta(v.page);
  await completar(v.page, { email: "", plan: [MOMENTO_COMPRA, "Dos", "Zona Oeste", [D_ESTADO, D_DOCS], "En los próximos 15 días"] });
  await esperarResultado(v.page);
  const f = (v.crmBodies[0] || {}).fields || {};
  ok(v.crm === 1 && f.email === "", "el envío pasa sin email y GHL recibe email vacío");
  const lead = n(v.capi, "Lead")[0];
  ok(lead && lead.email === "", "CAPI recibe email vacío desde el navegador");
  const claves = ["rango", "rango_nombre", "cotizacion_min", "cotizacion_max", "cotizacion_texto", "necesita_visita", "revision_documental",
    "Momento", "Propiedades", "Zona", "Dudas", "Urgencia"];
  ok(claves.every((k) => k in f), "GHL trae las claves del cotizador");
  ok(f.cotizacion_texto === "$900.000 – $1.400.000" && f.necesita_visita === "Sí" && f.revision_documental === "Sí", "cotizacion_texto con formato y visita/revisión documental");
  const viejas = ["presupuesto", "plazo", "visito_propiedad", "que_busca", "disposicion_invertir"];
  ok(viejas.every((k) => f[k] === ""), "GHL trae las claves viejas vacías");
  ok(["utm_source", "utm_campaign", "campaign_id", "adset_id", "ad_id", "placement", "fbclid", "fbp", "fbc", "external_id", "cta_origen", "ctas_sesion"].every((k) => k in f)
    && f.campaign_id === "11" && /CLK$/.test(f.fbc), "atribución completa en el payload");
  ok(/traslados se cotizan aparte/.test(await v.page.locator(".f-incluye").textContent()), "fuera de CABA suma la línea de traslados");
  await v.ctx.close();

  // La función de CAPI con email vacío: no manda `em` (ni el hash de "").
  process.env.META_CAPI_TOKEN = "prueba";
  const enviados = [];
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { enviados.push(JSON.parse(opts.body)); return { ok: true, status: 200, text: async () => "{}" }; };
  const capi = require(path.join(REPO, "netlify/functions/meta-capi.js"));
  const r1 = await capi.handler({ httpMethod: "POST", headers: {}, body: JSON.stringify({ event_name: "Lead", event_id: "x", email: "", telefono: "5491164803777", nombre: "Ana Prueba" }) });
  const r2 = await capi.handler({ httpMethod: "POST", headers: {}, body: JSON.stringify({ event_name: "CotizacionVista", event_id: "x-cot", email: "ana@prueba.com" }) });
  const r3 = await capi.handler({ httpMethod: "POST", headers: {}, body: JSON.stringify({ event_name: "Contact", event_id: "x-wa" }) });
  globalThis.fetch = fetchReal;
  const u1 = enviados[0] && enviados[0].data[0].user_data;
  ok(r1.statusCode === 200 && u1 && !("em" in u1) && u1.ph, "meta-capi: con email vacío no manda em");
  ok(r2.statusCode === 200 && enviados[1] && enviados[1].data[0].user_data.em, "meta-capi: con email, manda em hasheado");
  ok(r3.statusCode === 200, "meta-capi acepta CotizacionVista y Contact");
}

// ---------------------------------------------------------------- 12
console.log("\n12. Cerrar y volver a abrir después de enviar");
{
  const v = await visita();
  await v.page.goto(BASE);
  await abrirDesdeCta(v.page);
  await completar(v.page);
  await esperarResultado(v.page);
  await v.page.waitForTimeout(300);
  const antes = (await v.fbq()).length, antesCapi = v.capi.length;
  await v.page.locator(".modal-x").click();
  await v.page.waitForSelector("#modal[hidden]", { state: "attached" });
  await abrirDesdeCta(v.page);
  await v.page.waitForTimeout(300);
  ok(await v.page.locator(".f-incluye").count() === 1, "vuelve a ver su cotización");
  ok((await v.fbq()).length === antes && v.capi.length === antesCapi, "sin eventos nuevos (ni InitiateCheckout ni CotizacionVista)");
  ok(!/otro caso/i.test(await v.page.locator(".modal-body").innerText()) && (await v.page.locator(".f-final button").count()) === 0,
    "no hay opción de cotizar otro caso");
  await v.ctx.close();
}

// ---------------------------------------------------------------- 13
console.log("\n13. Cierra durante la carga");
{
  const v = await visita();
  await v.page.goto(BASE);
  await abrirDesdeCta(v.page);
  await completar(v.page);
  await v.page.waitForSelector(".f-carga");
  await v.page.locator(".modal-x").click();
  await v.page.waitForTimeout(2500);
  ok(n(await v.fbq(), "CotizacionVista").length === 0, "sin CotizacionVista si no la vio");
  await abrirDesdeCta(v.page);
  await v.page.waitForTimeout(300);
  ok(n(await v.fbq(), "CotizacionVista").length === 1 && await v.page.locator(".f-incluye").count() === 1, "al volver a abrir ve la cotización y sale CotizacionVista");
  await v.ctx.close();
}

// ---------------------------------------------------------------- 14
console.log("\n14. Borrador con las preguntas anteriores");
{
  const v = await visita();
  await v.page.addInitScript(() => {
    if (sessionStorage.getItem("seed")) return;
    sessionStorage.setItem("seed", "1");
    sessionStorage.setItem("black:form", JSON.stringify({
      r: { situacion: "Estoy comparando entre 2 o más propiedades", zona: "CABA", presupuesto_compra: "USD 120.000 – 180.000", plazo: "Esta semana" },
      otros: {}, d: { nombre: "Viejo" }, i: 4,
    }));
  });
  const errores = [];
  v.page.on("pageerror", (e) => errores.push(e.message));
  await v.page.goto(BASE);
  await abrirDesdeCta(v.page);
  ok(/Paso 1 de 6/.test(await v.page.textContent("[data-form-paso]")) && await v.page.locator(".f-intro").count() === 1, "se descarta y arranca de cero");
  await completar(v.page);
  await esperarResultado(v.page);
  ok(errores.length === 0 && n(v.capi, "Lead").length === 1, "el envío funciona sin errores");
  await v.ctx.close();
}

// ---------------------------------------------------------------- 15
console.log("\n15. Landing: CTA de atribución y sin garantía de devolución");
{
  const v = await visita();
  await v.page.goto(BASE);
  await v.page.waitForFunction(() => !!window.BlackForm);
  const ctas = await v.page.evaluate(() => [...document.querySelectorAll("[data-cta]")].map((a) => a.getAttribute("data-cta") + ":" + a.textContent.trim()));
  const ids = ["cta_header", "cta_hero", "cta_problema", "cta_solucion", "cta_incluye", "cta_pasos", "cta_casos", "cta_garantia", "cta_faq", "cta_cierre", "cta_sticky"];
  ok(ids.every((id) => ctas.some((c) => c === id + ":Quiero saber cuánto sale")) && ctas.length === ids.length, "los 11 CTA con su ID y \"Quiero saber cuánto sale\"");
  const html = await v.page.content();
  ok(!/devolvemos|devoluci[oó]n/i.test(html), "ninguna mención a la devolución del dinero (texto ni schema)");
  // Cada CTA abre el formulario y deja su ID como cta_origen.
  await v.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await v.page.waitForTimeout(400);
  await v.page.locator('[data-cta="cta_garantia"]').click();
  await v.page.waitForSelector("#modal:not([hidden])");
  const ic = n(v.capi, "InitiateCheckout")[0];
  ok(ic && ic.custom_data.cta_origen === "cta_garantia", "un CTA intermedio abre el formulario con su cta_origen");
  await v.ctx.close();
}

await browser.close();
server.close();
console.log(fallas ? "\n✗ " + fallas + " comprobación(es) fallaron." : "\n✓ Todo el tracking se comporta como debe.");
process.exit(fallas ? 1 : 0);
