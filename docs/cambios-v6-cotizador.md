# Cambios v6: formulario-cotizador del Diagnóstico Black (30–31/10/2026)

El formulario dejó de ser una calificación del lead y pasó a ser un **cotizador**: la persona responde 5 preguntas, ve una carga corta y después **el precio estimado de su caso** con un botón a WhatsApp con Esteban. El lead se captura igual que antes (mismo momento, mismos eventos, mismo envío a GHL). Ya no hay salto automático a WhatsApp.

- Punto de restauración: commit `64c31fb` (el `main` anterior a cualquier cambio). Se marcó con el tag local `restore-pre-cotizador`, pero el entorno no permite subir tags: si se quiere en GitHub, `git tag restore-pre-cotizador 64c31fb && git push origin restore-pre-cotizador`.
- `node scripts/verificar-tracking.mjs`: **en verde, 80 comprobaciones**.

---

## Qué ve la persona

1. **Botones de toda la landing:** "Quiero saber cuánto sale" (los 11, con los mismos IDs de siempre).
2. **Primer paso del formulario:** explica el proceso. "¿Querés saber cuánto sale el Diagnóstico adaptado a tu caso? Así funciona: 1. Respondés 5 preguntas sobre tu caso. 2. Ves tu cotización estimada en pantalla. 3. La confirmás con Esteban por WhatsApp." + "Menos de un minuto. Sin compromiso." Abajo, la primera pregunta. [Captura 360 px](cambios-v6-cotizador/paso1-360.jpg)
3. **Preguntas:** momento → cuántas propiedades (compra) o tipo de reforma (reforma) → zona → dudas → urgencia → datos (nombre, WhatsApp, email opcional). "Paso {n} de 6 · Cotizando tu caso".
4. **Carga (~2,6 s):** una planta que se dibuja, una barra amarilla que se llena y tres mensajes (Leyendo tu caso… → Definiendo el alcance… → Armando tu cotización…). [360](cambios-v6-cotizador/carga-360.jpg) · [430](cambios-v6-cotizador/carga-430.jpg)
5. **Resultado, corto y solo su caso:**
   - "Listo, {nombre}. En tu caso, el Diagnóstico Black sale entre **$500.000** y **$900.000**." (montos en amarillo)
   - Una línea: "Incluye la visita técnica." (o "Análisis por planos, sin visita." / "Incluye visitas y revisión documental."), + "Fuera de CABA, los traslados se cotizan aparte." si corresponde.
   - Botón: **Hablá con Esteban y resolvé tu propiedad**.
   - **No se muestran los otros rangos.** [360](cambios-v6-cotizador/resultado-360.jpg) · [430](cambios-v6-cotizador/resultado-430.jpg)
6. **Reforma:** "Listo, {nombre}. Te cotizamos tu caso por WhatsApp en menos de 24 h hábiles." + el mismo botón. [Captura](cambios-v6-cotizador/e2e-reforma-califica.jpg)
7. **No califica** (reforma puntual): igual que antes, Instagram. [Captura](cambios-v6-cotizador/e2e-reforma-no-califica.jpg)

**Rangos** (en `form-config.js`, bloque `cotizacion`; para cambiar montos o la regla no se toca `form.js`):

| Rango | Monto | Cuándo (ruta compra, en este orden) |
|---|---|---|
| 3 · Comparativo | $900.000 – $1.400.000 | "Cuatro o más", o "Dos"/"Tres" con duda de planos y documentación |
| 1 · Análisis por planos | $300.000 – $500.000 | "Una" sin duda de estado ni de planos y documentación |
| 2 · Con visita técnica | $500.000 – $900.000 | todo lo demás (incluye "Todavía no sé") |

---

## Ajustes del 31/10 (pedidos de Franco)

- El resultado muestra **solo el precio de su caso**: se sacaron las tres tarjetas, los chips de alcance, el párrafo de descuento y devolución, la línea de Lorena y "Te responde él, en el día…".
- Botón del resultado: "Hablá con Esteban y resolvé tu propiedad".
- Carga más larga (2 → 2,6 s) con una barra que se llena, para que se sienta que se arma la cotización.
- Primer paso del formulario: explica el proceso (ver arriba). En los pasos anteriores se sacó texto de más: la intro larga y la nota de los datos ("Te mandamos la cotización por WhatsApp. No te sumamos a ninguna lista.", que además ya no era cierta: la cotización se ve en pantalla).
- **Sin garantía de devolución en toda la página:** píldora del hero, sello y texto de la sección 10 (ahora "Inversión": "El valor depende de cuántas propiedades analicemos y del alcance." + "Y se descuenta…" + "Cotizalo en un minuto." [captura](cambios-v6-cotizador/inversion-390.jpg)), la frase de la FAQ "¿Tengo que pagar…?", "Garantía de devolución" del cierre y el schema. [Hero](cambios-v6-cotizador/hero-390.jpg)
- CTAs: "Quiero saber cuánto sale".

