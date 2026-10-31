/* ==========================================================================
   BLACK — motor del formulario condicional.
   Lee todo el contenido de window.BLACK_FORM (form-config.js). Para cambiar
   preguntas, opciones, saltos o reglas de calificación NO se toca este
   archivo.

   Flujo al enviar (califique o no):
     0. Lead completo a GoHighLevel por la función de Netlify ghl-lead, que
        lo reenvía al Inbound Webhook del Workflow "Black – Nuevo lead".
        Cola de reintento en localStorage si la red falla.
     1. Lead completo a Google Sheets (si sheets.url tiene valor): fetch text/plain + keepalive (sin
        preflight de CORS). No bloquea ni demora nada. Antes de mandarlo se
        guarda en una cola en localStorage; si el envío falla, se reintenta
        en la próxima carga de la página. El script descarta duplicados por
        lead_id.
     2. Eventos de GA4 (+ Lead de Meta solo si califica, con eventID =
        lead_id para deduplicar con la API de Conversiones). El Lead sale
        acá, antes de mostrar la cotización.
     3. Califica → pantalla de carga (~2 s) → pantalla de resultado con la
        cotización (ruta compra) o sin rango (ruta reforma), con el botón a
        WhatsApp. No hay salto automático: solo se va a WhatsApp si toca
        el botón (y ahí espera la confirmación de GHL, hasta 2,5 s).
        No califica → pantalla final con el Instagram.
   ========================================================================== */
