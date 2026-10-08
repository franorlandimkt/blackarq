# Diagnóstico Black — landing

Landing de una sola página para tráfico de Meta Ads (85 %+ mobile). Vende el Diagnóstico Black: precio, reforma y negociación antes de ofertar. Sitio estático, sin build: la carpeta `site/` se sirve tal cual (Netlify).

```
docs/landing-copy.md         COPY FINAL de la landing (fuente única, se usa literal)
site/
  index.html                 la landing (12 secciones + ilustraciones SVG inline)
  data/reviews.json          reseñas de Google (carga manual)
  assets/css/site.css        sistema de diseño (el bloque del formulario no cambió)
  assets/css/paginas.css     estilos de /estudio y /obras (sistema anterior)
  assets/js/config.js        WhatsApp, Píxel, URL de Sheets, cifras          (sin cambios)
  assets/js/form-config.js   preguntas del formulario                        (sin cambios)
  assets/js/form.js          motor del formulario + envío a Sheets           (sin cambios)
  assets/js/content.js       [DATO: …] pendientes: se completan acá, en un solo lugar
  assets/js/site.js          atribución, CTA, CTA fijo, slider, reseñas, FAQ, datos
  assets/js/motion.js        animaciones de la landing (reveals, contadores, dibujo SVG…)
integrations/sheets/Code.gs  Apps Script que escribe los leads en Google Sheets (sin cambios)
```

Para probar en local: `cd site && python3 -m http.server 8080` y abrir http://localhost:8080.

---

## 1. Parámetros de URL en Meta

En cada anuncio, en **Parámetros de URL**, pegar exactamente:

```
utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&placement={{placement}}
```

Qué hace el sitio con eso:

- **Último toque** (`utm_*`, `campaign_id`, `adset_id`, `ad_id`, `placement`, `fbclid`): la última visita que llegó con parámetros. Una visita directa posterior no lo borra. Dura 90 días (`localStorage`).
- **Primer toque** (`ft_campaign`, `ft_adset`, `ft_ad`, `ft_fecha`): la primera visita que llegó con parámetros. No se pisa hasta que vence (90 días).
- **CTA de origen** (`cta_origen`): el botón que abrió el formulario. `ctas_sesion` lista todos los CTA tocados en la sesión, en orden (`cta_hero > cta_casos`).

IDs de los CTA (todos abren el mismo formulario): `cta_header` (encabezado, solo desktop), `cta_hero`, `cta_incluye` (después de "Qué incluye"), `cta_casos`, `cta_garantia`, `cta_faq`, `cta_cierre` y `cta_sticky` (CTA fijo en mobile). Entrar con `#diagnostico` en la URL abre el formulario (`cta_origen = directo`).

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

