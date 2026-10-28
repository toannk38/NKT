/* =====================================================================
 * state — tuỳ chọn (localStorage), mô hình hồ sơ, trạng thái trường,
 * phân tích thay đổi / thống kê, undo-redo
 * ===================================================================== */
const PREFS_KEY = 'ocr-review:prefs';
const Prefs = (() => {
  const DEF = {
    split: 0.5, layout: 'h', theme: 'auto', sidebar: true, fit: 'width',
    saveUpdated: false, validate: true, reviewer: '', diffMode: 'list', formShow: 'all', rawView: 'current'
  };
  let p = Object.assign({}, DEF);
  try { Object.assign(p, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (e) { /* bỏ qua */ }
  const save = U.debounce(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { /* bỏ qua */ } }, 200);
  window.addEventListener('pagehide', () => save.flush());
  return {
    get: (k) => p[k],
    set(k, v) { p[k] = v; save(); },
    reset() { const r = p.reviewer; p = Object.assign({}, DEF, { reviewer: r }); save.flush(); }
  };
})();

/* ---------- Nhãn ---------- */
const CUSTOM_LABELS_KEY = 'ocr-review:labels:' + PROFILE.id;
let ACTIVE_LABELS = {};
function rebuildLabels() {
  let custom = {};
  try { custom = JSON.parse(localStorage.getItem(CUSTOM_LABELS_KEY) || '{}') || {}; } catch (e) { custom = {}; }
  ACTIVE_LABELS = Object.assign({}, LABELS, PROFILE.labels || {}, custom);
}
rebuildLabels();

/** Nhãn tiếng Việt của một path (mảng segment) */
function labelFor(path) {
  if (!path.length) return 'Gốc';
  const last = path[path.length - 1];
  if (typeof last === 'number') {
    const parent = path.slice(0, -1);
    return (parent.length ? labelFor(parent) + ' ' : '') + '#' + (last + 1);
  }
  const np = U.normPath(U.pathStr(path));
  return ACTIVE_LABELS[np] || ACTIVE_LABELS[np.replace(/\[\]/g, '')] || ACTIVE_LABELS[last] || U.humanize(last);
}
/** Nhãn từ path chuỗi đã chuẩn hoá (dùng cho báo cáo) */
function labelForNorm(np) {
  const m = np.match(/(?:^|\.)([^.[\]]+)(?:\[\])*$/) || np.match(/\["((?:\\.|[^"\\])*)"\](?:\[\])*$/);
  const key = m ? m[1] : np;
  return ACTIVE_LABELS[np] || ACTIVE_LABELS[np.replace(/\[\]/g, '')] || ACTIVE_LABELS[key] || U.humanize(key);
}

/* ---------- Kiểm tra định dạng (chỉ cảnh báo) ---------- */
const COMMON_VALIDATORS = [
  { match: /.*/, check: (v) => typeof v === 'string' && v !== v.trim() ? 'Có khoảng trắng thừa ở đầu/cuối' : null },
  { match: /.*/, check: (v) => typeof v === 'string' && / {2,}/.test(v) ? 'Có nhiều dấu cách liền nhau' : null },
  { match: /.*/, check: (v) => typeof v === 'string' && v !== v.normalize('NFC') ? 'Chuỗi Unicode tổ hợp (chưa chuẩn NFC) — dễ gây sai khi so khớp' : null },
  {
    match: /(^|[._])ngay(_|$)|(^|[._])date|_ngay$/i,
    check: (v) => {
      const s = String(v).trim();
      if (!s) return null;
      let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
      let d, mo, y;
      if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; } else if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = +m[1]; mo = +m[2]; d = +m[3]; } else return 'Ngày không đúng dạng dd/mm/yyyy';
      const dt = new Date(y, mo - 1, d);
      return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d && y > 1850 && y < 2200 ? null : 'Ngày không tồn tại';
    }
  },
  { match: /(^|\.)e?mail$/i, check: (v) => !String(v).trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()) ? null : 'Email không hợp lệ' },
  {
    match: /(^|[._])(dien_thoai|so_dien_thoai|sdt|phone|fax)$/i,
    check: (v) => {
      const s = String(v).trim();
      if (!s) return null;
      if (/[^\d\s+().\-/]/.test(s)) return 'Số điện thoại chứa ký tự lạ';
      return s.replace(/\D/g, '').length >= 8 ? null : 'Số điện thoại quá ngắn';
    }
  }
];
const ALL_VALIDATORS = COMMON_VALIDATORS.concat(PROFILE.validators || []);
/** Danh sách cảnh báo cho 1 leaf */
function validateLeaf(path, value, data) {
  if (!Prefs.get('validate') || value === null || value === undefined) return [];
  const last = path[path.length - 1];
  const np = U.normPath(U.pathStr(path));
  const parent = U.getAt(data, path.slice(0, -1));
  const out = [];
  for (const v of ALL_VALIDATORS) {
    const ok = typeof v.match === 'string' ? v.match === last : v.match.test(np);
    if (!ok) continue;
    try {
      const r = v.check(value, { parent, key: last, path: np });
      if (r) out.push(r);
    } catch (e) { /* bỏ qua validator lỗi */ }
  }
  return out;
}