(function () {
  "use strict";

  var F = window.BLACK_FORM;
  var CFG = window.BLACK || {};
  var APP = window.BLACK_APP || { track: function () {}, pixel: function () {}, pixelCustom: function () {}, pixelUsuario: function () {}, visitorId: function () { return ""; }, getAtribucion: function () { return {}; }, getCta: function () { return "directo"; }, getCtasSesion: function () { return ""; } };
  var modal = document.getElementById("modal");
  if (!F || !modal) return;

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  var panel = $(".modal-panel", modal);
  var cuerpo = $("[data-form-cuerpo]", modal);
  var barra = $("[data-form-barra]", modal);
  var etiquetaPaso = $("[data-form-paso]", modal);

  var DRAFT = "black:form";
  var T = F.textos || {};
  var E = T.errores || {};

  /* ---------------------------------------------------------- estado --- */
  // r: respuestas por id de pregunta (string o array). otros: texto de "Otro".
  // d: datos personales. i: índice del paso actual dentro de los visibles.
  var preguntas = F.preguntas || [];
  var primera = preguntas[0];

  var S = cargar() || nuevoEstado();
  var abierto = false, enviado = false, inicioTrackeado = false, ultimaRuta = null;
  // Después de enviar: lo que se muestra si cierra y vuelve a abrir el
  // formulario (pantalla de resultado), y cuándo envió (a los 30 min, o con
  // "Cotizar otro caso", arranca de cero).
  var final = null, enviadoEn = 0;
  var REINICIO = 30 * 60 * 1000;
  // Pasos ya informados a Meta en este formulario (no se repiten al volver atrás).
  var pasosMeta = {};
  var abridor = null;

  function nuevoEstado() { return { r: {}, otros: {}, d: {}, i: 0 }; }

  /** Borrador de esta pestaña. Si tiene respuestas que ya no existen (por
      ejemplo, de las preguntas anteriores al cotizador), se descarta. */
  function cargar() {
    var b = null;
    try { b = JSON.parse(sessionStorage.getItem(DRAFT) || "null"); } catch (e) { b = null; }
    if (!b) return null;
    if (!borradorValido(b)) {
      try { sessionStorage.removeItem(DRAFT); } catch (e) { /* sin storage */ }
      return null;
    }
    return b;
  }
  function borradorValido(b) {
    if (typeof b !== "object" || !b.r || typeof b.r !== "object" || typeof b.i !== "number") return false;
    b.otros = b.otros || {};
    b.d = b.d || {};
    return Object.keys(b.r).every(function (id) {
      var p = preguntas.filter(function (x) { return x.id === id; })[0];
      if (!p) return false;
      var v = b.r[id];
      if (p.tipo === "multiple") return Array.isArray(v) && v.every(function (x) { return !!opcion(p, x); });
      if (p.tipo === "unica") return !!opcion(p, v);
      return typeof v === "string";
    });
  }
  function guardar() {
    try { sessionStorage.setItem(DRAFT, JSON.stringify(S)); } catch (e) { /* sin storage */ }
  }

  /* ---------------------------------------------------------- lógica --- */

  function opcion(p, valor) {
    var ops = p.opciones || [];
    for (var k = 0; k < ops.length; k++) if (ops[k].valor === valor) return ops[k];
    return null;
  }

  /** Ruta actual según la respuesta a la primera pregunta. */
  function ruta() {
    var o = primera && opcion(primera, S.r[primera.id]);
    return (o && o.ruta) || null;
  }
  /** Para contar pasos antes de elegir ruta, se usa la primera que exista. */
  function rutaPorDefecto() {
    var ops = (primera && primera.opciones) || [];
    for (var k = 0; k < ops.length; k++) if (ops[k].ruta) return ops[k].ruta;
    return null;
  }

  function visibles() {
    var rt = ruta() || rutaPorDefecto();
    return preguntas.filter(function (p) {
      return !p.mostrarSi || !p.mostrarSi.ruta || p.mostrarSi.ruta === rt;
    });
  }

  function titulo(p) {
    if (typeof p.titulo === "string") return p.titulo;
    var rt = ruta() || rutaPorDefecto();
    return (p.titulo && (p.titulo[rt] || p.titulo[Object.keys(p.titulo)[0]])) || "";
  }

  function clave(p) { return p.clave || p.id; }

  /** Texto final de una respuesta (multiple → unido; "Otro" → con su texto). */
  function valorTexto(p, sep) {
    var v = S.r[p.id];
    if (v == null) return "";
    if (p.tipo !== "multiple") return String(v);
    return v.map(function (x) {
      var o = opcion(p, x);
      if (o && o.abreTexto && S.otros[p.id]) return x + ": " + S.otros[p.id].trim();
      return x;
    }).join(sep || " · ");
  }

  /** Flags marcados en las opciones elegidas (visibles): { visita, docs }. */
  function flags() {
    var f = {};
    visibles().forEach(function (p) {
      var v = S.r[p.id];
      if (v == null) return;
      (Array.isArray(v) ? v : [v]).forEach(function (x) {
        var o = opcion(p, x);
        if (o && o.flag) f[o.flag] = true;
      });
    });
    return f;
  }

  /** $300.000: punto de miles, sin decimales. */
  function pesos(n) {
    return "$" + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  /** Cotización del caso según form-config.js (bloque `cotizacion`).
      Ruta compra → { rango, ... }. Ruta reforma → rango null. */
  function cotizar() {
    var C = F.cotizacion || {};
    var f = flags();
    var out = { rango: null, visita: !!f.visita, docs: !!f.docs };
    if (ruta() !== "compra" || typeof C.asignar !== "function") return out;
    var n = C.asignar({ propiedades: S.r.propiedades, visita: !!f.visita, docs: !!f.docs });
    var r = (C.rangos || []).filter(function (x) { return x.n === n; })[0];
    if (!r) return out;
    out.rango = r;
    out.visita = out.visita || !!r.visita;
    out.docs = out.docs || !!r.docs;
    out.texto = pesos(r.min) + " – " + pesos(r.max);
    return out;
  }

  /** Califica si ninguna opción elegida (en preguntas visibles) tiene noCalifica. */
  function calificacion() {
    var motivos = [];
    visibles().forEach(function (p) {
      var v = S.r[p.id];
      if (v == null) return;
      (Array.isArray(v) ? v : [v]).forEach(function (x) {
        var o = opcion(p, x);
        if (o && o.noCalifica) motivos.push(o.motivo || (p.columna + ": " + x));
      });
    });
    return { ok: motivos.length === 0, motivo: motivos.join(" · ") };
  }

  /** Teléfono argentino → 549 + 10 dígitos, o null si no se puede armar. */
  function telefonoAR(input) {
    var d = String(input || "").replace(/\D/g, "");
    if (!d) return null;
    if (d.indexOf("00") === 0) d = d.slice(2);
    if (d.indexOf("54") === 0 && d.length > 10) d = d.slice(2);
    if (d.indexOf("9") === 0 && d.length === 11) d = d.slice(1);
    if (d.indexOf("0") === 0) d = d.slice(1);
    // El 15 va después del código de área: 11 (AMBA) o de 3/4 dígitos.
    if (d.length === 12) {
      (d.indexOf("11") === 0 ? [2] : [3, 4]).some(function (c) {
        if (d.substr(c, 2) === "15") { d = d.slice(0, c) + d.slice(c + 2); return true; }
        return false;
      });
    }
    // 10 dígitos nacionales. Los códigos de área argentinos empiezan con 11,
    // 2 o 3: "15 6480 3777" (sin código de área) no pasa.
    return /^(11\d{8}|[23]\d{9})$/.test(d) ? "549" + d : null;
  }

  /** UUID v4. Es el ID del lead en Sheets y el eventID del Píxel. */
  function nuevoLeadId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* contexto no seguro */ }
    var b = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  /** Referencia corta para el mensaje de WhatsApp (el UUID entero es largo
      para un chat). Es el comienzo del lead_id: se busca igual en la hoja. */
  function refCorta(leadId) {
    return "BLK-" + leadId.replace(/-/g, "").slice(0, 8).toUpperCase();
  }

  /* --------------------------------------------- cola de envíos a Sheets */

  var COLA = "black:sheets_cola";

  function leerCola() {
    try { return JSON.parse(localStorage.getItem(COLA) || "[]") || []; } catch (e) { return []; }
  }
  function guardarCola(c) {
    try { localStorage.setItem(COLA, JSON.stringify(c.slice(-20))); } catch (e) { /* sin storage */ }
  }
  function sacarDeCola(id) {
    guardarCola(leerCola().filter(function (x) { return x.id !== id; }));
  }

  /* Cola del CRM (GoHighLevel). A diferencia de Sheets, la función de Netlify
     responde: el envío solo sale de la cola con una respuesta OK. */
  var COLA_CRM = "black:crm_cola";
  function leerColaCrm() {
    try { return JSON.parse(localStorage.getItem(COLA_CRM) || "[]") || []; } catch (e) { return []; }
  }
  function guardarColaCrm(c) {
    try { localStorage.setItem(COLA_CRM, JSON.stringify(c.slice(-20))); } catch (e) { /* sin storage */ }
  }
  /** Devuelve una promesa que se resuelve cuando la función respondió (o
      falló). Solo sale de la cola con OK o con un 4xx (reintentar no lo
      arregla). */
  function mandarACrm(url, item) {
    if (!url || !window.fetch) return Promise.resolve();
    try {
      return fetch(url, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: item.body,
      }).then(function (r) {
        if (r.ok || (r.status >= 400 && r.status < 500)) {
          guardarColaCrm(leerColaCrm().filter(function (x) { return x.id !== item.id; }));
        }
      }, function () { /* queda en la cola */ });
    } catch (e) { return Promise.resolve(); /* queda en la cola */ }
  }

  /** Reintento de un envío que no se confirmó en su momento: va marcado y
      con la fecha original, para que GHL no lo tome como un lead nuevo de
      hoy. Pasados 7 días se descarta (si no llegó, ya no sirve reenviarlo
      solo: queda en el Píxel/CAPI y en el WhatsApp). */
  var CRM_TTL = 7 * 24 * 60 * 60 * 1000;
  function reintentarCrm() {
    var ahora = Date.now();
    var vigentes = leerColaCrm().filter(function (it) { return it.t && ahora - it.t < CRM_TTL; });
    guardarColaCrm(vigentes);
    vigentes.forEach(function (it) {
      var body = it.body;
      try {
        var d = JSON.parse(it.body);
        d.fields = d.fields || {};
        d.fields.reintento = "si";
        body = JSON.stringify(d);
      } catch (e) { /* va como estaba */ }
      mandarACrm(CFG.crmUrl, { id: it.id, body: body });
    });
  }

  /** Manda un payload. Si la red falla, queda en la cola para la próxima carga. */
  function mandarASheets(url, item) {
    if (!url || !window.fetch) return;
    try {
      fetch(url, {
        method: "POST",
        mode: "no-cors",
        keepalive: true,
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: item.body,
      }).then(function () { sacarDeCola(item.id); }, function () { /* queda en la cola */ });
    } catch (e) { /* queda en la cola */ }
  }

  function reintentarCola() {
    if (CFG.crmUrl) reintentarCrm();
    var url = (CFG.sheets || {}).url;
    if (!url) return;
    leerCola().forEach(function (item) { mandarASheets(url, item); });
  }

  function plantilla(txt, datos) {
    return String(txt || "").replace(/\{(\w+)\}/g, function (_, k) {
      return datos[k] != null && datos[k] !== "" ? datos[k] : "—";
    });
  }

  /* ---------------------------------------------------------- render --- */

  function h(tag, attrs, hijos) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") e.textContent = attrs[k];
      else if (k === "class") e.className = attrs[k];
      else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    });
    (hijos || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function svgUse(id) {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("aria-hidden", "true");
    s.setAttribute("width", "20");
    s.setAttribute("height", "20");
    var u = document.createElementNS("http://www.w3.org/2000/svg", "use");
    u.setAttribute("href", "#" + id);
    s.appendChild(u);
    return s;
  }

  function errorEn(contenedor, msg) {
    var e = $(".f-error", contenedor);
    if (!msg) { if (e) e.remove(); return; }
    if (!e) {
      e = h("p", { class: "f-error", role: "alert" });
      contenedor.appendChild(e);
    }
    e.textContent = msg;
  }

  function progreso() {
    var lista = visibles();
    var n = Math.min(S.i + 1, lista.length);
    barra.style.width = (n / lista.length) * 100 + "%";
    etiquetaPaso.textContent = plantilla(T.paso || "Paso {n} de {total}", { n: n, total: lista.length });
  }

  function pintar(dir) {
    var lista = visibles();
    if (S.i >= lista.length) S.i = lista.length - 1;
    if (S.i < 0) S.i = 0;
    var p = lista[S.i];
    cuerpo.innerHTML = "";

    if (S.i === 0 && F.intro) {
      cuerpo.appendChild(h("div", { class: "f-intro" }, [
        h("p", { class: "f-intro-t", text: F.intro.titulo }),
        F.intro.pasos && F.intro.pasos.length
          ? h("ol", { class: "f-intro-pasos" }, F.intro.pasos.map(function (x) { return h("li", { text: x }); }))
          : null,
        F.intro.micro ? h("p", { class: "f-intro-micro", text: F.intro.micro }) : null,
      ]));
    }

    var tid = "form-titulo";
    var paso = h(p.tipo === "datos" ? "form" : "fieldset", {
      class: "f-paso" + (dir > 0 ? " entra" : dir < 0 ? " vuelve" : ""),
      novalidate: p.tipo === "datos" ? true : null,
      "aria-labelledby": tid,
    });
    var leyenda = h(p.tipo === "datos" ? "h2" : "legend", { class: "f-titulo", id: tid, tabindex: "-1", text: titulo(p) });
    paso.appendChild(leyenda);
    if (p.ayuda) paso.appendChild(h("p", { class: "f-ayuda", text: p.ayuda }));

    var nav = h("div", { class: "f-nav" });
    if (S.i > 0) {
      var atras = h("button", { type: "button", class: "f-atras" }, [svgUse("i-flecha"), T.atras || "Atrás"]);
      atras.addEventListener("click", function () { ir(-1); });
      nav.appendChild(atras);
    }

    if (p.tipo === "unica") renderUnica(p, paso);
    else if (p.tipo === "multiple") renderMultiple(p, paso, nav);
    else if (p.tipo === "texto") renderTexto(p, paso, nav);
    else if (p.tipo === "datos") renderDatos(p, paso, nav);

    if (nav.childNodes.length) paso.appendChild(nav);
    cuerpo.appendChild(paso);
    progreso();
    panel.scrollTop = 0;

    // Foco: en los campos de texto, al input (en desktop abre el teclado de
    // una); en el resto, al título para que el lector de pantalla lo lea.
    var foco = (p.tipo === "texto") ? $("input", paso) : leyenda;
    if (dir !== 0 || p.tipo !== "texto") {
      try { foco.focus({ preventScroll: true }); } catch (e) { foco.focus(); }
    }

    APP.track("form_step", { step: S.i + 1, question_id: p.id });

    // Meta: un evento por paso alcanzado (paso N = completó los N-1 anteriores).
    // Sirve para ver en qué pregunta se cae la gente y para armar
    // conversiones personalizadas (ej. paso >= 5).
    reportarPaso(p, S.i, lista.length);
  }

  /** FormularioPaso a Meta (Píxel + CAPI, mismo eventID), una vez por paso. */
  function reportarPaso(p, i, total) {
    if (!p || pasosMeta[p.id]) return;
    pasosMeta[p.id] = true;
    var datosPaso = {
      paso: i + 1,
      total_pasos: total,
      pregunta: p.id,
      ruta: ruta() || "",
      es_datos: p.tipo === "datos" ? "si" : "no",
    };
    var idPaso = sesionMeta() + "-p" + (i + 1);
    APP.pixelCustom("FormularioPaso", datosPaso, { eventID: idPaso });
    mandarACapi("FormularioPaso", idPaso, datosPaso);
  }

  /** Id de esta apertura del formulario, para los eventID de Meta. */
  var sesionId = null;
  function sesionMeta() {
    if (!sesionId) sesionId = "f-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    return sesionId;
  }

  function renderUnica(p, paso) {
    var cont = h("div", { class: "f-opciones", role: "radiogroup", "aria-labelledby": "form-titulo" });
    (p.opciones || []).forEach(function (o) {
      var on = S.r[p.id] === o.valor;
      var b = h("button", { type: "button", class: "f-op" + (on ? " on" : ""), role: "radio", "aria-checked": String(on) }, [
        h("span", { class: "f-op-marca", "aria-hidden": "true" }),
        h("span", { text: o.valor }),
      ]);
      b.addEventListener("click", function () {
        if (cont.getAttribute("data-bloq")) return;
        $$(".f-op", cont).forEach(function (x) { x.classList.remove("on"); x.setAttribute("aria-checked", "false"); });
        b.classList.add("on");
        b.setAttribute("aria-checked", "true");
        S.r[p.id] = o.valor;
        errorEn(paso, null);
        guardar();
        if (p === primera) {
          var rt = ruta();
          if (rt && rt !== ultimaRuta) { ultimaRuta = rt; APP.track("form_route", { route: rt }); }
        }
        // Un toque = avanza. El bloqueo evita dobles toques que saltean pasos.
        cont.setAttribute("data-bloq", "1");
        setTimeout(function () { ir(1); }, 240);
      });
      cont.appendChild(b);
    });
    paso.appendChild(cont);
  }

  function renderMultiple(p, paso, nav) {
    var sel = Array.isArray(S.r[p.id]) ? S.r[p.id].slice() : [];
    var cont = h("div", { class: "f-opciones" });
    var otroInput = null;

    (p.opciones || []).forEach(function (o, k) {
      var on = sel.indexOf(o.valor) >= 0;
      var input = h("input", { type: "checkbox", id: "op-" + p.id + "-" + k, value: o.valor });
      input.checked = on;
      var lab = h("label", { class: "f-op f-op-multi" + (on ? " on" : ""), for: input.id }, [
        input,
        h("span", { class: "f-op-marca", "aria-hidden": "true" }),
        h("span", { text: o.valor }),
      ]);
      cont.appendChild(lab);

      if (o.abreTexto) {
        otroInput = h("input", {
          type: "text", class: "f-input f-otro", placeholder: o.placeholder || "", maxlength: "200",
          "aria-label": o.placeholder || o.valor,
        });
        otroInput.value = S.otros[p.id] || "";
        otroInput.hidden = !on;
        otroInput.addEventListener("input", function () { S.otros[p.id] = otroInput.value; guardar(); errorEn(paso, null); });
        cont.appendChild(otroInput);
      }

      input.addEventListener("change", function () {
        var i = sel.indexOf(o.valor);
        if (input.checked && i < 0) sel.push(o.valor);
        if (!input.checked && i >= 0) sel.splice(i, 1);
        lab.classList.toggle("on", input.checked);
        // Mantener el orden de la configuración.
        sel.sort(function (a, b) { return idx(p, a) - idx(p, b); });
        S.r[p.id] = sel.slice();
        if (o.abreTexto && otroInput) {
          otroInput.hidden = !input.checked;
          if (input.checked) otroInput.focus();
        }
        errorEn(paso, null);
        guardar();
      });
    });
    paso.appendChild(cont);

    nav.appendChild(botonSiguiente(function () {
      var v = S.r[p.id] || [];
      if (!v.length) return errorEn(paso, E.multiple), false;
      var otro = (p.opciones || []).filter(function (o) { return o.abreTexto && v.indexOf(o.valor) >= 0; })[0];
      if (otro && !(S.otros[p.id] || "").trim()) {
        errorEn(paso, E.otro);
        if (otroInput) otroInput.focus();
        return false;
      }
      return true;
    }));
  }

  function idx(p, valor) {
    var ops = p.opciones || [];
    for (var k = 0; k < ops.length; k++) if (ops[k].valor === valor) return k;
    return 999;
  }

  function renderTexto(p, paso, nav) {
    var campo = h("div", { class: "f-campo" });
    var input = h("input", {
      type: "text", class: "f-input", id: "f-" + p.id, placeholder: p.placeholder || "",
      autocomplete: p.autocomplete || "off", "aria-labelledby": "form-titulo", maxlength: "120",
      enterkeyhint: "next", autocapitalize: "words",
    });
    input.value = S.r[p.id] || "";
    input.addEventListener("input", function () {
      S.r[p.id] = input.value;
      input.removeAttribute("aria-invalid");
      errorEn(campo, null);
      guardar();
    });
    campo.appendChild(input);
    paso.appendChild(campo);

    var sig = botonSiguiente(function () {
      if (!(S.r[p.id] || "").trim()) {
        input.setAttribute("aria-invalid", "true");
        errorEn(campo, E.texto);
        input.focus();
        return false;
      }
      return true;
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); sig.click(); }
    });
    nav.appendChild(sig);
  }

  function renderDatos(p, form, nav) {
    (p.campos || []).forEach(function (c) {
      var campo = h("div", { class: "f-campo" });
      var input = h("input", {
        type: c.tipo || "text", class: "f-input", id: "f-" + c.id, name: c.id,
        autocomplete: c.autocomplete || "off", placeholder: c.placeholder || "",
        inputmode: c.tipo === "tel" ? "tel" : c.tipo === "email" ? "email" : null, maxlength: "80",
        enterkeyhint: "next", autocapitalize: c.tipo === "tel" || c.tipo === "email" ? "off" : "words",
        spellcheck: c.tipo === "email" ? "false" : null,
        "aria-required": c.requerido ? "true" : null,
      });
      input.value = S.d[c.id] || "";
      input.addEventListener("input", function () {
        S.d[c.id] = input.value;
        input.removeAttribute("aria-invalid");
        errorEn(campo, null);
        guardar();
      });
      campo.appendChild(h("label", { for: input.id, text: c.label }));
      campo.appendChild(input);
      form.appendChild(campo);
    });

    // Honeypot: un humano no lo ve ni lo puede enfocar. Si viene lleno, el
    // script de Sheets descarta el envío.
    var hp = h("div", { class: "f-hp", "aria-hidden": "true" }, [
      h("label", { for: "f-empresa", text: "Empresa" }),
      h("input", { type: "text", id: "f-empresa", name: "empresa", tabindex: "-1", autocomplete: "off" }),
    ]);
    form.appendChild(hp);

    if (p.nota) form.appendChild(h("p", { class: "f-nota", text: p.nota }));

    var btn = h("button", { type: "submit", class: "btn btn-1 btn-lg" }, [
      h("span", { text: T.enviar || "Enviar" }), svgUse("i-flecha"),
    ]);
    nav.appendChild(btn);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (enviado) return;
      var primeroMal = null;
      (p.campos || []).forEach(function (c) {
        var input = $("#f-" + c.id, form);
        var campo = input.closest(".f-campo");
        var v = (input.value || "").trim();
        var msg = null;
        if (c.requerido && !v) msg = E[c.id] || E.texto;
        else if (c.validar === "telefonoAR" && v && !telefonoAR(v)) msg = E.telefonoAR;
        else if (c.validar === "email" && v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) msg = E.emailValido;
        if (msg) {
          input.setAttribute("aria-invalid", "true");
          errorEn(campo, msg);
          if (!primeroMal) primeroMal = input;
        }
      });
      if (primeroMal) { primeroMal.focus(); return; }
      enviar(p, $("#f-empresa", form).value, btn);
    });
  }

  function botonSiguiente(validar) {
    var b = h("button", { type: "button", class: "btn btn-1" }, [h("span", { text: T.siguiente || "Siguiente" }), svgUse("i-flecha")]);
    b.addEventListener("click", function () { if (validar()) ir(1); });
    return b;
  }

  function ir(dir) {
    var lista = visibles();
    var nuevo = S.i + dir;
    if (nuevo < 0 || nuevo >= lista.length) return;
    S.i = nuevo;
    guardar();
    pintar(dir);
  }

  /* ---------------------------------------------------------- envío ---- */

  function enviar(pDatos, honeypot, btn) {
    enviado = true;
    enviadoEn = Date.now();
    var span = $("span", btn);
    if (span) span.textContent = T.enviando || "Enviando…";
    btn.disabled = true;

    var lista = visibles();
    var cal = calificacion();
    var rt = ruta();
    var cot = cotizar();
    var attr = APP.getAtribucion();
    var leadId = nuevoLeadId();
    var nombre = (S.d.nombre || "").trim();
    var tel = telefonoAR(S.d.whatsapp);

    // Columnas de la hoja "Leads", por nombre de encabezado. Las respuestas
    // usan la `columna` de cada pregunta (form-config.js).
    var fields = { lead_id: leadId, ref_whatsapp: refCorta(leadId) };
    var porClave = { nombre: nombre, lead_id: refCorta(leadId) };
    // Para el mensaje de WhatsApp: las múltiples van separadas por ", ".
    var paraWa = { nombre: nombre, lead_id: refCorta(leadId) };
    lista.forEach(function (p) {
      if (p.tipo === "datos") return;
      var txt = valorTexto(p);
      if (p.columna) fields[p.columna] = txt;
      porClave[clave(p)] = txt;
      paraWa[clave(p)] = valorTexto(p, ", ");
    });
    fields.ruta = (F.rutas && F.rutas[rt]) || rt || "";
    fields.califica = cal.ok ? "Sí" : "No";
    fields.motivo_descalificacion = cal.motivo;
    // Cotización (vacía en la ruta reforma).
    var rg = cot.rango;
    fields.rango = rg ? String(rg.n) : "";
    fields.rango_nombre = rg ? rg.nombre : "";
    fields.cotizacion_min = rg ? String(rg.min) : "";
    fields.cotizacion_max = rg ? String(rg.max) : "";
    fields.cotizacion_texto = rg ? cot.texto : "";
    fields.necesita_visita = cot.visita ? "Sí" : "No";
    fields.revision_documental = cot.docs ? "Sí" : "No";
    paraWa.cotizacion_texto = fields.cotizacion_texto;
    lista.forEach(function (p) {
      if (p.tipo !== "datos") return;
      (p.campos || []).forEach(function (c) {
        var v = (S.d[c.id] || "").trim();
        if (c.validar === "telefonoAR") v = "+" + tel;
        fields[c.id] = v;
        porClave[c.id] = v;
        paraWa[c.id] = v;
      });
    });
    fields.cta_origen = APP.getCta();
    fields.ctas_sesion = APP.getCtasSesion ? APP.getCtasSesion() : "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
      "campaign_id", "adset_id", "ad_id", "placement", "fbclid",
      "ft_campaign", "ft_adset", "ft_ad", "ft_fecha", "dispositivo", "url", "referrer"].forEach(function (k) {
      fields[k] = attr[k] || "";
    });
    if (!fields.url) fields.url = location.href.split("#")[0];

    // Para que Meta y el CRM usen los mismos identificadores de navegador.
    fields.fbp = cookieMeta("_fbp");
    fields.fbc = fbcActual();
    // Mismo external_id que Píxel y CAPI: GHL lo reusa en Schedule/ShowUp/Purchase.
    fields.external_id = APP.visitorId();
    // Cuándo completó el formulario (no cuándo llegó a GHL).
    fields.fecha_envio = new Date().toISOString();
    fields.reintento = "no";

    // 0. CRM (GoHighLevel). Con cola si la red falla. El botón de WhatsApp
    //    espera esta respuesta (máx. 2,5 s): si la página se va antes, el
    //    envío llega igual (keepalive) pero queda en la cola y se reenviaba
    //    en la próxima visita, como si fuera un lead nuevo.
    var crmListo = Promise.resolve();
    if (CFG.crmUrl) {
      // Claves del Workflow viejo, vacías (ver ghlClavesViejas en form-config.js).
      var fieldsCrm = {};
      (F.ghlClavesViejas || []).forEach(function (k) { fieldsCrm[k] = ""; });
      Object.keys(fields).forEach(function (k) { fieldsCrm[k] = fields[k]; });
      var itemCrm = { id: leadId, t: Date.now(), body: JSON.stringify({ token: (CFG.sheets || {}).token || "", hp: honeypot || "", fields: fieldsCrm }) };
      var colaCrm = leerColaCrm();
      colaCrm.push(itemCrm);
      guardarColaCrm(colaCrm);
      crmListo = mandarACrm(CFG.crmUrl, itemCrm);
    }

    // 1. Sheets. Fuego y olvido: nunca demora nada.
    var sh = CFG.sheets || {};
    if (sh.url) {
      var item = { id: leadId, body: JSON.stringify({ token: sh.token || "", hp: honeypot || "", fields: fields }) };
      var cola = leerCola();
      cola.push(item);
      guardarCola(cola);
      mandarASheets(sh.url, item);
    }

    // 2. Eventos.
    APP.track("form_submit", {
      qualified: cal.ok,
      disqualify_reason: cal.motivo || "",
      route: rt || "",
      utm_campaign: attr.utm_campaign || "",
      utm_term: attr.utm_term || "",
      utm_content: attr.utm_content || "",
    });

    try { sessionStorage.removeItem(DRAFT); } catch (e) {}

    // 3. Lead a Meta (sale acá, antes de mostrar la cotización) y destino.
    var email = (S.d.email || "").trim();
    var partes = nombre.split(/\s+/).filter(Boolean);
    APP.pixelUsuario({ em: email, ph: tel, fn: partes[0] || "", ln: partes.slice(1).join(" ") });
    var usuario = { nombre: nombre, telefono: tel, email: email, external_id: APP.visitorId() };
    var datosLead = {
      content_name: "Diagnóstico Black",
      ruta: rt || "",
      zona: porClave.zona || "",
      propiedades: porClave.propiedades || "",
      rango: fields.rango,
      urgencia: porClave.urgencia || "",
      cta_origen: fields.cta_origen || "",
    };
    if (cal.ok) {
      APP.pixel("Lead", datosLead, { eventID: leadId });
      mandarACapi("Lead", leadId, datosLead, usuario);
      var W = F.whatsapp || {};
      var msg = plantilla((rg ? W.mensaje : W.mensajeReforma || W.mensaje) || "", paraWa);
      final = {
        tipo: rg ? "cotizacion" : "reforma",
        url: "https://wa.me/" + (CFG.whatsapp || "") + "?text=" + encodeURIComponent(msg),
        nombre: nombre, cot: cot, ruta: rt || "", zona: porClave.zona || "", propiedades: S.r.propiedades || "",
        leadId: leadId, usuario: usuario, crmListo: crmListo, cta: fields.cta_origen || "",
        visto: false, contacto: false,
      };
      pantallaCarga();
    } else {
      datosLead.motivo = cal.motivo || "";
      APP.pixelCustom("LeadNoCalifica", datosLead, { eventID: leadId });
      mandarACapi("LeadNoCalifica", leadId, datosLead, usuario);
      final = { tipo: "noCalifica", url: CFG.instagram || "https://www.instagram.com/black_arq/", nombre: nombre };
      pantallaFinal();
    }
  }

  function cookieMeta(n) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + n + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  /** _fbc del Píxel; si todavía no existe, armado con el fbclid y la hora
      en que llegó ese clic (Meta pide esa hora, no la del evento). */
  function fbcActual() {
    var c = cookieMeta("_fbc");
    if (c) return c;
    var a = APP.getAtribucion() || {};
    if (!a.fbclid) return "";
    var t = Date.parse(a.lt_fecha || "");
    return "fb.1." + (isNaN(t) ? Date.now() : t) + "." + a.fbclid;
  }

  /** Evento por API de Conversiones, con el mismo eventID que el Píxel
      (Meta deduplica). keepalive: sobrevive al salto a WhatsApp.
      usuario (opcional): { nombre, telefono, email, external_id }. */
  function mandarACapi(evento, eventId, customData, usuario) {
    if (!CFG.metaPixelId || !CFG.metaCapiUrl) return;
    var u = usuario || {};
    var fbc = fbcActual();
    try {
      fetch(CFG.metaCapiUrl, {
        method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_name: evento, event_id: eventId, custom_data: customData || {},
          nombre: u.nombre || "", telefono: u.telefono || "", email: u.email || "",
          external_id: u.external_id || APP.visitorId(),
          fbp: cookieMeta("_fbp"), fbc: fbc, url: location.href.split("#")[0],
        }),
      }).catch(function () {});
    } catch (e) {}
  }

  /** Va a WhatsApp cuando GHL confirmó el lead y GA4 el evento, o a los
      2,5 s como mucho. Solo con el toque en el botón: no hay salto solo. */
  var yendo = false;
  function irAWhatsApp(url, crmListo) {
    if (yendo) return;
    yendo = true;
    var fue = false, ga = false, crm = false;
    function go() {
      if (fue) return;
      fue = true;
      yendo = false;
      location.href = url;
    }
    function quizas() { if (ga && crm) go(); }
    APP.track("whatsapp_redirect", { origen: "boton", event_callback: function () { ga = true; quizas(); }, event_timeout: 300 });
    setTimeout(function () { ga = true; quizas(); }, 300);
    (crmListo || Promise.resolve()).then(function () { crm = true; quizas(); }, function () { crm = true; quizas(); });
    setTimeout(go, 2500);
  }

  /** Deja el modal listo para una pantalla final (carga o resultado). */
  function limpiarCuerpo() {
    barra.style.width = "100%";
    etiquetaPaso.textContent = "";
    cuerpo.innerHTML = "";
    panel.scrollTop = 0;
  }

  function enfocar(el) {
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  }

  /* ------------------------------------------------- pantalla de carga --- */
  /* ~2,6 s: un plano que se dibuja, una barra que se llena y tres mensajes
     que rotan, para que se sienta que se arma la cotización. Con movimiento
     reducido: un mensaje fijo y la barra llena, mismo tiempo. El resultado
     no espera a GHL (crmListo sigue en segundo plano). */

  var DUR_CARGA = 2600, PASO_CARGA = 850;
  var timersCarga = [];
  function cortarCarga() {
    timersCarga.forEach(clearTimeout);
    timersCarga = [];
  }

  function svgCarga() {
    var NS = "http://www.w3.org/2000/svg";
    var s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 96 72");
    s.setAttribute("aria-hidden", "true");
    s.setAttribute("class", "f-carga-plano");
    // Planta simple: muros, tabiques, puerta y, en amarillo, la cota.
    [
      ["s", "M14 8H82V56H14V8"],
      ["s2", "M46 8V32H62"],
      ["s2", "M14 34H32"],
      ["s2", "M70 56V44a12 12 0 0 0-12-12"],
      ["y", "M14 66H82M14 62v8M82 62v8"],
    ].forEach(function (d, i) {
      var p = document.createElementNS(NS, "path");
      p.setAttribute("class", d[0]);
      p.setAttribute("d", d[1]);
      p.setAttribute("pathLength", "1");
      p.style.setProperty("--k", i);
      s.appendChild(p);
    });
    return s;
  }

  function pantallaCarga() {
    cortarCarga();
    limpiarCuerpo();
    var msgs = T.carga && T.carga.length ? T.carga : [""];
    var reduce = !document.documentElement.classList.contains("motion");
    var msg = h("p", {
      class: "f-carga-msg", id: "form-titulo", "aria-live": "polite", tabindex: "-1",
      text: reduce ? msgs[msgs.length - 1] : msgs[0],
    });
    var barraCarga = h("span", { class: "f-carga-barra", "aria-hidden": "true" }, [h("i")]);
    barraCarga.style.setProperty("--dur", DUR_CARGA + "ms");
    cuerpo.appendChild(h("div", { class: "f-carga" }, [svgCarga(), msg, barraCarga]));
    enfocar(msg);
    if (!reduce) {
      msgs.slice(1).forEach(function (t, k) {
        timersCarga.push(setTimeout(function () {
          msg.classList.add("sale");
          timersCarga.push(setTimeout(function () { msg.textContent = t; msg.classList.remove("sale"); }, 180));
        }, PASO_CARGA * (k + 1)));
      });
    }
    timersCarga.push(setTimeout(function () {
      cortarCarga();
      // Si cerró el formulario durante la carga, el resultado se pinta (y
      // se cuenta como visto) cuando lo vuelva a abrir.
      if (abierto) pantallaFinal();
    }, DUR_CARGA));
  }

  /* ---------------------------------------------- pantallas finales ----- */

  /** Título con {min} y {max} en amarillo (.hl-y). */
  function tituloCotizacion(txt, datos) {
    var t = h("h2", { id: "form-titulo", tabindex: "-1" });
    String(txt || "").split(/(\{\w+\})/).forEach(function (parte) {
      var m = parte.match(/^\{(\w+)\}$/);
      if (!m) { if (parte) t.appendChild(document.createTextNode(parte)); return; }
      var v = datos[m[1]] != null ? String(datos[m[1]]) : "";
      if (m[1] === "min" || m[1] === "max") t.appendChild(h("span", { class: "hl-y", text: v }));
      else t.appendChild(document.createTextNode(v));
    });
    return t;
  }

  function linkOtroCaso(texto) {
    var b = h("button", { type: "button", class: "f-otro-caso", text: texto });
    b.addEventListener("click", function () {
      reiniciar();
      iniciar(APP.getCta());
      pintar(0);
    });
    return b;
  }

  function botonWhatsApp(c) {
    var btn = h("a", { class: "btn btn-1 btn-lg", href: final.url }, [svgUse("i-wa"), h("span", { text: c.boton || "" })]);
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      // Contact a Meta: una vez por lead, aunque toque dos veces o vuelva.
      if (!final.contacto) {
        final.contacto = true;
        var datos = {
          content_name: "Diagnóstico Black", ruta: final.ruta,
          rango: final.cot && final.cot.rango ? String(final.cot.rango.n) : "", cta_origen: final.cta,
        };
        var idWa = final.leadId + "-wa";
        APP.pixel("Contact", datos, { eventID: idWa });
        mandarACapi("Contact", idWa, datos, final.usuario);
      }
      irAWhatsApp(final.url, final.crmListo);
    });
    return btn;
  }

  /** Pinta la pantalla final que corresponde a `final` (cotización,
      reforma o no califica). CotizacionVista sale una sola vez por lead,
      aunque cierre y vuelva a abrir. */
  function pantallaFinal() {
    cortarCarga();
    limpiarCuerpo();
    var Fz = F.final || {};
    var c = Fz.cotizacion || {};
    var cont = h("div", { class: "f-final" });
    var t;

    if (final.tipo === "noCalifica") {
      var n = Fz.noCalifica || {};
      var ig = h("a", { class: "btn btn-1 btn-lg", href: final.url, target: "_blank", rel: "noopener noreferrer" },
        [svgUse("i-ig"), h("span", { text: n.boton || "" })]);
      ig.addEventListener("click", function () { APP.track("instagram_redirect", { origen: "formulario" }); });
      t = h("h2", { id: "form-titulo", tabindex: "-1", text: plantilla(n.titulo || "", { nombre: final.nombre }) });
      cont.appendChild(t);
      cont.appendChild(h("p", { text: n.texto || "" }));
      cont.appendChild(ig);
      cont.appendChild(linkOtroCaso(c.otroCaso || ""));
      cuerpo.appendChild(cont);
      enfocar(t);
      return;
    }

    var cot = final.cot || {};
    var rg = cot.rango;
    var C = F.cotizacion || {};
    if (rg) {
      cont.className += " f-cot";
      t = tituloCotizacion(c.titulo, { nombre: final.nombre, min: pesos(rg.min), max: pesos(rg.max) });
      cont.appendChild(t);
      // Una sola línea: qué incluye su rango (+ traslados fuera de CABA).
      var linea = [rg.incluye, final.zona && final.zona !== "CABA" ? C.trasladoFueraCaba : ""].filter(Boolean).join(" ");
      if (linea) cont.appendChild(h("p", { class: "f-incluye", text: linea }));
    } else {
      t = h("h2", { id: "form-titulo", tabindex: "-1", text: plantilla((Fz.reforma || {}).titulo || "", { nombre: final.nombre }) });
      cont.appendChild(t);
    }

    cont.appendChild(botonWhatsApp(c));
    cont.appendChild(linkOtroCaso(c.otroCaso || ""));
    cuerpo.appendChild(cont);
    enfocar(t);

    // CotizacionVista (Píxel + CAPI con el mismo eventID, y GA4): una vez.
    if (rg && !final.visto) {
      final.visto = true;
      var datosCot = {
        rango: String(rg.n), cotizacion_min: rg.min, cotizacion_max: rg.max,
        zona: final.zona, propiedades: final.propiedades, cta_origen: final.cta,
      };
      var idCot = final.leadId + "-cot";
      APP.pixelCustom("CotizacionVista", datosCot, { eventID: idCot });
      mandarACapi("CotizacionVista", idCot, datosCot, final.usuario);
      APP.track("cotizacion_vista", datosCot);
    }
  }

  /* ---------------------------------------------------- abrir/cerrar --- */

  /** Formulario nuevo: después de "Cotizar otro caso" o pasados 30 min
      del envío. Vuelve a contar el inicio (InitiateCheckout + paso 1). */
  function reiniciar() {
    cortarCarga();
    enviado = false;
    final = null;
    S = nuevoEstado();
    try { sessionStorage.removeItem(DRAFT); } catch (e) { /* sin storage */ }
    pasosMeta = {};
    sesionId = null;
    inicioTrackeado = false;
  }

  /** Inicio del formulario: InitiateCheckout + FormularioPaso 1, una vez. */
  function iniciar(desde) {
    if (inicioTrackeado) return;
    inicioTrackeado = true;
    APP.track("form_start", { cta_id: desde || APP.getCta() });
    var datosIni = { content_name: "Diagnóstico Black", cta_origen: desde || APP.getCta() };
    var idIni = sesionMeta() + "-ic";
    APP.pixel("InitiateCheckout", datosIni, { eventID: idIni });
    mandarACapi("InitiateCheckout", idIni, datosIni);
    // Paso 1 siempre junto con el inicio: si retoma un borrador (recargó la
    // página a mitad del formulario) abre en el paso N y, sin esto, un
    // inicio basado en "paso 1" quedaba sin contar aunque después llegue
    // el Lead.
    if (S.i > 0) reportarPaso(visibles()[0], 0, visibles().length);
  }

  function abrir(desde) {
    if (abierto) return;
    abierto = true;
    abridor = document.activeElement;
    // Ya envió en esta visita: vuelve a ver su resultado. A los 30 min,
    // arranca de cero.
    if (enviado && Date.now() - enviadoEn > REINICIO) reiniciar();
    modal.hidden = false;
    document.documentElement.classList.add("modal-abierto");
    document.documentElement.style.overflow = "hidden";
    document.dispatchEvent(new CustomEvent("black:modal"));
    try {
      if (!history.state || !history.state.blkForm) history.pushState({ blkForm: 1 }, "");
    } catch (e) { /* WebViews sin history */ }

    if (enviado && final) {
      // Si cerró durante la carga, ve el resultado directo.
      pantallaFinal();
      return;
    }
    iniciar(desde);
    ultimaRuta = ruta();
    pintar(0);
  }

  function cerrar() {
    if (!abierto) return;
    abierto = false;
    modal.hidden = true;
    document.documentElement.classList.remove("modal-abierto");
    document.documentElement.style.overflow = "";
    document.dispatchEvent(new CustomEvent("black:modal"));
    if (abridor && abridor.focus) {
      try { abridor.focus({ preventScroll: true }); } catch (e) { /* nada */ }
    }
  }

  /** Cerrar desde la interfaz: si abrimos una entrada de historial, se
      consume con back() (así el botón Atrás de Android también cierra). */
  function cerrarUI() {
    if (history.state && history.state.blkForm) history.back();
    else cerrar();
  }

  window.addEventListener("popstate", function () { if (abierto) cerrar(); });

  $$("[data-cerrar-form]", modal).forEach(function (b) { b.addEventListener("click", cerrarUI); });

  document.addEventListener("keydown", function (e) {
    if (!abierto) return;
    if (e.key === "Escape") { e.preventDefault(); cerrarUI(); return; }
    if (e.key !== "Tab") return;
    var foco = $$('button:not([disabled]), input:not([tabindex="-1"]), a[href], [tabindex="0"]', panel)
      .filter(function (x) { return x.offsetParent !== null; });
    if (!foco.length) return;
    var a = foco[0], z = foco[foco.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  });

  window.BlackForm = { abrir: abrir, cerrar: cerrarUI };

  // Envíos que quedaron pendientes en una visita anterior (red cortada).
  setTimeout(reintentarCola, 1500);

  // Entrada directa: blackarquitectura.com/#diagnostico abre el formulario.
  if (location.hash === "#diagnostico") {
    if (APP.setCta) APP.setCta("directo");
    setTimeout(function () { abrir("directo"); }, 400);
  }
})();
