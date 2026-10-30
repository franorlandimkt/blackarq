# Cambios v6 — Formulario-cotizador del Diagnóstico Black (30/10/2026)

El formulario dejó de ser una calificación del lead y pasó a ser un **cotizador**: 5 preguntas + datos, una carga de 2 s y una pantalla con el rango de precio del caso y el botón a WhatsApp con Esteban. El lead se captura igual que antes (mismo momento, mismos eventos, mismo envío a GHL). Ya no hay salto automático a WhatsApp.

- Punto de restauración: commit `64c31fb` (el `main` anterior a cualquier cambio). Se marcó con el tag `restore-pre-cotizador`, pero el entorno no permite subir tags: si se quiere el tag en GitHub, `git tag restore-pre-cotizador 64c31fb && git push origin restore-pre-cotizador`.
- Rama: `claude/vigilant-thompson-p0gr2m` (ver "Decisiones").
- `node scripts/verificar-tracking.mjs`: **en verde** (72 comprobaciones).

---

## Qué cambió, por archivo

| Archivo | Cambio |
|---|---|
| `site/assets/js/form-config.js` | Intro, preguntas nuevas (`momento`, `propiedades`, `tipo_reforma`, `zona`, `dudas`, `urgencia`, `datos` con email opcional), encabezado "Paso {n} de {total} · Cotizando tu caso", mensajes de la carga, bloque `cotizacion` (montos, qué incluye cada rango, vigencia, traslados, regla de asignación), mensajes de WhatsApp (compra y reforma), textos de la pantalla de resultado y `ghlClavesViejas` (claves viejas que se mandan vacías a GHL). |
| `site/assets/js/form.js` | Cálculo del rango (lee `cotizacion`), campos nuevos del payload, `Lead` con `propiedades`/`rango`/`urgencia`, pantalla de carga, pantalla de resultado (compra, reforma, no califica), `CotizacionVista` y `Contact`, fin del salto automático, volver a abrir muestra el resultado (30 min o "Cotizar otro caso" reinician), descarte de borradores con preguntas que ya no existen. |
| `site/assets/css/site.css` | Estilos de la carga (planta que se dibuja con `stroke-dashoffset`) y del resultado (chips, tres tarjetas, la del caso en amarillo, entrada con el stagger de la landing y resaltado de 300 ms). Línea del hero estable en mobile. |
| `site/index.html` | 11 CTA → "Cotizá tu Diagnóstico"; hero "Cotización en 1 minuto · Visita en 72 h · Informe en 7 días"; pasos 1 y 3; inversión; FAQ "¿Cuánto sale?" primera + schema `FAQPage`; la FAQ de reforma nombra la opción nueva; versiones de caché de los archivos tocados. |
| `docs/landing-copy.md` | Los mismos cambios de copy + resumen del copy del cotizador. |
| `netlify/functions/meta-capi.js` | Acepta `CotizacionVista` y `Contact`. Email: ya no mandaba el hash de un texto vacío (solo hashea un email con formato válido); se dejó comentado. |
| `netlify/functions/ghl-lead.js` | `CLAVES` con las columnas nuevas y las claves de la cotización; se mantienen las viejas para reintentos de envíos anteriores en cola. |
| `scripts/verificar-tracking.mjs` | Flujo nuevo (ver punto 1). |
| `README.md` | Estructura, claves del webhook, columnas de Sheets, eventos, GA4, script de verificación y sección "Cambios v6". |

---

## Auditoría

### 1. `node scripts/verificar-tracking.mjs` → en verde

72 comprobaciones, 0 fallas. Se mantienen todas las reglas anteriores (InitiateCheckout + paso 1 al abrir, nunca Lead sin inicio, un Lead con el mismo eventID en Píxel y CAPI, no califica → LeadNoCalifica y nunca Lead, retomar borrador reenvía el paso 1, fbc con la hora del clic, no reenvío a GHL días después, reintento marcado). Nuevas:

