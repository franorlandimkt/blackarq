# Diagnóstico Black — landing

Landing de una sola página para tráfico de Meta Ads. Sitio estático, sin build: la carpeta `site/` se sirve tal cual (Netlify).

```
site/
  index.html                 la landing
  data/reviews.json          reseñas de Google (carga manual)
  assets/css/site.css        sistema de diseño de la landing
  assets/css/paginas.css     estilos de /estudio y /obras (sistema anterior)
  assets/js/config.js        WhatsApp, Píxel, URL de Sheets, cifras
  assets/js/form-config.js   preguntas del formulario
  assets/js/form.js          motor del formulario + envío a Sheets
  assets/js/site.js          atribución, CTA, corte de muro, reseñas, FAQ
integrations/sheets/Code.gs  Apps Script que escribe los leads en Google Sheets
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

IDs de los CTA: `cta_hero`, `cta_sticky`, `cta_tres_cuentas`, `cta_casos`, `cta_informe`, `cta_quienes`, `cta_faq`, `cta_cierre`, `cta_footer`. Entrar con `#diagnostico` en la URL abre el formulario (`cta_origen = directo`).

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

GA4 (`G-EE9PC274XF`) está en el `<head>` de `index.html`. Eventos: `cta_click`, `form_start`, `form_step`, `form_route`, `form_submit`, `whatsapp_redirect`, `faq_open`, `case_slider_used`, `muro_hotspot`, `reviews_more`, `scroll_depth`.

---

## 4. Reseñas

`site/data/reviews.json`. Copiar reseñas reales del perfil de Google, **texto literal**. Para publicar una entrada: completar `autor` y `texto` (y si se quiere `fecha`, `avatar`, `link`) y cambiar `estado` a `"OK"`. Las entradas `"PENDIENTE"` no se muestran; se ven agregando `?preview=1` a la URL. En desktop se ven 6 y un botón "Ver más"; en mobile, carrusel horizontal.

`rating` y `total` (5,0 / 41) se muestran en el encabezado: actualizarlos a mano cuando cambien.

---

## 5. Pendientes de contenido

- Reseñas: 7 entradas `PENDIENTE` en `data/reviews.json` (hay 5 reales).
- Foto de Esteban y Carla juntos (hoy: dos retratos individuales en el hero y en "Quiénes somos").
- Informe real anonimizado (hoy: mockup dibujado en la sección "Qué analizamos").
- Respuesta del FAQ "¿Y si mientras espero el informe me la sacan?" (comentada en `index.html`, no se publica).
- `sheets.url` y `metaPixelId` en `config.js`.
