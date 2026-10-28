/* =====================================================================
 * app — điều phối: mở thư mục, chọn hồ sơ, lưu, sidebar, bố cục,
 * giao diện, phím tắt, kéo-thả
 * ===================================================================== */
const App = (() => {
  const stale = { raw: true, diff: true };
  let reviewerInput, wsEl, narrowMq;

  /* ---------- Nạp hồ sơ ---------- */
  function ensureLoaded(doc) {
    if (doc.loaded) return Promise.resolve();
    if (!doc._loadP) doc._loadP = loadDoc(doc);
    return doc._loadP;
  }

  async function loadDoc(doc) {
    doc.loadWarnings = [];
    try {
      if (doc.files.json) {
        const text = await FS.readText(doc.files.json);
        doc.origText = text;
        try { doc.orig = JSON.parse(text); doc.baseline = doc.orig; }
        catch (e) { doc.parseError = U.jsonError(text, e); }
      }
      let fromReview = false;
      if (doc.files.reviewed) {
        try {
          const r = JSON.parse(await FS.readText(doc.files.reviewed));
          if (!U.isObj(r) || !U.hasOwn(r, 'data')) throw new Error('thiếu khoá "data"');
          const rv = U.isObj(r.review) ? r.review : {};
          if (doc.parseError) doc.baseline = rv.baseline !== undefined ? rv.baseline : U.clone(r.data);
          doc.data = r.data;
          doc.status = {};
          if (U.isObj(rv.field_status)) for (const [k, v] of Object.entries(rv.field_status)) if (v === 'correct' || v === 'wrong') doc.status[k] = v;
          doc.indexMap = U.isObj(rv.index_map) ? rv.index_map : {};
          doc.note = typeof rv.note === 'string' ? rv.note : '';
          doc.savedMeta = { reviewer: rv.reviewer || '', reviewed_at: rv.reviewed_at || '' };
          // Trạng thái "sai" của trường đã sửa coi như tự đặt
          for (const L of Model.analyze(doc).leaves) if (doc.status[L.ps] === 'wrong' && L.modified) doc.auto[L.ps] = true;
          fromReview = true;
        } catch (e) {
          doc.loadWarnings.push('File ' + doc.files.reviewed.name + ' lỗi, đã bỏ qua (' + e.message + ')');
          doc.saved = false;
          doc.data = undefined; doc.status = {}; doc.indexMap = {}; doc.note = '';
        }
      }
      if (!fromReview && doc.baseline !== undefined) doc.data = U.clone(doc.baseline);
      if (doc.parseError) doc.loadWarnings.push('JSON gốc lỗi cú pháp (dòng ' + doc.parseError.line + ', cột ' + doc.parseError.col + ')');
    } catch (e) {
      console.error(e);
      doc.loadWarnings.push('Không đọc được file: ' + (e.message || e));
    }
    doc.loaded = true;
    Model.markSaved(doc);
    Model.summarize(doc);
  }

  /* ---------- Mở thư mục ---------- */
  async function confirmDiscard() {
    const n = S.docs.filter((d) => d.dirty).length;
    if (!n) return true;
    return Dialog.confirm({ title: 'Còn thay đổi chưa lưu', message: 'Có ' + n + ' hồ sơ còn thay đổi chưa lưu. Mở thư mục khác sẽ bỏ các thay đổi này. Tiếp tục?', okText: 'Bỏ thay đổi & mở', danger: true });
  }

  async function pickFolder() {
    if (!FSA_SUPPORTED) { U.$('#dir-input').click(); return; }
    let handle;
    try { handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'ocr-review' }); }
    catch (e) { if (e.name !== 'AbortError') toast('Không mở được thư mục: ' + e.message, 'err'); return; }
    await openRoot(handle);
  }

  async function openRoot(handle) {
    if (!(await confirmDiscard())) return;
    let docs;
    try { docs = await FS.scanHandle(handle); }
    catch (e) { toast('Không đọc được thư mục: ' + e.message, 'err'); return; }
    S.mode = 'fsa'; S.rootHandle = handle; S.rootName = handle.name;
    try { await FS.kvSet('lastDir', handle); showReopen(handle.name); } catch (e) { /* bỏ qua */ }
    setDocs(docs);
  }

  async function openFileList(files) {
    if (!files || !files.length) return;
    if (!(await confirmDiscard())) return;
    const r = FS.scanFileList(files);
    S.mode = 'fallback'; S.rootHandle = null; S.rootName = r.rootName;
    setDocs(r.docs);
  }

  async function reopen() {
    let handle;
    try { handle = await FS.kvGet('lastDir'); } catch (e) { handle = null; }
    if (!handle) { toast('Không tìm thấy thư mục gần nhất', 'err'); return; }
    try {
      if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') { toast('Chưa được cấp quyền truy cập thư mục', 'err'); return; }
      await openRoot(handle);
    } catch (e) { toast('Không mở lại được thư mục: ' + e.message, 'err'); }
  }

  function showReopen(name) {
    U.$('#reopen-name').textContent = name;
    U.$('#btn-reopen').hidden = false;
    U.$('#es-reopen').hidden = false;
    U.$('#es-reopen').textContent = 'Mở lại thư mục gần nhất: ' + name;
  }

  function setDocs(docs) {
    S.docs = docs;
    S.cur = null;
    U.$('#empty-state').hidden = true;
    wsEl.hidden = false;
    U.$('#banner').hidden = S.mode !== 'fallback';
    renderSidebar();
    if (!docs.length) { toast('Không tìm thấy hồ sơ nào trong thư mục', 'err'); clearPanels(); }
    else select(docs[0]);
    preloadAll();
    updateHeader();
  }

  /** Đọc JSON của mọi hồ sơ ở nền để sidebar có số trường sai */
  async function preloadAll() {
    const queue = S.docs.slice();
    const docsRef = S.docs;
    const worker = async () => {
      while (queue.length) {
        const d = queue.shift();
        if (S.docs !== docsRef) return;
        if (!d.loaded) { await ensureLoaded(d); updateItem(d); }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  /* ---------- Chọn hồ sơ ---------- */
  async function select(doc) {
    if (!doc || doc === S.cur) return;
    commit();
    if (S.cur) refreshDirty(S.cur);
    const prev = S.cur;
    S.cur = doc;
    if (prev) updateItem(prev);
    U.$$('.doc-item').forEach((li) => li.classList.toggle('active', li._doc === doc));
    const li = U.$$('.doc-item').find((x) => x._doc === doc);
    if (li) li.scrollIntoView({ block: 'nearest' });
    updateHeader();
    Viewer.load(doc);
    Form.render(doc);
    await ensureLoaded(doc);
    if (S.cur !== doc) return;
    renderPanels();
    if (narrowMq.matches && !document.body.classList.contains('sb-collapsed')) toggleSidebar(false);
  }

  function clearPanels() {
    Viewer.clear();
    Form.render(null); Raw.render(null); Diff.render(null);
    U.$('#statsbar').textContent = '';
  }

  function renderPanels() {
    const doc = S.cur;
    Form.render(doc);
    stale.raw = stale.diff = true;
    renderActiveTab();
    updateStatus();
  }

  function renderActiveTab() {
    if (S.tab === 'raw' && stale.raw) { Raw.render(S.cur); stale.raw = false; }
    if (S.tab === 'diff' && stale.diff) { Diff.render(S.cur); stale.diff = false; }
  }

  function setTab(name) {
    S.tab = name;
    U.$$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
    U.$$('.tabpane').forEach((p) => p.classList.toggle('on', p.id === 'tab-' + name));
    renderActiveTab();
  }

  /* ---------- Sửa đổi ---------- */
  function commit() {
    if (!S.cur) return;
    Model.commit(S.cur);
    Form.updateHistoryButtons();
  }
  function refreshDirty(doc) {
    if (!doc || !doc.loaded) return;
    doc.dirty = Model.snap(doc) !== doc.savedSnap || (doc.note || '') !== (doc.savedNote || '');
  }
  /** Gọi sau mỗi lần sửa giá trị/trạng thái (debounce cập nhật thống kê, sidebar, tab khác) */
  const onEdit = U.debounce(() => {
    const doc = S.cur;
    if (!doc) return;
    refreshDirty(doc);
    stale.raw = stale.diff = true;
    if (!(S.tab === 'raw' && Raw.isEditing())) renderActiveTab();
    updateStatus();
    updateItem(doc);
  }, 150);
  /** Gọi sau thay đổi cấu trúc (thêm/xoá trường, undo…) */
  function onStructure() {
    Form.render(S.cur, true);
    onEdit.flush();
  }
  function undo() {
    if (!S.cur) return;
    if (Model.undo(S.cur)) onStructure(); else toast('Không còn bước để hoàn tác');
  }
  function redo() {
    if (!S.cur) return;
    if (Model.redo(S.cur)) onStructure(); else toast('Không còn bước để làm lại');
  }
  function applyRaw(v) {
    const doc = S.cur;
    if (!doc) return;
    if (doc.baseline === undefined) doc.baseline = U.clone(v);
    doc.data = v;
    doc.indexMap = {};
    Model.reconcile(doc);
    Model.commit(doc);
    renderPanels();
    onEdit.flush();
  }

  /* ---------- Thanh trạng thái ---------- */
  function updateStatus() {
    const doc = S.cur;
    const bar = U.$('#statsbar');
    const an = doc ? Model.summarize(doc) : null;
    U.$('#dirty-flag').hidden = !(doc && doc.dirty);
    const si = U.$('#saved-info');
    si.textContent = doc && doc.savedMeta && doc.saved ? 'Đã lưu' + (doc.savedMeta.reviewer ? ' bởi ' + doc.savedMeta.reviewer : '') + (doc.savedMeta.reviewed_at ? ' · ' + U.fmtTime(doc.savedMeta.reviewed_at) : '') : '';
    U.$('#diff-count').textContent = an && an.changes.length ? an.changes.length : '';
    if (!an) { bar.innerHTML = doc && doc.loaded ? '<span class="muted">Không có dữ liệu JSON</span>' : ''; return; }
    const s = an.stats;
    const tot = s.total || 1;
    bar.innerHTML =
      '<span>Tổng: <b>' + s.total + '</b> trường</span>' +
      '<span class="s-ok">Đúng: <b>' + s.correct + '</b></span>' +
      '<span class="s-bad">Sai: <b>' + s.wrong + '</b></span>' +
      '<span class="s-un">Chưa duyệt: <b>' + s.unreviewed + '</b></span>' +
      '<span>Độ chính xác: <b>' + U.pct(s.accuracy) + '</b></span>' +
      '<span title="Character Error Rate = tổng Levenshtein / tổng độ dài giá trị đúng (leaf chuỗi đã duyệt)">CER: <b>' + (s.cer == null ? '—' : U.pct(s.cer, 2)) + '</b></span>' +
      '<span class="progress" title="Tiến độ duyệt"><i class="p-bad" style="width:' + (s.wrong / tot) * 100 + '%"></i><i class="p-ok" style="width:' + (s.correct / tot) * 100 + '%"></i></span>';
    Form.updateHistoryButtons();
  }

  function updateHeader() {
    const doc = S.cur;
    const i = doc ? S.docs.indexOf(doc) : -1;
    U.$('#doc-title').textContent = doc ? doc.name + '  (' + (i + 1) + '/' + S.docs.length + ')' : (S.rootName || '');
    U.$('#doc-title').title = doc ? doc.name : '';
    U.$('#btn-save').disabled = U.$('#btn-save-next').disabled = !doc;
    U.$('#btn-report').disabled = !S.docs.length;
    document.title = (doc ? doc.name + ' — ' : '') + PROFILE.title;
  }

  /* ---------- Sidebar ---------- */
  function docMatches(doc) {
    if (S.sbQuery && !U.fold(doc.name).includes(U.fold(S.sbQuery))) return false;
    switch (S.sbFilter) {
      case 'unreviewed': return !doc.saved;
      case 'saved': return doc.saved;
      case 'wrong': return !!(doc.summary && doc.summary.wrong);
      default: return true;
    }
  }
  const visibleDocs = () => S.docs.filter(docMatches);

  function renderSidebar() {
    const ul = U.$('#doc-list');
    ul.textContent = '';
    const vis = visibleDocs();
    for (const d of vis) ul.append(docItem(d));
    const saved = S.docs.filter((d) => d.saved).length;
    U.$('#sb-count').textContent = vis.length + '/' + S.docs.length + ' hồ sơ · ' + saved + ' đã lưu';
  }
  function docItem(doc) {
    const warns = docWarnings(doc);
    const meta = U.h('div', { class: 'di-meta' });
    if (doc.dirty) meta.append(U.h('span', { class: 'badge b-dirty', text: '● Chưa lưu' }));
    else if (doc.saved) meta.append(U.h('span', { class: 'badge b-saved', text: '✓ Đã lưu' }));
    else meta.append(U.h('span', { class: 'badge b-new', text: 'Chưa duyệt' }));
    if (doc.parseError && doc.data === undefined) meta.append(U.h('span', { class: 'badge b-err', text: 'JSON lỗi' }));
    if (warns.length) meta.append(U.h('span', { class: 'badge b-warn', text: '⚠ ' + warns.length, title: warns.join('\n') }));
    if (doc.files.doc) meta.append(U.h('span', { text: doc.files.doc.name.split('.').pop().toUpperCase() }));
    const s = doc.summary;
    const li = U.h('li', { class: 'doc-item' + (doc === S.cur ? ' active' : ''), role: 'option', title: doc.name + (warns.length ? '\n⚠ ' + warns.join('\n⚠ ') : '') },
      U.h('span', { class: 'di-name', text: doc.name }),
      s && s.wrong ? U.h('span', { class: 'di-wrong', text: s.wrong + ' sai' }) : U.h('span', { class: 'muted', style: { fontSize: '11px' }, text: s ? s.total + ' trường' : '' }),
      meta,
      warns.length ? U.h('div', { class: 'di-warns', text: warns[0] + (warns.length > 1 ? ' (+' + (warns.length - 1) + ')' : '') }) : null);
    li._doc = doc;
    li.addEventListener('click', () => select(doc));
    return li;
  }
  function updateItem(doc) {
    const old = U.$$('.doc-item').find((x) => x._doc === doc);
    if (!docMatches(doc) && doc !== S.cur) { if (old) { old.remove(); } return; }
    if (old) old.replaceWith(docItem(doc));
    else renderSidebar();
    const saved = S.docs.filter((d) => d.saved).length;
    U.$('#sb-count').textContent = visibleDocs().length + '/' + S.docs.length + ' hồ sơ · ' + saved + ' đã lưu';
  }
  function refreshSidebar() { renderSidebar(); }

  function nav(dir) {
    if (!S.docs.length) return;
    const vis = visibleDocs();
    if (!vis.length) return;
    let target;
    const i = vis.indexOf(S.cur);
    if (i >= 0) target = vis[i + dir];
    else {
      const ci = S.docs.indexOf(S.cur);
      target = dir > 0 ? vis.find((d) => S.docs.indexOf(d) > ci) : vis.slice().reverse().find((d) => S.docs.indexOf(d) < ci);
    }
    if (target) select(target);
    else toast(dir > 0 ? 'Đã là hồ sơ cuối cùng' : 'Đã là hồ sơ đầu tiên');
  }

  /* ---------- Lưu ---------- */
  let saving = false;
  async function save(next) {
    const doc = S.cur;
    if (!doc || saving) return false;
    commit();
    await ensureLoaded(doc);
    if (!doc.files.json) { toast('Hồ sơ không có file JSON — không thể lưu', 'err'); return false; }
    if (doc.data === undefined) { toast('JSON gốc lỗi cú pháp — hãy sửa ở tab Raw rồi bấm Áp dụng trước khi lưu', 'err'); setTab('raw'); return false; }
    let reviewer = reviewerInput.value.trim();
    if (!reviewer) {
      U.$('.reviewer').classList.add('need');
      reviewer = await Dialog.prompt({ title: 'Nhập tên người duyệt', label: 'Tên người duyệt (được ghi vào file kết quả và nhớ cho lần sau)', okText: 'Lưu' });
      if (!reviewer) { toast('Chưa lưu: cần nhập tên người duyệt', 'err'); return false; }
      reviewerInput.value = reviewer;
      Prefs.set('reviewer', reviewer);
      U.$('.reviewer').classList.remove('need');
    }
    saving = true;
    try {
      const an = Model.analyze(doc);
      const st = an.stats;
      const now = U.isoLocal();
      const review = {
        tool: 'ocr-review v1',
        profile: PROFILE.id,
        folder: doc.name,
        source_json: doc.files.json.name,
        source_file: doc.files.doc ? doc.files.doc.name : null,
        reviewer,
        reviewed_at: now,
        summary: { total_fields: st.total, correct: st.correct, wrong: st.wrong, unreviewed: st.unreviewed, accuracy: U.round(st.accuracy), cer: U.round(st.cer) },
        field_status: Model.effectiveStatus(an),
        changes: an.changes.map((c) => ({ path: c.path, type: c.type, original: c.type === 'added' ? null : c.original, updated: c.type === 'removed' ? null : c.updated })),
        note: doc.note || ''
      };
      if (Object.keys(doc.indexMap).length) review.index_map = doc.indexMap;
      if (doc.parseError) { review.source_parse_error = { message: doc.parseError.msg, line: doc.parseError.line, col: doc.parseError.col }; review.baseline = doc.baseline; }
      const text = JSON.stringify({ data: doc.data, review }, null, 2) + '\n';
      const base = FS.jsonBase(doc.files.json.name);
      const name = base + '.reviewed.json';
      const upd = base + '.updated.json';
      if (name.toLowerCase() === doc.files.json.name.toLowerCase()) throw new Error('Tên file kết quả trùng file gốc');
      if (S.mode === 'fsa') {
        if (!(await FS.ensurePermission(doc.dir, 'readwrite'))) { toast('Không có quyền ghi vào thư mục hồ sơ', 'err'); return false; }
        const fh = await FS.writeFile(doc.dir, name, text);
        doc.files.reviewed = { name, handle: fh };
        if (Prefs.get('saveUpdated')) await FS.writeFile(doc.dir, upd, JSON.stringify(doc.data, null, 2) + '\n');
      } else {
        const prefix = doc.name.replace(/[\\/:*?"<>|]+/g, '_') + '__';
        U.download(prefix + name, text);
        if (Prefs.get('saveUpdated')) setTimeout(() => U.download(prefix + upd, JSON.stringify(doc.data, null, 2) + '\n'), 400);
      }
      doc.saved = true;
      doc.savedMeta = { reviewer, reviewed_at: now };
      Model.markSaved(doc);
      updateStatus();
      updateItem(doc);
      toast((S.mode === 'fsa' ? 'Đã lưu ' : 'Đã tải về ') + name, 'ok');
    } catch (e) {
      console.error(e);
      toast('Lỗi khi lưu: ' + (e.message || e), 'err', 5000);
      return false;
    } finally { saving = false; }
    if (next) nav(1);
    return true;
  }

  /* ---------- Bố cục / giao diện ---------- */
  function applyTheme() {
    const t = Prefs.get('theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    U.$('#btn-theme').title = 'Giao diện: ' + ({ auto: 'tự động theo hệ thống', light: 'sáng', dark: 'tối' }[t] || 'tự động') + ' (bấm để đổi)';
  }
  function cycleTheme() {
    const order = ['auto', 'light', 'dark'];
    Prefs.set('theme', order[(order.indexOf(Prefs.get('theme')) + 1) % 3]);
    applyTheme();
    toast('Giao diện: ' + ({ auto: 'tự động', light: 'sáng', dark: 'tối' })[Prefs.get('theme')]);
  }
  function applyLayout() {
    const vertical = Prefs.get('layout') === 'v' || narrowMq.matches;
    wsEl.classList.toggle('split-v', vertical);
    wsEl.classList.toggle('split-h', !vertical);
    wsEl.style.setProperty('--split', U.clamp(Prefs.get('split') || 0.5, 0.15, 0.85) * 100 + '%');
    const b = U.$('#btn-layout');
    b.innerHTML = U.icon(vertical ? 'rows' : 'columns');
    b.title = (vertical ? 'Bố cục trên-dưới' : 'Bố cục trái-phải') + ' — bấm để đổi' + (narrowMq.matches ? ' (màn hình hẹp: luôn trên-dưới)' : '');
  }
  function toggleSidebar(force) {
    const show = typeof force === 'boolean' ? force : document.body.classList.contains('sb-collapsed');
    document.body.classList.toggle('sb-collapsed', !show);
    if (!narrowMq.matches) Prefs.set('sidebar', show);
  }

  function initGutter() {
    const g = U.$('#gutter');
    let ratio = Prefs.get('split') || 0.5, active = false;
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      active = true;
      g.setPointerCapture(e.pointerId);
      g.classList.add('drag');
      document.body.classList.add('resizing', wsEl.classList.contains('split-v') ? 'rs-v' : 'rs-h');
    });
    g.addEventListener('pointermove', (e) => {
      if (!active) return;
      const r = wsEl.getBoundingClientRect();
      const v = wsEl.classList.contains('split-v');
      ratio = U.clamp(v ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width, 0.15, 0.85);
      wsEl.style.setProperty('--split', ratio * 100 + '%');
    });
    const end = () => {
      if (!active) return;
      active = false;
      g.classList.remove('drag');
      document.body.classList.remove('resizing', 'rs-v', 'rs-h');
      Prefs.set('split', ratio);
    };
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
    g.addEventListener('dblclick', () => { ratio = 0.5; Prefs.set('split', 0.5); applyLayout(); });
  }

  /* ---------- Cài đặt / trợ giúp ---------- */
  function initSettings() {
    const menu = U.$('#settings-menu');
    U.$('#btn-settings').onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('.menu-wrap')) menu.hidden = true; });
    const su = U.$('#opt-save-updated');
    su.checked = !!Prefs.get('saveUpdated');
    su.onchange = () => Prefs.set('saveUpdated', su.checked);
    const va = U.$('#opt-validate');
    va.checked = Prefs.get('validate') !== false;
    va.onchange = () => { Prefs.set('validate', va.checked); Form.refreshAll(); };
    U.$('#opt-load-labels').onclick = () => { menu.hidden = true; U.$('#labels-input').click(); };
    U.$('#labels-input').onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        let obj = JSON.parse(U.stripBom(await f.text()));
        if (U.isObj(obj) && U.isObj(obj.labels)) obj = obj.labels;
        if (!U.isObj(obj)) throw new Error('cần một object {"key": "Nhãn"}');
        const clean = {};
        for (const [k, v] of Object.entries(obj)) if (typeof v === 'string') clean[k] = v;
        localStorage.setItem(CUSTOM_LABELS_KEY, JSON.stringify(clean));
        rebuildLabels();
        if (S.cur) Form.render(S.cur, true);
        toast('Đã nạp ' + Object.keys(clean).length + ' nhãn tuỳ chỉnh', 'ok');
      } catch (err) { toast('File nhãn không hợp lệ: ' + err.message, 'err', 5000); }
    };
    U.$('#opt-clear-labels').onclick = () => {
      menu.hidden = true;
      localStorage.removeItem(CUSTOM_LABELS_KEY);
      rebuildLabels();
      if (S.cur) Form.render(S.cur, true);
      toast('Đã xoá bảng nhãn tuỳ chỉnh');
    };
    U.$('#opt-export-labels').onclick = () => { menu.hidden = true; U.download('labels_' + PROFILE.id + '.json', JSON.stringify(ACTIVE_LABELS, null, 2)); };
    U.$('#opt-reset-ui').onclick = () => {
      menu.hidden = true;
      Prefs.reset();
      applyTheme(); applyLayout(); toggleSidebar(true);
      su.checked = false; va.checked = true;
      toast('Đã đặt lại tuỳ chọn giao diện');
    };
    U.$('#opt-info').textContent = 'ocr-review v1 · Bản: ' + PROFILE.short + '\n' + PROFILE.description +
      '\nGhi file: ' + (FSA_SUPPORTED ? 'trực tiếp vào thư mục (File System Access API)' : 'tải file về (trình duyệt không hỗ trợ ghi thư mục)');
  }

  function showHelp() {
    if (document.querySelector('dialog[open]')) return;
    const keys = [
      ['Ctrl + S', 'Lưu hồ sơ hiện tại'],
      ['Ctrl + Enter', 'Lưu & sang hồ sơ tiếp theo'],
      ['Alt + ↓ / Alt + ↑', 'Hồ sơ tiếp / trước'],
      ['Enter', 'Sang ô nhập kế tiếp (trong tab Form)'],
      ['Shift + Enter', 'Xuống dòng trong ô nhập'],
      ['Ctrl + Z / Ctrl + Y', 'Hoàn tác / làm lại (khi không đứng trong ô nhập)'],
      ['Ctrl + lăn chuột', 'Zoom tài liệu quanh con trỏ (hoặc chụm 2 ngón trên trackpad)'],
      ['Kéo chuột', 'Di chuyển (pan) tài liệu'],
      ['?', 'Mở bảng phím tắt này'],
      ['Esc', 'Đóng hộp thoại / menu']
    ];
    const t = U.h('table', { class: 'kbd-table' }, keys.map(([k, d]) => U.h('tr', null,
      U.h('td', { html: k.split(' / ').map((x) => x.split(' + ').map((y) => '<kbd>' + U.esc(y) + '</kbd>').join(' + ')).join(' / ') }), U.h('td', { text: d }))));
    const tips = U.h('div', { class: 'muted', style: { marginTop: '10px', fontSize: '12px', maxWidth: '560px' } },
      U.h('p', { text: 'Quy tắc chấm: sửa giá trị khác gốc → tự đánh dấu Sai; sửa về đúng gốc → bỏ dấu tự đặt. Trường thêm mới (OCR bỏ sót) và trường bị xoá (OCR bịa) đều tính là Sai. Có thể ghi đè bằng nút ✓ / ✗.' }),
      U.h('p', { text: 'CER = tổng khoảng cách Levenshtein(giá trị OCR, giá trị đúng) / tổng độ dài giá trị đúng, chỉ tính trên các trường chuỗi đã duyệt.' }));
    Dialog.open({ title: 'Phím tắt & hướng dẫn nhanh', body: U.h('div', null, t, tips) });
  }

  /* ---------- Phím tắt ---------- */
  function onKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const dialogOpen = !!document.querySelector('dialog[open]');
    const tgt = e.target;
    const inField = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable);
    if (e.key === 'Escape') { U.$('#settings-menu').hidden = true; return; }
    if (dialogOpen) return;
    if (mod && !e.altKey && !e.shiftKey && k === 's') { e.preventDefault(); save(false); return; }
    if (mod && e.key === 'Enter') { e.preventDefault(); save(true); return; }
    if (e.altKey && !mod && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); nav(e.key === 'ArrowDown' ? 1 : -1); return; }
    if (inField) return;
    if (mod && !e.altKey && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (mod && !e.altKey && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
    if (!mod && !e.altKey && e.key === '?') { e.preventDefault(); showHelp(); }
  }

  /* ---------- Kéo-thả thư mục ---------- */
  function initDrop() {
    const overlay = U.$('#drop-overlay');
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; overlay.hidden = false; });
    window.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) overlay.hidden = true; });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0; overlay.hidden = true;
      const items = Array.from(e.dataTransfer.items || []).filter((i) => i.kind === 'file');
      if (FSA_SUPPORTED && items.length && items[0].getAsFileSystemHandle) {
        // Phải gọi getAsFileSystemHandle đồng bộ trong sự kiện drop
        const ps = items.map((i) => i.getAsFileSystemHandle());
        Promise.all(ps).then((hs) => {
          const dir = hs.find((h) => h && h.kind === 'directory');
          if (dir) openRoot(dir); else toast('Hãy kéo-thả một thư mục (không phải file lẻ)', 'err');
        }).catch((err) => toast('Không đọc được mục kéo-thả: ' + err.message, 'err'));
      } else {
        const entries = items.map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
        const dir = entries.find((en) => en.isDirectory);
        if (!dir) { toast('Hãy kéo-thả một thư mục (không phải file lẻ)', 'err'); return; }
        FS.filesFromEntry(dir).then(openFileList).catch((err) => toast('Không đọc được thư mục: ' + err.message, 'err'));
      }
    });
  }

  /* ---------- Khởi động ---------- */
  function init() {
    // Gắn icon SVG
    U.$$('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin', U.icon(el.dataset.icon)));
    wsEl = U.$('#workspace');
    narrowMq = window.matchMedia('(max-width: 900px)');
    reviewerInput = U.$('#reviewer');
    reviewerInput.value = Prefs.get('reviewer') || '';
    reviewerInput.addEventListener('input', () => { Prefs.set('reviewer', reviewerInput.value.trim()); if (reviewerInput.value.trim()) U.$('.reviewer').classList.remove('need'); });

    U.$('#profile-badge').textContent = PROFILE.short;
    U.$('#profile-badge').title = PROFILE.description;
    U.$('#empty-title').textContent = PROFILE.title;
    U.$('#empty-sub').textContent = PROFILE.description;
    document.title = PROFILE.title;

    applyTheme();
    applyLayout();
    narrowMq.addEventListener('change', applyLayout);
    if (Prefs.get('sidebar') === false) document.body.classList.add('sb-collapsed');

    if (!FSA_SUPPORTED) {
      const b = U.$('#banner');
      b.innerHTML = '<b>Chế độ chỉ đọc.</b> Trình duyệt này không hỗ trợ ghi trực tiếp vào thư mục (File System Access API). ' +
        'Khi bấm Lưu, file kết quả sẽ được <b>tải về</b> với tên <code>&lt;thư-mục&gt;__&lt;tên&gt;.reviewed.json</code> — hãy chép vào thư mục hồ sơ tương ứng. ' +
        'Dùng Chrome hoặc Edge (mở trực tiếp file HTML) để ghi thẳng vào thư mục.';
    }

    Viewer.init(); Form.init(); Raw.init(); Diff.init();
    initGutter(); initSettings(); initDrop();

    U.$('#btn-open').onclick = pickFolder;
    U.$('#es-open').onclick = pickFolder;
    U.$('#btn-reopen').onclick = reopen;
    U.$('#es-reopen').onclick = reopen;
    U.$('#dir-input').addEventListener('change', (e) => { const fl = Array.from(e.target.files || []); e.target.value = ''; openFileList(fl); });
    U.$('#btn-save').onclick = () => save(false);
    U.$('#btn-save-next').onclick = () => save(true);
    U.$('#btn-report').onclick = () => Report.open();
    U.$('#btn-layout').onclick = () => { Prefs.set('layout', Prefs.get('layout') === 'v' ? 'h' : 'v'); applyLayout(); if (narrowMq.matches) toast('Màn hình hẹp (< 900px) luôn dùng bố cục trên-dưới'); };
    U.$('#btn-theme').onclick = cycleTheme;
    U.$('#btn-sidebar').onclick = () => toggleSidebar();
    U.$('#btn-help').onclick = showHelp;
    U.$$('.tab').forEach((t) => { t.onclick = () => setTab(t.dataset.tab); });

    const search = U.$('#sb-search');
    search.addEventListener('input', U.debounce(() => { S.sbQuery = search.value.trim(); renderSidebar(); }, 100));
    U.$('#sb-filter').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      S.sbFilter = b.dataset.v;
      U.$$('#sb-filter button').forEach((x) => x.classList.toggle('on', x === b));
      renderSidebar();
    });

    new ResizeObserver(() => {
      const p = U.$('#pane-json');
      p.classList.toggle('narrow', p.clientWidth < 560);
    }).observe(U.$('#pane-json'));

    document.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', (e) => {
      if (S.cur) { commit(); refreshDirty(S.cur); }
      if (S.docs.some((d) => d.dirty)) { e.preventDefault(); e.returnValue = ''; }
    });

    if (FSA_SUPPORTED) FS.kvGet('lastDir').then((h) => { if (h) showReopen(h.name); }).catch(() => { /* bỏ qua */ });
    updateHeader();
  }

  return {
    init, select, ensureLoaded, commit, onEdit, onStructure, undo, redo, applyRaw, setTab, refreshSidebar,
    save, nav, openRoot, openFileList
  };
})();

// Đối tượng gỡ lỗi / kiểm thử
window.__ocrReview = { S, Model, Viewer, App, Prefs, PROFILE };
App.init();
