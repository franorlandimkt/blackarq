/* ==========================================================================
   VERIFICACIÓN DEL TRACKING (Meta Píxel + API de Conversiones + GA4)
   Levanta site/ en local, simula visitas en un iPhone con el navegador de
   Instagram y comprueba las reglas que tienen que cumplirse siempre:

     - Abrir el formulario manda InitiateCheckout + FormularioPaso paso 1,
       por Píxel y CAPI con el mismo eventID (Meta deduplica).
     - Nunca sale un Lead sin un InitiateCheckout antes en esa visita.
     - El Lead sale una sola vez (doble tap incluido), por Píxel y CAPI con
       el mismo eventID, con email/teléfono/nombre por CAPI.
     - Un envío que no califica manda LeadNoCalifica, nunca Lead.
     - Volver de WhatsApp no repite eventos.
     - Retomar el formulario después de recargar vuelve a mandar el paso 1.
     - El fbc armado a mano usa la hora del clic, no la del envío.
     - Volver a entrar a la landing días después NO reenvía el lead a GHL
       (antes se reenviaba y GHL lo tomaba como un contacto nuevo de ese día).
     - Un reenvío real (GHL no confirmó) va marcado reintento = "si" con la
       fecha_envio original; los pendientes viejos (> 7 días o sin fecha) se
       descartan.

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

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "site");
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
// "localhost" para que GA4 no cargue (index.html lo saltea en local).
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
  const v = { ctx, capi: [], crm: 0, pvImg: 0 };
  await ctx.route("**/*", (route) => {
    const u = route.request().url();
    if (u.includes("/.netlify/functions/meta-capi")) { v.capi.push(JSON.parse(route.request().postData() || "{}")); return route.fulfill({ status: 200, body: "ok" }); }
    if (u.includes("/.netlify/functions/ghl-lead")) { v.crm++; return route.fulfill({ status: 200, body: "" }); }
    if (u.startsWith("https://wa.me/")) return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>WhatsApp</body></html>" });
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
  return v;
}

async function abrirDesdeCta(page) {
  await page.waitForFunction(() => !!window.BlackForm);
  await page.locator('[data-cta="cta_hero"]').click();
  await page.waitForSelector("#modal:not([hidden])");
}

async function completar(page, { noCalifica = false, dobleTap = false } = {}) {
  for (let k = 0; k < 15; k++) {
    if (await page.locator("#f-nombre").count()) break;
    if (await page.locator(".f-op-multi").count()) {
      await page.locator(".f-op-multi").first().click();
      await page.locator(".f-nav .btn-1").click();
    } else {
      const no = page.locator(".f-op", { hasText: "información gratuita" });
      if (noCalifica && await no.count()) await no.click();
      else await page.locator(".f-op").first().click();
    }
    await page.waitForTimeout(400);
  }
  await page.fill("#f-nombre", "Ana Prueba");
  await page.fill("#f-whatsapp", "11 6480 3777");
  await page.fill("#f-email", "ana@prueba.com");
  const btn = page.locator('form.f-paso button[type="submit"]');
  if (dobleTap) {
    await page.evaluate(() => { const f = document.querySelector("form.f-paso"); f.requestSubmit(); f.requestSubmit(); });
  } else {
    await btn.click();
  }
}

/** Lo que se lee del Píxel antes de que la página salte a WhatsApp. */
async function capturarAntesDeSalir(v, accion) {
  let snap = [];
  const leer = async () => { try { snap = await v.fbq(); } catch (e) { /* navegó */ } };
  await accion();
  await leer();
  await v.page.waitForURL(/wa\.me|localhost/, { timeout: 3000 }).catch(() => {});
  return snap;
}

const n = (lista, ev) => lista.filter((x) => (x.ev || x.event_name) === ev);

