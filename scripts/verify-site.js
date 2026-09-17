#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { versionAssets } = require('./version-assets');

console.log('--- Running site verification checks ---');

let errors = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ [FAIL] ${message}`);
    errors++;
  } else {
    console.log(`✅ [PASS] ${message}`);
  }
}

// 1. CNAME check
assert(fs.existsSync('CNAME'), 'CNAME file exists');
if (fs.existsSync('CNAME')) {
  const cname = fs.readFileSync('CNAME', 'utf8').trim();
  assert(cname === 'bryantvilla.com', `CNAME is "bryantvilla.com" (got "${cname}")`);
}

// 2. Core files check
const coreFiles = ['index.html', 'assets/resume.html', 'assets/css/styles.css', 'assets/css/navigation-guard.css', 'assets/js/main.js', 'assets/js/desktop-icons.js', 'assets/js/navigation-guard.js', 'assets/img/bryantos-wordmark.svg', 'assets/img/chrome-wallpaper-mobile.svg', 'assets/img/favicon.svg', 'robots.txt', 'sitemap.xml'];
for (const file of coreFiles) {
  assert(fs.existsSync(file), `Core file exists: ${file}`);
}

// 3. JavaScript syntax validation
for (const file of fs.readdirSync('assets/js').filter(file => file.endsWith('.js'))) {
  try {
    execFileSync(process.execPath, ['--check', `assets/js/${file}`], { stdio: 'pipe' });
    assert(true, `JavaScript syntax valid: assets/js/${file}`);
  } catch (err) {
    assert(false, `JavaScript syntax error in assets/js/${file}: ${err.message}`);
  }
}

// 4. Asset reference check in HTML files
const htmlFiles = ['index.html', 'assets/resume.html'];
for (const htmlFile of htmlFiles) {
  if (!fs.existsSync(htmlFile)) continue;
  const content = fs.readFileSync(htmlFile, 'utf8');
  const matches = content.matchAll(/(?:href|src)=["']([^"':#]+)["']/g);
  let broken = 0;
  for (const match of matches) {
    let target = match[1];
    if (
      target.startsWith('http:') ||
      target.startsWith('https:') ||
      target.startsWith('mailto:') ||
      target.startsWith('tel:') ||
      target.startsWith('javascript:')
    ) {
      continue;
    }
    target = target.split('?')[0].split('#')[0];
    if (!target) continue;

    const resolvedLocal = path.resolve(path.dirname(htmlFile), target);
    const resolvedRoot = path.resolve(process.cwd(), target.startsWith('/') ? target.slice(1) : target);

    if (!fs.existsSync(resolvedLocal) && !fs.existsSync(resolvedRoot)) {
      console.error(`❌ Broken link in ${htmlFile}: "${match[1]}" not found on disk`);
      broken++;
      errors++;
    }
  }
  if (broken === 0) {
    console.log(`✅ [PASS] All local asset references valid in ${htmlFile}`);
  }
}

console.log('----------------------------------------');
const staleVersions = versionAssets({ check: true });
assert(staleVersions.length === 0, staleVersions.length ? 'Run node scripts/version-assets.js to refresh: ' + staleVersions.join(', ') : 'Cached asset versions match their contents');
if (errors > 0) {
  console.error(`Verification failed with ${errors} error(s).`);
  process.exit(1);
} else {
  console.log('All verification checks passed!');
}
