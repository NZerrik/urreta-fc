#!/usr/bin/env node
/**
 * wa-scraper.js — Lee el grupo de WhatsApp "URRETA CAT.2021"
 * y actualiza la hora del próximo partido en resultados.json
 *
 * Requiere:
 *   - WA_SESSION: secreto de GitHub con el JSON de sesión de WhatsApp Web
 *   - puppeteer instalado (npm install puppeteer)
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const RESULTADOS_FILE = path.join(__dirname, '..', 'resultados.json');
const GRUPO_NOMBRE = 'URRETA CAT.2021';

// Patrones para detectar hora en mensajes
// Ej: "jugamos a las 10", "14hs", "16:00", "partido a las 9:30"
const HORA_PATTERNS = [
  /\ba las (\d{1,2})(?::(\d{2}))?(?:\s*hs?)?\b/i,
  /\b(\d{1,2})(?::(\d{2}))?\s*hs?\b/i,
  /\bpartido\s+(?:a las\s+)?(\d{1,2})(?::(\d{2}))?\b/i,
  /\bcancha\s+(?:a las\s+)?(\d{1,2})(?::(\d{2}))?\b/i,
  /\bjugamos\s+(?:a las\s+)?(\d{1,2})(?::(\d{2}))?\b/i,
];

// Patrones para detectar suspensión
const SUSPENSION_PATTERNS = [
  /suspendid[oa]/i,
  /postergad[oa]/i,
  /no se juega/i,
  /cancelad[oa]/i,
  /lluvia/i,
];

function parseHora(texto) {
  for (const pattern of HORA_PATTERNS) {
    const m = texto.match(pattern);
    if (m) {
      const hora = parseInt(m[1]);
      if (hora >= 7 && hora <= 21) return hora; // horas razonables
    }
  }
  return null;
}

function esSuspension(texto) {
  return SUSPENSION_PATTERNS.some(p => p.test(texto));
}

function getProximaFecha(resultados) {
  // Encuentra la próxima fecha sin resultado
  const fechas = Object.keys(resultados.urreta || {}).map(Number);
  const maxJugada = fechas.length > 0 ? Math.max(...fechas) : 0;
  return maxJugada + 1;
}

async function main() {
  const sessionJson = process.env.WA_SESSION;
  if (!sessionJson) {
    console.error('❌ WA_SESSION no configurado');
    process.exit(1);
  }

  const resultados = JSON.parse(fs.readFileSync(RESULTADOS_FILE, 'utf8'));
  const proximaFecha = getProximaFecha(resultados);
  console.log(`📅 Próxima fecha a buscar: F${proximaFecha}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();

    // Restaurar sesión de IndexedDB
    await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded' });

    const session = JSON.parse(sessionJson);
    await page.evaluate((sessionData) => {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('wawc');
        request.onsuccess = (e) => {
          const db = e.target.result;
          const stores = Array.from(db.objectStoreNames);
          let done = 0;
          stores.forEach(storeName => {
            if (!sessionData[storeName]) { done++; if (done === stores.length) resolve(); return; }
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            Object.entries(sessionData[storeName]).forEach(([key, val]) => store.put(val, key));
            tx.oncomplete = () => { done++; if (done === stores.length) resolve(); };
          });
          if (stores.length === 0) resolve();
        };
        request.onerror = reject;
      });
    }, session);

    // Recargar con sesión restaurada
    await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
    console.log('🔄 Sesión restaurada, esperando WhatsApp...');

    // Esperar que cargue la lista de chats
    await page.waitForSelector('div[aria-label="Lista de chats"]', { timeout: 30000 });
    console.log('✅ WhatsApp Web cargado');

    // Buscar el grupo
    await page.click('div[aria-label="Buscar un chat o iniciar uno nuevo"]');
    await page.type('div[contenteditable="true"]', GRUPO_NOMBRE, { delay: 50 });
    await page.waitForTimeout(2000);

    // Click en el grupo
    const groupSelector = `span[title*="URRETA CAT.2021"]`;
    await page.waitForSelector(groupSelector, { timeout: 10000 });
    await page.click(groupSelector);
    await page.waitForTimeout(3000);

    // Leer mensajes
    const mensajes = await page.evaluate(() => {
      const msgs = Array.from(document.querySelectorAll('.copyable-text'));
      return msgs.slice(-50).map(m => ({
        texto: m.textContent.trim(),
        timestamp: m.closest('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text') || ''
      })).filter(m => m.texto.length > 2);
    });

    console.log(`📨 ${mensajes.length} mensajes leídos`);

    // Analizar mensajes recientes (últimas 48hs aprox)
    let horaDetectada = null;
    let suspendido = false;

    for (const msg of mensajes.reverse()) { // más reciente primero
      if (esSuspension(msg.texto)) {
        suspendido = true;
        console.log(`⚠️ Posible suspensión detectada: "${msg.texto}"`);
        break;
      }
      const hora = parseHora(msg.texto);
      if (hora && !horaDetectada) {
        horaDetectada = hora;
        console.log(`🕐 Hora detectada: ${hora}:00 en mensaje: "${msg.texto}"`);
      }
    }

    // Actualizar resultados.json
    let updated = false;
    if (!resultados.horas) resultados.horas = {};

    if (suspendido) {
      resultados.horas[proximaFecha] = 'suspendido';
      console.log(`💾 F${proximaFecha} marcada como suspendida`);
      updated = true;
    } else if (horaDetectada) {
      if (resultados.horas[proximaFecha] !== horaDetectada) {
        resultados.horas[proximaFecha] = horaDetectada;
        console.log(`💾 F${proximaFecha} hora actualizada a ${horaDetectada}:00`);
        updated = true;
      }
    }

    if (updated) {
      resultados.ultima_actualizacion = new Date().toISOString();
      fs.writeFileSync(RESULTADOS_FILE, JSON.stringify(resultados, null, 2));
      console.log('✅ resultados.json actualizado');
    } else {
      console.log('ℹ️ Sin cambios en la hora');
    }

    // Exportar sesión actualizada para guardar en secrets
    const updatedSession = await page.evaluate(() => {
      return new Promise((resolve) => {
        const request = indexedDB.open('wawc');
        request.onsuccess = (e) => {
          const db = e.target.result;
          const stores = Array.from(db.objectStoreNames);
          const result = {};
          let done = 0;
          stores.forEach(storeName => {
            result[storeName] = {};
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            const keyReq = store.getAllKeys();
            let allVals, allKeys;
            req.onsuccess = (e) => { allVals = e.target.result; };
            keyReq.onsuccess = (e) => { allKeys = e.target.result; };
            tx.oncomplete = () => {
              if (allKeys && allVals) {
                allKeys.forEach((k, i) => result[storeName][k] = allVals[i]);
              }
              done++;
              if (done === stores.length) resolve(result);
            };
          });
          if (stores.length === 0) resolve({});
        };
      });
    });

    // Guardar sesión actualizada como artifact
    fs.writeFileSync('/tmp/wa_session_updated.json', JSON.stringify(updatedSession));
    console.log('💾 Sesión exportada a /tmp/wa_session_updated.json');

  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error('💥', e); process.exit(1); });
