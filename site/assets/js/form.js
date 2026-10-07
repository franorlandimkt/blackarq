/* ==========================================================================
   BLACK — motor del formulario condicional.
   Lee todo el contenido de window.BLACK_FORM (form-config.js). Para cambiar
   preguntas, opciones, saltos o reglas de calificación NO se toca este
   archivo.

   Flujo al enviar (califique o no):
     1. Lead completo a Google Sheets: fetch text/plain + keepalive (sin
        preflight de CORS). No bloquea ni demora nada. Antes de mandarlo se
        guarda en una cola en localStorage; si el envío falla, se reintenta
        en la próxima carga de la página. El script descarta duplicados por
        lead_id.
     2. Eventos de GA4 (+ Lead de Meta solo si califica, con eventID =
        lead_id para deduplicar con la API de Conversiones).
     3. Califica → WhatsApp con el mensaje prellenado.
        No califica → pantalla final con el Instagram.
   ========================================================================== */
(function () {
  "use strict";

  var F = window.BLACK_FORM;
  var CFG = window.BLACK || {};
  var APP = window.BLACK_APP || { track: function () {}, pixel: function () {}, getAtribucion: function () { return {}; }, getCta: function () { return "directo"; }, getCtasSesion: function () { return ""; } };
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
  var S = cargar() || { r: {}, otros: {}, d: {}, i: 0 };
  var abierto = false, enviado = false, inicioTrackeado = false, ultimaRuta = null;
  var abridor = null;

  function cargar() {
    try { return JSON.parse(sessionStorage.getItem(DRAFT) || "null"); } catch (e) { return null; }
  }
  function guardar() {
    try { sessionStorage.setItem(DRAFT, JSON.stringify(S)); } catch (e) { /* sin storage */ }
  }

  /* ---------------------------------------------------------- lógica --- */

  var preguntas = F.preguntas || [];
  var primera = preguntas[0];

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
  function valorTexto(p) {
    var v = S.r[p.id];
    if (v == null) return "";
    if (p.tipo !== "multiple") return String(v);
    return v.map(function (x) {
      var o = opcion(p, x);
      if (o && o.abreTexto && S.otros[p.id]) return x + ": " + S.otros[p.id].trim();
      return x;
    }).join(" · ");
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
        inputmode: c.tipo === "tel" ? "tel" : null, maxlength: "80",
        enterkeyhint: "next", autocapitalize: c.tipo === "tel" ? null : "words",
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
    var span = $("span", btn);
    if (span) span.textContent = T.enviando || "Enviando…";
    btn.disabled = true;

    var lista = visibles();
    var cal = calificacion();
    var rt = ruta();
    var attr = APP.getAtribucion();
    var leadId = nuevoLeadId();
    var nombre = (S.d.nombre || "").trim();
    var tel = telefonoAR(S.d.whatsapp);

    // Columnas de la hoja "Leads", por nombre de encabezado. Las respuestas
    // usan la `columna` de cada pregunta (form-config.js).
    var fields = { lead_id: leadId, ref_whatsapp: refCorta(leadId) };
    var porClave = { nombre: nombre, lead_id: refCorta(leadId) };
    lista.forEach(function (p) {
      if (p.tipo === "datos") return;
      var txt = valorTexto(p);
      if (p.columna) fields[p.columna] = txt;
      porClave[clave(p)] = txt;
    });
    fields.ruta = (F.rutas && F.rutas[rt]) || rt || "";
    fields.califica = cal.ok ? "Sí" : "No";
    fields.motivo_descalificacion = cal.motivo;
    lista.forEach(function (p) {
      if (p.tipo !== "datos") return;
      (p.campos || []).forEach(function (c) {
        var v = (S.d[c.id] || "").trim();
        if (c.validar === "telefonoAR") v = "+" + tel;
        fields[c.id] = v;
        porClave[c.id] = v;
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

    // 1. Sheets. Fuego y olvido: nunca demora el paso a WhatsApp.
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

    // 3. Destino.
    if (cal.ok) {
      APP.pixel("Lead", { content_name: "Diagnóstico Black" }, { eventID: leadId });
      var msg = plantilla((F.whatsapp && F.whatsapp.mensaje) || "", porClave);
      var url = "https://wa.me/" + (CFG.whatsapp || "") + "?text=" + encodeURIComponent(msg);
      pantallaFinal("califica", url, nombre);
      irAWhatsApp(url);
    } else {
      pantallaFinal("noCalifica", CFG.instagram || "https://www.instagram.com/black_arq/", nombre);
    }
  }

  /** Redirige ya. Espera como mucho 300 ms a que GA4 confirme el evento. */
  function irAWhatsApp(url) {
    var fue = false;
    function go() {
      if (fue) return;
      fue = true;
      location.href = url;
    }
    APP.track("whatsapp_redirect", { event_callback: go, event_timeout: 300 });
    setTimeout(go, 300);
  }

  function pantallaFinal(tipo, url, nombre) {
    var c = (F.final && F.final[tipo]) || {};
    barra.style.width = "100%";
    etiquetaPaso.textContent = "";
    cuerpo.innerHTML = "";
    var esWa = tipo === "califica";
    var btn = h("a", {
      class: "btn btn-1 btn-lg", href: url,
      target: esWa ? null : "_blank", rel: esWa ? null : "noopener noreferrer",
    }, [esWa ? svgUse("i-wa") : svgUse("i-ig"), h("span", { text: c.boton || "" })]);
    btn.addEventListener("click", function () {
      APP.track(esWa ? "whatsapp_redirect" : "instagram_redirect", { origen: "formulario" });
    });
    var t = h("h2", { id: "form-titulo", tabindex: "-1", text: plantilla(c.titulo || "", { nombre: nombre }) });
    cuerpo.appendChild(h("div", { class: "f-final" }, [t, h("p", { text: c.texto || "" }), btn]));
    try { t.focus({ preventScroll: true }); } catch (e) { t.focus(); }
  }

  /* ---------------------------------------------------- abrir/cerrar --- */

  function abrir(desde) {
    if (abierto) return;
    abierto = true;
    abridor = document.activeElement;
    if (enviado) {
      // Ya envió en esta visita: arranca de cero.
      enviado = false;
      S = { r: {}, otros: {}, d: {}, i: 0 };
    }
    modal.hidden = false;
    document.documentElement.classList.add("modal-abierto");
    document.documentElement.style.overflow = "hidden";
    document.dispatchEvent(new CustomEvent("black:modal"));
    try {
      if (!history.state || !history.state.blkForm) history.pushState({ blkForm: 1 }, "");
    } catch (e) { /* WebViews sin history */ }

    if (!inicioTrackeado) {
      inicioTrackeado = true;
      APP.track("form_start", { cta_id: desde || APP.getCta() });
      APP.pixel("InitiateCheckout", { content_name: "Diagnóstico Black" });
    }
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