/* ---------- Schema (mẫu) của profile ---------- */
/** Path có nằm trong schema mẫu không (mảng dùng phần tử [0] làm khuôn) */
function schemaHas(path) {
  if (!PROFILE.schema) return true;
  let node = PROFILE.schema;
  for (const seg of path) {
    if (typeof seg === 'number') { if (!Array.isArray(node)) return false; node = node[0]; if (node === undefined) return true; }
    else { if (!U.isObj(node) || !U.hasOwn(node, seg)) return false; node = node[seg]; }
  }
  return true;
}
function schemaNode(path) {
  let node = PROFILE.schema;
  for (const seg of path) {
    if (node == null) return undefined;
    node = typeof seg === 'number' ? (Array.isArray(node) ? node[0] : undefined) : (U.isObj(node) ? node[seg] : undefined);
  }
  return node;
}
/** Các path theo mẫu mà dữ liệu đang thiếu */
function schemaMissing(data) {
  const out = [];
  if (!PROFILE.schema || !U.isObj(data)) return out;
  (function walk(s, d, path) {
    if (U.isObj(s)) {
      if (!U.isObj(d)) return;
      for (const k of Object.keys(s)) {
        if (!U.hasOwn(d, k)) out.push(path.concat(k));
        else walk(s[k], d[k], path.concat(k));
      }
    } else if (Array.isArray(s) && s.length && Array.isArray(d)) {
      d.forEach((item, i) => walk(s[0], item, path.concat(i)));
    }
  })(PROFILE.schema, data, []);
  return out;
}

/** Mọi cảnh báo của hồ sơ (file thiếu/thừa, lỗi đọc, thiếu trường theo mẫu — tính lại mỗi lần) */
function docWarnings(doc, withSchema = true) {
  const w = doc.warnings.concat(doc.loadWarnings || []);
  if (withSchema && doc.loaded && doc.data !== undefined) {
    const miss = schemaMissing(doc.data).length;
    if (miss) w.push('Thiếu ' + miss + ' trường theo mẫu ' + PROFILE.short);
  }
  return w;
}

/** Bản sao rỗng của một node (giữ cấu trúc, giá trị để trống) */
function emptyLike(node) {
  if (Array.isArray(node)) return node.length && !U.isLeaf(node[0]) ? [emptyLike(node[0])] : [];
  if (U.isObj(node)) { const o = {}; for (const k of Object.keys(node)) o[k] = emptyLike(node[k]); return o; }
  return typeof node === 'string' ? '' : null;
}

/* ---------- Mô hình hồ sơ ---------- */
/**
 * doc = {
 *   name, dir (handle FSA) | null, files: {json, doc, reviewed, extra[]}, warnings[],
 *   loaded, origText, orig, parseError, baseline, data, status{}, auto{}, indexMap{}, note,
 *   saved, savedMeta, undo[], redo[], lastSnap, savedSnap, dirty, summary
 * }
 * - baseline: bản đối chiếu (= JSON gốc; nếu JSON gốc lỗi cú pháp thì là bản đã sửa cú pháp đầu tiên)
 * - status[path]: 'correct' | 'wrong'; auto[path] = true nếu trạng thái do tool tự đặt
 * - indexMap[arrayPath] = [chỉ số gốc | -1] cho từng phần tử mảng hiện tại (theo dõi xoá/thêm phần tử)
 */
