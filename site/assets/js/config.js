/* ==========================================================================
   CONFIGURACIÓN DEL SITIO
   Se edita con cualquier editor de texto. Las preguntas del formulario NO
   están acá: están en form-config.js.
   ========================================================================== */

window.BLACK = {
  /* --- WhatsApp ---------------------------------------------------------
     Solo números, con código de país y sin el +.
     54 (Argentina) + 9 (celular) + área sin 0 + número sin 15.            */
  whatsapp: "5491164803777",

  /* --- Redes ------------------------------------------------------------ */
  instagram: "https://www.instagram.com/black_arq/",

  /* --- Píxel de Meta ----------------------------------------------------
     Vacío = no se carga. Con ID, dispara PageView, InitiateCheckout al abrir
     el formulario y Lead SOLO en envíos calificados (con eventID = lead_id,
     para deduplicar si después se suma la API de Conversiones).
     Meta Business > Administrador de eventos > tu píxel > ID.
     (GA4 está instalado en el <head> de index.html: G-EE9PC274XF.)        */
  metaPixelId: "",

  /* --- Registro de leads en Google Sheets --------------------------------
     url:   la URL de la aplicación web de Apps Script (termina en /exec).
            Vacía = no se envía nada (útil para probar en local).
     token: tiene que ser IGUAL al TOKEN de integrations/sheets/Code.gs.
            Instrucciones de publicación: README.md, en la raíz del repo.
            No es una contraseña (cualquiera puede verlo en el navegador):
            sirve para descartar envíos que no vienen de este sitio.       */
  sheets: {
    url: "",
    token: "blk_1c8fdfbb46be0a9ec65a444f",
  },

  /* --- Cifras de trayectoria ---------------------------------------------
     Se escriben en la barra superior y en "Quiénes somos". Si las cambiás
     acá, cambialas también en index.html (buscá data-stat): el número del
     HTML es el que se ve si el JavaScript no corre.
     Las reseñas ya no están acá: viven en data/reviews.json.             */
  stats: {
    anos: 15,
    obras: 120,
    m2: 18000,
  },
};
