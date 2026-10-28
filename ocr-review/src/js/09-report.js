/* =====================================================================
 * report — báo cáo tổng hợp toàn bộ hồ sơ + xuất CSV
 * ===================================================================== */
const Report = (() => {
  const ST_TXT = { correct: 'Đúng', wrong: 'Sai' };
  const CHG_TXT = { modified: 'Sửa', added: 'Thêm', removed: 'Xoá' };
  const DOC_ST = { saved: 'Đã lưu', dirty: 'Có thay đổi chưa lưu', unreviewed: 'Chưa duyệt', nojson: 'Thiếu JSON', error: 'JSON lỗi' };

  function docState(doc) {
    if (!doc.files.json) return 'nojson';
    if (doc.loaded && doc.data === undefined) return 'error';
    if (doc.dirty) return 'dirty';
    return doc.saved ? 'saved' : 'unreviewed';
  }

  /** Quét mọi hồ sơ: đọc file gốc + reviewed (nếu có) + trạng thái chưa lưu trong bộ nhớ */
  async function collect(onProgress) {
    const docs = [], fields = new Map(), details = [];
    const T = { docs: S.docs.length, saved: 0, dirty: 0, problem: 0, total: 0, correct: 0, wrong: 0, unreviewed: 0, dist: 0, len: 0 };
    const agg = (np, st, dist, len) => {
      let f = fields.get(np);
      if (!f) fields.set(np, f = { path: np, label: labelForNorm(np), correct: 0, wrong: 0, unreviewed: 0, dist: 0, len: 0 });
      if (st === 'correct') f.correct++; else if (st === 'wrong') f.wrong++; else f.unreviewed++;
      f.dist += dist || 0; f.len += len || 0;
    };
    let i = 0;
    for (const doc of S.docs) {
      await App.ensureLoaded(doc);
      onProgress && onProgress(++i, S.docs.length);
      const st = docState(doc);
      const row = { doc, name: doc.name, st, stats: null, reviewer: '', at: '', note: doc.note || '', warnings: docWarnings(doc) };
      if (doc.savedMeta) { row.reviewer = doc.savedMeta.reviewer || ''; row.at = doc.savedMeta.reviewed_at || ''; }
      if (st === 'saved') T.saved++; else if (st === 'dirty') T.dirty++; else if (st === 'nojson' || st === 'error') T.problem++;
      if (doc.data !== undefined) {
        const an = Model.analyze(doc);
        const changeType = new Map(an.changes.filter((c) => c.type !== 'removed').map((c) => [c.path, c.type]));
        row.stats = an.stats;
        for (const L of an.leaves) {
          agg(U.normPath(L.ps), L.status, L.dist, L.len);
          details.push([doc.name, L.ps, labelFor(L.path), ST_TXT[L.status] || 'Chưa duyệt',
            L.hasOrig ? U.leafText(L.orig) : '', U.leafText(L.value), CHG_TXT[changeType.get(L.ps)] || '']);
        }
        for (const R of an.removed) {
          if (!R.counted) continue;
          agg(U.normPath(R.ps), 'wrong', R.dist, 0);
          details.push([doc.name, R.ps, labelFor(R.opath), 'Sai', U.leafText(R.value), '', 'Xoá']);
        }
        T.total += an.stats.total; T.correct += an.stats.correct; T.wrong += an.stats.wrong; T.unreviewed += an.stats.unreviewed;
        T.dist += an.stats.dist; T.len += an.stats.len;
      }
      docs.push(row);
    }
    T.accuracy = T.correct + T.wrong ? T.correct / (T.correct + T.wrong) : null;
    T.cer = T.len ? T.dist / T.len : null;
    const fieldList = Array.from(fields.values()).map((f) => Object.assign(f, {
      accuracy: f.correct + f.wrong ? f.correct / (f.correct + f.wrong) : null,
      wrongRate: f.correct + f.wrong ? f.wrong / (f.correct + f.wrong) : 0,
      cer: f.len ? f.dist / f.len : null
    })).sort((a, b) => b.wrongRate - a.wrongRate || b.wrong - a.wrong || U.natCmp(a.path, b.path));
    return { T, docs, fields: fieldList, details };
  }

  async function open() {
    if (!S.docs.length) { toast('Hãy mở thư mục hồ sơ trước'); return; }
    App.commit();
    const body = U.h('div', { class: 'rp' }, U.h('div', { class: 'muted', text: 'Đang quét hồ sơ…' }));
    const d = Dialog.open({ title: 'Báo cáo tổng hợp — ' + S.rootName, body, cls: 'rp-dlg' });
    const R = await collect((i, n) => { body.firstChild.textContent = 'Đang quét hồ sơ ' + i + '/' + n + '…'; });
    App.refreshSidebar();
    body.textContent = '';
    renderReport(body, R, d);
  }

  function card(v, l, s) {
    return U.h('div', { class: 'rp-card' }, U.h('div', { class: 'v', text: v }), U.h('div', { class: 'l', text: l }), s ? U.h('div', { class: 's', text: s }) : null);
  }

  function renderReport(body, R, dlg) {
    const T = R.T;
    body.append(U.h('div', { class: 'rp-cards' },
      card(String(T.docs), 'Số hồ sơ', T.problem ? T.problem + ' hồ sơ thiếu/lỗi JSON' : ''),
      card(String(T.saved), 'Đã duyệt (đã lưu)', T.dirty ? '+' + T.dirty + ' đang sửa chưa lưu' : ''),
      card(String(T.total), 'Tổng số trường', T.correct + ' đúng · ' + T.wrong + ' sai · ' + T.unreviewed + ' chưa duyệt'),
      card(U.pct(T.accuracy, 2), 'Độ chính xác', 'Đúng / (Đúng + Sai)'),
      card(T.cer == null ? '—' : U.pct(T.cer, 2), 'CER', 'Levenshtein / độ dài giá trị đúng')));

    const seg = U.h('div', { class: 'seg' }, U.h('button', { class: 'on', dataset: { v: 'fields' }, text: 'Theo trường (' + R.fields.length + ')' }), U.h('button', { dataset: { v: 'docs' }, text: 'Theo hồ sơ (' + R.docs.length + ')' }));
    const stamp = U.isoLocal().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const base = 'bao_cao_' + S.rootName.replace(/[^\w\-]+/g, '_') + '_' + stamp;
    const tools = U.h('div', { class: 'rp-tools' }, seg, U.h('span', { class: 'spacer' }),
      U.h('button', { html: U.icon('download') + ' CSV chi tiết từng trường', id: 'csv-detail', onclick: () => exportDetail(R, base) }),
      U.h('button', { html: U.icon('download') + ' CSV theo trường', id: 'csv-fields', onclick: () => exportFields(R, base) }),
      U.h('button', { html: U.icon('download') + ' CSV theo hồ sơ', id: 'csv-docs', onclick: () => exportDocs(R, base) }));
    const wrap = U.h('div', { class: 'rp-scroll' });
    body.append(tools, wrap);
    const show = (v) => {
      U.$$('button', seg).forEach((b) => b.classList.toggle('on', b.dataset.v === v));
      wrap.textContent = '';
      wrap.append(v === 'fields' ? fieldTable(R) : docTable(R, dlg));
    };
    seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.v); });
    show('fields');
  }

  function bar(c, w, n) {
    const tot = c + w + n || 1;
    return U.h('div', { class: 'bar', title: w + ' sai / ' + c + ' đúng / ' + n + ' chưa duyệt' },
      U.h('i', { class: 'b-bad', style: { width: (w / tot) * 100 + '%' } }),
      U.h('i', { class: 'b-ok', style: { width: (c / tot) * 100 + '%' } }));
  }

  function fieldTable(R) {
    const t = U.h('table', { class: 'grid' });
    t.append(U.h('thead', null, U.h('tr', null, ['Trường', 'Đúng', 'Sai', 'Chưa duyệt', 'Độ chính xác', 'CER', 'Tỉ lệ sai'].map((x, i) => U.h('th', { class: i && i < 6 ? 'n' : '', text: x })))));
    const tb = U.h('tbody');
    for (const f of R.fields) {
      tb.append(U.h('tr', null,
        U.h('td', null, U.h('div', { text: f.label }), U.h('code', { class: 'k', text: f.path })),
        U.h('td', { class: 'n', text: f.correct }), U.h('td', { class: 'n', text: f.wrong, style: f.wrong ? { color: 'var(--bad)', fontWeight: 600 } : null }),
        U.h('td', { class: 'n', text: f.unreviewed }), U.h('td', { class: 'n', text: U.pct(f.accuracy) }),
        U.h('td', { class: 'n', text: f.cer == null ? '—' : U.pct(f.cer, 2) }),
        U.h('td', null, U.h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, bar(f.correct, f.wrong, f.unreviewed), U.h('span', { class: 'muted', text: U.pct(f.wrongRate) })))));
    }
    if (!R.fields.length) tb.append(U.h('tr', null, U.h('td', { colspan: 7, class: 'muted', text: 'Không có dữ liệu.' })));
    t.append(tb);
    return t;
  }

  function docTable(R, dlg) {
    const t = U.h('table', { class: 'grid' });
    t.append(U.h('thead', null, U.h('tr', null, ['Hồ sơ', 'Trạng thái', 'Tổng', 'Đúng', 'Sai', 'Chưa duyệt', 'Độ chính xác', 'CER', 'Người duyệt'].map((x, i) => U.h('th', { class: i >= 2 && i <= 7 ? 'n' : '', text: x })))));
    const tb = U.h('tbody');
    for (const r of R.docs) {
      const s = r.stats || {};
      const tr = U.h('tr', { class: 'clickable', title: 'Mở hồ sơ này' },
        U.h('td', null, r.name, r.warnings.length ? U.h('span', { class: 'badge b-warn', style: { marginLeft: '6px' }, title: r.warnings.join('\n'), text: '⚠ ' + r.warnings.length }) : null),
        U.h('td', { text: DOC_ST[r.st] }),
        U.h('td', { class: 'n', text: s.total != null ? s.total : '—' }), U.h('td', { class: 'n', text: s.correct != null ? s.correct : '—' }),
        U.h('td', { class: 'n', text: s.wrong != null ? s.wrong : '—', style: s.wrong ? { color: 'var(--bad)', fontWeight: 600 } : null }),
        U.h('td', { class: 'n', text: s.unreviewed != null ? s.unreviewed : '—' }),
        U.h('td', { class: 'n', text: U.pct(s.accuracy) }), U.h('td', { class: 'n', text: s.cer == null ? '—' : U.pct(s.cer, 2) }),
        U.h('td', { text: r.reviewer }));
      tr.addEventListener('click', () => { dlg.close(); App.select(r.doc); });
      tb.append(tr);
    }
    t.append(tb);
    return t;
  }

  /* ---------- CSV ---------- */
  function exportDetail(R, base) {
    const rows = [['Thư mục', 'Path', 'Nhãn', 'Trạng thái', 'Giá trị gốc (OCR)', 'Giá trị đúng', 'Loại thay đổi']].concat(R.details);
    U.download(base + '_chi_tiet_truong.csv', U.toCsv(rows), 'text/csv');
  }
  function exportFields(R, base) {
    const rows = [['Path', 'Nhãn', 'Tổng', 'Đúng', 'Sai', 'Chưa duyệt', 'Độ chính xác', 'CER']];
    for (const f of R.fields) rows.push([f.path, f.label, f.correct + f.wrong + f.unreviewed, f.correct, f.wrong, f.unreviewed, U.round(f.accuracy), U.round(f.cer)]);
    U.download(base + '_theo_truong.csv', U.toCsv(rows), 'text/csv');
  }
  function exportDocs(R, base) {
    const rows = [['Thư mục', 'Trạng thái', 'Tổng trường', 'Đúng', 'Sai', 'Chưa duyệt', 'Độ chính xác', 'CER', 'Người duyệt', 'Thời điểm duyệt', 'Ghi chú', 'Cảnh báo']];
    for (const r of R.docs) {
      const s = r.stats || {};
      rows.push([r.name, DOC_ST[r.st], s.total, s.correct, s.wrong, s.unreviewed, U.round(s.accuracy), U.round(s.cer), r.reviewer, r.at, r.note, r.warnings.join('; ')]);
    }
    U.download(base + '_theo_ho_so.csv', U.toCsv(rows), 'text/csv');
  }

  return { open, collect };
})();