function newDoc(name) {
  return {
    name, dir: null, files: { json: null, doc: null, reviewed: null, extra: [] }, warnings: [], loadWarnings: [],
    loaded: false, origText: null, orig: undefined, parseError: null, baseline: undefined,
    data: undefined, status: {}, auto: {}, indexMap: {}, note: '',
    saved: false, savedMeta: null, undo: [], redo: [], lastSnap: '', savedSnap: '', dirty: false, summary: null
  };
}

const Model = (() => {
  /** Ảnh chụp trạng thái để undo/redo & kiểm tra dirty */
  const snap = (doc) => JSON.stringify({ d: doc.data, s: doc.status, a: doc.auto, m: doc.indexMap, b: doc.parseError ? doc.baseline : undefined });
  function restore(doc, s) {
    const o = JSON.parse(s);
    doc.data = o.d; doc.status = o.s || {}; doc.auto = o.a || {}; doc.indexMap = o.m || {};
    if (doc.parseError) doc.baseline = o.b;
  }
  function updateDirty(doc) {
    doc.dirty = doc.lastSnap !== doc.savedSnap || doc.note !== (doc.savedNote || '');
  }
  /** Ghi một bước lịch sử nếu trạng thái thay đổi */
  function commit(doc) {
    if (!doc || !doc.loaded) return false;
    const s = snap(doc);
    if (s === doc.lastSnap) { updateDirty(doc); return false; }
    doc.undo.push(doc.lastSnap);
    if (doc.undo.length > 100) doc.undo.shift();
    doc.redo.length = 0;
    doc.lastSnap = s;
    updateDirty(doc);
    return true;
  }
  function undo(doc) {
    commit(doc);
    if (!doc.undo.length) return false;
    doc.redo.push(doc.lastSnap);
    doc.lastSnap = doc.undo.pop();
    restore(doc, doc.lastSnap);
    updateDirty(doc);
    return true;
  }
  function redo(doc) {
    commit(doc);
    if (!doc.redo.length) return false;
    doc.undo.push(doc.lastSnap);
    doc.lastSnap = doc.redo.pop();
    restore(doc, doc.lastSnap);
    updateDirty(doc);
    return true;
  }
  function markSaved(doc) {
    doc.lastSnap = snap(doc);
    doc.savedSnap = doc.lastSnap;
    doc.savedNote = doc.note;
    doc.dirty = false;
  }

  /** Tìm giá trị gốc tương ứng với một path hiện tại (qua indexMap) */
  function origInfo(doc, path) {
    let node = doc.baseline;
    if (node === undefined) return { exists: false };
    const opath = [];
    for (let i = 0; i < path.length; i++) {
      const seg = path[i];
      if (typeof seg === 'number') {
        const map = doc.indexMap[U.pathStr(path.slice(0, i))];
        const oi = map ? map[seg] : seg;
        if (!Array.isArray(node) || oi == null || oi < 0 || oi >= node.length) return { exists: false };
        node = node[oi]; opath.push(oi);
      } else {
        if (!U.isObj(node) || !U.hasOwn(node, seg)) return { exists: false };
        node = node[seg]; opath.push(seg);
      }
    }
    return { exists: true, value: node, opath };
  }

  /** Ép kiểu theo kiểu của giá trị gốc (number/boolean/null), ngược lại là string */
  function coerce(text, orig) {
    if (typeof orig === 'number') {
      const t = text.trim();
      if (t !== '' && /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
    } else if (typeof orig === 'boolean') {
      const t = text.trim().toLowerCase();
      if (t === 'true') return true;
      if (t === 'false') return false;
    } else if (orig === null) {
      const t = text.trim();
      if (t === '' || t === 'null') return null;
    }
    return text;
  }

  /** Cập nhật trạng thái tự động sau khi giá trị leaf đổi */
  function autoStatus(doc, ps, value, info) {
    const base = info.exists && U.isLeaf(info.value) ? info.value : (info.exists ? undefined : '');
    const differs = info.exists && U.isLeaf(info.value) ? value !== info.value : !(U.isEmptyVal(value) && U.isEmptyVal(base));
    if (differs) { doc.status[ps] = 'wrong'; doc.auto[ps] = true; }
    else if (doc.auto[ps]) { delete doc.status[ps]; delete doc.auto[ps]; }
  }

  function setLeaf(doc, path, text) {
    const info = origInfo(doc, path);
    const cur = U.getAt(doc.data, path);
    const typeRef = info.exists && U.isLeaf(info.value) ? info.value : cur;
    const v = coerce(text, typeRef === undefined ? '' : typeRef);
    if (!path.length) doc.data = v; else U.setAt(doc.data, path, v);
    autoStatus(doc, U.pathStr(path), v, info);
    return v;
  }

  function setStatus(doc, ps, st) {
    if (!st) { delete doc.status[ps]; delete doc.auto[ps]; }
    else { doc.status[ps] = st; delete doc.auto[ps]; }
  }

  function revertLeaf(doc, path) {
    const info = origInfo(doc, path);
    if (!info.exists || !U.isLeaf(info.value)) return false;
    if (!path.length) doc.data = info.value; else U.setAt(doc.data, path, info.value);
    const ps = U.pathStr(path);
    if (doc.auto[ps] || doc.status[ps] === 'wrong') { delete doc.status[ps]; delete doc.auto[ps]; }
    return true;
  }

  /** Xoá các khoá trạng thái nằm dưới một path */
  function dropUnder(doc, ps) {
    for (const map of [doc.status, doc.auto, doc.indexMap]) {
      for (const k of Object.keys(map)) {
        if (k === ps || k.startsWith(ps + '.') || k.startsWith(ps + '[')) delete map[k];
      }
    }
  }

  /** Dịch chỉ số các path con của mảng arrPs: xoá (delta<0) hoặc chèn (delta>0) tại vị trí at */
  function remapIndex(doc, arrPs, at, delta) {
    const pre = arrPs + '[';
    for (const name of ['status', 'auto', 'indexMap']) {
      const src = doc[name], out = {};
      for (const k of Object.keys(src)) {
        if (!k.startsWith(pre)) { out[k] = src[k]; continue; }
        const m = k.slice(pre.length).match(/^(\d+)\]/);
        if (!m) { out[k] = src[k]; continue; }
        const j = +m[1];
        const rest = k.slice(pre.length + m[0].length);
        if (delta < 0) {
          if (j === at) continue;
          out[j > at ? pre + (j - 1) + ']' + rest : k] = src[k];
        } else {
          out[j >= at ? pre + (j + 1) + ']' + rest : k] = src[k];
        }
      }
      doc[name] = out;
    }
  }

  function ensureMap(doc, arrPath) {
    const ps = U.pathStr(arrPath);
    if (!doc.indexMap[ps]) {
      const arr = U.getAt(doc.data, arrPath) || [];
      const info = origInfo(doc, arrPath);
      const olen = info.exists && Array.isArray(info.value) ? info.value.length : 0;
      doc.indexMap[ps] = arr.map((_, i) => (i < olen ? i : -1));
    }
    return doc.indexMap[ps];
  }

  function removeArrayItem(doc, arrPath, i) {
    const arr = U.getAt(doc.data, arrPath);
    const map = ensureMap(doc, arrPath);
    const ps = U.pathStr(arrPath);
    arr.splice(i, 1);
    map.splice(i, 1);
    remapIndex(doc, ps, i, -1);
    doc.indexMap[ps] = map;
  }

  /** Thêm phần tử vào mảng: clone cấu trúc phần tử đầu (hoặc mẫu schema), giá trị rỗng */
  function addArrayItem(doc, arrPath) {
    const arr = U.getAt(doc.data, arrPath);
    const map = ensureMap(doc, arrPath);
    let tpl;
    if (arr.length) tpl = emptyLike(arr[0]);
    else {
      const info = origInfo(doc, arrPath);
      const sn = schemaNode(arrPath);
      if (info.exists && Array.isArray(info.value) && info.value.length) tpl = emptyLike(info.value[0]);
      else if (Array.isArray(sn) && sn.length) tpl = emptyLike(sn[0]);
      else tpl = '';
    }
    arr.push(tpl);
    map.push(-1);
    return arr.length - 1;
  }

  /** Xoá trường/phần tử theo path */
  function deleteAt(doc, path) {
    const parentPath = path.slice(0, -1);
    const parent = U.getAt(doc.data, parentPath);
    const last = path[path.length - 1];
    if (Array.isArray(parent)) { removeArrayItem(doc, parentPath, last); return; }
    if (!U.isObj(parent)) return;
    delete parent[last];
    dropUnder(doc, U.pathStr(path));
  }

  function addField(doc, objPath, key, value = '') {
    const obj = objPath.length ? U.getAt(doc.data, objPath) : doc.data;
    if (!U.isObj(obj) || U.hasOwn(obj, key)) return false;
    obj[key] = value;
    return true;
  }

  /**
   * Khôi phục một path của bản gốc (hoàn tác "Xoá"): đi theo path gốc,
   * phần nào đã mất ở dữ liệu hiện tại thì chép lại từ bản gốc.
   */
  function restoreOrig(doc, opath) {
    let onode = doc.baseline, cpath = [];
    for (let i = 0; i < opath.length; i++) {
      const seg = opath[i];
      const cur = cpath.length ? U.getAt(doc.data, cpath) : doc.data;
      const oNext = onode[seg];
      if (typeof seg === 'number') {
        if (!Array.isArray(cur)) return false;
        const map = ensureMap(doc, cpath);
        let ci = map.indexOf(seg);
        if (ci < 0) {
          // chèn lại phần tử ở vị trí giữ đúng thứ tự gốc
          ci = 0;
          while (ci < map.length && (map[ci] < 0 || map[ci] < seg)) ci++;
          remapIndex(doc, U.pathStr(cpath), ci, +1);
          cur.splice(ci, 0, U.clone(oNext));
          map.splice(ci, 0, seg);
          doc.indexMap[U.pathStr(cpath)] = map;
          return true;
        }
        cpath = cpath.concat(ci);
      } else {
        if (!U.isObj(cur)) return false;
        if (!U.hasOwn(cur, seg) || (U.isLeaf(cur[seg]) !== U.isLeaf(oNext))) {
          cur[seg] = U.clone(oNext);
          dropUnder(doc, U.pathStr(cpath.concat(seg)));
          return true;
        }
        cpath = cpath.concat(seg);
      }
      onode = oNext;
    }
    return false;
  }

  /**
   * Phân tích hồ sơ: danh sách leaf, các thay đổi so với bản gốc, thống kê & CER.
   * Leaf = giá trị nguyên thuỷ (string/number/boolean/null).
   */
  function analyze(doc) {
    const leaves = [], removed = [];
    const base = doc.baseline;
    function collectRemoved(node, opath) {
      if (U.isLeaf(node)) { removed.push({ opath, ps: U.pathStr(opath), value: node }); return; }
      if (Array.isArray(node)) node.forEach((c, i) => collectRemoved(c, opath.concat(i)));
      else for (const k of Object.keys(node)) collectRemoved(node[k], opath.concat(k));
    }
    function walk(cur, orig, has, cpath, opath) {
      if (U.isLeaf(cur)) {
        const hasOrig = has && U.isLeaf(orig);
        if (has && !hasOrig) collectRemoved(orig, opath);
        leaves.push({ path: cpath, ps: U.pathStr(cpath), value: cur, hasOrig, orig: hasOrig ? orig : undefined });
        return;
      }
      if (Array.isArray(cur)) {
        const oArr = has && Array.isArray(orig) ? orig : null;
        if (has && !oArr) collectRemoved(orig, opath);
        const map = doc.indexMap[U.pathStr(cpath)];
        const used = new Set();
        cur.forEach((c, i) => {
          const oi = map ? map[i] : i;
          const ok = !!oArr && oi != null && oi >= 0 && oi < oArr.length && !used.has(oi);
          if (ok) used.add(oi);
          walk(c, ok ? oArr[oi] : undefined, ok, cpath.concat(i), ok ? opath.concat(oi) : null);
        });
        if (oArr) oArr.forEach((o, oi) => { if (!used.has(oi)) collectRemoved(o, opath.concat(oi)); });
        return;
      }
      const oObj = has && U.isObj(orig) ? orig : null;
      if (has && !oObj) collectRemoved(orig, opath);
      for (const k of Object.keys(cur)) {
        const ok = !!oObj && U.hasOwn(oObj, k);
        walk(cur[k], ok ? oObj[k] : undefined, ok, cpath.concat(k), ok ? opath.concat(k) : null);
      }
      if (oObj) for (const k of Object.keys(oObj)) if (!U.hasOwn(cur, k)) collectRemoved(oObj[k], opath.concat(k));
    }
    if (doc.data !== undefined) walk(doc.data, base, base !== undefined, [], []);

    const changes = [];
    let correct = 0, wrong = 0, unreviewed = 0, dist = 0, len = 0;
    for (const L of leaves) {
      L.modified = L.hasOrig ? L.value !== L.orig : !U.isEmptyVal(L.value);
      L.added = !L.hasOrig;
      L.status = doc.status[L.ps] || (L.modified ? 'wrong' : null);
      if (L.status === 'correct') correct++; else if (L.status === 'wrong') wrong++; else unreviewed++;
      if (L.modified) {
        changes.push(L.hasOrig
          ? { path: L.ps, type: 'modified', original: L.orig, updated: L.value, cpath: L.path }
          : { path: L.ps, type: 'added', updated: L.value, cpath: L.path });
      }
      // CER: chỉ leaf kiểu string đã được duyệt
      L.dist = 0; L.len = 0;
      if (L.status && typeof L.value === 'string') {
        const hyp = L.hasOrig ? U.leafText(L.orig) : '';
        L.dist = U.levenshtein(hyp, L.value);
        L.len = U.cpLen(L.value);
        dist += L.dist; len += L.len;
      }
    }
    for (const R of removed) {
      R.counted = !U.isEmptyVal(R.value);
      changes.push({ path: R.ps, type: 'removed', original: R.value, opath: R.opath });
      if (R.counted) {
        wrong++;
        R.dist = typeof R.value === 'string' ? U.cpLen(R.value) : 0;
        dist += R.dist;
      }
    }
    const total = correct + wrong + unreviewed;
    const stats = {
      total, correct, wrong, unreviewed,
      accuracy: correct + wrong ? correct / (correct + wrong) : null,
      cer: len ? dist / len : (dist ? null : (correct + wrong ? 0 : null)),
      dist, len
    };
    return { leaves, removed, changes, stats };
  }

  /** Map trạng thái hiệu lực để ghi ra file */
  function effectiveStatus(an) {
    const out = {};
    for (const L of an.leaves) if (L.status) out[L.ps] = L.status;
    return out;
  }

  /** Đồng bộ lại trạng thái tự động sau khi dữ liệu bị thay đổi lớn (sửa raw) */
  function reconcile(doc) {
    const an = analyze(doc);
    const live = new Set(an.leaves.map((l) => l.ps));
    for (const k of Object.keys(doc.status)) if (!live.has(k)) { delete doc.status[k]; delete doc.auto[k]; }
    for (const L of an.leaves) {
      if (L.modified && !doc.status[L.ps]) { doc.status[L.ps] = 'wrong'; doc.auto[L.ps] = true; }
      else if (!L.modified && doc.auto[L.ps]) { delete doc.status[L.ps]; delete doc.auto[L.ps]; }
    }
  }

  function summarize(doc) {
    if (!doc.loaded || doc.data === undefined) { doc.summary = null; return null; }
    const an = analyze(doc);
    doc.summary = an.stats;
    return an;
  }

  return {
    snap, restore, commit, undo, redo, markSaved, updateDirty, origInfo, coerce, setLeaf, setStatus, revertLeaf,
    deleteAt, addField, addArrayItem, removeArrayItem, restoreOrig, analyze, effectiveStatus, reconcile, summarize, dropUnder
  };
})();

/* ---------- Trạng thái ứng dụng ---------- */
const S = {
  mode: null,          // 'fsa' | 'fallback'
  rootName: '',
  rootHandle: null,
  docs: [],
  cur: null,           // hồ sơ đang mở
  sbFilter: 'all',
  sbQuery: '',
  tab: 'form',
  collapsed: new Set() // path chuẩn hoá của card đang thu gọn
};
const FSA_SUPPORTED = typeof window.showDirectoryPicker === 'function' && !/[?&#]fallback\b/.test(location.href);