---

## Qué cambió, por archivo

| Archivo | Cambio |
|---|---|
| `site/assets/js/form-config.js` | Primer paso con el proceso, preguntas nuevas, encabezado "Cotizando tu caso", mensajes de la carga, bloque `cotizacion` (montos, línea de qué incluye, vigencia, traslados, regla), mensajes de WhatsApp (compra y reforma), textos del resultado y `ghlClavesViejas`. |
| `site/assets/js/form.js` | Cálculo del rango, campos nuevos del payload, `Lead` con `propiedades`/`rango`/`urgencia`, carga, resultado (compra, reforma, no califica), `CotizacionVista` y `Contact`, sin salto automático, volver a abrir muestra el resultado (a los 30 min arranca de cero; no hay opción de cotizar otro caso), descarte de borradores viejos. |
| `site/assets/css/site.css` | Lista del primer paso, carga (planta + barra), resultado. Se borraron los estilos de la píldora y del sello de garantía. |
| `site/index.html` | 11 CTA "Quiero saber cuánto sale"; hero "Cotización en 1 minuto · Visita en 72 h · Informe en 7 días" sin píldora; pasos 1 y 3; sección 10 sin garantía; FAQ "¿Cuánto sale?" primera; FAQ y cierre sin devolución; schema `FAQPage` igual a lo visible. |
| `docs/landing-copy.md` | Los mismos cambios de copy + resumen del copy del cotizador. |
| `netlify/functions/meta-capi.js` | Acepta `CotizacionVista` y `Contact`. Email vacío: ya no se hasheaba (solo un email con formato válido); quedó comentado. |
| `netlify/functions/ghl-lead.js` | Claves nuevas en `CLAVES`; se mantienen las viejas para reintentos de envíos anteriores en cola. |
| `scripts/verificar-tracking.mjs` | Flujo nuevo (ver punto 1). |
| `README.md` | Estructura, claves del webhook, columnas de Sheets, eventos, GA4, script y sección "Cambios v6". |

---

## Auditoría de conversión y medición (versión final)

### 1. `node scripts/verificar-tracking.mjs` → 80 de 80

Siguen todas las reglas anteriores: InitiateCheckout + paso 1 al abrir (Píxel y CAPI con el mismo eventID), nunca Lead sin inicio, un solo Lead (doble tap incluido) con el mismo eventID en Píxel y CAPI y con email/teléfono/nombre por CAPI, no califica → LeadNoCalifica y nunca Lead, volver de WhatsApp no repite eventos, retomar un borrador reenvía el paso 1, fbc con la hora del clic, no se reenvía a GHL días después, reintento marcado, un solo PageView. Nuevas:

- Carga (con barra) después del envío; el `Lead` ya salió cuando aparece.
- `CotizacionVista` una vez, Píxel y CAPI con el mismo eventID (`lead_id-cot`).
- Los 5 casos de rango en Píxel, CAPI, GA4 y GHL, y en pantalla **solo sus dos montos** (ningún otro), sin Lorena, devolución ni "Te responde".
- `Contact` solo con el toque, uno solo con doble toque (`lead_id-wa`); 3 s en el resultado sin tocar → ninguna navegación a `wa.me`.
- Reforma: Lead sí, CotizacionVista no, sin montos; WhatsApp con "Reforma: …".
- Email vacío: el envío pasa; la función de CAPI no manda `em`.
- Payload a GHL con las claves del cotizador, las viejas vacías y la atribución completa.
- Cerrar y volver a abrir: ve su cotización sin eventos nuevos y no hay opción de cotizar otro caso (pasados 30 minutos, el formulario arranca de cero). Cerrar durante la carga: CotizacionVista sale recién cuando la ve.
- Borrador con las preguntas anteriores: se descarta sin errores.
- Landing: los 11 CTA existen con su ID y el texto nuevo; un CTA intermedio (`cta_garantia`) abre el formulario y llega como `cta_origen`; ninguna mención a la devolución en el HTML (texto ni schema).

### 2. Prueba de punta a punta (iPhone 13 + navegador de Instagram)

Visita con UTMs y `fbclid`, formulario completo, envío y toque del botón:

| Caso | Resultado | Captura |
|---|---|---|
| 1 propiedad, duda de precio | Rango 1 · $300.000 – $500.000 | [e2e-rango1](cambios-v6-cotizador/e2e-rango1.jpg) |
| 1 propiedad + estado real | Rango 2 · $500.000 – $900.000 | [e2e-rango2-visita](cambios-v6-cotizador/e2e-rango2-visita.jpg) |
| 2 propiedades + planos y documentación (Zona Norte) | Rango 3 · $900.000 – $1.400.000 + traslados | [e2e-rango3-docs](cambios-v6-cotizador/e2e-rango3-docs.jpg) |
| Todavía no sé | Rango 2 | [e2e-rango2-nose](cambios-v6-cotizador/e2e-rango2-nose.jpg) |
| Cuatro o más (Zona Oeste) | Rango 3 + traslados | [e2e-rango3-cuatro](cambios-v6-cotizador/e2e-rango3-cuatro.jpg) |
| Reforma integral | Sin rango | [e2e-reforma-califica](cambios-v6-cotizador/e2e-reforma-califica.jpg) |
| Reforma puntual | No califica (Instagram) | [e2e-reforma-no-califica](cambios-v6-cotizador/e2e-reforma-no-califica.jpg) |

Eventos en orden (compra; `SES` = id de la apertura del formulario, `LEAD` = `lead_id`):

- **Píxel:** InitiateCheckout [SES-ic] → FormularioPaso p1…p6 → Lead [LEAD] → CotizacionVista [LEAD-cot] → (toque) Contact [LEAD-wa]
- **CAPI:** lo mismo, con los mismos eventID.
- **GA4:** cta_click → form_start → form_step → form_route → form_step ×5 → form_submit → cotizacion_vista → (toque) whatsapp_redirect `origen: "boton"`
- **Reforma que califica:** igual, sin CotizacionVista. **No califica:** … → LeadNoCalifica [LEAD], sin Lead.

### 3. eventIDs

`Lead` = `lead_id`, `CotizacionVista` = `lead_id-cot`, `Contact` = `lead_id-wa`: distintos entre sí y cada uno igual en Píxel y CAPI.

### 4. Atribución contra `main` (`64c31fb`)

Mismo recorrido en las dos versiones: `cta_origen`, `ctas_sesion`, `utm_*`, `campaign_id`, `adset_id`, `ad_id`, `placement`, `fbclid`, `ft_*`, `dispositivo`, `url`, `referrer` **idénticos**; `external_id` = el mismo id de visitante; `fbp` y `fbc` (`fb.1.<hora del clic>.<fbclid>`) con el mismo formato. El `Lead` por CAPI lleva email, teléfono, nombre, fbc, fbp y external_id, con eventID = `lead_id`. Lo único que cambia en el payload son las respuestas (columnas nuevas) y las claves de la cotización.

### 5. Peso y Lighthouse mobile

| Archivo (gzip) | `main` | Ahora | Diferencia |
|---|---|---|---|
| `form.js` | 10.660 B | 13.744 B | +3.084 B |
| `form-config.js` | 3.463 B | 4.153 B | +690 B |
| `site.css` | 16.964 B | 16.899 B | −65 B (se borraron los estilos de la garantía) |
| **Total** | | | **+3.709 B (3,6 KB)**, debajo del límite de 6 KB |

Lighthouse 13 mobile, 3 corridas, sitio servido en local (sin CDN; las fuentes pasan por el proxy del entorno, por eso varía tanto):

| | Performance | LCP | CLS | TBT |
|---|---|---|---|---|
| `main` | 0,54 / 0,68 / 0,68 | 5,9 / 6,1 / 5,2 s | 0,009 / 0,022 / 0,022 | 1311 / 387 / 506 ms |
| Ahora | 0,54 / 0,66 / 0,65 | 5,6 / 5,4 / 6,2 s | 0,020 / 0,020 / 0,020 | 1249 / 545 / 495 ms |

Sin diferencias reales: el CLS viene del mismo lugar que en `main` (el hero cuando carga Poppins). La línea nueva del hero va siempre en dos renglones en mobile para no sumar desplazamiento.

### 6. Revisión visual

- Primer paso a 360×640: intro + las 4 opciones de la primera pregunta entran sin scroll.
- Resultado: entra entero en la primera pantalla a 360, 390 y 430 px (el botón termina a ~305 px). Foco al título al aparecer. El CTA fijo de la landing queda oculto con el modal abierto.
- Con movimiento reducido: planta dibujada, barra llena y un mensaje fijo ([360](cambios-v6-cotizador/carga-360-reduce.jpg) · [430](cambios-v6-cotizador/carga-430-reduce.jpg)).
- Contraste: negro sobre amarillo y amarillo sobre negro 15,5:1.

