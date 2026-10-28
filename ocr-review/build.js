#!/usr/bin/env node
/*
 * Build: ghép src/app.html + CSS + JS + pdf.js (UMD 3.11.174) thành file HTML độc lập.
 *   node build.js            → dist/ocr-review.html (mọi loại giấy tờ) + dist/ocr-review-gpkd.html (GPKD)
 * Người dùng cuối chỉ cần file trong dist/, mở trực tiếp bằng Chrome/Edge (file://).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const PDFJS_DIR = path.join(ROOT, 'node_modules', 'pdfjs-dist');

const PROFILES = [
  { id: 'generic', out: 'ocr-review.html' },
  { id: 'gpkd', out: 'ocr-review-gpkd.html' }
];

function read(p) { return fs.readFileSync(p, 'utf8'); }

/** Chặn chuỗi có thể đóng thẻ <script> sớm khi nhúng inline */
function scriptSafe(code) {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

function loadPdfjs() {
  const pkg = JSON.parse(read(path.join(PDFJS_DIR, 'package.json')));
  if (pkg.version !== '3.11.174') {
    throw new Error('Cần pdfjs-dist@3.11.174, đang có ' + pkg.version + '. Chạy: npm install');
  }
  return {
    lib: read(path.join(PDFJS_DIR, 'build', 'pdf.min.js')),
    worker: read(path.join(PDFJS_DIR, 'build', 'pdf.worker.min.js'))
  };
}

function build() {
  const pdfjs = loadPdfjs();
  const html = read(path.join(SRC, 'app.html'));
  const css = read(path.join(SRC, 'app.css'));
  const jsFiles = fs.readdirSync(path.join(SRC, 'js')).filter((f) => f.endsWith('.js')).sort();
  fs.mkdirSync(DIST, { recursive: true });

  for (const prof of PROFILES) {
    const profileJs = read(path.join(SRC, 'profiles', prof.id + '.js'));
    // LABELS (00-labels.js) đứng đầu script, sau đó là PROFILE và các module còn lại
    const parts = [];
    for (const f of jsFiles) {
      parts.push('/* ---- ' + f + ' ---- */\n' + read(path.join(SRC, 'js', f)));
      if (f.startsWith('00-')) parts.push('/* ---- profile: ' + prof.id + ' ---- */\n' + profileJs);
    }
    const app = parts.join('\n');
    const titleMatch = profileJs.match(/title:\s*'([^']+)'/);
    const title = titleMatch ? titleMatch[1] : 'OCR Review';

    // Dùng hàm thay thế để tránh các mẫu "$&", "$'"… trong mã pdf.js
    const out = html
      .replace('{{TITLE}}', () => title)
      .replace('{{CSS}}', () => css)
      .replace('{{PDFJS}}', () => '<script>\n' + scriptSafe(pdfjs.lib) + '\n</script>')
      .replace('{{PDFJS_WORKER}}', () => '<script type="text/js-worker" id="pdf-worker">\n' + scriptSafe(pdfjs.worker) + '\n</script>')
      .replace('{{APP}}', () => scriptSafe(app));

    const dest = path.join(DIST, prof.out);
    fs.writeFileSync(dest, out);
    console.log('✔ ' + path.relative(process.cwd(), dest) + '  (' + (out.length / 1024 / 1024).toFixed(2) + ' MB, bản ' + prof.id + ')');
  }
}

build();
