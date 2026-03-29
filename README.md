# Urreta FC — Campeonato Apertura 2026

Página web del campeonato de baby fútbol de Urreta FC en Liga Prado, categoría 2021.

## 🚀 Setup en 10 minutos

### 1. Crear repositorio en GitHub

1. Ir a [github.com/new](https://github.com/new)
2. Nombre: `urreta-campeonato`
3. Marcar **Public**
4. Click **Create repository**

### 2. Subir los archivos

En la terminal (o GitHub Desktop):

```bash
cd urreta-site
git init
git add .
git commit -m "🚀 Inicial"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/urreta-campeonato.git
git push -u origin main
```

### 3. Activar GitHub Pages

1. En el repo → **Settings** → **Pages**
2. Source: **Deploy from branch**
3. Branch: `main` / `/ (root)`
4. **Save**

Tu URL será: `https://TU_USUARIO.github.io/urreta-campeonato`

### 4. Agregar el secreto de Instagram (para el bot)

El bot necesita tu `sessionid` de Instagram para leer los posts de Liga Prado.

**Cómo obtener el sessionid:**
1. Abrí Chrome y logueate en Instagram
2. F12 → Application → Cookies → `https://www.instagram.com`
3. Buscá la cookie `sessionid` y copiá su valor

**Dónde guardarlo:**
1. En tu repo → **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret**
3. Name: `IG_SESSIONID`, Value: (el valor que copiaste)
4. Repetir para `IG_CSRFTOKEN` (la cookie `csrftoken`)

### 5. Verificar que funciona

1. En el repo → **Actions** → **Actualizar Resultados**
2. Click **Run workflow** → **Run workflow**
3. Verificar que el job pasa en verde

## 🤖 Actualización automática

El bot corre automáticamente:
- **Domingos a las 20:00 UY** (día de partido)
- **Lunes a las 20:00 UY** (por si publican tarde)

También podés correrlo manualmente desde **Actions → Run workflow**.

## 📁 Estructura

```
urreta-site/
├── index.html          ← La página web
├── resultados.json     ← Datos de resultados (actualizado por el bot)
├── scripts/
│   └── scraper.js      ← Bot de scraping de Instagram
└── .github/
    └── workflows/
        └── update.yml  ← Configuración del cron job
```

## ✏️ Actualizar resultados manualmente

Si el bot no captura un resultado, podés:
1. Abrir la página web
2. Click en **+ Resultado** en la fecha correspondiente
3. Ingresar el marcador

Los resultados manuales se guardan en `localStorage` del browser.
