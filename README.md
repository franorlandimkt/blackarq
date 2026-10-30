# Diagnóstico Black — landing

Landing de una sola página para tráfico de Meta Ads (85 %+ mobile). Vende el Diagnóstico Black: precio, reforma y negociación antes de ofertar. Sitio estático, sin build: la carpeta `site/` se sirve tal cual (Netlify).

```
docs/landing-copy.md         COPY FINAL de la landing (fuente única, se usa literal)
site/
  index.html                 la landing (12 secciones + ilustraciones SVG inline)
  data/reviews.json          reseñas de Google (carga manual)
  assets/css/site.css        sistema de diseño (+ pantallas de carga y resultado del cotizador)
  assets/css/paginas.css     estilos de /estudio y /obras (sistema anterior)
  assets/js/config.js        WhatsApp, Píxel, URL de Sheets, cifras          (sin cambios)
  assets/js/form-config.js   preguntas del cotizador, montos y textos del resultado
  assets/js/form.js          motor del cotizador + envío a GHL y Sheets + eventos
  assets/js/content.js       [DATO: …] pendientes: se completan acá, en un solo lugar
  assets/js/site.js          atribución, CTA, CTA fijo, slider, reseñas, FAQ, datos
  assets/js/motion.js        animaciones de la landing (reveals, contadores, dibujo SVG…)
integrations/sheets/Code.gs  Apps Script que escribe los leads en Google Sheets (sin cambios)
netlify/functions/           ghl-lead (lead → GHL) y meta-capi (eventos → API de Conversiones)
scripts/verificar-tracking.mjs  prueba automática del tracking (correr antes de publicar)
```

Para probar en local: `cd site && python3 -m http.server 8080` y abrir http://localhost:8080.

---

## 0. CRM: Go High Level (subcuenta Black Arquitectura)

Cada envío del formulario (califique o no) va a `netlify/functions/ghl-lead.js`, que lo reenvía al disparador **Inbound Webhook** del Workflow **"Black – Nuevo lead"**. Variable en Netlify: `GHL_WEBHOOK_URL` (la URL del disparador). Sin ella, la función responde 503 y el navegador guarda el lead en la cola para reintentar.

Claves que llegan al webhook (planas, sin tildes, para mapear en el Workflow):

- **Contacto:** `first_name`, `last_name`, `full_name`, `phone` (+54…), `email`, `country`, `source`, `tags` (`diagnostico-black` + `califica` / `no-califica`).
- **Respuestas (cotizador, v6):** `momento`, `propiedades` (ruta compra), `tipo_reforma` (ruta reforma), `zona`, `dudas` (varias, separadas por " · "), `urgencia`. Una pregunta nueva llega con su `columna` en snake_case.
- **Cotización:** `rango` ("1"/"2"/"3"; vacío en reforma y en no califica), `rango_nombre`, `cotizacion_min` y `cotizacion_max` (números sin formato, ej. `500000`), `cotizacion_texto` (`$500.000 – $900.000`), `necesita_visita` y `revision_documental` ("Sí"/"No": lo incluye el rango o lo pidió en las dudas).
- **Claves del formulario anterior, vacías:** `presupuesto`, `plazo`, `visito_propiedad`, `que_busca`, `disposicion_invertir` llegan siempre como `""` para que el Workflow no se rompa si las tenía mapeadas. Se borran de `ghlClavesViejas` en `form-config.js` cuando se actualice el Workflow.
- **Lead:** `lead_id`, `ref_whatsapp` (la `Ref. BLK-XXXX` del WhatsApp), `ruta`, `califica` ("Sí"/"No"), `motivo_descalificacion`.
- **Envío:** `fecha_envio` (cuándo completó el formulario) y `reintento` (`no` / `si`). Un `si` es el mismo lead reenviado porque en su momento no se confirmó (mismo `lead_id`): no es un contacto nuevo. El botón de WhatsApp de la pantalla de resultado espera la confirmación de GHL (hasta 2,5 s) antes de salir; los pendientes de más de 7 días se descartan.
- **Atribución:** `cta_origen`, `ctas_sesion`, `utm_*`, `campaign_id`, `adset_id`, `ad_id`, `placement`, `fbclid`, `fbp`, `fbc`, `external_id` (el mismo que usan Píxel y CAPI), `ft_*` (primer toque), `dispositivo`, `url`, `referrer`.

