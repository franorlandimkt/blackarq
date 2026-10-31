/* ==========================================================================
   FORMULARIO — TODO EL CONTENIDO VIVE ACÁ
   Textos, opciones, saltos y reglas de calificación. La lógica (form.js) no
   se toca para cambiar preguntas.

   CÓMO SE DEFINE UNA PREGUNTA
   ---------------------------
   {
     id:        identificador único (sin espacios).
     clave:     (opcional) nombre del dato. Dos preguntas excluyentes pueden
                compartir clave (ej. una pregunta por ruta con el mismo dato).
                Si falta, se usa el id. Es lo que se usa en {llaves} del
                mensaje de WhatsApp.
     columna:   encabezado de la columna en la hoja "Leads" de Google
                Sheets. Si la columna no existe, el script la crea antes de
                las columnas manuales (integrations/sheets/Code.gs).
     tipo:      "unica"    → una opción; avanza sola al tocar.
                "multiple" → varias opciones + botón Siguiente.
                "texto"    → campo de texto corto + botón Siguiente.
                "datos"    → nombre y WhatsApp + botón de envío (va última).
     titulo:    texto de la pregunta. Puede ser un texto o un objeto por
                ruta: { compra: "...", reforma: "..." }.
     mostrarSi: (opcional) { ruta: "compra" } o { ruta: "reforma" }.
                Sin esto, la pregunta se muestra siempre.
     opciones:  [{ valor, ruta?, noCalifica?, motivo?, abreTexto?, flag?, chip? }]
                ruta:       "compra" | "reforma". La primera pregunta define
                            la ruta de las siguientes.
                noCalifica: true → el lead no califica (no va a WhatsApp).
                motivo:     texto que se guarda en "Motivo de descalificación".
                abreTexto:  true → al marcarla aparece un campo de texto
                            (lo que se escribe se guarda como "Otro: ...").
                flag:       "visita" | "docs". Marca que el caso necesita
                            visita técnica o revisión documental (mueve el
                            rango de la cotización).
                chip:       cómo se nombra la opción en la línea de alcance
                            de la pantalla de resultado (ej. "1 propiedad").
   }

   Para agregar una pregunta: copiá un bloque, cambiá id/columna/titulo/
   opciones y ubicalo en el orden en que se tiene que ver.
   ========================================================================== */

