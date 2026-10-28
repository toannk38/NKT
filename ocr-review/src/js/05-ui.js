/* =====================================================================
 * ui — toast, hộp thoại (prompt/confirm/modal)
 * ===================================================================== */
function toast(msg, type = 'info', ms = 2800) {
  const t = U.h('div', { class: 'toast ' + type, text: msg, role: 'status' });
  U.$('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

const Dialog = (() => {
  /** Mở modal; build(close) trả về {title, body, footer} */
  function open({ title, body, footer, cls, onClose, initialFocus }) {
    const dlg = U.h('dialog', { class: cls || '' });
    const close = (v) => { if (dlg.open) dlg.close(); dlg.remove(); if (onClose) onClose(v); };
    const head = U.h('div', { class: 'dlg-h' }, U.h('span', { text: title }), U.h('span', { class: 'spacer' }),
      U.h('button', { class: 'icon-btn ghost', title: 'Đóng (Esc)', text: '✕', onclick: () => close(null) }));
    const wrap = U.h('div', { class: 'dlg' }, head, U.h('div', { class: 'dlg-b' }, body));
    if (footer) wrap.append(U.h('div', { class: 'dlg-f' }, footer));
    dlg.append(wrap);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    document.body.append(dlg);
    dlg.showModal();
    if (initialFocus) setTimeout(() => initialFocus.focus(), 0);
    return { dlg, close };
  }

  /** Hỏi một giá trị chuỗi → Promise<string|null> */
  function prompt({ title, label, value = '', placeholder = '', okText = 'OK', suggestions = [], validate }) {
    return new Promise((resolve) => {
      const input = U.h('input', { value, placeholder, spellcheck: 'false', autocomplete: 'off' });
      const err = U.h('div', { class: 'lf-warn' });
      let dl = null;
      if (suggestions.length) {
        const id = 'dl-' + Math.random().toString(36).slice(2);
        input.setAttribute('list', id);
        dl = U.h('datalist', { id }, suggestions.map((s) => U.h('option', { value: s })));
      }
      const body = U.h('div', null, U.h('label', { class: 'fld' }, label, input), dl, err);
      let result = null;
      const ok = () => {
        const v = input.value.trim();
        const msg = validate ? validate(v) : (v ? null : 'Không được để trống');
        if (msg) { err.textContent = msg; input.focus(); return; }
        result = v; d.close(v);
      };
      const d = open({
        title, body, initialFocus: input,
        footer: [U.h('button', { text: 'Huỷ', onclick: () => d.close(null) }), U.h('button', { class: 'primary', text: okText, onclick: ok })],
        onClose: () => resolve(result)
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
      setTimeout(() => input.select(), 0);
    });
  }

  function confirm({ title, message, okText = 'Đồng ý', cancelText = 'Huỷ', danger }) {
    return new Promise((resolve) => {
      let result = false;
      const okBtn = U.h('button', { class: 'primary', text: okText, onclick: () => { result = true; d.close(true); } });
      if (danger) okBtn.style.background = 'var(--bad)';
      const d = open({
        title, body: U.h('div', { style: { maxWidth: '460px', whiteSpace: 'pre-line' }, text: message }),
        footer: [U.h('button', { text: cancelText, onclick: () => d.close(false) }), okBtn],
        onClose: () => resolve(result), initialFocus: okBtn
      });
    });
  }

  return { open, prompt, confirm };
})();
