/* ==========================================================================
   BLACK — comportamiento del sitio (v3).
   Vanilla, sin dependencias. El formulario y el envío a Sheets viven en
   form.js.

   Regla: todo lo animado ya tiene su valor final en el HTML. Si este
   archivo no corre, o corre a medias, la página se lee completa.
   ========================================================================== */
(function () {
  "use strict";

  var CFG = window.BLACK || {};
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var desktop = window.matchMedia("(min-width: 900px)");

  function storageGet(store, key) {
    try { return JSON.parse(window[store].getItem(key) || "null"); } catch (e) { return null; }
  }
  function storageSet(store, key, val) {
    try { window[store].setItem(key, JSON.stringify(val)); } catch (e) { /* storage bloqueado */ }
  }

  /* ====================================================== ANALÍTICA ====== */

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
  /** opts: { eventID } para deduplicar con la API de Conversiones. */
  function pixel(evento, params, opts) {
    if (!window.fbq) return;
    if (opts) window.fbq("track", evento, params || {}, opts);
    else window.fbq("track", evento, params || {});
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
      while (marcas.length && pct >= marcas[0]) track("scroll_depth", { percent_scrolled: marcas.shift() });
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
  /* Dos registros en localStorage, con vencimiento de 90 días:
     - first touch (black:ft): la primera visita que llegó con parámetros de
       campaña. No se pisa hasta que vence.
     - last touch (black:lt): la última visita que llegó con parámetros. Una
       visita directa posterior no lo borra.                               */

  var FT_KEY = "black:ft";
  var LT_KEY = "black:lt";
  var TTL = 90 * 24 * 60 * 60 * 1000;
  var PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "fbclid", "campaign_id", "adset_id", "ad_id", "placement"];

  function dispositivo() {
    var ua = navigator.userAgent || "";
    var mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
    var tipo = mobile ? "mobile" : "desktop";
    if (/Instagram/i.test(ua)) return tipo + " · Instagram";
    if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(ua)) return tipo + " · Facebook";
    return tipo;
  }

  function leerToque(key) {
    var t = storageGet("localStorage", key);
    if (!t || !t.exp || t.exp < Date.now()) {
      try { localStorage.removeItem(key); } catch (e) { /* nada */ }
      return null;
    }
    return t.data || null;
  }

  function capturarAtribucion() {
    var p = new URLSearchParams(location.search);
    if (!PARAMS.some(function (k) { return !!p.get(k); })) return;
    var data = {};
    PARAMS.forEach(function (k) { data[k] = p.get(k) || ""; });
    data.fecha = new Date().toISOString();
    var registro = { data: data, exp: Date.now() + TTL };
    storageSet("localStorage", LT_KEY, registro);
    if (!leerToque(FT_KEY)) storageSet("localStorage", FT_KEY, registro);
  }

  function referrerExterno() {
    var r = document.referrer || "";
    return r && r.indexOf(location.origin) !== 0 ? r : "";
  }

  /** Todo lo que se manda a Sheets sobre el origen del lead. */
  function getAtribucion() {
    var lt = leerToque(LT_KEY) || {};
    var ft = leerToque(FT_KEY) || {};
    var a = {};
    PARAMS.forEach(function (k) { a[k] = lt[k] || ""; });
    a.ft_campaign = ft.utm_campaign || "";
    a.ft_adset = ft.utm_term || "";
    a.ft_ad = ft.utm_content || "";
    a.ft_fecha = ft.fecha || "";
    a.dispositivo = dispositivo();
    a.url = location.href.split("#")[0];
    a.referrer = referrerExterno();
    return a;
  }

  /* CTA de origen: el último que abrió el formulario, y la lista de todos los
     que se tocaron en la sesión (en orden). */
  var CTA_KEY = "black:cta_origen";
  var CTAS_KEY = "black:ctas_sesion";

  function setCta(id) {
    storageSet("sessionStorage", CTA_KEY, id);
    var lista = storageGet("sessionStorage", CTAS_KEY) || [];
    lista.push(id);
    storageSet("sessionStorage", CTAS_KEY, lista.slice(-30));
  }
  function getCta() { return storageGet("sessionStorage", CTA_KEY) || "directo"; }
  function getCtasSesion() { return (storageGet("sessionStorage", CTAS_KEY) || []).join(" > "); }

  /* Interfaz compartida con form.js */
  window.BLACK_APP = {
    track: track,
    pixel: pixel,
    getAtribucion: getAtribucion,
    getCta: getCta,
    getCtasSesion: getCtasSesion,
    setCta: setCta,
    reduce: reduce,
  };

  /* ========================================================== CTAs ====== */
  /* Todos los CTA abren el formulario (href="#diagnostico"). */

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
    $$("[data-ig]").forEach(function (a) {
      a.addEventListener("click", function () { track("instagram_redirect", { origen: "footer" }); });
    });
  }

  /* ================================================ CIFRAS (config) ====== */

  function nf(n) { return new Intl.NumberFormat("es-AR").format(n); }

  function initStats() {
    var s = CFG.stats;
    if (!s) return;
    $$("[data-stat]").forEach(function (el) {
      var v = s[el.getAttribute("data-stat")];
      if (typeof v === "number" && isFinite(v)) el.textContent = nf(v);
    });
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
      }, { threshold: 0.1 });
      ocultan.forEach(function (o) { io.observe(o); });
    }

    var altoHero = hero.offsetHeight;
    window.addEventListener("resize", function () { altoHero = hero.offsetHeight; });
    function actualizar() {
      var pasoHero = window.scrollY > altoHero * 0.8;
      var modal = document.documentElement.classList.contains("modal-abierto");
      sticky.classList.toggle("is-in", pasoHero && !tapado && !modal);
    }
    actualizar();
    window.addEventListener("scroll", actualizar, { passive: true });
    window.addEventListener("resize", actualizar);
    document.addEventListener("black:modal", actualizar);
  }

  /* ================================================ ANTES / DESPUÉS ====== */

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
      if (!("PointerEvent" in window)) {
        ba.addEventListener("touchstart", function (e) { desde(e.touches[0]); }, { passive: true });
        ba.addEventListener("touchmove", function (e) { desde(e.touches[0]); }, { passive: true });
      }
      if (range) range.addEventListener("input", function () { set(+range.value); });
    });
  }

  /* ========================================================= FAQ ========= */
  /* Una abierta a la vez. Sin JS, todas quedan abiertas. */

  function initFaq() {
    var items = $$(".faq-item");
    items.forEach(function (item, i) {
      var btn = $(".faq-btn", item);
      var panel = $(".faq-panel", item);
      panel.id = "faq-p-" + i;
      btn.setAttribute("aria-controls", panel.id);
      btn.addEventListener("click", function () {
        var abierto = item.classList.contains("abierto");
        items.forEach(function (o) {
          o.classList.remove("abierto");
          $(".faq-btn", o).setAttribute("aria-expanded", "false");
        });
        if (!abierto) {
          item.classList.add("abierto");
          btn.setAttribute("aria-expanded", "true");
          track("faq_open", { question: btn.textContent.trim() });
        }
      });
    });
  }

  /* ============================================== ECUACIÓN (3 cuentas) === */

  function initEcuacion() {
    var ec = $("[data-ecuacion]");
    if (!ec) return;
    if (reduce || !("IntersectionObserver" in window)) { ec.classList.add("is-in"); return; }
    var io = new IntersectionObserver(function (es) {
      if (es[0].isIntersecting) {
        setTimeout(function () { ec.classList.add("is-in"); }, 500);
        io.disconnect();
      }
    }, { threshold: 0.6 });
    io.observe(ec);
  }

  /* =================================================== CORTE DE MURO ===== */
  /* Al scrollear, el revoque se abre de izquierda a derecha y deja ver lo
     que hay detrás. Los números (hotspots) abren el texto de cada punto. */

  function initMuro() {
    var bloque = $("[data-muro]");
    if (!bloque) return;
    var clip = $("[data-muro-clip]", bloque);
    var borde = $("[data-muro-borde]", bloque);
    var hots = $$(".hot", bloque);
    var lista = $("[data-muro-lista]", bloque);
    var items = $$(".muro-item", bloque);
    var X0 = 110, W = 410;
    var abierto = 1;

    // Una vez abierto, no se vuelve a cerrar al subir.
    function abrir(p, forzar) {
      p = Math.max(0, Math.min(1, p));
      if (!forzar && p < abierto) return;
      if (Math.abs(p - abierto) < 0.002 && !forzar) return;
      abierto = p;
      var x = X0 + W * p;
      clip.setAttribute("x", x.toFixed(1));
      clip.setAttribute("width", (W * (1 - p)).toFixed(1));
      borde.setAttribute("d", "M" + x.toFixed(1) + " 50V500");
      borde.style.opacity = p > 0.995 ? "0" : "1";
    }

    var activo = -1;
    function activar(i, origen) {
      if (i === activo) return;
      activo = i;
      hots.forEach(function (h, k) { h.classList.toggle("on", k === i); h.setAttribute("aria-pressed", String(k === i)); });
      items.forEach(function (it, k) { it.classList.toggle("on", k === i); });
      lista.classList.add("activa");
      if (origen === "hotspot") track("muro_hotspot", { punto: i + 1 });
    }

    hots.forEach(function (h, i) {
      h.setAttribute("aria-pressed", "false");
      h.setAttribute("aria-controls", "muro-item-" + i);
      items[i].id = "muro-item-" + i;
      h.addEventListener("click", function () {
        abrir(1);
        activar(i, "hotspot");
        var it = items[i];
        if (desktop.matches) {
          it.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
        } else {
          lista.scrollTo({ left: it.offsetLeft - lista.offsetLeft - parseFloat(getComputedStyle(lista).paddingLeft || 0), behavior: reduce ? "auto" : "smooth" });
        }
      });
    });

    // Mobile: la tarjeta que queda al borde izquierdo es la activa.
    var enCola = false;
    lista.addEventListener("scroll", function () {
      if (desktop.matches || enCola) return;
      enCola = true;
      requestAnimationFrame(function () {
        enCola = false;
        var izq = lista.getBoundingClientRect().left;
        var mejor = 0, dist = Infinity;
        items.forEach(function (it, k) {
          var d = Math.abs(it.getBoundingClientRect().left - izq - 16);
          if (d < dist) { dist = d; mejor = k; }
        });
        activar(mejor);
      });
    }, { passive: true });

    // Scroll de página: apertura del revoque (todas las pantallas) y, en
    // desktop, el punto activo según el texto que está en el centro.
    var pendiente = false;
    function aplicar() {
      pendiente = false;
      var vh = window.innerHeight;
      if (!reduce) {
        var top = bloque.getBoundingClientRect().top;
        abrir((vh * 0.8 - top) / (vh * 0.55));
      }
      if (desktop.matches) {
        var centro = vh * 0.5, mejor = -1, dist = Infinity;
        items.forEach(function (it, k) {
          var r = it.getBoundingClientRect();
          var d = Math.abs(r.top + Math.min(r.height, 160) / 2 - centro);
          if (r.bottom > 0 && r.top < vh && d < dist) { dist = d; mejor = k; }
        });
        if (mejor >= 0) activar(mejor);
      }
    }
    function onScroll() {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(aplicar);
    }
    if (!reduce) abrir(0, true);
    aplicar();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    if (!desktop.matches) activar(0);
  }

  /* ======================================================= RESEÑAS ======= */
  /* data/reviews.json. Las entradas con estado "PENDIENTE" no se muestran,
     salvo con ?preview=1 en la URL (para revisar el armado). */

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
    var listaEl = sec && $("[data-res-lista]", sec);
    if (!listaEl || !window.fetch) return;
    var preview = /[?&]preview=1/.test(location.search);

    fetch("data/reviews.json", { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (R) {
        if (!R) return;
        if (typeof R.rating === "number") $$("[data-res-rating]", sec).forEach(function (x) { x.textContent = R.rating.toFixed(1).replace(".", ","); });
        if (R.total) $$("[data-res-total]", sec).forEach(function (x) { x.textContent = String(R.total); });
        if (R.url) $$("[data-res-url]", sec).forEach(function (x) { x.href = R.url; });

        var items = (R.items || []).filter(function (r) { return preview || r.estado !== "PENDIENTE"; });
        items.forEach(function (r, i) {
          var pend = r.estado === "PENDIENTE";
          var li = el("li", "res-card" + (pend ? " pendiente" : ""));
          li.setAttribute("aria-label", "Reseña " + (i + 1) + " de " + items.length);
          var head = el("div", "res-card-head");
          var av = el("span", "res-avatar");
          if (r.avatar) {
            var img = el("img");
            img.src = r.avatar; img.alt = ""; img.width = 40; img.height = 40; img.loading = "lazy";
            av.appendChild(img);
          } else {
            av.textContent = (r.inicial || (r.autor || "?").trim().charAt(0)).toUpperCase();
          }
          head.appendChild(av);
          var quien = el("div");
          quien.appendChild(el("p", "res-nombre", r.autor || ""));
          var est = el("div", "estrellas");
          var n = Math.max(1, Math.min(5, r.estrellas || 5));
          est.setAttribute("role", "img");
          est.setAttribute("aria-label", n + " de 5 estrellas");
          for (var k = 0; k < n; k++) est.appendChild(svgUse("i-star"));
          quien.appendChild(est);
          head.appendChild(quien);
          li.appendChild(head);
          li.appendChild(el("p", "res-texto", r.texto || ""));
          if (r.fecha) li.appendChild(el("p", "res-fecha", r.fecha));
          listaEl.appendChild(li);
        });

        var mas = $("[data-res-mas]", sec);
        if (mas && items.length > 6) {
          mas.hidden = false;
          mas.addEventListener("click", function () {
            listaEl.classList.add("todas");
            mas.hidden = true;
            track("reviews_more");
          });
        }
      })
      .catch(function () { /* sin reseñas: queda el encabezado y el link a Google */ });
  }

  /* ============================================ PÁGINAS SECUNDARIAS ====== */
  /* /estudio y /obras usan el sistema anterior (paginas.css), que esconde
     los bloques hasta que se marcan como visibles. Se muestran de una. */

  function initPaginasSimples() {
    if ($(".hero")) return;
    $$("[data-reveal], .mask-grupo, .persona-foto").forEach(function (x) { x.classList.add("is-in"); });
  }

  /** Corre `fn` recién cuando `el` se acerca a la pantalla: así el arranque
      no paga el costo de lo que está más abajo. */
  function cuandoCerca(el, fn) {
    if (!el) return;
    if (!("IntersectionObserver" in window)) { fn(); return; }
    var io = new IntersectionObserver(function (es) {
      if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); fn(); }
    }, { rootMargin: "600px 0px" });
    io.observe(el);
  }

  /* ========================================================= INIT ======== */

  function init() {
    capturarAtribucion();
    initPixel();
    initStats();
    initCtas();
    initScrollDepth();
    initSticky();
    initFaq();
    initEcuacion();
    initPaginasSimples();
    cuandoCerca($("#casos"), function () { initSliders(); initResenas(); });
    cuandoCerca($("[data-muro]"), initMuro);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