`fbc`, `fbp`, `external_id`, email y teléfono quedan en el contacto para que los Workflows de etapa (Schedule, ShowUp, Purchase) los manden a Meta.

## 1. Parámetros de URL en Meta

En cada anuncio, en **Parámetros de URL**, pegar exactamente:

```
utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&placement={{placement}}
```

Qué hace el sitio con eso:

- **Último toque** (`utm_*`, `campaign_id`, `adset_id`, `ad_id`, `placement`, `fbclid`): la última visita que llegó con parámetros. Una visita directa posterior no lo borra. Dura 90 días (`localStorage`).
- **Primer toque** (`ft_campaign`, `ft_adset`, `ft_ad`, `ft_fecha`): la primera visita que llegó con parámetros. No se pisa hasta que vence (90 días).
- **CTA de origen** (`cta_origen`): el botón que abrió el formulario. `ctas_sesion` lista todos los CTA tocados en la sesión, en orden (`cta_hero > cta_casos`).

IDs de los CTA (todos abren el mismo formulario): `cta_header` (encabezado, solo desktop), `cta_hero`, `cta_problema`, `cta_solucion`, `cta_incluye` (después de "Qué incluye"), `cta_pasos`, `cta_casos`, `cta_garantia`, `cta_faq`, `cta_cierre` y `cta_sticky` (CTA fijo en mobile). Entrar con `#diagnostico` en la URL abre el formulario (`cta_origen = directo`).

En la v4 se dejaron de usar `cta_tres_cuentas`, `cta_informe`, `cta_quienes` y `cta_footer` (esas secciones ya no existen) y se sumaron `cta_header`, `cta_incluye` y `cta_garantia`. La pestaña "Resumen" agrupa con `UNIQUE()`, así que los IDs nuevos aparecen solos; los viejos quedan con sus leads históricos.

---

## 2. Google Sheets: publicar el registro de leads

1. Crear una planilla nueva en Google Sheets (por ejemplo "Black — Leads Diagnóstico").
2. **Extensiones → Apps Script**. Borrar el contenido de `Código.gs` y pegar todo `integrations/sheets/Code.gs`. Guardar.
3. En el selector de funciones de arriba elegir **`setupSheet`** y tocar **Ejecutar**. La primera vez pide permisos: aceptar con la cuenta dueña de la planilla. Crea las pestañas **Leads** y **Resumen** con encabezados, desplegables, formato condicional y fórmulas.
4. **Implementar → Nueva implementación**. Tipo: **Aplicación web**.
   - Ejecutar como: **Yo**.
   - Quién tiene acceso: **Cualquier usuario** (sin esto el sitio no puede escribir).
5. **Implementar**, copiar la **URL de la aplicación web** (termina en `/exec`).
6. Pegarla en `site/assets/js/config.js`, en `sheets.url`. El `token` de `config.js` tiene que ser igual a `TOKEN` en `Code.gs` (ya lo son).
7. Publicar el sitio.

Si después se edita `Code.gs`: **Implementar → Administrar implementaciones → editar (lápiz) → Versión: nueva → Implementar**. La URL no cambia.

### Cómo envía el sitio

`fetch` con `Content-Type: text/plain;charset=utf-8`, JSON en el body y `keepalive: true` (sin preflight de CORS). El envío no bloquea ni demora el paso a WhatsApp. Antes de mandarlo se guarda en una cola en `localStorage`; si la red falla, se reintenta en la próxima carga de la página. El script descarta duplicados por `lead_id`.

`lead_id` es un UUID. El mensaje de WhatsApp lleva una referencia corta (`Ref. BLK-XXXXXXXX`), que figura en la columna `ref_whatsapp`: así se cruza un chat con su fila.

### Pestaña "Leads"

Una fila por envío (califique o no).