// ---------------------------------------------------------------- 1
console.log("\n1. Visita desde anuncio → completa → califica");
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
    ok(Math.abs(t - llegada) < 3000,"fbc con la hora del clic, no la del evento");
  }
  await v.page.waitForTimeout(1500);
  const fbq = await capturarAntesDeSalir(v, () => completar(v.page));
  await v.page.waitForTimeout(800);
  const leadsPx = n(fbq, "Lead"), leadsCapi = n(v.capi, "Lead");
  ok(leadsPx.length === 1 && leadsCapi.length === 1, "un Lead por Píxel y uno por CAPI");
  ok(leadsPx[0] && leadsCapi[0] && leadsPx[0].id === leadsCapi[0].event_id, "Lead con el mismo eventID en Píxel y CAPI");
  ok(fbq.findIndex((x) => x.ev === "InitiateCheckout") < fbq.findIndex((x) => x.ev === "Lead"), "InitiateCheckout antes que el Lead");
  ok(leadsCapi[0] && leadsCapi[0].email && leadsCapi[0].telefono && leadsCapi[0].nombre, "Lead por CAPI con email, teléfono y nombre");
  ok(v.crm === 1, "un envío a GoHighLevel");
  ok(/wa\.me/.test(v.page.url()), "redirige a WhatsApp");

  const antes = v.capi.length;
  await v.page.goBack();
  await v.page.waitForTimeout(1500);
  ok(v.capi.length === antes && n(await v.fbq(), "Lead").length === 0, "volver de WhatsApp no repite eventos");
  await v.ctx.close();
}

// ---------------------------------------------------------------- 2
console.log("\n2. Doble tap en Enviar");
{
  const v = await visita();
  await v.page.goto(BASE);
  await abrirDesdeCta(v.page);
  await capturarAntesDeSalir(v, () => completar(v.page, { dobleTap: true }));
  await v.page.waitForTimeout(800);
  ok(n(v.capi, "Lead").length === 1, "un solo Lead");
  ok(v.crm === 1, "un solo envío a GoHighLevel");
  await v.ctx.close();
}

// ---------------------------------------------------------------- 3
console.log("\n3. No califica");
{
  const v = await visita();
  await v.page.goto(BASE);
  await abrirDesdeCta(v.page);
  await completar(v.page, { noCalifica: true });
  await v.page.waitForTimeout(800);
  const fbq = await v.fbq();
  ok(n(fbq, "Lead").length === 0 && n(v.capi, "Lead").length === 0, "no manda Lead");
  ok(n(fbq, "LeadNoCalifica").length === 1 && n(v.capi, "LeadNoCalifica").length === 1, "manda LeadNoCalifica (Píxel y CAPI)");
  ok(v.crm === 1, "igual va a GoHighLevel");
  await v.ctx.close();
}

// ---------------------------------------------------------------- 4
console.log("\n4. Recarga a mitad del formulario y retoma");
{
  const v = await visita();
  await v.page.goto(BASE);
  await abrirDesdeCta(v.page);
  for (let k = 0; k < 3; k++) { await v.page.locator(".f-op").first().click(); await v.page.waitForTimeout(400); }
  await v.page.reload();
  v.capi.length = 0;
  await abrirDesdeCta(v.page);
  const fbq = await v.fbq();
  ok(/Paso 4/.test(await v.page.textContent("[data-form-paso]")), "retoma en el paso 4");
  ok(n(fbq, "InitiateCheckout").length === 1 && n(v.capi, "InitiateCheckout").length === 1, "InitiateCheckout de nuevo");
  ok(fbq.some((x) => x.ev === "FormularioPaso" && x.data.paso === 1), "FormularioPaso paso 1 de nuevo (Píxel)");
  ok(v.capi.some((x) => x.event_name === "FormularioPaso" && x.custom_data.paso === 1), "FormularioPaso paso 1 de nuevo (CAPI)");
  await v.page.waitForTimeout(800);
  await capturarAntesDeSalir(v, () => completar(v.page));
  await v.page.waitForTimeout(800);
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
  await capturarAntesDeSalir(v, () => completar(v.page));
  await v.page.waitForTimeout(800);
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

await browser.close();
server.close();
console.log(fallas ? "\n✗ " + fallas + " comprobación(es) fallaron." : "\n✓ Todo el tracking se comporta como debe.");
process.exit(fallas ? 1 : 0);
