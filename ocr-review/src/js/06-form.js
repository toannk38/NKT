/* =====================================================================
 * form — tab Form: render đệ quy JSON thành card/ô nhập, đánh dấu
 * Đúng/Sai, khôi phục, thêm/xoá trường & phần tử, lọc
 * ===================================================================== */
const Form = (() => {
  let pane, body, scroller, searchInput, showSeg, btnUndo, btnRedo;
  let rows = new Map();      // ps -> {row, ta, orig, warn, path, search}
  let doc = null;
  let filterText = '';
  let show = Prefs.get('formShow') || 'all';
  const AUTOSIZE = !(window.CSS && CSS.supports && CSS.supports('field-sizing', 'content'));

  function init() {
    pane = U.$('#tab-form');
    searchInput = U.h('input', { type: 'search', placeholder: 'Lọc theo tên trường…', spellcheck: 'false' });
    showSeg = U.h('div', { class: 'seg', title: 'Chỉ hiện' },
      [['all', 'Tất cả'], ['modified', 'Đã sửa'], ['unreviewed', 'Chưa duyệt'], ['wrong', 'Sai']].map(([v, t]) =>
        U.h('button', { dataset: { v }, class: v === show ? 'on' : '', text: t })));
    btnUndo = U.h('button', { class: 'icon-btn', title: 'Hoàn tác (Ctrl+Z)', html: U.icon('undo'), onclick: () => App.undo() });
    btnRedo = U.h('button', { class: 'icon-btn', title: 'Làm lại (Ctrl+Y)', html: U.icon('redo'), onclick: () => App.redo() });
    const markAll = U.h('button', { html: U.icon('check') + ' Đúng cho mọi trường chưa duyệt', title: 'Đánh dấu Đúng cho mọi trường chưa duyệt', onclick: markAllCorrect, id: 'btn-mark-all' });
    const tools = U.h('div', { class: 'form-tools' }, searchInput, U.h('span', { class: 'muted', text: 'Chỉ hiện:' }), showSeg,
      U.h('span', { class: 'spacer' }), markAll, btnUndo, btnRedo);
    body = U.h('div', { class: 'form-body' });
    scroller = U.h('div', { class: 'scroll-y', id: 'form-scroll' }, body);
    pane.append(tools, scroller);

    searchInput.addEventListener('input', U.debounce(() => { filterText = searchInput.value; applyFilter(); }, 120));
    showSeg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      show = b.dataset.v; Prefs.set('formShow', show);
      U.$$('button', showSeg).forEach((x) => x.classList.toggle('on', x === b));
      applyFilter();
    });

    // Uỷ quyền sự kiện
    body.addEventListener('input', onInput);
    body.addEventListener('change', (e) => { if (e.target.matches('.leaf textarea')) App.commit(); });
    body.addEventListener('keydown', onKeyDown);
    body.addEventListener('click', onClick);
    body.addEventListener('focusin', (e) => { const r = e.target.closest('.leaf'); if (r) r.classList.add('focus'); });
    body.addEventListener('focusout', (e) => { const r = e.target.closest('.leaf'); if (r) r.classList.remove('focus'); });
  }

  /* ---------- Render ---------- */
  function render(d, keepScroll) {
    doc = d;
    const st = scroller.scrollTop;
    rows = new Map();
    body.textContent = '';
    updateHistoryButtons();
    if (!doc) return;
    if (!doc.loaded) { body.append(U.h('div', { class: 'form-empty', text: 'Đang tải…' })); return; }

    const note = U.h('textarea', { id: 'doc-note', rows: 1, placeholder: 'Ghi chú cho hồ sơ này (lưu vào file kết quả)…' });
    note.value = doc.note || '';
    note.addEventListener('input', () => { doc.note = note.value; App.onEdit(); });
    body.append(U.h('div', { class: 'note-box' }, U.h('label', { for: 'doc-note', text: 'Ghi chú hồ sơ' }), note));

    const warns = docWarnings(doc, false);
    if (warns.length) body.append(U.h('div', { class: 'notice' }, U.h('b', { text: '⚠ Cảnh báo hồ sơ' }), U.h('div', null, warns.map((w) => U.h('div', { text: '• ' + w })))));

    if (doc.parseError) {
      const pe = doc.parseError;
      body.append(U.h('div', { class: 'notice err' },
        U.h('b', { text: 'JSON gốc lỗi cú pháp' }), ' (dòng ' + pe.line + ', cột ' + pe.col + '): ' + pe.msg + '. ',
        doc.data === undefined ? 'Hãy sửa tay ở tab Raw rồi bấm Áp dụng. ' : 'Đã dùng bản sửa cú pháp làm bản đối chiếu. ',
        U.h('button', { class: 'small', text: 'Mở tab Raw', onclick: () => App.setTab('raw') })));
    }
    if (doc.data === undefined) {
      if (!doc.files.json) body.append(U.h('div', { class: 'form-empty', text: 'Hồ sơ này không có file JSON kết quả OCR.' }));
      return;
    }

    // Thiếu trường theo mẫu (profile có schema)
    const missing = schemaMissing(doc.data);
    if (missing.length) {
      body.append(U.h('div', { class: 'notice' },
        U.h('b', { text: 'Thiếu ' + missing.length + ' trường theo mẫu ' + PROFILE.short + ' ' }),
        U.h('button', { class: 'small', text: '+ Thêm tất cả', dataset: { act: 'add-missing-all' } }),
        U.h('div', { class: 'n-list' }, missing.map((p) => U.h('button', {
          class: 'small', dataset: { act: 'add-missing', path: JSON.stringify(p) }, title: 'Thêm trường ' + U.pathStr(p),
          html: '+ ' + U.esc(labelFor(p)) + ' <code>' + U.esc(U.pathStr(p)) + '</code>'
        })))));
    }

    const frag = document.createDocumentFragment();
    if (U.isObj(doc.data)) {
      renderEntries(doc.data, [], frag, '');
      frag.append(U.h('div', { class: 'add-row' }, U.h('button', { class: 'small', text: '+ Thêm trường', dataset: { act: 'add-field', path: '[]' } })));
    } else if (Array.isArray(doc.data)) {
      frag.append(arrayCard(doc.data, [], 'Gốc'));
    } else {
      frag.append(leafRow([], doc.data, ''));
    }
    body.append(frag);
    if (!rows.size && U.isObj(doc.data) && !Object.keys(doc.data).length) body.append(U.h('div', { class: 'form-empty', text: 'JSON rỗng. Dùng “+ Thêm trường” để bổ sung.' }));
    for (const ps of rows.keys()) updateRow(ps);
    updateCards();
    applyFilter();
    if (AUTOSIZE) autosizeAll();
    if (keepScroll) scroller.scrollTop = st;
  }

  function renderEntries(obj, path, parent, ctx) {
    for (const k of Object.keys(obj)) renderNode(obj[k], path.concat(k), parent, ctx);
  }
  function renderNode(v, path, parent, ctx) {
    if (U.isLeaf(v)) parent.append(leafRow(path, v, ctx));
    else if (Array.isArray(v)) parent.append(arrayCard(v, path, ctx));
    else parent.append(objectCard(v, path, ctx));
  }

  function tags(path) {
    const out = [];
    if (!schemaHas(path)) out.push(U.h('span', { class: 'tag t-extra', text: 'ngoài mẫu', title: 'Trường không có trong mẫu ' + PROFILE.short }));
    if (path.length && !Model.origInfo(doc, path).exists) out.push(U.h('span', { class: 'tag t-added', text: 'mới', title: 'Không có trong JSON gốc' }));
    return out;
  }

  function cardShell(path, title, keyText, sub, acts, cls) {
    const ps = U.pathStr(path);
    const c = U.h('div', { class: 'card ' + (cls || ''), dataset: { ps } });
    if (S.collapsed.has(ps)) c.classList.add('collapsed');
    if (path.length && !Model.origInfo(doc, path).exists) c.classList.add('added');
    const head = U.h('div', { class: 'card-h', dataset: { act: 'toggle' } },
      U.h('span', { class: 'caret', text: '▼' }),
      U.h('span', { class: 'c-title', text: title }),
      keyText != null ? U.h('code', { class: 'k', text: keyText }) : null,
      sub ? U.h('span', { class: 'c-sub', text: sub }) : null,
      tags(path),
      U.h('span', { class: 'c-stats' }),
      U.h('span', { class: 'c-acts' }, acts));
    const b = U.h('div', { class: 'card-b' });
    c.append(head, b);
    return [c, b];
  }

  function itemSummary(o) {
    if (!U.isObj(o)) return '';
    const pref = Object.keys(o).find((k) => /(^|_)(ho_ten|ho_va_ten|ten|name|title)$/i.test(k) && typeof o[k] === 'string' && o[k].trim());
    const k = pref || Object.keys(o).find((x) => typeof o[x] === 'string' && o[x].trim());
    const s = k ? o[k].trim() : '';
    return s.length > 60 ? s.slice(0, 57) + '…' : s;
  }

  function objectCard(obj, path, ctx) {
    const last = path[path.length - 1];
    const isItem = typeof last === 'number';
    const title = isItem ? '#' + (last + 1) : labelFor(path);
    const ps = JSON.stringify(path);
    const acts = [U.h('button', { class: 'small', text: '+ Thêm trường', dataset: { act: 'add-field', path: ps } })];
    if (isItem) acts.push(U.h('button', { class: 'small', text: 'Xoá', title: 'Xoá phần tử ' + title, dataset: { act: 'del', path: ps } }));
    const [c, b] = cardShell(path, title, isItem ? null : String(last), isItem ? itemSummary(obj) : '', acts, isItem ? 'arr-item' : '');
    const nctx = ctx + ' ' + title;
    renderEntries(obj, path, b, nctx);
    if (!Object.keys(obj).length) b.append(U.h('div', { class: 'muted', style: { padding: '4px' }, text: '(object rỗng)' }));
    return c;
  }

  function arrayCard(arr, path, ctx) {
    const last = path[path.length - 1];
    const title = path.length ? (typeof last === 'number' ? '#' + (last + 1) : labelFor(path)) : 'Danh sách';
    const ps = JSON.stringify(path);
    const acts = [U.h('button', { class: 'small', text: '+ Thêm phần tử', dataset: { act: 'add-item', path: ps } })];
    if (typeof last === 'number') acts.push(U.h('button', { class: 'small', text: 'Xoá', dataset: { act: 'del', path: ps } }));
    const [c, b] = cardShell(path, title + ' (' + arr.length + ')', path.length && typeof last !== 'number' ? String(last) : null, '', acts, 'arr');
    const nctx = ctx + ' ' + title;
    arr.forEach((v, i) => renderNode(v, path.concat(i), b, nctx));
    if (!arr.length) b.append(U.h('div', { class: 'muted', style: { padding: '4px' }, text: '(mảng rỗng)' }));
    return c;
  }

  function leafRow(path, value, ctx) {
    const ps = U.pathStr(path);
    const last = path[path.length - 1];
    const isItem = typeof last === 'number';
    const name = !path.length ? 'Giá trị' : isItem ? '#' + (last + 1) : labelFor(path);
    const keyText = !path.length ? '(gốc)' : isItem ? '[' + last + ']' : String(last);
    const ta = U.h('textarea', { rows: 1, spellcheck: 'false', 'aria-label': name });
    ta.value = U.leafText(value);
    if (value === null) { ta.placeholder = 'null'; ta.classList.add('is-null'); }
    const warn = U.h('span', { class: 'lf-warn' });
    const orig = U.h('div', { class: 'lf-orig', hidden: true });
    const pj = JSON.stringify(path);
    const row = U.h('div', { class: 'leaf', dataset: { ps } },
      U.h('div', { class: 'lf-label' }, U.h('span', { class: 'lf-name', text: name, title: ps }), ' ', tags(path), U.h('code', { class: 'k', text: keyText }), warn),
      U.h('div', { class: 'lf-input' }, ta, orig),
      U.h('div', { class: 'lf-acts' },
        U.h('button', { class: 'b-ok', title: 'Đúng', text: '✓', dataset: { act: 'ok', path: pj } }),
        U.h('button', { class: 'b-bad', title: 'Sai', text: '✗', dataset: { act: 'bad', path: pj } }),
        U.h('button', { class: 'b-rev', title: 'Khôi phục giá trị gốc', text: '↺', dataset: { act: 'revert', path: pj } }),
        path.length ? U.h('button', { class: 'b-del', title: isItem ? 'Xoá phần tử' : 'Xoá trường', text: '×', dataset: { act: 'del', path: pj } }) : null));
    rows.set(ps, { row, ta, orig, warn, path, search: U.fold(ctx + ' ' + name + ' ' + ps) });
    return row;
  }

  /** Cập nhật hiển thị 1 hàng: tô vàng, diff với gốc, trạng thái, cảnh báo */
  function updateRow(ps) {
    const r = rows.get(ps);
    if (!r || !doc) return;
    const value = r.path.length ? U.getAt(doc.data, r.path) : doc.data;
    const info = Model.origInfo(doc, r.path);
    const hasOrig = info.exists && U.isLeaf(info.value);
    const modified = hasOrig ? value !== info.value : !U.isEmptyVal(value);
    const status = doc.status[ps] || (modified ? 'wrong' : null);
    const cl = r.row.classList;
    cl.toggle('modified', modified);
    cl.toggle('st-correct', status === 'correct');
    cl.toggle('st-wrong', status === 'wrong');
    const bOk = r.row.querySelector('.b-ok'), bBad = r.row.querySelector('.b-bad'), bRev = r.row.querySelector('.b-rev');
    bOk.classList.toggle('on', status === 'correct');
    bBad.classList.toggle('on', status === 'wrong');
    bBad.title = status === 'wrong' && (doc.auto[ps] || !doc.status[ps]) ? 'Sai (tự đặt vì giá trị khác gốc)' : 'Sai';
    bRev.disabled = !hasOrig || !modified;
    if (modified) {
      let html;
      if (!hasOrig) html = '<span class="ol">Gốc:</span><span class="empty-val">(không có — trường mới)</span>';
      else {
        const a = U.leafText(info.value), b = U.leafText(value);
        if (a === '' && info.value !== null) html = '<span class="ol">Gốc:</span><span class="empty-val">(trống)</span>';
        else if (a === b) html = '<span class="ol">Gốc:</span>' + U.esc(U.leafShow(info.value)) + ' <span class="empty-val">(khác kiểu: ' + (info.value === null ? 'null' : typeof info.value) + ')</span>';
        else html = '<span class="ol">Gốc:</span>' + (info.value === null ? '<span class="empty-val">null</span> → ' + U.esc(b) : U.charDiffHtml(a, b));
      }
      r.orig.innerHTML = html;
      r.orig.hidden = false;
    } else r.orig.hidden = true;
    const w = validateLeaf(r.path, value, doc.data);
    r.warn.textContent = w.length ? '⚠ ' + w.join('; ') : '';
  }

  function refreshAll() {
    for (const ps of rows.keys()) updateRow(ps);
    updateCards();
    applyFilter();
    updateHistoryButtons();
  }

  /** Thống kê nhỏ trên tiêu đề card */
  const updateCards = U.debounce(() => {
    for (const c of U.$$('.card', body)) {
      const leaves = c.querySelectorAll('.leaf');
      const wrong = c.querySelectorAll('.leaf.st-wrong').length;
      const ok = c.querySelectorAll('.leaf.st-correct').length;
      const un = leaves.length - wrong - ok;
      const el = c.querySelector(':scope > .card-h .c-stats');
      el.innerHTML = leaves.length + ' trường' + (wrong ? ' · <span class="w">' + wrong + ' sai</span>' : '') + (un ? ' · ' + un + ' chưa duyệt' : '');
    }
  }, 60);

  function applyFilter() {
    const q = U.fold(filterText.trim());
    const active = !!q || show !== 'all';
    document.body.classList.toggle('filtering', active);
    for (const r of rows.values()) {
      const cl = r.row.classList;
      let ok = !q || r.search.includes(q);
      if (ok && show === 'modified') ok = cl.contains('modified');
      else if (ok && show === 'unreviewed') ok = !cl.contains('st-correct') && !cl.contains('st-wrong');
      else if (ok && show === 'wrong') ok = cl.contains('st-wrong');
      cl.toggle('hidden', !ok);
    }
    const cards = U.$$('.card', body).reverse();
    for (const c of cards) c.classList.toggle('hidden', active && !c.querySelector('.leaf:not(.hidden)'));
  }

  function autosize(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; }
  function autosizeAll() {
    requestAnimationFrame(() => {
      const tas = U.$$('.leaf textarea', body);
      tas.forEach((t) => { t.style.height = 'auto'; });
      const hs = tas.map((t) => t.scrollHeight);
      tas.forEach((t, i) => { t.style.height = hs[i] + 2 + 'px'; });
    });
  }

  /* ---------- Sự kiện ---------- */
  function onInput(e) {
    const ta = e.target;
    if (!ta.matches('.leaf textarea') || !doc) return;
    const ps = ta.closest('.leaf').dataset.ps;
    const r = rows.get(ps);
    Model.setLeaf(doc, r.path, ta.value);
    if (AUTOSIZE) autosize(ta);
    updateRow(ps);
    updateCards();
    App.onEdit();
  }

  function visibleInputs() {
    return U.$$('.leaf:not(.hidden) textarea', body).filter((t) => t.offsetParent !== null);
  }
  function focusRel(ta, dir) {
    const list = visibleInputs();
    const i = list.indexOf(ta);
    const next = list[i + dir];
    if (next) {
      next.focus();
      next.setSelectionRange(next.value.length, next.value.length);
      next.closest('.leaf').scrollIntoView({ block: 'nearest' });
    }
  }
  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.target.matches('.leaf textarea')) {
      e.preventDefault();
      App.commit();
      focusRel(e.target, +1);
    }
  }

  async function onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn || !doc) return;
    const act = btn.dataset.act;
    if (act === 'toggle') {
      if (e.target.closest('button')) return;
      const c = btn.closest('.card');
      c.classList.toggle('collapsed');
      if (c.classList.contains('collapsed')) S.collapsed.add(c.dataset.ps); else S.collapsed.delete(c.dataset.ps);
      return;
    }
    e.stopPropagation();
    const path = btn.dataset.path ? JSON.parse(btn.dataset.path) : null;
    const ps = path ? U.pathStr(path) : '';
    switch (act) {
      case 'ok':
      case 'bad': {
        const want = act === 'ok' ? 'correct' : 'wrong';
        const manual = doc.status[ps] === want && !doc.auto[ps];
        Model.setStatus(doc, ps, manual ? null : want);
        App.commit(); updateRow(ps); updateCards(); applyFilterSoon(); App.onEdit();
        break;
      }
      case 'revert': {
        if (Model.revertLeaf(doc, path)) {
          const r = rows.get(ps);
          r.ta.value = U.leafText(U.getAt(doc.data, path));
          if (AUTOSIZE) autosize(r.ta);
          App.commit(); updateRow(ps); updateCards(); App.onEdit();
        }
        break;
      }
      case 'del': {
        const label = labelFor(path);
        Model.deleteAt(doc, path);
        App.commit(); App.onStructure();
        toast('Đã xoá “' + label + '” — Ctrl+Z để hoàn tác');
        break;
      }
      case 'add-field': {
        const obj = path.length ? U.getAt(doc.data, path) : doc.data;
        const sn = schemaNode(path);
        const sugg = U.isObj(sn) ? Object.keys(sn).filter((k) => !U.hasOwn(obj, k)) : [];
        const key = await Dialog.prompt({
          title: 'Thêm trường', label: 'Tên key (vd: so_dien_thoai)', okText: 'Thêm', suggestions: sugg,
          validate: (v) => (!v ? 'Không được để trống' : U.hasOwn(obj, v) ? 'Key đã tồn tại' : null)
        });
        if (key == null) return;
        Model.addField(doc, path, key, U.isObj(sn) && sn[key] !== undefined ? emptyLike(sn[key]) : '');
        App.commit(); App.onStructure();
        focusPath(U.pathStr(path.concat(key)));
        break;
      }
      case 'add-item': {
        const i = Model.addArrayItem(doc, path);
        S.collapsed.delete(U.pathStr(path));
        App.commit(); App.onStructure();
        const first = U.$$('.leaf', body).find((r) => r.dataset.ps.startsWith(U.pathStr(path.concat(i))));
        if (first) focusPath(first.dataset.ps);
        break;
      }
      case 'add-missing': {
        U.setAt(doc.data, path, emptyLike(schemaNode(path)));
        App.commit(); App.onStructure();
        break;
      }
      case 'add-missing-all': {
        for (const p of schemaMissing(doc.data)) U.setAt(doc.data, p, emptyLike(schemaNode(p)));
        App.commit(); App.onStructure();
        break;
      }
    }
  }
  const applyFilterSoon = U.debounce(applyFilter, 250);

  function markAllCorrect() {
    if (!doc || doc.data === undefined) return;
    const an = Model.analyze(doc);
    let n = 0;
    for (const L of an.leaves) if (!L.status) { doc.status[L.ps] = 'correct'; delete doc.auto[L.ps]; n++; }
    if (!n) { toast('Không còn trường nào chưa duyệt'); return; }
    App.commit();
    refreshAll();
    App.onEdit();
    toast('Đã đánh dấu Đúng cho ' + n + ' trường', 'ok');
  }

  function focusPath(ps) {
    const r = rows.get(ps);
    if (!r) return;
    let c = r.row.closest('.card');
    while (c) { c.classList.remove('collapsed'); S.collapsed.delete(c.dataset.ps); c = c.parentElement.closest('.card'); }
    if (r.row.classList.contains('hidden')) { filterText = ''; searchInput.value = ''; show = 'all'; U.$$('button', showSeg).forEach((x) => x.classList.toggle('on', x.dataset.v === 'all')); applyFilter(); }
    r.row.scrollIntoView({ block: 'center' });
    r.ta.focus();
  }

  function updateHistoryButtons() {
    btnUndo.disabled = !doc || !doc.undo.length;
    btnRedo.disabled = !doc || !doc.redo.length;
  }

  return { init, render, refreshAll, updateHistoryButtons, focusPath, markAllCorrect };
})();
