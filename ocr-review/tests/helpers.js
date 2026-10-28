'use strict';
/* Tiện ích dùng chung cho test Playwright & script chụp màn hình */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const TMP = path.join(__dirname, '.tmp');

/** Sao chép test-data sang thư mục tạm (mỗi lần chạy dùng bản sạch) */
function freshData(name = 'test-data') {
  const src = path.join(ROOT, name);
  const dst = path.join(TMP, name + '-' + process.pid + '-' + Math.random().toString(36).slice(2, 7));
  fs.mkdirSync(TMP, { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
  return dst;
}

/** HTTP server tĩnh cho dist/ (dùng cho chế độ File System Access giả lập bằng OPFS) */
function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const f = path.join(DIST, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, ''));
      if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: 'http://127.0.0.1:' + srv.address().port + '/' }));
  });
}

/**
 * Mở app.
 *  mode 'fallback': file:// và xoá showDirectoryPicker → dùng <input webkitdirectory>
 *  mode 'fsa'     : http:// + showDirectoryPicker trả về thư mục OPFS đã nạp sẵn dữ liệu
 */
async function openApp({ file = 'ocr-review.html', mode = 'fallback', viewport = { width: 1600, height: 900 }, colorScheme = 'light', browser, baseUrl } = {}) {
  const own = !browser;
  browser = browser || await chromium.launch();
  const ctx = await browser.newContext({ viewport, colorScheme, acceptDownloads: true, deviceScaleFactor: 1 });
  if (mode === 'fallback') {
    await ctx.addInitScript(() => { delete Window.prototype.showDirectoryPicker; delete window.showDirectoryPicker; });
  } else {
    await ctx.addInitScript(() => {
      window.showDirectoryPicker = async () => {
        const opfs = await navigator.storage.getDirectory();
        return opfs.getDirectoryHandle('root');
      };
    });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const url = mode === 'fallback' ? 'file://' + path.join(DIST, file) : baseUrl + file;
  await page.goto(url);
  return { browser, ctx, page, errors, close: async () => { await ctx.close(); if (own) await browser.close(); } };
}

/** Nạp thư mục qua input fallback */
async function loadFolder(page, dir) {
  await page.setInputFiles('#dir-input', dir);
  await page.waitForSelector('.doc-item');
  await page.waitForFunction(() => window.__ocrReview.S.docs.every((d) => d.loaded));
}

/** Chép một thư mục local vào OPFS/root rồi bấm "Mở thư mục" (chế độ FSA) */
async function loadFolderOpfs(page, dir) {
  const files = [];
  (function walk(d, rel) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p, rel.concat(n));
      else files.push({ rel: rel.concat(n), b64: fs.readFileSync(p).toString('base64') });
    }
  })(dir, []);
  await page.evaluate(async (files) => {
    const opfs = await navigator.storage.getDirectory();
    try { await opfs.removeEntry('root', { recursive: true }); } catch (e) { /* chưa có */ }
    const root = await opfs.getDirectoryHandle('root', { create: true });
    for (const f of files) {
      let d = root;
      for (const seg of f.rel.slice(0, -1)) d = await d.getDirectoryHandle(seg, { create: true });
      const fh = await d.getFileHandle(f.rel[f.rel.length - 1], { create: true });
      const w = await fh.createWritable();
      const bin = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
      await w.write(bin); await w.close();
    }
  }, files);
  await page.click('#es-open');
  await page.waitForSelector('.doc-item');
  await page.waitForFunction(() => window.__ocrReview.S.docs.every((d) => d.loaded));
}

/** Đọc file text trong OPFS/root */
async function readOpfs(page, rel) {
  return page.evaluate(async (rel) => {
    let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('root');
    for (const seg of rel.slice(0, -1)) d = await d.getDirectoryHandle(seg);
    try { return await (await (await d.getFileHandle(rel[rel.length - 1])).getFile()).text(); } catch (e) { return null; }
  }, rel);
}

const leaf = (ps) => '.leaf[data-ps="' + ps.replace(/"/g, '\\"') + '"]';

async function selectDoc(page, name) {
  await page.click('.doc-item:has(.di-name:text-is("' + name + '"))');
  await page.waitForFunction((n) => { const c = window.__ocrReview.S.cur; return c && c.name === n && c.loaded; }, name);
  await page.waitForTimeout(50);
}

async function download(page, action) {
  const [dl] = await Promise.all([page.waitForEvent('download'), action()]);
  const p = await dl.path();
  return { name: dl.suggestedFilename(), text: fs.readFileSync(p, 'utf8'), buf: fs.readFileSync(p) };
}

module.exports = { ROOT, DIST, TMP, freshData, startServer, openApp, loadFolder, loadFolderOpfs, readOpfs, leaf, selectDoc, download, chromium };
