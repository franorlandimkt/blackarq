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
     el formulario y Lead SOLO en envíos calificados.
     Meta Business > Administrador de eventos > tu píxel > ID.
     (GA4 está instalado en el <head> de index.html: G-EE9PC274XF.)        */
  metaPixelId: "",

  /* --- Registro de leads en Google Sheets --------------------------------
     url:   la URL de la aplicación web de Apps Script (termina en /exec).
            Vacía = no se envía nada (útil para probar en local).
     token: tiene que ser IGUAL al TOKEN de google-apps-script/Code.gs.
            No es una contraseña (cualquiera puede verlo en el navegador):
            sirve para descartar envíos que no vienen de este sitio.       */
  sheets: {
    url: "",
    token: "blk_1c8fdfbb46be0a9ec65a444f",
  },

  /* --- Cifras de trayectoria ---------------------------------------------
     Se escriben en la barra superior y en los contadores del bloque 14.
     Si las cambiás acá, cambialas también en index.html (buscá data-stat):
     el número del HTML es el que se ve si el JavaScript no corre.         */
  // BORRADOR - reemplazar por datos reales
  stats: {
    anos: 15, // BORRADOR - reemplazar por datos reales
    obras: 120, // BORRADOR - reemplazar por datos reales
    m2: 18000, // BORRADOR - reemplazar por datos reales
  },

  /* --- Reseñas de Google (carga manual) -----------------------------------
     Textos literales: no corregir nada, son reseñas reales.
     El orden es el que se muestra. Si `items` queda vacío, el bloque de
     reseñas no aparece.

     featured: testimonio destacado arriba del carrusel. Se muestra SOLO si
     tiene name, barrio y text completos. Dejalo con strings vacíos hasta
     tenerlo.                                                              */
  reviews: {
    rating: 5.0,
    total: 41,
    url: "https://maps.google.com/?cid=7365464068826002467",
    featured: { name: "", barrio: "", text: "" },
    items: [
      {
        name: "Diego Rodriguez",
        rating: 5,
        text: "Muy Buena Atención de ambos!! Esteban con el asesoramiento para hacer tareas de refacciones y realizarlas con mucho detalle (un 10), como Carla para la venta de la propiedad y la búsqueda de la futura casa, Una dupla extraordinaria!!! parecen Marido y Mujer."
      },
      {
        name: "Anthony Cremona",
        rating: 5,
        text: "Excelente asesoramiento por parte del dueño, se supieron adaptar a nuestras necesidades y presupuesto. 100% recomendado"
      },
      {
        name: "Julio Roma",
        rating: 5,
        text: "Muy bueno el servicio ! Super responsables con toda la información y la manera de explicarla. Muy profesional en lo que hacen. Los recomiendo"
      },
      {
        name: "Ayelén Bramajo",
        rating: 5,
        text: "Son excelentes, la calidad de su trabajo y profesionalismo es impecable. Esteban es súper profesional y humano, desde el primer momento se ocupó de todo, incluso de cada preocupación o duda que tuvimos. Recomiendo %100!!"
      },
      {
        name: "Lucas Cabrera",
        rating: 5,
        text: "Destaco la calidad humana y el profesionalismo con el que trabajan. Realmente eso de \"agregamos valor en la obras\", es asi, tal cual! Felicitaciones."
      }
    ]
  }
};
