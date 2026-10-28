/* =====================================================================
 * diff — tab Đối chiếu: danh sách thay đổi (hoàn tác từng mục) và
 * so sánh song song 2 cột theo dòng (LCS) + diff mức ký tự
 * ===================================================================== */
const Diff = (() => {
  let pane, seg, view, foldChk, info, doc = null;
  let mode = Prefs.get('diffMode') || 'list';
  let expanded = new Set();
  const TYPE_TXT = { modified: 'Sửa', added: 'Thêm', removed: 'Xoá' };

  function init() {
    pane = U.$('#tab-diff');
    seg = U.h('div', { class: 'seg' },
      U.h('button', { dataset: { v: 'list' }, text: 'Danh sách thay đổi' }),
      U.h('button', { dataset: { v: 'side' }, text: 'Song song' }));
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      mode = b.dataset.v; Prefs.set('diffMode', mode); render(doc);
    });
    foldChk = U.h('input', { type: 'checkbox', checked: true });
    foldChk.addEventListener('change', () => render(doc));
    info = U.h('span', { class: 'muted' });
    const foldLbl = U.h('label', { class: 'muted', style: { display: 'inline-flex', gap: '4px', alignItems: 'center' } }, foldChk, 'Ẩn các dòng giống nhau');
    pane.append(U.h('div', { class: 'form-tools' }, seg, foldLbl, U.h('span', { class: 'spacer' }), info));
    view = U.h('div', { class: 'scroll-y', id: 'diff-scroll' });
    pane.append(view);
    view.addEventListener('click', onClick);
    pane._foldLbl = foldLbl;
  }

  function render(d) {
    if (d !== doc) expanded = new Set();
    doc = d;
    U.$$('button', seg).forEach((b) => b.classList.toggle('on', b.dataset.v === mode));
    pane._foldLbl.hidden = mode !== 'side';
    view.textContent = '';
    info.textContent = '';
    if (!doc || !doc.loaded) return;
    if (doc.data === undefined) { view.innerHTML = '<div class="form-empty">Chưa có dữ liệu để đối chiếu.</div>'; return; }
    if (mode === 'list') renderList(); else renderSide();
  }

  function valHtml(v, other, side) {
    if (v === undefined) return '<span class="empty-val">(không có)</span>';
    if (v === '') return '<span class="empty-val">(trống)</span>';
    if (other !== undefined && typeof v === 'string' && typeof other === 'string') {
      return side === 'old' ? U.charDiffHtml(v, other, 'old') : U.charDiffHtml(other, v, 'new');
    }
    const s = U.esc(U.leafShow(v));
    return side === 'old' ? '<del class="d">' + s + '</del>' : '<ins class="d">' + s + '</ins>';
  }

  function renderList() {
    const an = Model.analyze(doc);
    const ch = an.changes;
    info.textContent = ch.length ? ch.length + ' thay đổi' : '';
    if (!ch.length) { view.innerHTML = '<div class="form-empty">Không có thay đổi nào so với JSON gốc.</div>'; return; }
    const list = U.h('div', { class: 'chg-list' });
    ch.forEach((c, i) => {
      const path = c.type === 'removed' ? c.opath : c.cpath;
      const vals = U.h('div', { class: 'chg-val' });
      if (c.type !== 'added') vals.append(U.h('span', { class: 'vl', text: 'Gốc' }), U.h('span', { html: valHtml(c.original, c.type === 'modified' ? c.updated : undefined, 'old') }));
      if (c.type !== 'removed') vals.append(U.h('span', { class: 'vl', text: 'Mới' }), U.h('span', { html: valHtml(c.updated, c.type === 'modified' ? c.original : undefined, 'new') }));
      list.append(U.h('div', { class: 'chg', dataset: { i } },
        U.h('span', { class: 'chg-type t-' + c.type, text: TYPE_TXT[c.type] }),
        U.h('div', { class: 'chg-head' },
          U.h('span', { class: 'lbl', text: labelFor(path) }),
          U.h('span', { class: 'path', text: c.path + (c.type === 'removed' ? '  (path gốc)' : ''), title: c.type === 'removed' ? 'Trường đã bị xoá' : 'Đi tới trường trong tab Form', dataset: { act: 'goto', i } })),
        U.h('div', { class: 'chg-acts' }, U.h('button', { class: 'small', html: U.icon('undo') + ' Hoàn tác', dataset: { act: 'undo', i } })),
        vals));
    });
    view.append(list);
    view._changes = ch;
  }

  function onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t || !doc) return;
    if (t.dataset.act === 'fold') { expanded.add(+t.dataset.k); renderSide(); return; }
    const c = view._changes && view._changes[+t.dataset.i];
    if (!c) return;
    if (t.dataset.act === 'goto') {
      if (c.type === 'removed') return;
      App.setTab('form');
      Form.focusPath(c.path);
      return;
    }
    if (t.dataset.act === 'undo') {
      const st = view.scrollTop;
      let ok = false;
      if (c.type === 'modified') ok = Model.revertLeaf(doc, c.cpath);
      else if (c.type === 'added') { Model.deleteAt(doc, c.cpath); ok = true; }
      else ok = Model.restoreOrig(doc, c.opath);
      if (ok) { App.commit(); App.onStructure(); view.scrollTop = st; toast('Đã hoàn tác: ' + c.path); }
    }
  }

  /* ---------- Song song ---------- */
  function renderSide() {
    const left = doc.parseError ? (doc.origText || '') : JSON.stringify(doc.baseline === undefined ? null : doc.baseline, null, 2);
    const right = JSON.stringify(doc.data, null, 2);
    const A = left.split('\n'), B = right.split('\n');
    const ops = U.lcsOps(A, B, 1.2e7);
    // Gom thành các hàng: eq, hoặc cặp del/ins (ghép theo thứ tự trong cụm)
    const rows = [];
    let dels = [], inss = [];
    const flush = () => {
      const n = Math.max(dels.length, inss.length);
      for (let k = 0; k < n; k++) rows.push({ t: 'chg', a: dels[k], b: inss[k] });
      dels = []; inss = [];
    };
    for (const op of ops) {
      if (op.t === 'eq') { flush(); rows.push({ t: 'eq', a: op.a, b: op.b }); }
      else if (op.t === 'del') dels.push(op.a);
      else inss.push(op.b);
    }
    flush();
    const nChg = rows.filter((r) => r.t === 'chg').length;
    info.textContent = nChg ? nChg + ' dòng khác nhau' : 'Hai bản giống nhau';

    const fold = foldChk.checked, CTX = 3;
    let html = '<div class="side"><div class="side-head"><div>Gốc (OCR)</div><div>Hiện tại</div></div>';
    const lineHtml = (r) => {
      if (r.t === 'eq') {
        const s = U.hlJsonLine(A[r.a]) || ' ';
        return '<div class="side-row"><span class="ln">' + (r.a + 1) + '</span><span class="lc l">' + s + '</span><span class="ln">' + (r.b + 1) + '</span><span class="lc r">' + s + '</span></div>';
      }
      const a = r.a != null ? A[r.a] : null, b = r.b != null ? B[r.b] : null;
      const lh = a == null ? '' : (b != null ? U.charDiffHtml(a, b, 'old') : '<del class="d">' + U.esc(a) + '</del>');
      const rh = b == null ? '' : (a != null ? U.charDiffHtml(a, b, 'new') : '<ins class="d">' + U.esc(b) + '</ins>');
      return '<div class="side-row"><span class="ln">' + (a != null ? r.a + 1 : '') + '</span><span class="lc l ' + (a != null ? 'del' : 'gap') + '">' + (lh || ' ') +
        '</span><span class="ln">' + (b != null ? r.b + 1 : '') + '</span><span class="lc r ' + (b != null ? 'ins' : 'gap') + '">' + (rh || ' ') + '</span></div>';
    };
    let i = 0;
    while (i < rows.length) {
      if (rows[i].t !== 'eq' || !fold) { html += lineHtml(rows[i]); i++; continue; }
      let j = i;
      while (j < rows.length && rows[j].t === 'eq') j++;
      const len = j - i;
      const head = i === 0 ? 0 : CTX, tail = j === rows.length ? 0 : CTX;
      if (len > head + tail + 2 && !expanded.has(i)) {
        for (let k = i; k < i + head; k++) html += lineHtml(rows[k]);
        html += '<div class="side-fold" data-act="fold" data-k="' + i + '">⋯ ' + (len - head - tail) + ' dòng giống nhau — bấm để mở</div>';
        for (let k = j - tail; k < j; k++) html += lineHtml(rows[k]);
      } else for (let k = i; k < j; k++) html += lineHtml(rows[k]);
      i = j;
    }
    view.innerHTML = html + '</div>';
  }

  return { init, render, count: (d) => (d && d.loaded && d.data !== undefined ? Model.analyze(d).changes.length : 0) };
})();
