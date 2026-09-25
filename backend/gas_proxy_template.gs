/**
 * GAS Proxy Template — aizsargā publisku GAS URL ar atslēgu filtrēšanu
 *
 * Kā izmantot:
 * 1. Izveidot jaunu Google Apps Script projektu (script.google.com)
 * 2. Ielīmēt šo kodu
 * 3. Izmainīt PUBLIC_KEY uz unikālu vērtību (piemēram: "company2025secret_xyz")
 * 4. Publicēt kā "Web App" → "Execute as: Me" → "Who has access: Anyone"
 * 5. Ielīmēt published URL uz js/config.js SYNC_URL ar ?key=... pieguvenojumam
 * 6. Veco GAS URL no js/config.js var noņemt — tas vairs nebus publisks
 */

const PUBLIC_KEY = 'IZMAINĪT_MANI'; // <-- Mainiet uz savu unikālo atslēgu
const REAL_GAS_URL = 'https://script.google.com/macros/s/AKfycbzuLLIfX6rXYBXTduYnhb5sarF10KGFYTyt-qDVJZOgwuI5q4KgpaYSVpuE4ce7XAhn-Q/exec'; // <-- Mainiet uz savu faktisko GAS URL

function doGet(e) {
  // 1. Pārbaudīt atslēgu
  const providedKey = e.parameter.key;
  if (providedKey !== PUBLIC_KEY) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'Invalid API key' }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*');
  }

  // 2. Noņemt atslēgu no URL param (neko deklānot)
  const cleanParams = {};
  for (const [k, v] of Object.entries(e.parameter)) {
    if (k !== 'key') cleanParams[k] = v;
  }

  // 3. Pārvērst pieprasījumu uz faktisko GAS
  const queryString = Object.entries(cleanParams)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');

  const targetUrl = REAL_GAS_URL + '?' + queryString;

  try {
    const response = UrlFetchApp.fetch(targetUrl, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: false
    });

    const statusCode = response.getResponseCode();
    const content = response.getContentText();

    return ContentService
      .createTextOutput(content)
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'GET, POST');
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*');
  }
}

function doPost(e) {
  // 1. Pārbaudīt atslēgu (no query param vai no body)
  const providedKey = e.parameter?.key || (e.postData?.contents ? JSON.parse(e.postData.contents)?.key : null);
  if (providedKey !== PUBLIC_KEY) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'Invalid API key' }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*');
  }

  // 2. Noņemt atslēgu no body
  let body = '';
  if (e.postData?.contents) {
    try {
      const json = JSON.parse(e.postData.contents);
      delete json.key;
      body = JSON.stringify(json);
    } catch (ex) {
      body = e.postData.contents;
    }
  }

  // 3. Pārvērst POST pieprasījumu uz faktisko GAS
  try {
    const response = UrlFetchApp.fetch(REAL_GAS_URL, {
      method: 'post',
      payload: body,
      muteHttpExceptions: true,
      contentType: 'application/json'
    });

    const content = response.getContentText();

    return ContentService
      .createTextOutput(content)
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'GET, POST');
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*');
  }
}