window.BLACK_FORM = {
  // Primer paso: qué va a pasar. `pasos` se ve como lista numerada.
  intro: {
    titulo: "¿Querés saber cuánto sale el Diagnóstico adaptado a tu caso? Así funciona:",
    pasos: [
      "Respondés 5 preguntas sobre tu caso.",
      "Ves tu cotización estimada en pantalla.",
      "La confirmás con Esteban por WhatsApp.",
    ],
    micro: "Menos de un minuto. Sin compromiso.",
  },

  // Nombre de cada ruta tal como se escribe en la columna "Ruta".
  rutas: { compra: "Compra", reforma: "Reforma" },

  /* Cada pregunta existe porque mueve el rango o el alcance. Lo que no lo
     mueve lo pregunta Esteban por WhatsApp. Orden: momento → propiedades /
     tipo de reforma → zona → dudas → urgencia → datos (6 pasos en las dos
     rutas). */
  preguntas: [
    /* 1 ------------------------------------------------------------------ */
    {
      id: "momento",
      columna: "Momento",
      tipo: "unica",
      titulo: "¿En qué momento estás?",
      opciones: [
        { valor: "Encontré una propiedad y estoy por ofertar o ya reservé", ruta: "compra" },
        { valor: "Estoy comparando entre dos o más", ruta: "compra" },
        { valor: "Estoy buscando, todavía sin una propiedad concreta", ruta: "compra" },
        { valor: "Ya es mía y quiero reformarla", ruta: "reforma" },
      ],
    },

    /* 2 (compra) ---------------------------------------------------------- */
    {
      id: "propiedades",
      columna: "Propiedades",
      tipo: "unica",
      mostrarSi: { ruta: "compra" },
      titulo: "¿Cuántas propiedades querés analizar?",
      opciones: [
        { valor: "Una", chip: "1 propiedad" },
        { valor: "Dos", chip: "2 propiedades" },
        { valor: "Tres", chip: "3 propiedades" },
        { valor: "Cuatro o más", chip: "4 o más propiedades" },
        { valor: "Todavía no sé, quiero que me asesoren", chip: "a definir cuántas" },
      ],
    },

    /* 2 (reforma) --------------------------------------------------------- */
    {
      id: "tipo_reforma",
      columna: "Tipo de reforma",
      tipo: "unica",
      mostrarSi: { ruta: "reforma" },
      titulo: "¿Qué tipo de reforma tenés en mente?",
      opciones: [
        // Mantiene el corte de la reforma chica. Para sacarlo, borrar
        // noCalifica y motivo.
        { valor: "Puntual (baño, cocina, un ambiente)", noCalifica: true, motivo: "Reforma puntual" },
        { valor: "Varios ambientes" },
        { valor: "Integral o ampliación" },
      ],
    },

    /* 3 ------------------------------------------------------------------ */
    {
      id: "zona",
      columna: "Zona",
      tipo: "unica",
      titulo: "¿Dónde está ubicada la propiedad?",
      opciones: [
        { valor: "CABA" },
        { valor: "Zona Norte" },
        { valor: "Zona Oeste" },
        { valor: "Zona Sur" },
        { valor: "Otra zona" },
      ],
    },

    /* 4 ------------------------------------------------------------------ */
    {
      id: "dudas",
      columna: "Dudas",
      tipo: "multiple",
      titulo: "¿Qué dudas tenés hoy?",
      ayuda: "Podés elegir más de una.",
      opciones: [
        { valor: "No sé en qué estado real está (humedades, instalaciones, estructura)", flag: "visita" },
        { valor: "No sé si el precio que piden es el correcto" },
        { valor: "No sé si los planos y la documentación están en regla", flag: "docs" },
        { valor: "Quiero saber qué reforma admite y cuánto me costaría" },
        { valor: "No sé, prefiero que me recomienden el alcance" },
      ],
    },

    /* 5 ------------------------------------------------------------------ */
    {
      id: "urgencia",
      columna: "Urgencia",
      tipo: "unica",
      titulo: "¿Para cuándo lo necesitás?",
      opciones: [
        { valor: "Tengo que ofertar esta semana" },
        { valor: "En los próximos 15 días" },
        { valor: "Sin apuro todavía" },
      ],
    },

    /* 6 ------------------------------------------------------------------ */
    {
      id: "datos",
      tipo: "datos",
      titulo: "Tus datos",
      campos: [
        { id: "nombre", columna: "Nombre", label: "Nombre y apellido", tipo: "text", autocomplete: "name", requerido: true },
        { id: "whatsapp", columna: "WhatsApp", label: "WhatsApp con código de área", tipo: "tel", autocomplete: "tel", placeholder: "11 6480 3777", requerido: true, validar: "telefonoAR" },
        { id: "email", columna: "Email", label: "Email (opcional, para mandarte la propuesta)", tipo: "email", autocomplete: "email", placeholder: "nombre@mail.com", requerido: false, validar: "email" },
      ],
    },
  ],

  /* Claves que el Workflow "Black – Nuevo lead" de GHL tenía mapeadas con
     las preguntas anteriores. Se mandan vacías para que el Workflow no se
     rompa. Se pueden borrar cuando Franco actualice el Workflow. */
  ghlClavesViejas: ["presupuesto", "plazo", "visito_propiedad", "que_busca", "disposicion_invertir"],

  /* ------------------------------------------------------------------------
     COTIZACIÓN. Todo lo que define el rango vive acá: form.js solo lo lee.
     Montos en pesos, sin formato (se muestran como $300.000).
     incluye: la línea corta que se ve debajo del precio.
     visita / docs: si ese rango incluye visita técnica o revisión
     documental (va al CRM).
     ------------------------------------------------------------------------ */
  cotizacion: {
    moneda: "ARS",
    vigencia: "2026-10-30",
    rangos: [
      { n: 1, nombre: "Análisis por planos",
        incluye: "Análisis por planos, sin visita.",
        min: 300000, max: 500000, visita: false, docs: false },
      { n: 2, nombre: "Con visita técnica",
        incluye: "Incluye la visita técnica.",
        min: 500000, max: 900000, visita: true, docs: false },
      { n: 3, nombre: "Comparativo",
        incluye: "Incluye visitas y revisión documental.",
        min: 900000, max: 1400000, visita: true, docs: true },
    ],
    trasladoFueraCaba: "Fuera de CABA, los traslados se cotizan aparte.",

    /* Regla de asignación (solo ruta compra), en este orden.
       c.propiedades: la opción elegida. c.visita / c.docs: si marcó alguna
       duda con ese flag. Devuelve el n del rango. */
    asignar: function (c) {
      var p = c.propiedades;
      if (p === "Cuatro o más" || ((p === "Dos" || p === "Tres") && c.docs)) return 3;
      if (p === "Una" && !c.visita && !c.docs) return 1;
      return 2; // todo lo demás, incluido "Todavía no sé"
    },
  },

  textos: {
    paso: "Paso {n} de {total} · Cotizando tu caso",
    siguiente: "Siguiente",
    atras: "Atrás",
    enviar: "Enviar",
    enviando: "Enviando…",
    // Pantalla de carga: rotan cada ~850 ms. Con movimiento reducido queda
    // fijo el último.
    carga: ["Leyendo tu caso…", "Definiendo el alcance…", "Armando tu cotización…"],
    errores: {
      unica: "Elegí una opción para seguir.",
      multiple: "Elegí al menos una opción.",
      otro: "Contanos qué buscás en “Otro”.",
      texto: "Completá este dato para seguir.",
      nombre: "Escribí tu nombre y apellido.",
      email: "Escribí tu email.",
      emailValido: "Revisá el email: tiene que ser del tipo nombre@mail.com.",
      whatsapp: "Escribí tu WhatsApp.",
      telefonoAR: "Revisá el número: tiene que tener código de área. Ej.: 11 6480 3777",
    },
  },

  /* Mensaje prellenado de WhatsApp (solo leads que califican).
     {llaves}: cualquier `clave` o `id` de pregunta, más {nombre},
     {cotizacion_texto} y {lead_id} ({lead_id} acá es la referencia corta,
     BLK-XXXXXXXX: el comienzo del lead_id completo, que figura en la columna
     ref_whatsapp de la hoja). Las respuestas múltiples van separadas por ", ". */
  whatsapp: {
    mensaje:
      "Hola Esteban, soy {nombre}. Hice el cotizador del Diagnóstico Black.\nMomento: {momento}.\nPropiedades: {propiedades}.\nZona: {zona}.\nDudas: {dudas}.\nUrgencia: {urgencia}.\nRango estimado: {cotizacion_texto}.\n(Ref. {lead_id})",
    mensajeReforma:
      "Hola Esteban, soy {nombre}. Hice el cotizador del Diagnóstico Black.\nMomento: {momento}.\nReforma: {tipo_reforma}.\nZona: {zona}.\nDudas: {dudas}.\nUrgencia: {urgencia}.\n(Ref. {lead_id})",
  },

  final: {
    // Ruta compra: el precio de su caso ({min} y {max} en amarillo), una
    // línea con lo que incluye (`incluye` del rango) y el botón. Nada más:
    // los otros rangos no se muestran.
    cotizacion: {
      titulo: "Listo, {nombre}. En tu caso, el Diagnóstico Black sale entre {min} y {max}.",
      boton: "Hablá con Esteban y resolvé tu propiedad",
      otroCaso: "Cotizar otro caso",
    },
    // Ruta reforma (califica): sin rango. Mismo botón.
    reforma: {
      titulo: "Listo, {nombre}. Te cotizamos tu caso por WhatsApp en menos de 24 h hábiles.",
    },
    noCalifica: {
      titulo: "Gracias por tu tiempo.",
      texto:
        "Por ahora el Diagnóstico no es lo que estás buscando, pero en nuestro Instagram compartimos todo lo que hay que saber antes de comprar o reformar.",
      boton: "Ir a @black_arq",
    },
  },
};
