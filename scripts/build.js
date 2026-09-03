// Minifiziert HTML/CSS/JS fuer das Deployment nach dist/ - die Quelldateien
// im Repo (js/*.js, css/style.css, *.html) bleiben davon komplett
// unangetastet, inklusive aller Kommentare/Herleitungen. Wird von
// .github/workflows/deploy.yml bei jedem Push auf main automatisch
// ausgefuehrt (kein manueller Schritt noetig) - siehe dortigen Kommentar
// fuer den Gesamtablauf.
//
// Absichtlich ohne "glob"-Abhaengigkeit: eigener kleiner rekursiver Walker
// reicht fuer die paar Dutzend Dateien hier locker aus.

const fs = require('fs');
const path = require('path');
const { minify: minifyHtml } = require('html-minifier-terser');
const { minify: minifyJs } = require('terser');
const CleanCSS = require('clean-css');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

// Alles, was NICHT mit ausgeliefert werden soll (Tooling/Repo-Kram) -
// wird beim rekursiven Einsammeln komplett uebersprungen.
const SKIP_DIRS = new Set(['.git', '.github', '.claude', 'node_modules', 'dist', 'scripts']);
const SKIP_FILES = new Set(['package.json', 'package-lock.json', 'README.md', '.gitignore']);

function collectFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectFiles(path.join(dir, entry.name), out);
    } else {
      if (SKIP_FILES.has(entry.name)) continue;
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

async function buildFile(file) {
  const rel = path.relative(ROOT, file);
  const outPath = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const ext = path.extname(file).toLowerCase();
  const src = fs.readFileSync(file, 'utf8');

  if (ext === '.js') {
    const result = await minifyJs(src, { compress: true, mangle: true });
    fs.writeFileSync(outPath, result.code ?? src);
  } else if (ext === '.css') {
    const result = new CleanCSS({}).minify(src);
    if (result.errors.length) throw new Error(`CSS-Fehler in ${rel}: ${result.errors.join(', ')}`);
    fs.writeFileSync(outPath, result.styles);
  } else if (ext === '.html') {
    const result = await minifyHtml(src, {
      collapseWhitespace: true,
      removeComments: true,
      minifyCSS: true,
      minifyJS: true,
      removeAttributeQuotes: false, // Attribute mit Sonderzeichen (z.B. onclick-JS) bleiben sicher gequotet
    });
    fs.writeFileSync(outPath, result);
  } else {
    // Alles andere (z.B. zukuenftige Bilder/Fonts) unveraendert kopieren.
    fs.copyFileSync(file, outPath);
  }
  return rel;
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  const files = collectFiles(ROOT);
  let totalBefore = 0;
  let totalAfter = 0;
  for (const file of files) {
    totalBefore += fs.statSync(file).size;
    const rel = await buildFile(file);
    totalAfter += fs.statSync(path.join(OUT, rel)).size;
  }
  const pct = totalBefore ? (100 * (1 - totalAfter / totalBefore)).toFixed(1) : '0';
  console.log(`${files.length} Dateien minifiziert: ${(totalBefore / 1024).toFixed(0)} KB -> ${(totalAfter / 1024).toFixed(0)} KB (-${pct}%)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
