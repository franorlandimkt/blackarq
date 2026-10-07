/**
 * BLACK — Registro de leads del Diagnóstico Black en Google Sheets.
 *
 * Se pega en Extensiones > Apps Script de la planilla y se publica como
 * aplicación web (instrucciones paso a paso en README.md, en la raíz del
 * repo). Dos funciones para usar a mano:
 *
 *   setupSheet()  Crea (o completa) las pestañas "Leads" y "Resumen":
 *                 encabezados, desplegables, formato condicional y fórmulas.
 *                 Se puede volver a correr: no borra filas de "Leads".
 *   doPost(e)     La llama el sitio en cada envío del formulario. Agrega una
 *                 fila en "Leads". Nunca escribe en las columnas manuales
 *                 (salvo "estado" = "Nuevo" en la fila nueva).
 */

/* Tiene que ser IGUAL a `sheets.token` de site/assets/js/config.js. No es
   una contraseña: sirve para descartar envíos que no vienen del sitio. */
var TOKEN = 'blk_1c8fdfbb46be0a9ec65a444f';

var HOJA_LEADS = 'Leads';
var HOJA_RESUMEN = 'Resumen';
var ZONA_HORARIA = 'America/Argentina/Buenos_Aires';

/* Columnas que escribe el script, en orden. Las respuestas del formulario
   usan el mismo nombre que `columna` en form-config.js. Si el sitio manda
   un campo nuevo, la columna se crea sola antes de las manuales. */
var AUTOMATICAS = [
  'fecha_hora', 'lead_id', 'ref_whatsapp',
  'Situación', 'Zona', 'Presupuesto', 'Plazo', '¿Visitó la propiedad?', 'Qué busca', 'Disposición a invertir',
  'ruta', 'califica', 'motivo_descalificacion',
  'nombre', 'whatsapp',
  'cta_origen', 'ctas_sesion',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'campaign_id', 'adset_id', 'ad_id', 'placement', 'fbclid',
  'ft_campaign', 'ft_adset', 'ft_ad', 'ft_fecha',
  'dispositivo', 'url', 'referrer'
];

/* Columnas que completa Black a mano. El script nunca las pisa. */
var MANUALES = ['estado', 'vendido', 'fecha_venta', 'monto', 'motivo_no_venta', 'notas'];

var ESTADOS = ['Nuevo', 'Contactado', 'Calificado', 'Diagnóstico vendido', 'No vendido', 'No califica'];
var COLOR_ESTADO = {
  'Nuevo': '#FFF7B3',
  'Contactado': '#DCE7F2',
  'Calificado': '#C9DDF0',
  'Diagnóstico vendido': '#CDEBD3',
  'No vendido': '#F3D6D2',
  'No califica': '#E4E2DE'
};
var MOTIVOS = ['Precio', 'No respondió', 'Fuera de zona', 'Ya compró', 'Otro'];

/* ===================================================================== */
/*  WEB APP                                                              */
/* ===================================================================== */

function doGet() {
  return ContentService.createTextOutput('Black · registro de leads activo');
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.token !== TOKEN) return respuesta_({ ok: false, error: 'token' });
    // Honeypot lleno = bot. Se responde ok para no darle pistas.
    if (body.hp) return respuesta_({ ok: true });

    var f = body.fields || {};
    if (!f.lead_id) return respuesta_({ ok: false, error: 'sin lead_id' });

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var sh = hojaLeads_();
      var headers = asegurarColumnas_(sh, Object.keys(f));

      // Duplicados: el sitio reintenta envíos que creyó fallidos.
      var colId = headers.indexOf('lead_id') + 1;
      if (sh.getLastRow() > 1) {
        var ya = sh.getRange(2, colId, sh.getLastRow() - 1, 1)
          .createTextFinder(String(f.lead_id)).matchEntireCell(true).findNext();
        if (ya) return respuesta_({ ok: true, duplicado: true });
      }

      var fila = headers.map(function (h) {
        if (h === 'fecha_hora') return new Date();
        if (h === 'estado') return 'Nuevo';
        if (MANUALES.indexOf(h) >= 0) return '';
        return limpiar_(f[h]);
      });
      sh.appendRow(fila);
    } finally {
      lock.releaseLock();
    }
    return respuesta_({ ok: true });
  } catch (err) {
    return respuesta_({ ok: false, error: String(err) });
  }
}

function respuesta_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Texto plano. Lo que empieza con = + - @ se escribe como texto (evita
    que Sheets lo tome como fórmula o como número, ej. +549…). */
function limpiar_(v) {
  if (v == null) return '';
  var s = String(v).slice(0, 2000);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function hojaLeads_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(HOJA_LEADS);
  if (!sh || sh.getLastColumn() === 0) {
    setupSheet();
    sh = SpreadsheetApp.getActive().getSheetByName(HOJA_LEADS);
  }
  return sh;
}

function leerEncabezados_(sh) {
  var n = sh.getLastColumn();
  if (!n) return [];
  return sh.getRange(1, 1, 1, n).getValues()[0].map(String);
}