- Pantalla de carga después del envío; el `Lead` ya salió cuando aparece (antes de la cotización).
- `CotizacionVista` una vez, Píxel y CAPI con el mismo eventID (`lead_id-cot`).
- Los 5 casos de rango, comprobados en Píxel, CAPI, GA4 y GHL, con la tarjeta resaltada correcta: 1 prop. sin flags → 1 · 1 prop. + estado → 2 · 2 prop. + papeles → 3 · "Todavía no sé" → 2 · "Cuatro o más" → 3.
- `Contact` solo al tocar el botón, uno solo con doble toque (Píxel y CAPI, `lead_id-wa`); 3 s en el resultado sin tocar nada → ninguna navegación a `wa.me`.
- Reforma: `Lead` sí, `CotizacionVista` no, sin montos ni tarjetas; mensaje de WhatsApp con "Reforma: …" y sin rango.
- Email vacío: el envío pasa, GHL recibe `email: ""`; la función `meta-capi` probada directamente: con email vacío no manda `em`, con email lo manda hasheado.
- Payload a GHL: claves del cotizador, claves viejas vacías y atribución completa.
- Cerrar y volver a abrir: vuelve a ver la cotización sin eventos nuevos; "Cotizar otro caso" arranca de cero y cuenta un inicio nuevo. Cerrar durante la carga: `CotizacionVista` sale recién cuando la ve.
- Borrador con las preguntas anteriores: se descarta, arranca en el paso 1 y el envío funciona sin errores.

### 2. Prueba de punta a punta (iPhone 13 + navegador de Instagram)

Visita con UTMs y `fbclid`, formulario completo, envío y toque del botón. Capturas de la pantalla de resultado (390 px):

| Caso | Resultado | Captura |
|---|---|---|
| 1 propiedad, duda de precio | Rango 1 · $300.000 – $500.000 | [e2e-rango1](cambios-v6-cotizador/e2e-rango1.jpg) |
| 1 propiedad + estado real | Rango 2 · $500.000 – $900.000 | [e2e-rango2-visita](cambios-v6-cotizador/e2e-rango2-visita.jpg) |
| 2 propiedades + planos y documentación (Zona Norte) | Rango 3 · $900.000 – $1.400.000 + traslados | [e2e-rango3-docs](cambios-v6-cotizador/e2e-rango3-docs.jpg) |
| Todavía no sé | Rango 2 | [e2e-rango2-nose](cambios-v6-cotizador/e2e-rango2-nose.jpg) |
| Cuatro o más (Zona Oeste) | Rango 3 + traslados | [e2e-rango3-cuatro](cambios-v6-cotizador/e2e-rango3-cuatro.jpg) |
| Reforma integral (califica) | Sin rango, "te cotizamos por WhatsApp en menos de 24 h hábiles" | [e2e-reforma-califica](cambios-v6-cotizador/e2e-reforma-califica.jpg) |
| Reforma puntual (no califica) | Pantalla de Instagram | [e2e-reforma-no-califica](cambios-v6-cotizador/e2e-reforma-no-califica.jpg) |

Eventos en orden (iguales en los 5 casos de compra; `SES` = id de la apertura del formulario, `LEAD` = `lead_id`):

- **Píxel:** InitiateCheckout [SES-ic] → FormularioPaso p1…p6 → Lead [LEAD] → CotizacionVista [LEAD-cot] → (toque) Contact [LEAD-wa]
- **CAPI:** InitiateCheckout [SES-ic] → FormularioPaso p1…p6 → Lead [LEAD] → CotizacionVista [LEAD-cot] → Contact [LEAD-wa]
- **GA4:** cta_click → form_start → form_step → form_route → form_step ×5 → form_submit → cotizacion_vista → (toque) whatsapp_redirect `origen: "boton"`
- **Reforma que califica:** igual, sin CotizacionVista ni cotizacion_vista.
- **No califica:** … → LeadNoCalifica [LEAD] (Píxel y CAPI) → form_submit. Sin Lead, sin CotizacionVista.

Payload interceptado a `/.netlify/functions/ghl-lead` (caso 2 propiedades + papeles, recortado):