### 7. Recargar a mitad del formulario

Retoma en "Paso 4 de 6" con las preguntas nuevas y el Lead llega igual. Un borrador con las preguntas anteriores se descarta y arranca en el paso 1.

### 8. Grep final

- `form-config.js` y `form.js`: sin `presupuesto_compra`, `presupuesto_reforma`, `objetivos`, `inversion`, `plazo` ni `presupuesto`, salvo `ghlClavesViejas` (compatibilidad con GHL). `visito` solo en `visitorId` (atribución, sin relación) y en `visito_propiedad` de esa lista.
- `index.html` y `landing-copy.md`: sin "Quiero mi Diagnóstico Black" ni "devolvemos". Queda "lo que garantiza que nadie gana nada si comprás" en la FAQ, que es el verbo, no la garantía de devolución.

---

## Decisiones tomadas sin consultar

- **Rama y `main`:** se trabajó en `claude/vigilant-thompson-p0gr2m` y, por pedido de Franco, se subió a `main`.
- **Títulos de las preguntas** (el prompt traía solo las opciones): "¿En qué momento estás?", "¿Cuántas propiedades querés analizar?", "¿Qué tipo de reforma tenés en mente?", "¿Qué dudas tenés hoy?", "¿Para cuándo lo necesitás?". Zona usa la de antes.
- **Texto del CTA:** "Quiero saber cuánto sale", de lo que pidió Franco ("quiero saber cuánto sale").
- **Primer paso:** "¿Querés saber cuánto sale el Diagnóstico adaptado a tu caso? Así funciona:" + los tres pasos.
- **Línea de qué incluye** (una por rango): "Análisis por planos, sin visita.", "Incluye la visita técnica.", "Incluye visitas y revisión documental.".
- **Sección 10 sin garantía:** el título pasó a ser "El valor depende de cuántas propiedades analicemos y del alcance." (frase que ya estaba en la sección). Se mantienen el id `#garantia` y el CTA `cta_garantia` para no cortar la comparación de CTA en la planilla.
- **Traslados fuera de CABA:** se mantiene, en la misma línea de qué incluye (es parte del precio).
- **Sin "Cotizar otro caso"** (pedido de Franco): ninguna pantalla final ofrece volver a cotizar. Si cierra y vuelve a abrir, ve su resultado; a los 30 minutos (o recargando la página) el formulario arranca de cero.
- **Dudas:** en el WhatsApp separadas por ", "; en GHL y Sheets por " · " (una opción tiene comas adentro).
- **`necesita_visita` / `revision_documental`:** "Sí" si el rango lo incluye o si marcó esa duda.
- **`vigencia`** se guarda pero no se muestra ni se aplica.
- **Claves viejas vacías solo a GHL**, no a Sheets (ahí habrían creado columnas vacías). `Code.gs` sin cambios: las columnas nuevas se crean solas.

### Para revisar

- Paso a paso de la landing: los pasos 3 ("Confirmás el alcance con Esteban por WhatsApp.") y 4 ("Confirmás y nos mandás todo.") empiezan igual.
- En la sección de pasos sigue "Todos los clientes… recuperaron lo que pagaron por el Diagnóstico con los argumentos que les dimos". No es una garantía de devolución, pero habla de recuperar lo pagado: si se quiere sacar también, avisar.

---

## Qué tiene que hacer Franco

**En GHL (Workflow "Black – Nuevo lead", disparador Inbound Webhook):**

1. Mapear como custom fields: `momento`, `propiedades`, `tipo_reforma`, `dudas`, `urgencia`, `rango`, `cotizacion_min`, `cotizacion_max`, `cotizacion_texto`. Opcionales: `rango_nombre`, `necesita_visita`, `revision_documental`.
2. Opcional: tag cuando `urgencia` = "Tengo que ofertar esta semana".
3. Cuando el Workflow ya no use `presupuesto`, `plazo`, `visito_propiedad`, `que_busca` y `disposicion_invertir`: borrarlas de `ghlClavesViejas` en `site/assets/js/form-config.js`.

**En Meta (Administrador de eventos):**

1. Crear una conversión personalizada sobre `CotizacionVista` (se puede filtrar por `rango`).
2. `Contact` es estándar: aparece cuando alguien toca el botón de WhatsApp del resultado.
3. Si alguna campaña optimizaba por el salto automático a WhatsApp, ese salto ya no existe: el equivalente es `Contact`. El `Lead` sigue saliendo igual, en el envío.

**En Google Sheets:** nada.
