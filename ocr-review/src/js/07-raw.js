/* =====================================================================
 * raw — tab Raw: xem JSON (hiện tại / gốc) có tô màu & số dòng,
 * sửa trực tiếp (Áp dụng / Huỷ / Định dạng), báo lỗi dòng-cột
 * ===================================================================== */
const Raw = (() => {
  let pane, seg, btnCopy, btnEdit, btnApply, btnCancel, btnFormat, msgEl, view, editWrap, ta;
  let doc = null, editing = false, which = Prefs.get('rawView') || 'current';

  function init() {
    pane = U.$('#tab-raw');
    seg = U.h('div', { class: 'seg' },
      U.h('button', { dataset: { v: 'current' }, text: 'Hiện tại' }),
      U.h('button', { dataset: { v: 'orig' }, text: 'Gốc' }));
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      which = b.dataset.v; Prefs.set('rawView', which); render(doc);
    });
    btnCopy = U.h('button', { html: U.icon('copy') + ' Sao chép', onclick: copy });
    btnEdit = U.h('button', { html: U.icon('edit') + ' Sửa raw', onclick: startEdit });
    btnApply = U.h('button', { class: 'primary', text: 'Áp dụng', onclick: apply, title: 'Phân tích JSON và áp dụng vào dữ liệu' });
    btnCancel = U.h('button', { text: 'Huỷ', onclick: cancel });
    btnFormat = U.h('button', { text: 'Định dạng', onclick: format, title: 'Thụt lề lại JSON' });
    const tools = U.h('div', { class: 'form-tools' }, seg, btnCopy, U.h('span', { class: 'spacer' }), btnFormat, btnCancel, btnApply, btnEdit);
    msgEl = U.h('div', { hidden: true });
    view = U.h('div', { class: 'scroll-y' });
    ta = U.h('textarea', { spellcheck: 'false', wrap: 'off', 'aria-label': 'Sửa JSON' });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const s = ta.selectionStart, en = ta.selectionEnd;
        ta.setRangeText('  ', s, en, 'end');
      }
    });
    editWrap = U.h('div', { class: 'raw-edit', hidden: true }, ta);
    pane.append(tools, msgEl, view, editWrap);
  }

  const textOf = (w) => {
    if (!doc) return '';
    if (w === 'orig') return doc.origText != null ? doc.origText : '';
    return doc.data === undefined ? '' : JSON.stringify(doc.data, null, 2);
  };

  function showMsg(html, cls) {
    if (!html) { msgEl.hidden = true; return; }
    msgEl.className = cls || 'raw-err';
    msgEl.innerHTML = html;
    msgEl.hidden = false;
  }

  function render(d) {
    if (d !== doc) { editing = false; }
    doc = d;
    U.$$('button', seg).forEach((b) => b.classList.toggle('on', b.dataset.v === which));
    if (!doc || !doc.loaded) { view.textContent = ''; showMsg(''); setMode(); return; }
    // JSON gốc lỗi & chưa sửa → mở sẵn chế độ sửa
    if (doc.data === undefined && doc.parseError && !editing && !doc.rawDismissed) {
      editing = true;
      ta.value = doc.origText || '';
      errorAt(doc.parseError);
    }
    setMode();
    if (editing) return;
    showMsg('');
    const text = textOf(which);
    const errLine = which === 'orig' && doc.parseError ? doc.parseError.line : -1;
    if (which === 'orig' && doc.parseError) {
      showMsg('JSON gốc lỗi cú pháp ở <b>dòng ' + doc.parseError.line + ', cột ' + doc.parseError.col + '</b>: ' + U.esc(doc.parseError.msg));
    }
    if (!text) { view.innerHTML = '<div class="form-empty">' + (doc.files.json ? 'Chưa có dữ liệu.' : 'Hồ sơ không có file JSON.') + '</div>'; return; }
    const lines = text.split('\n');
    let html = '<div class="code-view">';
    for (let i = 0; i < lines.length; i++) {
      html += '<div class="cl' + (i + 1 === errLine ? ' err' : '') + '"><span class="ln">' + (i + 1) + '</span><span class="lc">' + (U.hlJsonLine(lines[i]) || ' ') + '</span></div>';
    }
    view.innerHTML = html + '</div>';
    if (errLine > 0) {
      const el = view.querySelector('.cl.err');
      if (el) el.scrollIntoView({ block: 'center' });
    }
  }

  function setMode() {
    const has = !!(doc && doc.loaded && (doc.files.json || doc.data !== undefined));
    view.hidden = editing; editWrap.hidden = !editing;
    seg.hidden = editing; btnCopy.hidden = editing;
    btnEdit.hidden = editing; btnEdit.disabled = !has;
    btnApply.hidden = btnCancel.hidden = btnFormat.hidden = !editing;
    btnCopy.disabled = !has;
  }

  function startEdit() {
    if (!doc) return;
    editing = true;
    ta.value = doc.data === undefined ? (doc.origText || '') : JSON.stringify(doc.data, null, 2);
    showMsg('');
    setMode();
    ta.focus();
    ta.setSelectionRange(0, 0);
    ta.scrollTop = 0;
  }
  function cancel() {
    editing = false;
    if (doc && doc.data === undefined) doc.rawDismissed = true;
    render(doc);
  }
  function errorAt(pe) {
    showMsg('Lỗi JSON ở <b>dòng ' + pe.line + ', cột ' + pe.col + '</b>: ' + U.esc(pe.msg));
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(pe.pos, Math.min(ta.value.length, pe.pos + 1));
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
      ta.scrollTop = Math.max(0, (pe.line - 5) * lh);
    }, 0);
  }
  function parse() {
    try { return { ok: true, v: JSON.parse(ta.value) }; } catch (e) { const pe = U.jsonError(ta.value, e); errorAt(pe); return { ok: false }; }
  }
  function format() {
    const r = parse();
    if (r.ok) { ta.value = JSON.stringify(r.v, null, 2); showMsg('Đã định dạng lại JSON.', 'raw-ok'); }
  }
  function apply() {
    const r = parse();
    if (!r.ok) return;
    editing = false;
    App.applyRaw(r.v);
    toast('Đã áp dụng JSON', 'ok');
  }

  async function copy() {
    const text = textOf(which);
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const t = U.h('textarea', { style: { position: 'fixed', opacity: '0' } });
      t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
    }
    toast('Đã sao chép JSON ' + (which === 'orig' ? 'gốc' : 'hiện tại'), 'ok');
  }

  return { init, render, isEditing: () => editing };
})();