- **Automáticas** (las escribe el script): `fecha_hora`, `lead_id`, `ref_whatsapp`, las respuestas del formulario con el mismo nombre que en `form-config.js` (`Situación`, `Zona`, `Presupuesto`, `Plazo`, `¿Visitó la propiedad?`, `Qué busca`, `Disposición a invertir`), `ruta`, `califica`, `motivo_descalificacion`, `nombre`, `whatsapp`, `cta_origen`, `ctas_sesion`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term` (conjunto), `utm_content` (anuncio), `campaign_id`, `adset_id`, `ad_id`, `placement`, `fbclid`, `ft_campaign`, `ft_adset`, `ft_ad`, `ft_fecha`, `dispositivo`, `url`, `referrer`.
- **Manuales** (encabezado azul, las completa Black, el script nunca las pisa): `estado` (Nuevo / Contactado / Calificado / Diagnóstico vendido / No vendido / No califica), `vendido` (Sí / No), `fecha_venta`, `monto`, `motivo_no_venta` (Precio / No respondió / Fuera de zona / Ya compró / Otro), `notas`. Cada fila nueva entra con `estado = Nuevo`.

Si se agrega una pregunta al formulario, su columna se crea sola antes de las manuales.

### Pestaña "Resumen"

Solo fórmulas, sin carga manual: totales; leads, vendidos, tasa de venta y monto vendido **por campaña, por conjunto, por anuncio y por CTA de origen**; y lo mismo **por semana**. Para que cuente una venta, `vendido` tiene que ser **Sí**. Lo que llega sin campaña se agrupa como "(sin dato)".

---

## 3. Píxel de Meta

`metaPixelId` en `config.js`. Vacío = no se carga. Con ID: `PageView`, `InitiateCheckout` al abrir el formulario y `Lead` solo en envíos que califican, con `eventID = lead_id` (para deduplicar si después se suma la API de Conversiones).

GA4 (`G-EE9PC274XF`) está en el `<head>` de `index.html`. Eventos: `cta_click`, `form_start`, `form_step`, `form_route`, `form_submit`, `whatsapp_redirect`, `instagram_redirect`, `faq_open`, `case_slider_used`, `reviews_more`, `scroll_depth`. (`muro_hotspot` dejó de existir con la sección del corte de muro.)

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
| `plazo_whatsapp` | Paso a paso, paso 2 | Plazo de respuesta por WhatsApp (ej. "dentro de las 24 h hábiles") |
| `forma_pago` | Paso a paso, paso 4 | Forma de pago |
| `email` | Footer | Email de contacto (también arma el `mailto:`) |

Ya completados: `resenas_google` ("5,0 en Google · 41 reseñas") y `trayectoria_esteban` ("15 años · 120 obras · 18.000 m²", las cifras de `config.js`). El dato de años de Carla se sacó de la página.

Material visual pendiente (se reemplaza en `index.html`, cada lugar tiene un comentario `PLACEHOLDER`):

- **Foto de Esteban y Carla juntos en una visita** (sección "Quiénes"). Hoy: los dos retratos individuales (sin marcador visible).
- **Informe real anonimizado (2–3 páginas)**, con ACM y estrategia de negociación tapados (card "Informe Black de 7 miradas"). Hoy: mockup dibujado en SVG con datos reemplazados por líneas.
- **Fotos antes/después reales de Lorena (Villa Devoto) y de Amenábar.** Hoy los dos sliders usan las imágenes del sitio anterior (`caso-antes/despues` y `caso2-antes/despues`), que son **el mismo render en blanco y negro y en color**, no un antes y un después reales. Reemplazar los archivos con el mismo nombre (640 y 1000 px, AVIF + WebP).
- Del listado del cliente que no tiene lugar en la página: testimonio de la clienta que cerró la compra, apellido de Carla (se usa La Porta), cuántas propiedades entran en el Diagnóstico base.

## 6. Diseño y motion (v4)

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
- **Comparativa (Quiénes):** en mobile es una grilla de 4 columnas sin scroll (el criterio arriba de cada fila, la columna Black continua); en desktop, 5 columnas. Qué cubre cada opción se dedujo del copy — Tasación: precio; Inspección: estado; Inmobiliaria: precio y negociación, y cobra si firmás; Diagnóstico Black: todo, y no cobra si firmás. Revisar si se quiere otro criterio.
- **Caso Amenábar:** el título de la card es el H3 del copy; "Amenábar 914" va como rótulo arriba.
- **Footer:** zonas + Instagram + email. Se sacaron el link a Google Maps, las matrículas y el WhatsApp directo que tenía la v3 (sin links que saquen de la página salvo Instagram).
- **Schema:** se mantuvo `ProfessionalService` (con la descripción actualizada) y se reescribió `FAQPage` con las preguntas nuevas, para que coincida con lo visible.

### Formulario, Sheets y tracking

No se tocaron `form.js`, `form-config.js`, `config.js` ni `Code.gs`, ni el HTML del modal ni sus estilos. En `site.js` las funciones de atribución, Píxel, CTA y CTA fijo quedaron iguales; solo cambiaron las partes visuales (slider nuevo, se fueron el corte de muro y la ecuación de la v3, se sumó el completado de `[DATO]`).

Prueba de punta a punta (Playwright, antes y después del cambio, con una URL de Sheets de prueba interceptada porque `sheets.url` sigue vacío en `config.js`): el payload a Sheets (respuestas, ruta, califica, motivo, CTA de origen, UTMs, IDs de campaña/conjunto/anuncio, primer toque, dispositivo), la URL de WhatsApp con el mensaje precargado, los eventos de GA4 y del Píxel (`InitiateCheckout`, `Lead`) y la pantalla de Instagram para el no calificado salieron **idénticos** a la línea base. Mientras `sheets.url` y `metaPixelId` estén vacíos, en producción no se escribe en la planilla ni carga el Píxel (igual que antes).
