/* ==========================================================================
   FORMULARIO — TODO EL CONTENIDO VIVE ACÁ
   Textos, opciones, saltos y reglas de calificación. La lógica (form.js) no
   se toca para cambiar preguntas.

   CÓMO SE DEFINE UNA PREGUNTA
   ---------------------------
   {
     id:        identificador único (sin espacios).
     clave:     (opcional) nombre del dato. Dos preguntas excluyentes pueden
                compartir clave (ej. los dos presupuestos → "presupuesto").
                Si falta, se usa el id. Es lo que se usa en {llaves} del
                mensaje de WhatsApp.
     columna:   encabezado de la columna en la hoja "Leads" de Google
                Sheets. Si la columna no existe, el script la crea al final.
     tipo:      "unica"    → una opción; avanza sola al tocar.
                "multiple" → varias opciones + botón Siguiente.
                "texto"    → campo de texto corto + botón Siguiente.
                "datos"    → nombre y WhatsApp + botón de envío (va última).
     titulo:    texto de la pregunta. Puede ser un texto o un objeto por
                ruta: { compra: "...", reforma: "..." }.
     mostrarSi: (opcional) { ruta: "compra" } o { ruta: "reforma" }.
                Sin esto, la pregunta se muestra siempre.
     opciones:  [{ valor, ruta?, noCalifica?, motivo?, abreTexto? }]
                ruta:       "compra" | "reforma". La primera pregunta define
                            la ruta de las siguientes.
                noCalifica: true → el lead no califica (no va a WhatsApp).
                motivo:     texto que se guarda en "Motivo de descalificación".
                abreTexto:  true → al marcarla aparece un campo de texto
                            (lo que se escribe se guarda como "Otro: ...").
   }

   Para agregar una pregunta: copiá un bloque, cambiá id/columna/titulo/
   opciones y ubicalo en el orden en que se tiene que ver.
   ========================================================================== */