- **Automáticas** (las escribe el script): `fecha_hora`, `lead_id`, `ref_whatsapp`, las respuestas del formulario con el mismo nombre que en `form-config.js` (`Momento`, `Propiedades`, `Tipo de reforma`, `Zona`, `Dudas`, `Urgencia`; las columnas del formulario anterior quedan con sus leads históricos), `ruta`, `califica`, `motivo_descalificacion`, `rango`, `rango_nombre`, `cotizacion_min`, `cotizacion_max`, `cotizacion_texto`, `necesita_visita`, `revision_documental`, `nombre`, `whatsapp`, `email`, `cta_origen`, `ctas_sesion`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term` (conjunto), `utm_content` (anuncio), `campaign_id`, `adset_id`, `ad_id`, `placement`, `fbclid`, `ft_campaign`, `ft_adset`, `ft_ad`, `ft_fecha`, `dispositivo`, `url`, `referrer`.
- **Manuales** (encabezado azul, las completa Black, el script nunca las pisa): `Estado` (Nuevo / Contactado / Calificado / Diagnóstico vendido / No vendido / No califica), `¿Se vendió?` (Sí / No), `fecha_venta`, `monto`, `motivo_no_venta` (Precio / No respondió / Fuera de zona / Ya compró / Otro), `notas`. Cada fila nueva entra con las manuales vacías.

Si se agrega una pregunta al formulario, su columna se crea sola antes de las manuales.

### Pestaña "Resumen"

Solo fórmulas, sin carga manual: totales; leads, vendidos, tasa de venta y monto vendido **por campaña, por conjunto, por anuncio y por CTA de origen**; y lo mismo **por semana**. Para que cuente una venta, `¿Se vendió?` tiene que ser **Sí**. Lo que llega sin campaña se agrupa como "(sin dato)".

---

## 3. Píxel de Meta

`metaPixelId` en `config.js`. Vacío = no se carga. Con ID: `PageView`, `InitiateCheckout` al abrir el formulario y `Lead` solo en envíos que califican, con `eventID = lead_id` (Meta deduplica con la API de Conversiones).

**El `PageView` sale desde el `<head>` por píxel de imagen** (una petición a `facebook.com/tr` sin esperar a `fbevents.js`) en `index.html`, `obras/` y `estudio/`. Antes dependía de que bajaran `fbevents.js` y su configuración (~280 KB, uno detrás del otro): con señal floja el PageView salía a los 4–14 s y quien se iba antes no contaba como visita a la página de destino; ahora sale en 0,2–0,4 s. El mismo bloque crea `_fbp`/`_fbc` con el formato de Meta y el script los reusa, así todos los eventos quedan atados al mismo clic. `fbevents.js` carga igual (prioridad alta) para el resto de los eventos, pero ya no manda PageView. GA4 carga desde el principio, como siempre. Si cambia el ID del Píxel, cambiarlo en `config.js` y en esas 3 páginas.

**Eventos de Meta (Píxel + API de Conversiones, mismo `eventID` en los dos, Meta deduplica):**

| Evento | Cuándo | Parámetros |
|---|---|---|
| `PageView` | carga | — |
| `InitiateCheckout` | abre el formulario | `cta_origen` |
| `FormularioPaso` (personalizado) | cada paso que alcanza, una vez por paso. El `paso` 1 sale **siempre** junto con `InitiateCheckout`, aunque retome un borrador en un paso posterior | `paso`, `total_pasos`, `pregunta`, `ruta`, `es_datos` |
| `Lead` | envío que **califica** (sale en el envío, antes de la cotización). `eventID` = `lead_id` | `ruta`, `zona`, `propiedades`, `rango`, `urgencia`, `cta_origen` |
| `LeadNoCalifica` (personalizado) | envío que **no** califica | lo mismo + `motivo` |
| `CotizacionVista` (personalizado) | se pinta la pantalla con la cotización (ruta compra), una vez por lead. `eventID` = `lead_id` + `-cot` | `rango`, `cotizacion_min`, `cotizacion_max`, `zona`, `propiedades`, `cta_origen` |
| `Contact` (estándar) | toca el botón de WhatsApp de la pantalla de resultado, una vez por lead. `eventID` = `lead_id` + `-wa` | `ruta`, `rango`, `cta_origen` |

Coincidencia de eventos: `external_id` anónimo y estable del visitante en todos los eventos, `_fbp`/`_fbc` (o `fbclid`), IP y user agent por servidor; en el envío, email, teléfono, nombre y apellido (hasheados) por Píxel con coincidencia avanzada y por CAPI.

**Conversión personalizada de inicio de formulario:** tiene que ser evento `InitiateCheckout` sin reglas de URL ni de parámetros (o `FormularioPaso` con `paso` = 1). Una regla de URL no sirve: abrir el formulario no cambia la URL. Y una conversión personalizada solo cuenta desde el día en que se creó: para rangos anteriores, usar la columna estándar "Pagos iniciados en el sitio web".

**Antes de publicar un cambio en `form.js`, `site.js` o `form-config.js`:** `node scripts/verificar-tracking.mjs` (necesita Playwright). Simula visitas en iPhone con el navegador de Instagram y comprueba que nunca salga un Lead sin inicio, que Píxel y CAPI compartan `eventID`, que no se dupliquen Leads (doble tap, volver de WhatsApp) y que el no calificado no mande Lead. Desde la v6 también: los 5 casos de rango (Píxel, CAPI, GA4 y GHL), `CotizacionVista` una vez, `Contact` solo con el toque (una vez aunque toque dos), que nunca se vaya a WhatsApp sin el toque, la ruta reforma sin cotización, el envío sin email (y que la función de CAPI no mande el hash de un email vacío), las claves del payload a GHL, volver a abrir el resultado y que un borrador con las preguntas anteriores se descarte. No manda nada a Meta, GHL ni GA4.

Para ver dónde se cae la gente o optimizar a mitad de embudo: en el Administrador de eventos, **Conversiones personalizadas** sobre `FormularioPaso` con la regla `paso` ≥ N (ej. ≥ 5 = completó la mitad).

Píxel: `1638281244623196`. **API de Conversiones:** el `Lead` calificado también sale del servidor por `netlify/functions/meta-capi.js` (mismo `event_id`, nombre y teléfono hasheados SHA-256, IP, user agent, `_fbp`/`_fbc`). El token **no está en el repo**: cargarlo en Netlify > Site configuration > Environment variables como `META_CAPI_TOKEN` y volver a desplegar. Opcional: `META_TEST_CODE` con el código de "Probar eventos" del Administrador de eventos para verificar, y borrarlo después.

GA4 (`G-EE9PC274XF`) está en el `<head>` de `index.html`. Eventos: `cta_click`, `form_start`, `form_step`, `form_route`, `form_submit`, `cotizacion_vista` (mismos parámetros que `CotizacionVista`), `whatsapp_redirect` (`origen: "boton"`; el `origen: "auto"` dejó de existir con el salto automático), `instagram_redirect`, `faq_open`, `case_slider_used`, `reviews_more`, `scroll_depth`. (`muro_hotspot` dejó de existir con la sección del corte de muro.)

---

## 4. Reseñas

`site/data/reviews.json`. Copiar reseñas reales del perfil de Google, **texto literal**. Para publicar una entrada: completar `autor` y `texto` (y si se quiere `fecha`, `avatar`, `link`) y cambiar `estado` a `"OK"`. Las entradas `"PENDIENTE"` no se muestran; se ven agregando `?preview=1` a la URL. Hoy hay 5 reales publicadas (el copy pide 3 a 5). En desktop se ven hasta 6 (con "Ver más" si hay más); en mobile, carrusel horizontal.

El puntaje y la cantidad que se muestran en el hero y en el encabezado de las reseñas salen de `content.js` (`resenas_google`: "5,0 en Google · 41 reseñas"), con los mismos valores que `reviews.json` y el schema `aggregateRating`. Si cambian, actualizar los tres.

---

## 5. Contenido pendiente — `[DATO: …]`

Todos se completan en **`site/assets/js/content.js`** (un solo archivo). Mientras estén vacíos se ven en la página como un marcador amarillo punteado.

| Clave en `content.js` | Dónde aparece | Qué falta |
|---|---|---|
| `testimonio_lorena` | Caso Lorena | Testimonio textual de Lorena (y permiso de nombre) |

Ya completados: `resenas_google` ("5,0 en Google · 41 reseñas") y `trayectoria_esteban` ("15 años · 120 obras · 18.000 m²", las cifras de `config.js`). El dato de años de Carla se sacó de la página.

Material visual pendiente (se reemplaza en `index.html`, cada lugar tiene un comentario `PLACEHOLDER`):

- **Foto de Esteban y Carla juntos en una visita** (sección "Quiénes"). Hoy: los dos retratos individuales (sin marcador visible).
- **Informe real anonimizado (2–3 páginas)**, con ACM y estrategia de negociación tapados (card "Informe Black de 7 miradas"). Hoy: mockup dibujado en SVG con datos reemplazados por líneas.
- **Fotos antes/después reales de Lorena (Villa Devoto) y de Amenábar.** Hoy los dos sliders usan las imágenes del sitio anterior (`caso-antes/despues` y `caso2-antes/despues`), que son **el mismo render en blanco y negro y en color**, no un antes y un después reales. Reemplazar los archivos con el mismo nombre (640 y 1000 px, AVIF + WebP).
- Del listado del cliente que no tiene lugar en la página: testimonio de la clienta que cerró la compra, apellido de Carla (se usa La Porta), cuántas propiedades entran en el Diagnóstico base.

## 6. Cambios v6 (30/10): cotizador

El formulario pasó de calificar al lead a **cotizar su caso**: 5 preguntas + datos, una carga breve y una pantalla con el rango de precio y el botón a WhatsApp. El lead se captura igual que antes (mismo momento, mismos eventos, mismo envío a GHL). Informe completo con capturas y auditoría: `docs/cambios-v6-cotizador.md`. Punto de restauración: commit `64c31fb` (el `main` anterior al cotizador).

**Formulario (6 pasos en las dos rutas, `form-config.js`):** momento (define la ruta) → cuántas propiedades (compra) o tipo de reforma (reforma; "Puntual" no califica, como la reforma chica de antes) → zona → dudas (varias; "estado real" marca visita, "planos y documentación" marca revisión documental) → urgencia → datos (nombre y WhatsApp obligatorios, **email opcional**). Encabezado: "Paso {n} de {total} · Cotizando tu caso". Presupuesto, plazo de compra, objetivos y "¿visitó?" salieron del formulario: los pregunta Esteban por WhatsApp.

**Bloque `cotizacion` (`form-config.js`):** moneda, vigencia, los tres rangos (nombre, qué incluye, mínimo y máximo en pesos, si incluyen visita y revisión documental), la línea de traslados fuera de CABA y la regla de asignación. `form.js` solo lo lee: para cambiar un monto o la regla no se toca el motor.

| Rango | Monto | Cuándo (ruta compra, en este orden) |
|---|---|---|
| 3 · Comparativo | $900.000 – $1.400.000 | "Cuatro o más", o "Dos"/"Tres" con duda de planos y documentación |
| 1 · Análisis por planos | $300.000 – $500.000 | "Una" sin duda de estado ni de planos y documentación |
| 2 · Con visita técnica | $500.000 – $900.000 | todo lo demás (incluye "Todavía no sé") |

Ruta reforma: no se calcula rango.

**Después de enviar:** el envío a GHL, Sheets, `form_submit` y el `Lead` (o `LeadNoCalifica`) salen igual que antes, en el envío. Si califica: **pantalla de carga** (2 s, barra al 100 %, una planta que se dibuja y tres mensajes; con movimiento reducido, un mensaje fijo) y **pantalla de resultado**:
- compra: "Listo, {nombre}. Para tu caso, el Diagnóstico Black sale entre {min} y {max}.", alcance (cuántas propiedades · zona · con visita técnica · con revisión documental, solo lo que aplica), las tres tarjetas con la del caso en amarillo ("Tu caso"), traslados si no es CABA, el párrafo de descuento y devolución, el contexto de Lorena y el botón "Hablá con Esteban y empezá a resolver tu propiedad";
- reforma: "Listo, {nombre}. Te cotizamos tu caso por WhatsApp en menos de 24 h hábiles." + el mismo párrafo y el mismo botón;
- no califica: igual que antes (Instagram).

**Fin del salto automático a WhatsApp.** Solo se va a WhatsApp tocando el botón (misma pestaña, espera a GHL hasta 2,5 s). El mensaje prellenado lleva momento, propiedades (o reforma), zona, dudas, urgencia, rango estimado y la referencia. Si cierra el formulario y lo vuelve a abrir, ve su resultado otra vez; a los 30 minutos, o con "Cotizar otro caso", arranca de cero (y cuenta un inicio nuevo). Un borrador guardado con las preguntas anteriores se descarta.

**Tracking:** nuevos `CotizacionVista` (Píxel + CAPI + GA4 `cotizacion_vista`) y `Contact` (Píxel + CAPI; GA4 `whatsapp_redirect` con `origen: "boton"`). El `Lead` ahora lleva `propiedades`, `rango` y `urgencia` en lugar de `presupuesto` y `plazo`. `meta-capi.js` acepta los dos eventos nuevos.

**Landing:** todos los CTA dicen "Cotizá tu Diagnóstico"; hero "Cotización en 1 minuto · Visita en 72 h · Informe en 7 días"; pasos 1 y 3; inversión ("Cotizalo en un minuto."); FAQ nueva "¿Cuánto sale?" primera (y en el schema `FAQPage`).

**Pendiente en GHL y Meta:** ver `docs/cambios-v6-cotizador.md` ("Qué tiene que hacer Franco").

## 7. Cambios v5 (13/10)

- **Hero:** H1 "¿Estás por comprar una propiedad?" a todo el ancho, sin resaltado (2 líneas en 358–390 px). Bullets y subtítulo nuevos. CTA del hero: "Quiero analizar mi propiedad" (el resto sigue "Quiero mi Diagnóstico Black"). *Desde la v6 todos dicen "Cotizá tu Diagnóstico".* Debajo: "Visita en 72 h · Informe en 7 días" + garantía.
- **Problema:** H2 del auto usado, tarjetas Auto usado vs Propiedad (sin íconos: el "Sí" malo va en amarillo), texto, puente y pregunta 3 nueva ("¿Puede quedar como la querés?").
- **Idea central:** compra en tres partes + mapa conceptual SVG (COMPRA → Inmobiliario · Constructivo · Arquitectónico) que reemplaza la ilustración de las dos mitades.
- **Remate** ("Todo esto tiene solución"): panel oscuro con más aire, frase con barra amarilla.
- **Pasos 1, 2 y 4** nuevos; sin `[DATO]` de plazo y forma de pago.
- **Foto de Carla** corregida en el archivo (niveles de negro, contraste, color) en todos sus tamaños (mini, 400, 596; WebP + AVIF).
- **Comparativa** en matriz y **footer** sin Instagram ni email.
- **Motion:** sigue siendo el sistema propio (no hay GSAP/Lenis en el proyecto): las tarjetas entran con `data-stagger` y las flechas del mapa se dibujan con `data-draw` (stroke-dashoffset). Con `prefers-reduced-motion`, todo estático.
- Punto de restauración: tag `restore-pre-cambios-finales`.

## 8. Diseño y motion (v4)

- **Dirección:** estudio de arquitectura contemporáneo con lenguaje de plano. Base negro + grises (`--g1` #121212, `--g2` #1A1A1A), blanco cálido (`--hueso` #F4F3EF) solo en "Idea central" y "Para quién". Antonio (títulos) + Poppins (texto) y el amarillo de marca existente (`--acento` #FFE500), solo como acento.
- **Resaltados** (siempre los mismos tres): `.hl-u` subrayado que se dibuja, `.hl-m` marcador que se pinta, `.hl-y` palabra/cifra en amarillo. Sobre blanco, `.hl-y` pasa a fondo amarillo con texto negro (contraste AA).
- **Ilustraciones:** SVG inline propias, un solo sistema (trazo 1,5 px, puntas redondeadas, rellenos planos en grises, amarillo solo en el protagonista, rótulos Poppins en mayúsculas). Se dibujan con `stroke-dashoffset` al entrar, una sola vez.
- **Motion:** `motion.js`, vanilla (IntersectionObserver + rAF + transiciones CSS). La entrada del hero la dispara un script inline en `index.html` (no espera a los scripts diferidos, así el titular no parpadea). Con `prefers-reduced-motion`, o si `motion.js` no corre, todo aparece estático, ya dibujado y con los números finales.
- **Fuentes:** fallbacks con métricas ajustadas (`Antonio Fallback`, `Poppins Fallback` en `site.css`) para que el cambio de fuente no mueva la página.

### Decisiones tomadas sin consultar

- **Sin GSAP ni Lenis.** El brief decía usar el stack existente, pero el proyecto no los tenía: es vanilla y sin build. Sumarlos agregaba ~60 KB de JS antes de animar nada y Lenis (scroll suavizado) se pelea con el slider táctil y con el scroll del modal. Todo el motion pedido está hecho con JS propio (~7 KB sin comprimir).
- **privy.io no se pudo abrir** desde el entorno de trabajo (la política de red bloquea el dominio). Se aplicó el sistema descripto en el brief: hero con aire y pieza visual grande, fila de stats, cards con visual arriba, bloques apilados con divisores finos, cierre que repite el hero.
- **Rama de trabajo:** `claude/black-landing-redesign-qsk1ax` (la que asigna el entorno) en lugar de `landing-diagnostico-black`.
- **CTAs intermedios:** además del hero, el cierre y el CTA fijo, se repite el mismo botón ("Quiero mi Diagnóstico Black") en el encabezado y después de Qué incluye, Casos, Garantía y FAQ. No agrega texto nuevo; cada uno con su ID.
- **Sin rótulos de sección** (v4.1): se sacaron los eyebrows ("B-02 · Ofertar a ciegas"…) y los códigos de las cards (A-01…). Regla agregada a la skill `crear-landing-pages`. La fila de stats usa los rótulos que pide el brief ("familias", "visita", "informe", "ahorro de Lorena").
- **Hero v4.1:** centrado, render de la casa de fondo, titular "Invertí en tu propiedad…", bajada corta, tres bullets, CTA y prueba (caras + cargos de Esteban y Carla + 5,0 en Google). El encabezado (logo + CTA) queda solo en desktop; en mobile el CTA fijo de abajo aparece pasado el hero.
- **"No es para vos" en rojo** (`--rojo` #CD2B31), único uso del color.
- **Comparativa (Quiénes, v5):** matriz (criterios en filas, opciones en columnas). En mobile, 4 columnas sin scroll con el criterio arriba de cada fila; en desktop, el criterio a la izquierda. Columna Black con fondo y borde amarillo y tildes amarillos; en las otras, tilde neutro para sí y ✕ gris apagado para no. Qué cubre cada opción se dedujo del copy — Tasación: precio; Inspección: estado; Inmobiliaria: precio y negociación, y cobra si firmás; Diagnóstico Black: todo, y no cobra si firmás. Revisar si se quiere otro criterio.
- **Caso Amenábar:** el título de la card es el H3 del copy; "Amenábar 914" va como rótulo arriba.
- **Footer (v5):** logo + zonas + copyright. Sin Instagram ni email (ningún link saca de la página).
- **Schema:** se mantuvo `ProfessionalService` (con la descripción actualizada) y se reescribió `FAQPage` con las preguntas nuevas, para que coincida con lo visible.

### Formulario, Sheets y tracking

No se tocaron `form.js`, `form-config.js`, `config.js` ni `Code.gs`, ni el HTML del modal ni sus estilos. En `site.js` las funciones de atribución, Píxel, CTA y CTA fijo quedaron iguales; solo cambiaron las partes visuales (slider nuevo, se fueron el corte de muro y la ecuación de la v3, se sumó el completado de `[DATO]`).

Prueba de punta a punta (Playwright, antes y después del cambio, con una URL de Sheets de prueba interceptada porque `sheets.url` sigue vacío en `config.js`): el payload a Sheets (respuestas, ruta, califica, motivo, CTA de origen, UTMs, IDs de campaña/conjunto/anuncio, primer toque, dispositivo), la URL de WhatsApp con el mensaje precargado, los eventos de GA4 y del Píxel (`InitiateCheckout`, `Lead`) y la pantalla de Instagram para el no calificado salieron **idénticos** a la línea base. Mientras `sheets.url` y `metaPixelId` estén vacíos, en producción no se escribe en la planilla ni carga el Píxel (igual que antes).
