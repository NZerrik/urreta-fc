#!/usr/bin/env node
/**
 * scraper.js — Liga Prado Instagram results scraper
 * Runs via GitHub Actions daily at 20:00 UY (23:00 UTC)
 * Reads resultados.json, fetches new results from Instagram, updates file.
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const RESULTADOS_FILE = path.join(__dirname, '..', 'resultados.json');

const INSTAGRAM_SESSION = process.env.IG_SESSIONID;
const INSTAGRAM_CSRF    = process.env.IG_CSRFTOKEN || '';
const LIGA_PRADO_ID     = '11659874891';

// Mapping: "Fecha X" from caption → fecha index (1-based)
// We detect from post caption text

function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    const opts = { headers: { 'User-Agent': 'Mozilla/5.0', ...headers } };
    https.get(url, opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error: ' + data.substring(0, 200))); }
      });
    }).on('error', reject);
  });
}

function parseFechaNum(caption) {
  const m = caption.match(/Fecha\s+(\d+)/i);
  return m ? parseInt(m[1]) : null;
}

function parsePartidosCat2021(caption) {
  const partidos = [];
  const lines = caption.split('\n');
  for (const line of lines) {
    if (!line.includes('2021')) continue;
    // Formato: "Cat. 2021 | Local X vs Visitante Y"  o "Cat. 2021 | Local X vs Visitante Y (W/O)"
    const m = line.match(/2021\s*\|\s*(.+?)\s+(\d+)\s+vs\s+(.+?)\s+(\d+)/);
    if (m) {
      partidos.push({ local: m[1].trim(), gl: parseInt(m[2]), visitante: m[3].trim(), gv: parseInt(m[4]) });
    }
  }
  return partidos;
}

function normalizarNombre(n) {
  // Normaliza abreviaturas del Instagram al nombre canónico
  const MAP = {
    'L. W.': 'L. Washington', 'LW': 'L. Washington', 'Libertad': 'L. Washington',
    'Covi': 'Covicenova', 'Depor': 'D. Uruguayo', 'Depor.': 'D. Uruguayo',
    'E. Del Norte': 'E. del Norte', 'E.del Norte': 'E. del Norte',
    'Sanfra': 'San Francisco', 'Av. Lezica': 'Av. Lezica', 'Aviación': 'Av. Lezica',
    'Ombú': 'Ombú Jrs.', 'Malvin Alto': 'Malvín Alto', 'Malvín': 'Malvín Alto',
    'Cosmos': 'C. Corinto', 'Isidro F.': 'Isidro Fynn',
    '3 de Abril': '3 de Abril', 'Pablan': 'Pablán',
    'Bochas': 'Bochas', 'Las Flores': 'Las Flores', 'Yegros': 'Yegros',
    'Urreta': 'Urreta',
  };
  for (const [abbr, full] of Object.entries(MAP)) {
    if (n.toLowerCase().includes(abbr.toLowerCase())) return full;
  }
  return n;
}

async function main() {
  if (!INSTAGRAM_SESSION) {
    console.error('❌ IG_SESSIONID not set');
    process.exit(1);
  }

  const resultados = JSON.parse(fs.readFileSync(RESULTADOS_FILE, 'utf8'));
  let updated = false;

  const headers = {
    'Cookie': `sessionid=${INSTAGRAM_SESSION}; csrftoken=${INSTAGRAM_CSRF}`,
    'X-IG-App-ID': '936619743392459',
  };

  console.log('📡 Fetching Liga Prado posts...');

  // Fetch last 24 posts
  let url = `https://www.instagram.com/api/v1/feed/user/${LIGA_PRADO_ID}/?count=24`;
  let allItems = [];

  for (let page = 0; page < 3; page++) {
    const data = await fetchJson(url, headers).catch(e => null);
    if (!data || !data.items) break;
    allItems = allItems.concat(data.items);
    if (!data.more_available || !data.next_max_id) break;
    url = `https://www.instagram.com/api/v1/feed/user/${LIGA_PRADO_ID}/?count=24&max_id=${data.next_max_id}`;
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`📦 Got ${allItems.length} posts`);

  for (const item of allItems) {
    if (!item.caption) continue;
    const caption = item.caption.text;

    // Solo posts del Apertura con resultado
    if (!caption.includes('Torneo Apertura') || !caption.includes('Fecha')) continue;

    const fechaNum = parseFechaNum(caption);
    if (!fechaNum) continue;

    const partidos2021 = parsePartidosCat2021(caption);
    if (partidos2021.length === 0) continue;

    console.log(`📅 Fecha ${fechaNum}: encontrados ${partidos2021.length} partidos cat. 2021`);

    const fechaKey = String(fechaNum);
    if (!resultados.fechas[fechaKey]) resultados.fechas[fechaKey] = [];

    for (const p of partidos2021) {
      const local = normalizarNombre(p.local);
      const visitante = normalizarNombre(p.visitante);

      // Buscar el partido en la fecha y actualizar
      const existing = resultados.fechas[fechaKey];
      const idx = existing.findIndex(e =>
        normalizarNombre(e.local) === local && normalizarNombre(e.visitante) === visitante
      );

      if (idx >= 0) {
        if (existing[idx].gl !== p.gl || existing[idx].gv !== p.gv) {
          existing[idx].gl = p.gl;
          existing[idx].gv = p.gv;
          console.log(`  ✅ ${local} ${p.gl}–${p.gv} ${visitante}`);
          updated = true;
        }
      } else {
        existing.push({ local, visitante, gl: p.gl, gv: p.gv });
        console.log(`  ➕ ${local} ${p.gl}–${p.gv} ${visitante} (nuevo)`);
        updated = true;
      }

      // Actualizar resultado de Urreta si aplica
      const esUrretaLocal = local === 'Urreta';
      const esUrretaVisita = visitante === 'Urreta';
      if ((esUrretaLocal || esUrretaVisita) && !resultados.urreta[fechaKey]) {
        resultados.urreta[fechaKey] = {
          golesUrreta: esUrretaLocal ? p.gl : p.gv,
          golesRival:  esUrretaLocal ? p.gv : p.gl,
        };
        console.log(`  🟠 Resultado Urreta F${fechaNum} guardado`);
        updated = true;
      }
    }
  }

  if (updated) {
    resultados.ultima_actualizacion = new Date().toISOString();
    fs.writeFileSync(RESULTADOS_FILE, JSON.stringify(resultados, null, 2));
    console.log('💾 resultados.json actualizado');
  } else {
    console.log('ℹ️  Sin cambios nuevos');
  }
}

main().catch(e => { console.error('💥', e); process.exit(1); });