```
Momento: Encontré una propiedad y estoy por ofertar o ya reservé · Propiedades: Dos · Zona: Zona Norte
Dudas: No sé si los planos y la documentación están en regla · Urgencia: En los próximos 15 días
ruta: Compra · califica: Sí · rango: 3 · rango_nombre: Comparativo
cotizacion_min: 900000 · cotizacion_max: 1400000 · cotizacion_texto: $900.000 – $1.400.000
necesita_visita: Sí · revision_documental: Sí · email: ana@prueba.com
presupuesto: "" · plazo: "" · visito_propiedad: "" · que_busca: "" · disposicion_invertir: ""
+ atribución completa (utm_*, campaign_id, adset_id, ad_id, placement, fbclid, fbp, fbc, external_id, ft_*, cta_origen, ctas_sesion…)
```

Mensaje de WhatsApp (caso Cuatro o más):

```
Hola Esteban, soy Ana Prueba. Hice el cotizador del Diagnóstico Black.
Momento: Encontré una propiedad y estoy por ofertar o ya reservé.
Propiedades: Cuatro o más.
Zona: Zona Oeste.
Dudas: No sé en qué estado real está (humedades, instalaciones, estructura), No sé si el precio que piden es el correcto.
Urgencia: Tengo que ofertar esta semana.
Rango estimado: $900.000 – $1.400.000.
(Ref. BLK-DA86A91E)
```

### 3. eventIDs

En cada envío, `Lead` por Píxel y por CAPI comparten `eventID` = `lead_id`. `CotizacionVista` usa `lead_id-cot` y `Contact` `lead_id-wa`: los tres son distintos entre sí y cada uno es igual en Píxel y CAPI (comprobado en el script y en la prueba de punta a punta).

### 4. Comparación con la línea base (`64c31fb`, tag local `restore-pre-cotizador`)

Mismo recorrido en las dos versiones (UTMs + `campaign_id`/`adset_id`/`ad_id`/`placement` + `fbclid`): los campos de atribución del payload a GHL (`cta_origen`, `ctas_sesion`, `utm_*`, IDs de campaña, `placement`, `fbclid`, `ft_*`, `dispositivo`, `url`, `referrer`) son **idénticos** (la `url` solo difiere en el puerto del servidor local). `external_id` es el mismo id de visitante en las dos (`v-…`, igual a `BLACK_APP.visitorId()`), `fbp` con el formato `fb.1.<hora>.<n>` y `fbc` = `fb.1.<hora del clic>.CLICKX` en las dos.

Lo único que cambia en el payload: salen `Situación`, `Presupuesto`, `Plazo`, `¿Visitó la propiedad?`, `Qué busca`, `Disposición a invertir`; entran `Momento`, `Propiedades`/`Tipo de reforma`, `Dudas`, `Urgencia`, las claves de la cotización y las 5 claves viejas vacías.

### 5. Peso y Lighthouse mobile

Peso gzip del modal (antes → después):

| Archivo | Antes | Después | Diferencia |
|---|---|---|---|
| `form.js` | 10.660 B | 14.145 B | +3.485 B |
| `form-config.js` | 3.463 B | 4.401 B | +938 B |
| `site.css` | 16.964 B | 17.984 B | +1.020 B |
| **Total** | | | **+5.443 B (5,3 KB)**, debajo del límite de 6 KB |

Lighthouse 13 mobile, 3 corridas cada uno, sitio servido en local (sin CDN; las fuentes salen por el proxy del entorno, por eso el LCP varía tanto entre corridas):

| | Performance | LCP | CLS | TBT |
|---|---|---|---|---|
| Antes | 0,54 / 0,68 / 0,68 | 5,9 / 6,1 / 5,2 s | 0,009 / 0,022 / 0,022 | 1311 / 387 / 506 ms |
| Después | 0,95 / 0,71 / 0,70 | 1,4 / 5,3 / 5,5 s | 0,013 / 0,013 / 0,014 | 242 / 383 / 395 ms |

LCP y CLS no empeoran. La primera medición después del cambio dio CLS 0,024: la línea nueva del hero ("Cotización en 1 minuto · …") cortaba en 2 líneas con la fuente de respaldo y en 1 con Poppins a 412 px. Se resolvió dejando "Cotización en 1 minuto" en su propia línea en mobile, siempre.

### 6. Revisión visual

Capturas de carga y resultado en 360 y 430 px, con y sin `prefers-reduced-motion`:

