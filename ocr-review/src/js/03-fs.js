/* =====================================================================
 * fs — quét thư mục (File System Access API hoặc input webkitdirectory),
 * đọc/ghi file, lưu handle thư mục gần nhất vào IndexedDB
 * ===================================================================== */
const FS = (() => {
  const DOC_EXT = /\.(pdf|png|jpe?g|webp|bmp|gif)$/i;
  const TIFF_EXT = /\.tiff?$/i;
  const IGNORE = /^(\.|~\$)|^(thumbs\.db|desktop\.ini)$/i;
  const isReviewed = (n) => /\.reviewed\.json$/i.test(n);
  const isUpdated = (n) => /\.updated\.json$/i.test(n);
  const baseName = (n) => n.replace(/\.[^.]+$/, '');
  const jsonBase = (n) => n.replace(/\.json$/i, '');

  /* ---------- IndexedDB (handle thư mục gần nhất) ---------- */
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('ocr-review', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function kvSet(key, val) {
    const db = await idb();
    await new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    db.close();
  }
  async function kvGet(key) {
    const db = await idb();
    const v = await new Promise((res, rej) => {
      const r = db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    db.close();
    return v;
  }

  /**
   * Phân loại danh sách file của 1 thư mục thành hồ sơ.
   * files: [{name, handle?|file?}]
   */
  function classify(doc, files) {
    const docs = [], jsons = [], reviewed = [], tiffs = [];
    for (const f of files) {
      if (IGNORE.test(f.name)) continue;
      if (isReviewed(f.name)) reviewed.push(f);
      else if (isUpdated(f.name)) continue;
      else if (/\.json$/i.test(f.name)) jsons.push(f);
      else if (DOC_EXT.test(f.name)) docs.push(f);
      else if (TIFF_EXT.test(f.name)) tiffs.push(f);
      else doc.files.extra.push(f);
    }
    const byName = (a, b) => U.natCmp(a.name, b.name);
    docs.sort(byName); jsons.sort(byName); tiffs.sort(byName);
    const allDocs = docs.concat(tiffs);
    const W = doc.warnings;
    // Chọn file tài liệu
    if (allDocs.length) {
      doc.files.doc = allDocs[0];
      if (allDocs.length > 1) W.push('Thừa file tài liệu: ' + allDocs.map((f) => f.name).join(', ') + ' — đang dùng ' + allDocs[0].name);
    } else W.push('Thiếu file tài liệu (PDF/ảnh)');
    // Chọn JSON: ưu tiên file cùng tên với tài liệu
    if (jsons.length) {
      const want = doc.files.doc ? baseName(doc.files.doc.name).toLowerCase() : null;
      const pick = jsons.find((j) => jsonBase(j.name).toLowerCase() === want) || jsons[0];
      doc.files.json = pick;
      if (jsons.length > 1) W.push('Thừa file JSON: ' + jsons.map((f) => f.name).join(', ') + ' — đang dùng ' + pick.name);
      const rv = jsonBase(pick.name) + '.reviewed.json';
      doc.files.reviewed = reviewed.find((r) => r.name.toLowerCase() === rv.toLowerCase()) || null;
    } else W.push('Thiếu file JSON kết quả OCR');
    if (doc.files.doc && TIFF_EXT.test(doc.files.doc.name)) W.push('TIFF chưa hỗ trợ hiển thị');
    if (doc.files.extra.length) W.push('File không nhận dạng: ' + doc.files.extra.map((f) => f.name).join(', '));
    doc.saved = !!doc.files.reviewed;
    return doc;
  }

  /** Quét thư mục gốc bằng File System Access API */
  async function scanHandle(root) {
    const rootFiles = [], subdirs = [];
    for await (const [name, h] of root.entries()) {
      if (h.kind === 'directory') { if (!IGNORE.test(name)) subdirs.push(h); }
      else rootFiles.push({ name, handle: h });
    }
    const docs = [];
    for (const d of subdirs) {
      const files = [];
      for await (const [name, h] of d.entries()) if (h.kind === 'file') files.push({ name, handle: h });
      const doc = newDoc(d.name);
      doc.dir = d;
      docs.push(classify(doc, files));
    }
    // Thư mục gốc chứa trực tiếp file tài liệu/JSON → chính nó là 1 hồ sơ
    if (rootFiles.some((f) => /\.json$/i.test(f.name) || DOC_EXT.test(f.name) || TIFF_EXT.test(f.name))) {
      const doc = newDoc(root.name);
      doc.dir = root;
      doc.isRoot = true;
      docs.push(classify(doc, rootFiles));
    }
    return docs.sort((a, b) => U.natCmp(a.name, b.name));
  }

  /** Quét danh sách File từ input webkitdirectory / kéo-thả (chế độ chỉ đọc) */
  function scanFileList(fileList) {
    const groups = new Map();
    let rootName = '';
    for (const file of fileList) {
      const rel = file.webkitRelativePath || file.relPath || file.name;
      const parts = rel.split('/');
      if (!rootName) rootName = parts.length > 1 ? parts[0] : '';
      const dir = parts.length > 1 ? parts.slice(1, -1).join('/') : '';
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir).push({ name: parts[parts.length - 1], file });
    }
    const docs = [];
    for (const [dir, files] of groups) {
      if (!dir && !files.some((f) => /\.json$/i.test(f.name) || DOC_EXT.test(f.name) || TIFF_EXT.test(f.name))) continue;
      const doc = newDoc(dir || rootName || '(thư mục gốc)');
      doc.isRoot = !dir;
      docs.push(classify(doc, files));
    }
    return { rootName: rootName || 'Thư mục', docs: docs.sort((a, b) => U.natCmp(a.name, b.name)) };
  }

  /** Đọc toàn bộ cây thư mục từ kéo-thả khi không có File System Access API */
  async function filesFromEntry(entry) {
    const out = [];
    async function walk(ent, prefix) {
      if (ent.isFile) {
        const file = await new Promise((res, rej) => ent.file(res, rej));
        file.relPath = prefix + ent.name;
        out.push(file);
      } else if (ent.isDirectory) {
        const reader = ent.createReader();
        let batch;
        do {
          batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          for (const e of batch) await walk(e, prefix + ent.name + '/');
        } while (batch.length);
      }
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, entry.name + '/');
      } while (batch.length);
    }
    return out;
  }

  async function getFile(ref) {
    if (!ref) return null;
    if (ref.file) return ref.file;
    return ref.handle.getFile();
  }
  async function readText(ref) {
    const f = await getFile(ref);
    return U.stripBom(await f.text());
  }

  async function ensurePermission(handle, mode = 'readwrite') {
    if (!handle || !handle.queryPermission) return true;
    const opts = { mode };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    return (await handle.requestPermission(opts)) === 'granted';
  }

  async function writeFile(dirHandle, name, text) {
    const fh = await dirHandle.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(new Blob([text], { type: 'application/json' }));
    await w.close();
    return fh;
  }

  return {
    kvGet, kvSet, scanHandle, scanFileList, filesFromEntry, getFile, readText, ensurePermission, writeFile,
    jsonBase, isTiff: (n) => TIFF_EXT.test(n), isPdf: (n) => /\.pdf$/i.test(n)
  };
})();
