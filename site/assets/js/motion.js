/* ==========================================================================
   BLACK — motion de la landing.
   Vanilla (IntersectionObserver + requestAnimationFrame + transiciones CSS),
   sin librerías: el sitio no tiene build y así no suma peso al primer render.

   Corre solo si <html> tiene la clase `motion` (la pone el script del
   <head> salvo con prefers-reduced-motion). Sin ella, todo queda en su
   estado final: números finales, ilustraciones dibujadas, resaltados
   pintados. La entrada del hero la dispara un script inline en index.html.
   ========================================================================== */
(function () {
  "use strict";

  var root = document.documentElement;
  if (!root.classList.contains("motion")) return;
  window.__motion = true;

  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var nf = new Intl.NumberFormat("es-AR");
  var hasIO = "IntersectionObserver" in window;

  function clamp(v) { return Math.max(0, Math.min(1, v)); }
  function easeOut(k) { return 1 - Math.pow(1 - k, 3); }

  /** Agrega .is-in a `el` cuando entra en pantalla (una sola vez). */
  function alEntrar(els, fn, opts) {
    if (!els.length) return;
    if (!hasIO) { els.forEach(fn); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        fn(e.target);
      });
    }, opts || { rootMargin: "0px 0px -12% 0px", threshold: 0.15 });
    els.forEach(function (el) { io.observe(el); });
  }
  function marcar(el) { el.classList.add("is-in"); }

  /* -------------------------------------------------------- contadores -- */

  function formato(el, v) {
    el.textContent = (el.getAttribute("data-prefix") || "") + nf.format(Math.round(v));
  }
  function contar(el, dur) {
    var a = +(el.getAttribute("data-from") || 0);
    var b = +el.getAttribute("data-count");
    var t0 = null;
    dur = dur || 1300;
    requestAnimationFrame(function paso(t) {
      if (t0 === null) t0 = t;
      var k = Math.min(1, (t - t0) / dur);
      formato(el, a + (b - a) * easeOut(k));
      if (k < 1) requestAnimationFrame(paso);
    });
  }

  var contadores = $$("[data-count]");
  contadores.forEach(function (el) { formato(el, +(el.getAttribute("data-from") || 0)); });

  var enHero = function (el) { return !!el.closest("[data-hero]"); };

  /* ----------------------------------------------- dibujo de las SVG ---- */
  /* pathLength = 1 en cada trazo dibujable: el CSS anima dashoffset 1 → 0. */

  $$("[data-draw]").forEach(function (g) {
    $$(".s, .s2, .y", g).forEach(function (p) {
      if (p.classList.contains("nd") || p.tagName === "text" || p.tagName === "g") return;
      p.setAttribute("pathLength", "1");
    });
  });

  /* ------------------------------------------------------ reveals ------- */

  $$("[data-stagger]").forEach(function (g) {
    Array.prototype.forEach.call(g.children, function (c, i) { c.style.setProperty("--i", Math.min(i, 8)); });
  });

  alEntrar($$("[data-reveal], [data-stagger]"), marcar);
  alEntrar($$("[data-draw], [data-ecu]"), marcar, { rootMargin: "0px 0px -15% 0px", threshold: 0.3 });
  alEntrar($$(".hl-u, .hl-m").filter(function (e) { return !enHero(e); }), function (el) {
    setTimeout(function () { marcar(el); }, 250);
  }, { rootMargin: "0px 0px -18% 0px", threshold: 1 });
  alEntrar(contadores.filter(function (e) { return !enHero(e); }), function (el) {
    contar(el);
  }, { threshold: 0.6 });

  var scrollers = [];

  /* --------------------------------------------- scroll: línea de tiempo */
  /* La línea amarilla avanza con el scroll y cada hito se enciende al pasar.
     Mobile: vertical. Desktop (≥ 1024): horizontal, un tramo por fila. */

  var horizontal = window.matchMedia("(min-width: 1024px)");
  $$("[data-tramo]").forEach(function (tramo) {
    var cont = tramo.querySelector(".tramo-in");
    var fill = tramo.querySelector("[data-tl-fill]");
    var riel = fill.parentNode;
    var pasos = $$(".tl-paso", tramo);
    var maxP = 0;
    fill.style.setProperty("--p", 0);
    scrollers.push({
      el: tramo,
      fn: function (vh) {
        var r = cont.getBoundingClientRect();
        var p = horizontal.matches
          ? clamp((vh * 0.8 - r.top) / (vh * 0.4))
          : clamp((vh * 0.62 - r.top) / r.height);
        if (p <= maxP) return;
        maxP = p;
        fill.style.setProperty("--p", p.toFixed(4));
        var rr = riel.getBoundingClientRect();
        pasos.forEach(function (li) {
          var n = li.querySelector(".tl-n").getBoundingClientRect();
          var umbral = horizontal.matches
            ? (n.left + n.width / 2 - rr.left) / Math.max(1, rr.width)
            : (n.top + n.height / 2 - rr.top) / Math.max(1, rr.height);
          li.classList.toggle("on", p >= umbral - 0.02);
        });
      },
    });
  });

  /* Un solo listener de scroll, y solo mira lo que está cerca de pantalla. */
  if (scrollers.length) {
    var cerca = [];
    if (hasIO) {
      var ioS = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          var s = scrollers.filter(function (x) { return x.el === e.target; })[0];
          var i = cerca.indexOf(s);
          if (e.isIntersecting && i < 0) cerca.push(s);
          if (!e.isIntersecting && i >= 0) cerca.splice(i, 1);
        });
        tick();
      }, { rootMargin: "200px 0px" });
      scrollers.forEach(function (s) { ioS.observe(s.el); });
    } else {
      cerca = scrollers.slice();
    }
    var pendiente = false;
    var tick = function () {
      pendiente = false;
      var vh = window.innerHeight;
      cerca.forEach(function (s) { s.fn(vh); });
    };
    var onScroll = function () {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(tick);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
  }
})();