- Carga: [360](cambios-v6-cotizador/carga-360.jpg) · [430](cambios-v6-cotizador/carga-430.jpg) · [360 reducido](cambios-v6-cotizador/carga-360-reduce.jpg) · [430 reducido](cambios-v6-cotizador/carga-430-reduce.jpg)
- Resultado arriba: [360](cambios-v6-cotizador/resultado-360.jpg) · [430](cambios-v6-cotizador/resultado-430.jpg) · [360 reducido](cambios-v6-cotizador/resultado-360-reduce.jpg) · [430 reducido](cambios-v6-cotizador/resultado-430-reduce.jpg)
- Resultado abajo (CTA): [360](cambios-v6-cotizador/resultado-360-abajo.jpg) · [430](cambios-v6-cotizador/resultado-430-abajo.jpg) · [360 reducido](cambios-v6-cotizador/resultado-360-abajo-reduce.jpg) · [430 reducido](cambios-v6-cotizador/resultado-430-abajo-reduce.jpg)

Medidas de la pantalla de resultado (caso más largo con chips y traslados): a 360×640 el contenido mide 939 px (un scroll de ~300 px, el CTA termina a 801 px); a 390×664, 883 px; a 430×740, 817 px (casi todo a la vista). Las tres tarjetas se ven en una sola fila sin scroll horizontal en los tres anchos. El CTA fijo de la landing queda oculto mientras el modal está abierto (comprobado: `.sticky-cta` sin `is-in`). Foco al H2 al aparecer. Con movimiento reducido: la planta ya dibujada, un mensaje fijo y la tarjeta del caso ya resaltada.

