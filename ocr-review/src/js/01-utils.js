/* =====================================================================
 * utils — DOM helper, chuỗi, path, diff (LCS), Levenshtein, CSV, JSON
 * ===================================================================== */
const U = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** Tạo element: h('div', {class:'x', onclick: fn, dataset:{a:1}}, child, 'text') */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

  // So sánh tự nhiên (tương đương localeCompare với numeric: true)
  const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
  const natCmp = (a, b) => collator.compare(a, b);

  /** Bỏ dấu tiếng Việt + lowercase, dùng cho tìm kiếm */
  const fold = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

  function humanize(key) {
    const s = String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : String(key);
  }

  const isLeaf = (v) => v === null || typeof v !== 'object';
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const isEmptyVal = (v) => v === '' || v === null || v === undefined;

  /* ---------- Path: mảng segment <-> chuỗi "a.b[0].c" ---------- */
  const IDENT = /^[A-Za-z_$][\w$]*$/;
  function pathStr(arr) {
    let s = '';
    for (const seg of arr) {
      if (typeof seg === 'number') s += '[' + seg + ']';
      else if (IDENT.test(seg)) s += (s ? '.' : '') + seg;
      else s += '[' + JSON.stringify(seg) + ']';
    }
    return s;
  }
  const normPath = (s) => s.replace(/\[\d+\]/g, '[]');
  function getAt(obj, arr) {
    let cur = obj;
    for (const seg of arr) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[seg];
    }
    return cur;
  }
  function setAt(obj, arr, val) {
    const parent = getAt(obj, arr.slice(0, -1));
    parent[arr[arr.length - 1]] = val;
  }

  /** Giá trị leaf -> chuỗi hiển thị trong ô nhập */
  const leafText = (v) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : String(v));
  /** Giá trị leaf -> chuỗi hiển thị trong danh sách diff */
  const leafShow = (v) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));

  /* ---------- LCS diff ---------- */
  /**
   * Trả về danh sách thao tác [{t:'eq'|'del'|'ins', a:idx, b:idx}] biến a thành b.
   * Cắt tiền tố/hậu tố chung trước, DP O(n*m) phần còn lại; quá lớn thì thay thế toàn khối.
   */
  function lcsOps(a, b, maxCells) {
    const ops = [];
    let pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    let suf = 0;
    while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
    for (let i = 0; i < pre; i++) ops.push({ t: 'eq', a: i, b: i });
    const n = a.length - pre - suf, m = b.length - pre - suf;
    if (n * m > (maxCells || 4e6)) {
      for (let i = 0; i < n; i++) ops.push({ t: 'del', a: pre + i });
      for (let j = 0; j < m; j++) ops.push({ t: 'ins', b: pre + j });
    } else if (n || m) {
      const W = m + 1;
      const L = Math.min(n, m) < 65535 ? new Uint16Array((n + 1) * W) : new Uint32Array((n + 1) * W);
      for (let i = n - 1; i >= 0; i--) {
        const ai = a[pre + i];
        for (let j = m - 1; j >= 0; j--) {
          L[i * W + j] = ai === b[pre + j] ? L[(i + 1) * W + j + 1] + 1
            : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
        }
      }
      let i = 0, j = 0;
      while (i < n || j < m) {
        if (i < n && j < m && a[pre + i] === b[pre + j]) { ops.push({ t: 'eq', a: pre + i, b: pre + j }); i++; j++; }
        else if (j >= m || (i < n && L[(i + 1) * W + j] >= L[i * W + j + 1])) { ops.push({ t: 'del', a: pre + i }); i++; }
        else { ops.push({ t: 'ins', b: pre + j }); j++; }
      }
    }
    for (let k = 0; k < suf; k++) ops.push({ t: 'eq', a: a.length - suf + k, b: b.length - suf + k });
    return ops;
  }

  /** Diff mức ký tự: [{t, s}] đã gộp các đoạn liên tiếp cùng loại */
  function charDiff(x, y) {
    const a = Array.from(String(x)), b = Array.from(String(y));
    const out = [];
    for (const op of lcsOps(a, b, 4e6)) {
      const s = op.t === 'ins' ? b[op.b] : a[op.a];
      const last = out[out.length - 1];
      if (last && last.t === op.t) last.s += s; else out.push({ t: op.t, s });
    }
    // Đưa del đứng trước ins trong các cụm thay thế để dễ đọc
    return out;
  }
  /** HTML của diff ký tự. mode: 'both' | 'old' | 'new' */
  function charDiffHtml(x, y, mode = 'both') {
    return charDiff(x, y).map((p) => {
      if (p.t === 'eq') return esc(p.s);
      if (p.t === 'del') return mode === 'new' ? '' : '<del class="d">' + esc(p.s) + '</del>';
      return mode === 'old' ? '' : '<ins class="d">' + esc(p.s) + '</ins>';
    }).join('');
  }

  /** Levenshtein theo code point (đã chuẩn hoá NFC) */
  function levenshtein(x, y) {
    if (x === y) return 0;
    const a = Array.from(String(x).normalize('NFC')), b = Array.from(String(y).normalize('NFC'));
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = new Uint32Array(b.length + 1), cur = new Uint32Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      cur[0] = i;
      const ai = a[i - 1];
      for (let j = 1; j <= b.length; j++) {
        const c = prev[j - 1] + (ai === b[j - 1] ? 0 : 1);
        const d = prev[j] + 1, e = cur[j - 1] + 1;
        cur[j] = c < d ? (c < e ? c : e) : (d < e ? d : e);
      }
      const t = prev; prev = cur; cur = t;
    }
    return prev[b.length];
  }
  const cpLen = (s) => Array.from(String(s).normalize('NFC')).length;

  /* ---------- JSON ---------- */
  /** Tô màu cú pháp 1 dòng JSON */
  const TOK = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}\[\],])/g;
  function hlJsonLine(line) {
    let out = '', last = 0, m;
    TOK.lastIndex = 0;
    while ((m = TOK.exec(line))) {
      out += esc(line.slice(last, m.index));
      if (m[1]) out += m[2] ? '<span class="j-key">' + esc(m[1]) + '</span>' + esc(m[2]) : '<span class="j-str">' + esc(m[1]) + '</span>';
      else if (m[3]) out += '<span class="j-bool">' + m[3] + '</span>';
      else if (m[4]) out += '<span class="j-null">null</span>';
      else if (m[5]) out += '<span class="j-num">' + m[5] + '</span>';
      else out += '<span class="j-p">' + esc(m[6]) + '</span>';
      last = TOK.lastIndex;
    }
    return out + esc(line.slice(last));
  }

  /** Phân tích lỗi JSON.parse → {msg, line, col, pos} */
  function jsonError(text, err) {
    const msg = String(err && err.message || err);
    let pos = -1, line = 0, col = 0;
    let m = msg.match(/line (\d+) column (\d+)/);
    if (m) { line = +m[1]; col = +m[2]; }
    m = msg.match(/position (\d+)/);
    if (m) pos = +m[1];
    if (pos < 0 && /Unexpected end of JSON input/i.test(msg)) pos = text.length;
    if (pos >= 0 && !line) {
      const before = text.slice(0, pos).split('\n');
      line = before.length; col = before[before.length - 1].length + 1;
    }
    if (pos < 0 && line) {
      const lines = text.split('\n');
      pos = lines.slice(0, line - 1).reduce((s, l) => s + l.length + 1, 0) + col - 1;
    }
    const clean = msg.replace(/^JSON\.parse:\s*/, '').replace(/\s*\(line \d+ column \d+\)/, '');
    return { msg: clean, line: line || 1, col: col || 1, pos: Math.max(0, pos) };
  }
  const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

  /* ---------- Định dạng ---------- */
  const pct = (x, d = 1) => (x == null || isNaN(x) ? '—' : (x * 100).toFixed(d).replace('.', ',') + '%');
  const round = (x, d = 4) => (x == null || isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

  /** ISO 8601 theo giờ địa phương, có múi giờ: 2024-05-01T10:20:30+07:00 */
  function isoLocal(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' +
      p(d.getMinutes()) + ':' + p(d.getSeconds()) + sign + p(Math.floor(Math.abs(off) / 60)) + ':' + p(Math.abs(off) % 60);
  }
  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  /* ---------- CSV (UTF-8 BOM, CRLF) ---------- */
  function csvCell(v) {
    if (v == null) return '';
    const s = typeof v === 'number' ? String(v) : String(v);
    return /[",\r\n;]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const toCsv = (rows) => '\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

  function download(name, content, mime = 'application/json') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name, style: { display: 'none' } });
    document.body.append(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
  }

  function debounce(fn, ms) {
    let t;
    const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    d.flush = (...args) => { clearTimeout(t); fn(...args); };
    d.cancel = () => clearTimeout(t);
    return d;
  }
  function rafThrottle(fn) {
    let queued = false;
    return (...args) => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; fn(...args); });
    };
  }
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  /* ---------- Icon (SVG nội tuyến) ---------- */
  const ICONS = {
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/>',
    save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M8 3v5h7V3"/><rect x="8" y="13" width="8" height="6"/>',
    next: '<path d="M5 12h12"/><path d="m13 6 6 6-6 6"/>',
    chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
    columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
    rows: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18"/>',
    theme: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    rotate: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'
  };
  const icon = (name) => (ICONS[name] ? '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>' : '');

  return {
    $, $$, h, esc, natCmp, fold, humanize, isLeaf, isObj, hasOwn, clone, isEmptyVal,
    pathStr, normPath, getAt, setAt, leafText, leafShow,
    lcsOps, charDiff, charDiffHtml, levenshtein, cpLen,
    hlJsonLine, jsonError, stripBom, pct, round, isoLocal, fmtTime, toCsv, download,
    debounce, rafThrottle, clamp, icon
  };
})();