window.BLACK_FORM = {
  intro: {
    titulo:
      "Estás por tomar una decisión importante y queremos entender en qué instancia estás para saber si nuestro Diagnóstico puede ayudarte.",
    micro: "Completá estas preguntas. Nos lleva menos de 2 minutos.",
  },

  // Nombre de cada ruta tal como se escribe en la columna "Ruta".
  rutas: { compra: "Compra", reforma: "Reforma" },

  preguntas: [
    /* 1 ------------------------------------------------------------------ */
    {
      id: "situacion",
      columna: "Situación",
      tipo: "unica",
      titulo: "¿En qué situación estás actualmente?",
      opciones: [
        { valor: "Ya encontré una propiedad y estoy evaluando si comprarla", ruta: "compra" },
        { valor: "Estoy comparando entre 2 o más propiedades", ruta: "compra" },
        { valor: "Estoy buscando activamente una propiedad", ruta: "compra" },
        { valor: "Estoy en proceso de negociar el precio", ruta: "compra" },
        { valor: "Ya reservé una propiedad y quiero evaluarla antes de avanzar", ruta: "compra" },
        { valor: "Ya tengo el inmueble y quiero evaluar una reforma", ruta: "reforma" },
        { valor: "Todavía estoy investigando y no tengo una propiedad concreta", ruta: "compra" },
      ],
    },

    /* 2 ------------------------------------------------------------------ */
    {
      id: "zona",
      columna: "Zona",
      tipo: "texto",
      titulo: "¿Dónde está ubicada la propiedad?",
      placeholder: "Barrio / localidad",
      autocomplete: "address-level2",
    },

    /* 3A ----------------------------------------------------------------- */
    {
      id: "presupuesto_compra",
      clave: "presupuesto",
      columna: "Presupuesto",
      tipo: "unica",
      mostrarSi: { ruta: "compra" },
      titulo: "¿Cuál es el presupuesto total que tenés para destinar a tu nueva propiedad?",
      opciones: [
        { valor: "Menos de USD 70.000" },
        { valor: "USD 70.000 – 120.000" },
        { valor: "USD 120.000 – 180.000" },
        { valor: "USD 180.000 – 250.000" },
        { valor: "USD 250.000 – 400.000" },
        { valor: "Más de USD 400.000" },
        { valor: "Todavía no tengo una propiedad definida" },
      ],
    },

    /* 3B ----------------------------------------------------------------- */
    {
      id: "presupuesto_reforma",
      clave: "presupuesto",
      columna: "Presupuesto",
      tipo: "unica",
      mostrarSi: { ruta: "reforma" },
      titulo: "¿Cuál es el presupuesto total que tenés para destinar a la reforma de tu propiedad?",
      opciones: [
        { valor: "Menos de USD 15.000", noCalifica: true, motivo: "Presupuesto de reforma menor a USD 15.000" },
        { valor: "USD 15.000 – 30.000" },
        { valor: "USD 30.000 – 50.000" },
        { valor: "USD 50.000 – 80.000" },
        { valor: "USD 80.000 – 150.000" },
        { valor: "USD 150.000 – 300.000" },
        { valor: "Más de USD 300.000" },
      ],
    },

    /* 4 ------------------------------------------------------------------ */
    {
      id: "plazo",
      columna: "Plazo",
      tipo: "unica",
      titulo: {
        compra: "¿En qué plazo te gustaría concretar la compra?",
        reforma: "¿En qué plazo te gustaría concretar la reforma?",
      },
      opciones: [
        { valor: "Esta semana" },
        { valor: "Dentro de los próximos 30 días" },
        { valor: "Entre 1 y 3 meses" },
        { valor: "Entre 3 y 6 meses" },
        { valor: "Más adelante" },
        { valor: "Todavía no lo tengo definido" },
      ],
    },

    /* 5 ------------------------------------------------------------------
       Se muestra en las dos rutas. Si querés saltearla para quien ya tiene
       el inmueble, agregá:  mostrarSi: { ruta: "compra" },               */
    {
      id: "visito",
      columna: "¿Visitó la propiedad?",
      tipo: "unica",
      titulo: "¿Ya visitaste personalmente la propiedad?",
      opciones: [
        { valor: "Sí, y estoy seriamente interesado/a" },
        { valor: "Sí, pero todavía tengo dudas" },
        { valor: "Todavía no, pero ya tengo coordinada una visita" },
        { valor: "No" },
      ],
    },

    /* 6 ------------------------------------------------------------------ */
    {
      id: "objetivos",
      columna: "Qué busca",
      tipo: "multiple",
      titulo: "¿Qué te gustaría obtener del Diagnóstico?",
      ayuda: "Podés elegir más de una.",
      opciones: [
        { valor: "Saber si compraríamos o no esa propiedad" },
        { valor: "Evaluar su estado arquitectónico y constructivo" },
        { valor: "Detectar posibles problemas antes de comprar" },
        { valor: "Entender qué reformas se pueden realizar" },
        { valor: "Tener una estimación inicial de la inversión necesaria" },
        { valor: "Analizar si el precio publicado tiene sentido" },
        { valor: "Tener argumentos para negociar el precio" },
        { valor: "Compararla con otra propiedad" },
        { valor: "Evaluar su potencial como inversión" },
        { valor: "Otro", abreTexto: true, placeholder: "Contanos qué buscás" },
      ],
    },

    /* 7 ------------------------------------------------------------------
       [TEXTO A CONFIRMAR] Es el ÚNICO lugar del sitio donde aparece el valor.
       Funciona como filtro.                                               */
    {
      id: "inversion",
      columna: "Disposición a invertir",
      tipo: "unica",
      titulo:
        "Nuestra asesoría tiene un valor base de $300.000 e incluye el análisis profesional online de la propiedad para ayudarte a tomar una decisión con claridad. ¿Estás dispuesto/a a invertir en este asesoramiento?",
      opciones: [
        { valor: "Sí, quiero avanzar" },
        { valor: "Sí, también quisiera que visiten mi propiedad" },
        { valor: "Sí, pero antes quisiera entender exactamente qué incluye" },
        { valor: "No, por el momento busco únicamente información gratuita", noCalifica: true, motivo: "Busca información gratuita" },
      ],
    },

    /* 8 ------------------------------------------------------------------ */
    {
      id: "datos",
      tipo: "datos",
      titulo: "Tus datos",
      campos: [
        { id: "nombre", columna: "Nombre", label: "Nombre", tipo: "text", autocomplete: "given-name", requerido: true },
        { id: "whatsapp", columna: "WhatsApp", label: "WhatsApp con código de área", tipo: "tel", autocomplete: "tel", placeholder: "11 6480 3777", requerido: true, validar: "telefonoAR" },
      ],
      nota: "Te escribimos solo por este tema. No hacemos llamados automáticos ni te sumamos a ninguna lista.",
    },
  ],

  textos: {
    paso: "Paso {n} de {total}",
    siguiente: "Siguiente",
    atras: "Atrás",
    enviar: "Enviar",
    enviando: "Enviando…",
    errores: {
      unica: "Elegí una opción para seguir.",
      multiple: "Elegí al menos una opción.",
      otro: "Contanos qué buscás en “Otro”.",
      texto: "Completá este dato para seguir.",
      nombre: "Escribí tu nombre.",
      whatsapp: "Escribí tu WhatsApp.",
      telefonoAR: "Revisá el número: tiene que tener código de área. Ej.: 11 6480 3777",
    },
  },

  /* Mensaje prellenado de WhatsApp (solo leads que califican).
     {llaves}: cualquier `clave` o `id` de pregunta, más {nombre} y {lead_id}. */
  whatsapp: {
    mensaje:
      "Hola, soy {nombre}. Completé el formulario del Diagnóstico Black.\nSituación: {situacion}.\nZona: {zona}.\nPresupuesto: {presupuesto}.\nPlazo: {plazo}.\n(Ref. {lead_id})",
  },

  final: {
    califica: {
      titulo: "Listo, {nombre}.",
      texto: "Te estamos abriendo WhatsApp con tus respuestas. Si no se abre solo, tocá el botón.",
      boton: "Abrir WhatsApp",
    },
    noCalifica: {
      titulo: "Gracias por tu tiempo.",
      texto:
        "Por ahora el Diagnóstico no es lo que estás buscando, pero en nuestro Instagram compartimos todo lo que hay que saber antes de comprar o reformar.",
      boton: "Ir a @black_arq",
    },
  },
};