Contraste: negro (#0A0A0A) sobre amarillo (#FFE500) 15,5:1; amarillo sobre negro 15,5:1; gris (#A3A3A3) sobre las tarjetas (#1A1A1A) 6,9:1. Todo AA (y AAA salvo el gris, que es AA).

### 7. Recargar a mitad del formulario

Recargar después de 3 respuestas retoma en "Paso 4 de 6" con las preguntas nuevas, reenvía InitiateCheckout + paso 1 y el Lead llega igual. Un borrador con las claves anteriores (`situacion`, `presupuesto_compra`, `plazo`, `i: 4`) se descarta: abre en el paso 1 con la intro y el envío funciona sin errores (los dos casos están en el script).

### 8. Grep final

- `form-config.js` y `form.js`: sin `presupuesto_compra`, `presupuesto_reforma`, `objetivos`, `inversion` ni `plazo`/`presupuesto`, salvo `ghlClavesViejas` (las claves vacías de compatibilidad con GHL). `visito` solo aparece dentro de `visitorId` (función de atribución, sin relación) y en `visito_propiedad` de esa misma lista.
- `index.html` y `landing-copy.md`: ninguna referencia a "Quiero mi Diagnóstico Black".

---

## Decisiones tomadas sin consultar

- **Rama de trabajo:** `claude/vigilant-thompson-p0gr2m` (la que asigna el entorno) en lugar de `cotizador`, igual que en la v4. No se tocó `main` ni se hizo merge. `claude/cotizador-formulario.md`, que menciona el prompt, no existe en el repo.
- **Títulos de las preguntas:** el prompt da opciones pero no la pregunta. Se escribieron en el tono del sitio (ver lista abajo). La de zona es la misma de antes.
- **Tarjeta del caso: fondo amarillo y texto negro**, como pide el prompt. La columna Black de la comparativa es fondo oscuro con borde amarillo; se priorizó la indicación explícita.
- **Dudas:** en el mensaje de WhatsApp van separadas por ", " (como pide el prompt); en GHL y Sheets siguen con " · " (como hacía `valorTexto`), porque una de las opciones tiene comas adentro y con ", " no se podría separar.
- **`necesita_visita` / `revision_documental`:** "Sí" si el rango asignado los incluye (rango 2 y 3 incluyen visita; el 3, revisión documental) o si marcó la duda correspondiente. En reforma, según las dudas.
- **Chips de alcance:** "Tres" → "3 propiedades" y "Cuatro o más" → "4 o más propiedades" (el prompt solo definía Una, Dos y Todavía no sé). Los chips "con visita técnica" / "con revisión documental" siguen la misma lógica que el punto anterior.
- **Regla de asignación en `form-config.js`** (función `asignar`) junto a los montos, para que cambiarla no requiera tocar `form.js`.
- **`vigencia`** se guarda en el bloque pero no se muestra ni se aplica (el prompt no dice qué hacer con ella). Hoy es 30/10/2026: si la idea es que los montos venzan, hay que definir qué pasa después.
- **"Cotizar otro caso" también en la pantalla de reforma y en la de no califica**, para que alguien que eligió mal pueda volver sin esperar 30 minutos.
- **Cerrar durante la carga:** al volver a abrir ve el resultado directo, y `CotizacionVista` sale recién ahí (cuenta la vista real).
- **Mensaje fijo con movimiento reducido:** "Armando tu cotización…" (el último de los tres).
- **Paso 1 del paso a paso:** el texto nuevo reemplaza el título y se sacó la bajada ("6 preguntas para saber si realmente te podemos ayudar"), que quedaba desactualizada. **Paso 3:** el texto nuevo reemplaza el título y se mantuvo la bajada ("Qué incluye y su valor según cuántas propiedades sean. Sin compromiso hasta que confirmes.").
- **FAQ "Ya tengo la propiedad. ¿Me sirve?":** decía "Elegí “Ya tengo el inmueble” en el formulario"; ahora nombra la opción nueva ("Ya es mía y quiero reformarla"). También en `landing-copy.md` (estrategia) y en el schema.
- **Hero en mobile:** "Cotización en 1 minuto" en su propia línea (ver punto 5).
- **Claves viejas vacías solo a GHL**, no a Sheets: en Sheets habrían creado columnas nuevas en minúscula sin datos. Las columnas viejas de Sheets quedan con sus leads históricos.
- **`Code.gs` sin cambios:** las columnas nuevas (`Momento`, `Propiedades`, `Dudas`, `rango`, …) se crean solas antes de las manuales, como ya hacía el script.
- **Nombre en el título del resultado:** nombre y apellido completos, como la pantalla final de antes ("Listo, Ana Prueba.").

### Texto que no estaba en el prompt

- Títulos de las preguntas: "¿En qué momento estás?", "¿Cuántas propiedades querés analizar?", "¿Qué tipo de reforma tenés en mente?", "¿Qué dudas tenés hoy?", "¿Para cuándo lo necesitás?". (Zona: "¿Dónde está ubicada la propiedad?", la de antes.)
- Chips: "3 propiedades", "4 o más propiedades".
- `aria-label="Alcance"` en la lista de chips (solo lector de pantalla).

### Para revisar

- **Reforma:** el párrafo de ancla es el mismo que en compra, como pide el prompt, pero su segunda frase ("si en el informe no encontramos ningún argumento para negociar, te lo devolvemos") habla de negociar un precio, que no aplica a quien ya tiene la propiedad. Si se quiere, se puede dar a reforma su propio párrafo en `form-config.js`.
- **Paso a paso:** los pasos 3 ("Confirmás el alcance con Esteban por WhatsApp.") y 4 ("Confirmás y nos mandás todo.") empiezan igual.

---

## Qué tiene que hacer Franco

**En GHL (Workflow "Black – Nuevo lead", disparador Inbound Webhook):**

1. Mapear como custom fields: `momento`, `propiedades`, `tipo_reforma`, `dudas`, `urgencia`, `rango`, `cotizacion_min`, `cotizacion_max`, `cotizacion_texto`. Opcionales: `rango_nombre`, `necesita_visita`, `revision_documental`.
2. Opcional: tag cuando `urgencia` = "Tengo que ofertar esta semana" (para que Esteban lo vea primero).
3. Cuando el Workflow ya no use `presupuesto`, `plazo`, `visito_propiedad`, `que_busca` y `disposicion_invertir`: borrarlas de `ghlClavesViejas` en `site/assets/js/form-config.js`.

**En Meta (Administrador de eventos):**

1. Crear una conversión personalizada sobre el evento `CotizacionVista` (se puede filtrar por `rango`).
2. `Contact` ya es un evento estándar: aparece solo cuando alguien toca el botón de WhatsApp del resultado.
3. Si alguna campaña optimizaba por un evento del salto automático a WhatsApp, ese salto ya no existe: el equivalente ahora es `Contact`.

**En Google Sheets:** nada. Las columnas nuevas se crean solas con el primer lead.
