#!/usr/bin/env node
/* Keep checked-in HTML and CSS paired with the exact assets they reference. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function versionAssets({ check = false } = {}) {
  const root = path.resolve(__dirname, '..');
  const contents = new Map();
  const changed = [];

  function visit(file) {
    if (contents.has(file)) return contents.get(file);
    const original = fs.readFileSync(file, 'utf8');
    const extension = path.extname(file);

    function version(url) {
      if (/^(?:[a-z]+:|\/\/|#)/i.test(url)) return url;
      const [withoutHash, fragment] = url.split('#');
      const [pathname, query = ''] = withoutHash.split('?');
      const target = path.resolve(path.dirname(file), pathname);
      const supported = /\.(?:css|js|svg)$/.test(pathname) || target === path.join(root, 'assets/resume.html');
      if (!supported || target === file || !target.startsWith(root + path.sep)) return url;
      const data = visit(target);
      const digest = createHash('sha256').update(data).digest('hex').slice(0, 12);
      const params = new URLSearchParams(query.replaceAll('&amp;', '&'));
      params.set('v', digest);
      const search = extension === '.html' ? params.toString().replaceAll('&', '&amp;') : params.toString();
      return pathname + '?' + search + (fragment === undefined ? '' : '#' + fragment);
    }

    let updated = original;
    if (extension === '.html') {
      updated = original.replace(/((?:href|src)=["'])([^"']+)(["'])/g, (_, start, url, end) => start + version(url) + end);
    } else if (extension === '.css') {
      updated = original.replace(/(url\(\s*["']?)([^\s"')]+)(["']?\s*\))/g, (_, start, url, end) => start + version(url) + end);
    }
    contents.set(file, updated);
    if (updated !== original) {
      changed.push(path.relative(root, file));
      if (!check) fs.writeFileSync(file, updated);
    }
    return updated;
  }

  visit(path.join(root, 'assets/resume.html'));
  visit(path.join(root, 'index.html'));
  return changed;
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  const changed = versionAssets({ check });
  if (check && changed.length) {
    console.error('Asset versions are stale in: ' + changed.join(', ') + '. Run node scripts/version-assets.js.');
    process.exitCode = 1;
  } else console.log(changed.length ? 'Updated asset versions: ' + changed.join(', ') : 'Asset versions match their contents.');
}

module.exports = { versionAssets };