/** Crea las columnas que falten, antes de la primera columna manual. */
function asegurarColumnas_(sh, claves) {
  var headers = leerEncabezados_(sh);
  claves.forEach(function (k) {
    if (!k || headers.indexOf(k) >= 0) return;
    var antes = headers.indexOf(MANUALES[0]);
    if (antes < 0) {
      sh.getRange(1, headers.length + 1).setValue(k);
    } else {
      sh.insertColumnBefore(antes + 1);
      sh.getRange(1, antes + 1).setValue(k);
    }
    headers = leerEncabezados_(sh);
  });
  return headers;
}

/* ===================================================================== */
/*  SETUP                                                                */
/* ===================================================================== */

function setupSheet() {
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(ZONA_HORARIA);

  /* ------------------------------------------------------------ Leads */
  var sh = ss.getSheetByName(HOJA_LEADS) || ss.insertSheet(HOJA_LEADS, 0);
  var headers = leerEncabezados_(sh).filter(function (h) { return h !== ''; });
  if (!headers.length) {
    headers = AUTOMATICAS.concat(MANUALES);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    asegurarColumnas_(sh, AUTOMATICAS);
    headers = leerEncabezados_(sh);
    MANUALES.forEach(function (m) {
      if (headers.indexOf(m) < 0) {
        sh.getRange(1, headers.length + 1).setValue(m);
        headers = leerEncabezados_(sh);
      }
    });
  }
  headers = leerEncabezados_(sh);
  var nCols = headers.length;
  var maxFilas = Math.max(sh.getMaxRows(), 2000);
  if (sh.getMaxRows() < maxFilas) sh.insertRowsAfter(sh.getMaxRows(), maxFilas - sh.getMaxRows());

  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, nCols).setFontWeight('bold').setBackground('#0A0A0A').setFontColor('#F6F6F4');
  // Las manuales, en otro color: así se ve qué columnas se tocan a mano.
  MANUALES.forEach(function (m) {
    sh.getRange(1, headers.indexOf(m) + 1).setBackground('#2E4D6B');
  });

  function col(nombre) { return headers.indexOf(nombre) + 1; }
  function rango(nombre) { return sh.getRange(2, col(nombre), maxFilas - 1, 1); }

  rango('fecha_hora').setNumberFormat('dd/mm/yyyy hh:mm');
  rango('fecha_venta').setNumberFormat('dd/mm/yyyy');
  rango('monto').setNumberFormat('#,##0');

  rango('estado').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(ESTADOS, true).setAllowInvalid(false).build());
  rango('vendido').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Sí', 'No'], true).setAllowInvalid(false).build());
  rango('motivo_no_venta').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(MOTIVOS, true).setAllowInvalid(false).build());
  rango('fecha_venta').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireDate().setAllowInvalid(false).build());
  rango('monto').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireNumberGreaterThanOrEqualTo(0).setAllowInvalid(false).build());

  // Formato condicional: la fila entera según el estado.
  var letraEstado = letra_(col('estado'));
  var filas = sh.getRange(2, 1, maxFilas - 1, nCols);
  var reglas = sh.getConditionalFormatRules().filter(function (r) {
    return !r.getRanges().some(function (x) { return x.getSheet().getName() === HOJA_LEADS; });
  });
  ESTADOS.forEach(function (e) {
    reglas.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + letraEstado + '2="' + e + '"')
      .setBackground(COLOR_ESTADO[e])
      .setRanges([filas])
      .build());
  });
  sh.setConditionalFormatRules(reglas);

  /* ---------------------------------------------------------- Resumen */
  var rs = ss.getSheetByName(HOJA_RESUMEN) || ss.insertSheet(HOJA_RESUMEN, 1);
  rs.clear();
  rs.clearConditionalFormatRules();

  function ref(nombre) {
    var l = letra_(col(nombre));
    return "'" + HOJA_LEADS + "'!$" + l + '$2:$' + l;
  }
  var ID = ref('lead_id'), VEND = ref('vendido'), MONTO = ref('monto'), FECHA = ref('fecha_hora');

  rs.getRange('A1').setValue('Resumen — se calcula solo a partir de "Leads". No escribir en esta pestaña.')
    .setFontWeight('bold');
  rs.getRange('A2:D2').setValues([['Leads', 'Vendidos', 'Tasa de venta', 'Monto vendido']]).setFontWeight('bold');
  rs.getRange('A3').setFormula('=COUNTIF(' + ID + ',"<>")');
  rs.getRange('B3').setFormula('=COUNTIFS(' + ID + ',"<>",' + VEND + ',"Sí")');
  rs.getRange('C3').setFormula('=IFERROR(B3/A3,0)').setNumberFormat('0.0%');
  rs.getRange('D3').setFormula('=SUMIFS(' + MONTO + ',' + ID + ',"<>",' + VEND + ',"Sí")').setNumberFormat('#,##0');

  var bloques = [
    { titulo: 'Por campaña', dim: 'utm_campaign', col: 1 },
    { titulo: 'Por conjunto de anuncios', dim: 'utm_term', col: 7 },
    { titulo: 'Por anuncio', dim: 'utm_content', col: 13 },
    { titulo: 'Por CTA de origen', dim: 'cta_origen', col: 19 }
  ];
  var FILA = 5;
  bloques.forEach(function (b) {
    var D = ref(b.dim);
    var c = b.col;
    var A = letra_(c), B = letra_(c + 1), C = letra_(c + 2), Dd = letra_(c + 3), E = letra_(c + 4);
    var datos = FILA + 2;
    var lista = A + datos + ':' + A;
    // Lo vacío se agrupa como "(sin dato)" (ej. tráfico orgánico).
    var crit = 'IF(' + lista + '="(sin dato)","",' + lista + ')';
    rs.getRange(FILA, c).setValue(b.titulo).setFontWeight('bold');
    rs.getRange(FILA + 1, c, 1, 5).setValues([[b.dim, 'Leads', 'Vendidos', 'Tasa de venta', 'Monto vendido']])
      .setFontWeight('bold').setBackground('#E4E2DE');
    rs.getRange(datos, c).setFormula(
      '=IFERROR(SORT(UNIQUE(FILTER(IF(LEN(' + D + ')=0,"(sin dato)",' + D + '),LEN(' + ID + ')>0))),"")');
    rs.getRange(datos, c + 1).setFormula(
      '=ARRAYFORMULA(IF(' + lista + '="",,COUNTIFS(' + ID + ',"<>",' + D + ',' + crit + ')))');
    rs.getRange(datos, c + 2).setFormula(
      '=ARRAYFORMULA(IF(' + lista + '="",,COUNTIFS(' + ID + ',"<>",' + D + ',' + crit + ',' + VEND + ',"Sí")))');
    rs.getRange(datos, c + 3).setFormula(
      '=ARRAYFORMULA(IF(' + lista + '="",,IFERROR(' + C + datos + ':' + C + '/' + B + datos + ':' + B + ',0)))');
    rs.getRange(datos, c + 4).setFormula(
      '=ARRAYFORMULA(IF(' + lista + '="",,SUMIFS(' + MONTO + ',' + ID + ',"<>",' + D + ',' + crit + ',' + VEND + ',"Sí")))');
    rs.getRange(Dd + datos + ':' + Dd).setNumberFormat('0.0%');
    rs.getRange(E + datos + ':' + E).setNumberFormat('#,##0');
  });

  // Por semana (lunes a domingo).
  var c = 25;
  var A = letra_(c), B = letra_(c + 1), C = letra_(c + 2), Dd = letra_(c + 3), E = letra_(c + 4);
  var datos = FILA + 2;
  var lista = A + datos + ':' + A;
  rs.getRange(FILA, c).setValue('Por semana').setFontWeight('bold');
  rs.getRange(FILA + 1, c, 1, 5).setValues([['semana (lunes)', 'Leads', 'Vendidos', 'Tasa de venta', 'Monto vendido']])
    .setFontWeight('bold').setBackground('#E4E2DE');
  rs.getRange(datos, c).setFormula(
    '=IFERROR(SORT(UNIQUE(FILTER(INT(' + FECHA + ')-WEEKDAY(' + FECHA + ',2)+1,LEN(' + ID + ')>0)),1,FALSE),"")');
  rs.getRange(datos, c + 1).setFormula(
    '=ARRAYFORMULA(IF(' + lista + '="",,COUNTIFS(' + ID + ',"<>",' + FECHA + ',">="&' + lista + ',' + FECHA + ',"<"&(' + lista + '+7))))');
  rs.getRange(datos, c + 2).setFormula(
    '=ARRAYFORMULA(IF(' + lista + '="",,COUNTIFS(' + ID + ',"<>",' + FECHA + ',">="&' + lista + ',' + FECHA + ',"<"&(' + lista + '+7),' + VEND + ',"Sí")))');
  rs.getRange(datos, c + 3).setFormula(
    '=ARRAYFORMULA(IF(' + lista + '="",,IFERROR(' + C + datos + ':' + C + '/' + B + datos + ':' + B + ',0)))');
  rs.getRange(datos, c + 4).setFormula(
    '=ARRAYFORMULA(IF(' + lista + '="",,SUMIFS(' + MONTO + ',' + ID + ',"<>",' + VEND + ',"Sí",' + FECHA + ',">="&' + lista + ',' + FECHA + ',"<"&(' + lista + '+7))))');
  rs.getRange(lista).setNumberFormat('dd/mm/yyyy');
  rs.getRange(Dd + datos + ':' + Dd).setNumberFormat('0.0%');
  rs.getRange(E + datos + ':' + E).setNumberFormat('#,##0');

  rs.setFrozenRows(3);
  SpreadsheetApp.flush();
}

/** 1 → A, 27 → AA. */
function letra_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
