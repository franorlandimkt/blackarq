/* ==========================================================================
   BLACK — comportamiento del sitio (v2).
   Vanilla, sin dependencias. Lo que anima usa transform, opacity y
   stroke-dashoffset. El formulario vive en form.js.

   Regla: todo lo animado ya tiene su valor final en el HTML. Si este
   archivo no corre, o corre a medias, la página se lee completa.
   ========================================================================== */
(function () {
  "use strict";

  var CFG = window.BLACK || {};
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function storageGet(store, key) {
    try { return JSON.parse(window[store].getItem(key) || "null"); } catch (e) { return null; }
  }
  function storageSet(store, key, val) {
    try { window[store].setItem(key, JSON.stringify(val)); } catch (e) { /* storage bloqueado */ }
  }

  /* ====================================================== ANALÍTICA ====== */
  /* gtag ya está definido en el <head>. En localhost no se carga la
     librería: los eventos quedan en window.dataLayer para inspeccionarlos. */

  function track(evento, params) {
    if (typeof window.gtag === "function") window.gtag("event", evento, params || {});
  }

  function initPixel() {
    if (!CFG.metaPixelId) return;
    /* eslint-disable */
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
    (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    window.fbq("init", CFG.metaPixelId);
    window.fbq("track", "PageView");
  }
  function pixel(evento, params) {
    if (window.fbq) window.fbq("track", evento, params || {});
  }

  /** Profundidad de scroll: 25, 50, 75 y 90 %. Una vez cada uno. */
  function initScrollDepth() {
    var marcas = [25, 50, 75, 90];
    var pendiente = false;
    function calcular() {
      pendiente = false;
      var alto = document.documentElement.scrollHeight - window.innerHeight;
      if (alto <= 0) return;
      var pct = (window.scrollY / alto) * 100;
      while (marcas.length && pct >= marcas[0]) {
        track("scroll_depth", { percent_scrolled: marcas.shift() });
      }
      if (!marcas.length) window.removeEventListener("scroll", onScroll);
    }
    function onScroll() {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(calcular);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ==================================================== ATRIBUCIÓN ====== */
  /* First touch dentro de la sesión: lo que trajo la primera URL con
     parámetros queda guardado en sessionStorage hasta que se cierre la
     pestaña. Si entra de nuevo sin parámetros, no se pisa. */

  var ATTR_KEY = "black:attr";
  var CTA_KEY = "black:cta";
  var PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "campaign_id", "adset_id", "ad_id", "placement", "fbclid"];

  function dispositivo() {
    var ua = navigator.userAgent || "";
    var mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua) ||
      (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
    var tipo = mobile ? "mobile" : "desktop";
    if (/Instagram/i.test(ua)) return tipo + " · Instagram";
    if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(ua)) return tipo + " · Facebook";
    return tipo;
  }

  function capturarAtribucion() {
    var p = new URLSearchParams(location.search);
    var trae = PARAMS.some(function (k) { return !!p.get(k); });
    var prev = storageGet("sessionStorage", ATTR_KEY);
    var prevTenia = prev && PARAMS.some(function (k) { return !!prev[k]; });
    // Se guarda la primera visita de la sesión; si esa vino sin parámetros
    // y después entra por un anuncio, gana la del anuncio.
    if (prev && (prevTenia || !trae)) return;
    var a = {};
    PARAMS.forEach(function (k) { a[k] = p.get(k) || ""; });
    a.landing_url = location.href.split("#")[0];
    // Un referrer del propio sitio (recarga, navegación interna) no es una fuente.
    a.referrer = document.referrer && document.referrer.indexOf(location.origin) !== 0 ? document.referrer : "";
    a.dispositivo = dispositivo();
    storageSet("sessionStorage", ATTR_KEY, a);
  }

  function getAtribucion() {
    return storageGet("sessionStorage", ATTR_KEY) || {};
  }

  /** Último CTA clickeado antes de abrir el formulario. */
  function setCta(id) { storageSet("sessionStorage", CTA_KEY, id); }
  function getCta() { return storageGet("sessionStorage", CTA_KEY) || "directo"; }

  /* Interfaz compartida con form.js */
  window.BLACK_APP = {
    track: track,
    pixel: pixel,
    getAtribucion: getAtribucion,
    getCta: getCta,
    setCta: setCta,
    reduce: reduce,
  };

  /* ========================================================== CTAs ====== */
  /* Los CTA son <a href="https://wa.me/..."> con data-cta: sin JS llevan
     directo a WhatsApp. Con JS abren el formulario. */

  function initCtas() {
    $$("[data-cta]").forEach(function (a) {
      a.addEventListener("click", function (e) {
        var id = a.getAttribute("data-cta");
        setCta(id);
        track("cta_click", { cta_id: id });
        if (window.BlackForm) {
          e.preventDefault();
          window.BlackForm.abrir(id);
        }
      });
    });

    $$("[data-wa-directo]").forEach(function (a) {
      a.addEventListener("click", function () { track("cta_click", { cta_id: "footer_whatsapp" }); });
    });
    $$("[data-ig]").forEach(function (a) {
      a.addEventListener("click", function () { track("instagram_redirect", { origen: "footer" }); });
    });
  }

  /* ==================================================== REVEALS ========== */

  /**
   * Dispara `alEntrar(el)` una sola vez por elemento cuando entra en
   * pantalla. IntersectionObserver + un barrido por scroll: con uno solo hay
   * escenarios (ancla, refresh a media página, pestaña en segundo plano)
   * donde algo queda sin revelar.
   */
  function alEntrarEnPantalla(lista, alEntrar) {
    if (!lista.length) return;
    var pendientes = lista.slice();
    var io = null;
    var enCola = false;

    function marcar(el) {
      var i = pendientes.indexOf(el);
      if (i < 0) return;
      pendientes.splice(i, 1);
      alEntrar(el);
      if (!pendientes.length) desconectar();
    }
    function barrer() {
      enCola = false;
      var limite = window.innerHeight * 0.9;
      pendientes.slice().forEach(function (el) {
        if (el.getBoundingClientRect().top < limite) marcar(el);
      });
    }
    function onScroll() {
      if (enCola) return;
      enCola = true;
      requestAnimationFrame(barrer);
    }
    function alVolver() { if (!document.hidden) barrer(); }
    function desconectar() {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("load", barrer);
      document.removeEventListener("visibilitychange", alVolver);
      if (io) io.disconnect();
    }

    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver(function (entradas) {
        entradas.forEach(function (e) { if (e.isIntersecting) marcar(e.target); });
      }, { rootMargin: "0px 0px -10% 0px" });
      lista.forEach(function (el) { io.observe(el); });
    }
    barrer();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("load", barrer);
    document.addEventListener("visibilitychange", alVolver);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(barrer);
  }

  function initReveals() {
    $$(".mask-grupo").forEach(function (g) {
      $$(".mask > span", g).forEach(function (s, i) { s.style.setProperty("--i", i); });
    });
    var els = $$("[data-reveal], .mask-grupo, .persona-foto");
    if (reduce) {
      els.forEach(function (el) { el.classList.add("is-in"); });
      return;
    }
    alEntrarEnPantalla(els, function (el) { el.classList.add("is-in"); });
  }

  /* ================================================ CIFRAS (config) ====== */

  function nf(n) { return new Intl.NumberFormat("es-AR").format(n); }

  function initStats() {
    var s = CFG.stats;
    if (!s) return;
    $$("[data-stat]").forEach(function (el) {
      var v = s[el.getAttribute("data-stat")];
      if (typeof v !== "number" || !isFinite(v)) return;
      el.textContent = nf(v);
      if (el.hasAttribute("data-contador")) el.setAttribute("data-contador", String(v));
    });
  }

  /* ==================================================== CONTADORES ======= */
  /* El texto final ya está en el HTML. El contador recién toca el texto
     cuando el elemento está en pantalla y el navegador está pintando. Al
     terminar (o si algo se corta) vuelve a poner exactamente ese texto. */

  function initContadores() {
    if (reduce) return;
    var els = $$("[data-contador]");
    if (!els.length) return;
    alEntrarEnPantalla(els, correr);

    function correr(el) {
      var destino = +el.getAttribute("data-contador");
      var pre = el.getAttribute("data-prefijo") || "";
      var final = el.textContent;
      if (!destino || document.hidden) return;

      // Reservamos el ancho final para que el número no empuje nada (CLS).
      el.style.minWidth = el.getBoundingClientRect().width + "px";

      var ms = 1400, t0 = null, listo = false;
      function cerrar() {
        if (listo) return;
        listo = true;
        el.textContent = final;
        document.removeEventListener("visibilitychange", cerrar);
      }
      // Red de seguridad: si requestAnimationFrame se frena (pestaña en
      // segundo plano), el número final igual aparece.
      setTimeout(cerrar, ms + 500);
      document.addEventListener("visibilitychange", cerrar);

      requestAnimationFrame(function tick(ahora) {
        if (listo) return;
        if (t0 === null) t0 = ahora;
        var t = Math.min(1, (ahora - t0) / ms);
        var e = 1 - Math.pow(1 - t, 3);
        el.textContent = pre + nf(Math.round(destino * e));
        if (t < 1) requestAnimationFrame(tick); else cerrar();
      });
    }
  }

  /* ======================================================= STICKY ======== */

  function initSticky() {
    var sticky = $(".sticky-cta");
    var hero = $(".hero");
    if (!sticky || !hero) return;
    var tapado = false;

    var ocultan = $$("[data-oculta-sticky]");
    if (ocultan.length && "IntersectionObserver" in window) {
      var visibles = [];
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          var i = visibles.indexOf(e.target);
          if (e.isIntersecting && i < 0) visibles.push(e.target);
          if (!e.isIntersecting && i >= 0) visibles.splice(i, 1);
        });
        tapado = visibles.length > 0;
        actualizar();
      }, { threshold: 0.15 });
      ocultan.forEach(function (o) { io.observe(o); });
    }

    function actualizar() {
      var pasoHero = window.scrollY > hero.offsetHeight * 0.7;
      var modal = document.documentElement.classList.contains("modal-abierto");
      sticky.classList.toggle("is-in", pasoHero && !tapado && !modal);
    }
    actualizar();
    window.addEventListener("scroll", actualizar, { passive: true });
    window.addEventListener("resize", actualizar);
    document.addEventListener("black:modal", actualizar);
  }

  /* ===================================================== TIMELINE ======== */
  /* La línea se traza a medida que se scrollea. */

  function initTimeline() {
    var tl = $(".tl");
    var trazo = $(".tl-trazo");
    var pasos = $$(".paso");
    if (!tl || !trazo || !pasos.length) return;

    if (reduce) {
      trazo.style.strokeDashoffset = "0";
      pasos.forEach(function (p) { p.classList.add("activo"); });
      return;
    }

    var pendiente = false;
    function aplicar() {
      pendiente = false;
      var r = tl.getBoundingClientRect();
      var vh = window.innerHeight;
      var avance = Math.max(0, Math.min(1, (vh * 0.62 - r.top) / r.height));
      trazo.style.strokeDashoffset = (1 - avance).toFixed(4);
      var limite = r.top + r.height * avance;
      pasos.forEach(function (p) {
        p.classList.toggle("activo", p.getBoundingClientRect().top <= limite + 4);
      });
    }
    function onScroll() {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(aplicar);
    }
    aplicar();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
  }

  /* ================================================ ANTES / DESPUÉS ====== */
  /* Punteros sobre el contenedor (mouse, touch y lápiz). touch-action:pan-y
     deja el scroll vertical en manos del navegador; el arrastre horizontal
     mueve el divisor. El range oculto queda para teclado. */

  function initSliders() {
    $$(".ba").forEach(function (ba) {
      var range = $(".ba-range", ba);
      var usado = false;
      function set(v) {
        v = Math.max(0, Math.min(100, v));
        ba.style.setProperty("--pos", v + "%");
        if (range) range.value = String(Math.round(v));
        if (!usado) {
          usado = true;
          track("case_slider_used", { case_id: ba.getAttribute("data-caso") || "" });
        }
      }
      function desde(e) {
        var r = ba.getBoundingClientRect();
        set(((e.clientX - r.left) / r.width) * 100);
      }

      var activo = false;
      ba.addEventListener("pointerdown", function (e) {
        activo = true;
        try { ba.setPointerCapture(e.pointerId); } catch (err) { /* iOS viejo */ }
        desde(e);
      });
      ba.addEventListener("pointermove", function (e) { if (activo) desde(e); });
      ["pointerup", "pointercancel", "lostpointercapture"].forEach(function (t) {
        ba.addEventListener(t, function () { activo = false; });
      });
      // Respaldo para WebViews sin Pointer Events.
      if (!("PointerEvent" in window)) {
        ba.addEventListener("touchstart", function (e) { desde(e.touches[0]); }, { passive: true });
        ba.addEventListener("touchmove", function (e) { desde(e.touches[0]); }, { passive: true });
      }
      if (range) range.addEventListener("input", function () { set(+range.value); });
    });
  }

  /* ========================================================= FAQ ========= */

  function initFaq() {
    var items = $$(".faq-item");
    items.forEach(function (item) {
      var btn = $(".faq-btn", item);
      btn.addEventListener("click", function () {
        var abierto = item.getAttribute("data-open") === "1";
        items.forEach(function (o) {
          o.setAttribute("data-open", "0");
          $(".faq-btn", o).setAttribute("aria-expanded", "false");
        });
        if (!abierto) {
          item.setAttribute("data-open", "1");
          btn.setAttribute("aria-expanded", "true");
          track("faq_open", { question: btn.textContent.trim() });
        }
      });
    });
  }

  /* ======================================================= RESEÑAS ======= */

  var SVG_NS = "http://www.w3.org/2000/svg";
  function svgUse(id, cls) {
    var s = document.createElementNS(SVG_NS, "svg");
    if (cls) s.setAttribute("class", cls);
    s.setAttribute("aria-hidden", "true");
    var u = document.createElementNS(SVG_NS, "use");
    u.setAttribute("href", "#" + id);
    s.appendChild(u);
    return s;
  }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function initResenas() {
    var sec = $("#resenas");
    if (!sec) return;
    var R = CFG.reviews;
    if (!R || !R.items || !R.items.length) { sec.remove(); return; }

    var rating = $("[data-res-rating]", sec);
    if (rating && typeof R.rating === "number") rating.textContent = R.rating.toFixed(1).replace(".", ",");
    var total = $("[data-res-total]", sec);
    if (total && R.total) total.textContent = String(R.total);
    var link = $("[data-res-url]", sec);
    if (link && R.url) link.href = R.url;

    // Testimonio destacado: solo si está completo.
    var f = R.featured;
    var fig = $("[data-res-featured]", sec);
    if (fig && f && f.name && f.barrio && f.text) {
      var q = el("blockquote", "", "“" + f.text + "”");
      var cap = el("figcaption");
      cap.appendChild(el("b", "", f.name));
      cap.appendChild(document.createTextNode(" · " + f.barrio));
      fig.appendChild(q);
      fig.appendChild(cap);
      fig.hidden = false;
    }

    var pista = $("[data-res-pista]", sec);
    R.items.forEach(function (r, i) {
      var li = el("li", "res-card");
      li.setAttribute("aria-label", "Reseña " + (i + 1) + " de " + R.items.length);
      var head = el("div", "res-card-head");
      head.appendChild(el("span", "res-avatar", (r.name || "?").trim().charAt(0).toUpperCase()));
      var quien = el("div");
      quien.appendChild(el("p", "res-nombre", r.name));
      var est = el("div", "estrellas");
      est.setAttribute("role", "img");
      est.setAttribute("aria-label", (r.rating || 5) + " de 5 estrellas");
      for (var k = 0; k < (r.rating || 5); k++) est.appendChild(svgUse("i-star"));
      quien.appendChild(est);
      head.appendChild(quien);
      head.appendChild(svgUse("i-google", "res-card-g"));
      li.appendChild(head);

      var p = el("p", "res-texto", r.text);
      p.id = "res-txt-" + i;
      li.appendChild(p);

      var mas = el("button", "res-mas", "Leer más");
      mas.type = "button";
      mas.setAttribute("aria-expanded", "false");
      mas.setAttribute("aria-controls", p.id);
      mas.hidden = true;
      mas.addEventListener("click", function () {
        var abierta = li.classList.toggle("abierta");
        mas.textContent = abierta ? "Leer menos" : "Leer más";
        mas.setAttribute("aria-expanded", String(abierta));
      });
      li.appendChild(mas);
      pista.appendChild(li);
    });

    sec.hidden = false;
    // El bloque arrancó oculto: los reveals que contiene se registraron
    // con alto cero. Se marcan a mano.
    $$(".mask-grupo", sec).forEach(function (g) {
      if (reduce) g.classList.add("is-in");
      else alEntrarEnPantalla([g], function (x) { x.classList.add("is-in"); });
    });

    // "Leer más" solo donde el texto realmente se corta en 4 líneas.
    function revisarCortes() {
      $$(".res-card", pista).forEach(function (card) {
        if (card.classList.contains("abierta")) return;
        var t = $(".res-texto", card);
        $(".res-mas", card).hidden = t.scrollHeight <= t.clientHeight + 2;
      });
    }
    revisarCortes();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(revisarCortes);
    var tRes;
    window.addEventListener("resize", function () { clearTimeout(tRes); tRes = setTimeout(revisarCortes, 150); });

    // Flechas (desktop).
    var prev = $("[data-res-prev]", sec);
    var next = $("[data-res-next]", sec);
    function paso() {
      var card = $(".res-card", pista);
      return card ? card.getBoundingClientRect().width + 16 : 300;
    }
    function estado() {
      var max = pista.scrollWidth - pista.clientWidth - 2;
      if (prev) prev.disabled = pista.scrollLeft <= 2;
      if (next) next.disabled = pista.scrollLeft >= max;
    }
    if (prev) prev.addEventListener("click", function () { pista.scrollBy({ left: -paso(), behavior: reduce ? "auto" : "smooth" }); });
    if (next) next.addEventListener("click", function () { pista.scrollBy({ left: paso(), behavior: reduce ? "auto" : "smooth" }); });
    pista.addEventListener("scroll", estado, { passive: true });
    window.addEventListener("resize", estado);
    estado();
  }

  /* ========================================================= INIT ======== */

  function init() {
    capturarAtribucion();
    initPixel();
    initStats();
    initCtas();
    initScrollDepth();
    initReveals();
    initContadores();
    initSticky();
    initTimeline();
    initSliders();
    initFaq();
    initResenas();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
