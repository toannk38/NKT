/* =====================================================================
 * viewer — xem ảnh / PDF (pdf.js): zoom, fit, pan, xoay, phân trang,
 * render lười bằng IntersectionObserver, re-render nét theo devicePixelRatio
 * ===================================================================== */
const Viewer = (() => {
  const MAX_PIXELS = 16777216;   // giới hạn ~16M pixel / canvas
  const ZMIN = 0.05, ZMAX = 8, PAD = 12;
  let scrollEl, contentEl, zoomInput, pagerEl, pageLabel, fileLabel;
  let kind = null, pdf = null, loadingTask = null, pages = [];
  let zoom = 1, rot = 0, fit = Prefs.get('fit') || null, curPage = 0;
  let token = 0, objectUrl = null, io = null, pan = null, destroying = Promise.resolve();

  /** Tạo worker pdf.js từ <script type="text/js-worker"> nhúng trong trang */
  function setupPdfWorker() {
    if (!window.pdfjsLib) return false;
    const src = document.getElementById('pdf-worker');
    if (src && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      const blob = new Blob([src.textContent], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      pdfjsLib.GlobalWorkerOptions.workerSrc = url;
      // Trên file:// origin là "null" nên pdf.js coi workerSrc là khác origin và bọc bằng
      // importScripts (thất bại → "fake worker" chạy trên luồng chính). Tạo sẵn Worker từ
      // chính Blob URL đó và giao qua workerPort để pdf.js chạy trong luồng riêng.
      try { pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(url); } catch (e) { /* dùng workerSrc */ }
    }
    return true;
  }

  function init() {
    scrollEl = U.$('#vscroll'); contentEl = U.$('#vcontent');
    zoomInput = U.$('#v-zoom'); pagerEl = U.$('#v-pager'); pageLabel = U.$('#v-page'); fileLabel = U.$('#v-file');
    setupPdfWorker();

    U.$('#v-zoom-in').onclick = () => setZoom(zoom * 1.2);
    U.$('#v-zoom-out').onclick = () => setZoom(zoom / 1.2);
    U.$('#v-fit-width').onclick = () => setFit('width');
    U.$('#v-fit-page').onclick = () => setFit('page');
    U.$('#v-100').onclick = () => setZoom(1);
    U.$('#v-rotate').onclick = rotate;
    U.$('#v-prev').onclick = () => goPage(curPage - 1);
    U.$('#v-next').onclick = () => goPage(curPage + 1);
    const applyInput = () => {
      const v = parseFloat(String(zoomInput.value).replace(',', '.'));
      if (isFinite(v) && v > 0) setZoom(v / 100); else updateUI();
    };
    zoomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyInput(); zoomInput.select(); } });
    zoomInput.addEventListener('change', applyInput);
    zoomInput.addEventListener('focus', () => zoomInput.select());

    // Ctrl + wheel / pinch trackpad: zoom quanh con trỏ
    scrollEl.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = scrollEl.getBoundingClientRect();
      const k = e.deltaMode === 1 ? 0.05 : 0.0025;
      setZoom(zoom * Math.exp(-e.deltaY * k), { x: e.clientX - r.left, y: e.clientY - r.top });
    }, { passive: false });

    // Kéo chuột để pan
    scrollEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.pointerType === 'touch' || !pages.length) return;
      const r = scrollEl.getBoundingClientRect();
      if (e.clientX - r.left >= scrollEl.clientWidth || e.clientY - r.top >= scrollEl.clientHeight) return; // thanh cuộn
      pan = { x: e.clientX, y: e.clientY, sl: scrollEl.scrollLeft, st: scrollEl.scrollTop, id: e.pointerId };
      scrollEl.setPointerCapture(e.pointerId);
      scrollEl.classList.add('panning');
      scrollEl.focus({ preventScroll: true });
      e.preventDefault();
    });
    scrollEl.addEventListener('pointermove', (e) => {
      if (!pan || e.pointerId !== pan.id) return;
      scrollEl.scrollLeft = pan.sl - (e.clientX - pan.x);
      scrollEl.scrollTop = pan.st - (e.clientY - pan.y);
    });
    const endPan = (e) => {
      if (!pan || e.pointerId !== pan.id) return;
      pan = null;
      scrollEl.classList.remove('panning');
      try { scrollEl.releasePointerCapture(e.pointerId); } catch (err) { /* bỏ qua */ }
    };
    scrollEl.addEventListener('pointerup', endPan);
    scrollEl.addEventListener('pointercancel', endPan);
    scrollEl.addEventListener('scroll', U.rafThrottle(updateCurPage), { passive: true });

    // Panel đổi kích thước → fit lại
    const refit = U.rafThrottle(() => { if (fit && pages.length) applyFit(false); });
    new ResizeObserver(refit).observe(scrollEl);
    updateUI();
  }

  /* ---------- Nạp tài liệu ---------- */
  function clear() {
    if (io) { io.disconnect(); io = null; }
    for (const p of pages) if (p.task) { try { p.task.cancel(); } catch (e) { /* bỏ qua */ } }
    pages = [];
    // Ghi nhớ promise huỷ: phải chờ xong trước khi mở PDF mới trên cùng worker
    const ds = [];
    if (loadingTask) { try { ds.push(loadingTask.destroy()); } catch (e) { /* bỏ qua */ } loadingTask = null; }
    if (pdf) { try { ds.push(pdf.destroy()); } catch (e) { /* bỏ qua */ } pdf = null; }
    if (ds.length) destroying = Promise.all(ds.map((p) => Promise.resolve(p).catch(() => {})));
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    kind = null; curPage = 0;
    contentEl.textContent = '';
    pagerEl.hidden = true;
  }

  function message(title, text) {
    contentEl.innerHTML = '<div class="vmsg"><b>' + U.esc(title) + '</b>' + U.esc(text || '') + '</div>';
    pagerEl.hidden = true;
  }

  async function load(doc) {
    const t = ++token;
    clear();
    rot = 0;
    const ref = doc && doc.files.doc;
    fileLabel.textContent = ref ? ref.name : '';
    fileLabel.title = ref ? ref.name : '';
    if (!ref) { message('Không có file tài liệu', 'Hồ sơ này thiếu file PDF hoặc ảnh.'); return; }
    if (FS.isTiff(ref.name)) {
      message('Định dạng TIFF chưa hỗ trợ hiển thị', ref.name + '\nVui lòng chuyển sang PDF hoặc PNG/JPG để xem. Vẫn có thể duyệt JSON bình thường.');
      return;
    }
    message('Đang tải tài liệu…', ref.name);
    try {
      const file = await FS.getFile(ref);
      if (t !== token) return;
      if (FS.isPdf(ref.name)) await loadPdf(file, t);
      else await loadImage(file, t);
    } catch (e) {
      if (t !== token) return;
      console.error(e);
      clear();
      message('Không mở được tài liệu', ref.name + '\n' + (e && e.message || e));
    }
  }

  async function loadPdf(file, t) {
    if (!window.pdfjsLib) throw new Error('Thiếu thư viện pdf.js trong bản build');
    const data = new Uint8Array(await file.arrayBuffer());
    await destroying;
    if (t !== token) return;
    // isEvalSupported: false — vá lỗ hổng CVE-2024-4367
    loadingTask = pdfjsLib.getDocument({ data, isEvalSupported: false, enableXfa: false, useSystemFonts: true });
    const doc = await loadingTask.promise;
    if (t !== token) { doc.destroy(); return; }
    pdf = doc; loadingTask = null;
    const list = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      if (t !== token) return;
      const vp = pg.getViewport({ scale: 1 });
      list.push({ proxy: pg, w: vp.width, h: vp.height });
    }
    kind = 'pdf';
    build(list);
  }

  async function loadImage(file, t) {
    objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.draggable = false;
    img.alt = file.name;
    img.src = objectUrl;
    try { await img.decode(); } catch (e) { throw new Error('Không giải mã được ảnh (file hỏng hoặc định dạng không hỗ trợ)'); }
    if (t !== token) return;
    kind = 'image';
    build([{ img, w: img.naturalWidth, h: img.naturalHeight }]);
  }

  function build(list) {
    contentEl.textContent = '';
    pages = list;
    pages.forEach((p, i) => {
      p.el = U.h('div', { class: 'vpage', dataset: { i } });
      if (p.img) p.el.append(p.img);
      if (kind === 'pdf' && pages.length > 1) p.el.append(U.h('span', { class: 'pnum', text: (i + 1) + '/' + pages.length }));
      contentEl.append(p.el);
    });
    pagerEl.hidden = kind !== 'pdf';
    if (kind === 'pdf') {
      io = new IntersectionObserver(onIntersect, { root: scrollEl, rootMargin: '150% 0px' });
      pages.forEach((p) => io.observe(p.el));
    }
    if (fit) applyFit(true); else { layout(); scrollEl.scrollTop = 0; }
    updateUI();
  }

  /* ---------- Render PDF ---------- */
  function onIntersect(entries) {
    for (const e of entries) {
      const p = pages[+e.target.dataset.i];
      if (!p) continue;
      p.visible = e.isIntersecting;
      if (p.visible) renderPage(p);
      else releasePage(p);
    }
  }
  function releasePage(p) {
    if (p.task) { try { p.task.cancel(); } catch (e) { /* bỏ qua */ } p.task = null; p.pendingKey = null; }
    if (p.canvas) { p.canvas.width = 0; p.canvas.height = 0; p.canvas.remove(); p.canvas = null; p.renderedKey = null; }
  }
  async function renderPage(p) {
    if (kind !== 'pdf' || !p.proxy) return;
    const dpr = window.devicePixelRatio || 1;
    const rotation = (p.proxy.rotate + rot) % 360;
    let scale = zoom * dpr;
    let vp = p.proxy.getViewport({ scale, rotation });
    const px = vp.width * vp.height;
    if (px > MAX_PIXELS) { scale *= Math.sqrt(MAX_PIXELS / px); vp = p.proxy.getViewport({ scale, rotation }); }
    const key = scale.toFixed(4) + '|' + rotation;
    if (p.renderedKey === key || p.pendingKey === key) return;
    if (p.task) { try { p.task.cancel(); } catch (e) { /* bỏ qua */ } }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    const task = p.proxy.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: vp });
    p.task = task; p.pendingKey = key;
    try { await task.promise; } catch (e) {
      if (p.task === task) { p.task = null; p.pendingKey = null; }
      return; // bị huỷ
    }
    if (p.task !== task) return;
    p.task = null; p.pendingKey = null;
    if (!pages.includes(p)) return;
    if (p.canvas) { p.canvas.width = 0; p.canvas.remove(); }
    p.canvas = canvas;
    p.renderedKey = key;
    p.el.prepend(canvas);
  }
  // Trong lúc chờ render lại: canvas cũ được kéo giãn bằng CSS (100% kích thước trang)
  const rerender = U.debounce(() => { for (const p of pages) if (p.visible) renderPage(p); }, 160);

  /* ---------- Bố cục / zoom ---------- */
  const dims = (p) => (rot % 180 ? [p.h, p.w] : [p.w, p.h]);
  function layout() {
    for (const p of pages) {
      const [w, h] = dims(p);
      p.el.style.width = Math.round(w * zoom) + 'px';
      p.el.style.height = Math.round(h * zoom) + 'px';
      if (p.img) {
        p.img.style.width = p.w * zoom + 'px';
        p.img.style.height = p.h * zoom + 'px';
        p.img.style.transform = 'translate(-50%, -50%) rotate(' + rot + 'deg)';
      }
    }
  }
  function fitZoom(mode) {
    const aw = scrollEl.clientWidth - 2 * PAD - 1, ah = scrollEl.clientHeight - 2 * PAD - 1;
    if (!pages.length || aw <= 0) return zoom;
    if (mode === 'width') return aw / Math.max(...pages.map((p) => dims(p)[0]));
    const [w, h] = dims(pages[curPage] || pages[0]);
    return Math.min(aw / w, ah / h);
  }
  function applyFit(resetScroll) {
    if (!fit || !pages.length) return;
    const page = curPage;
    zoom = U.clamp(fitZoom(fit), ZMIN, ZMAX);
    layout();
    if (resetScroll) scrollEl.scrollTop = 0;
    else if (fit === 'page' && pages[page]) scrollEl.scrollTop = pages[page].el.offsetTop - PAD;
    scrollEl.scrollLeft = 0;
    rerender();
    updateUI();
  }
  function setFit(mode) {
    fit = mode;
    Prefs.set('fit', mode);
    if (mode) applyFit(false);
    updateUI();
  }

  /** Đổi zoom, giữ nguyên điểm dưới con trỏ (anchor toạ độ trong khung cuộn) */
  function setZoom(nz, anchor) {
    nz = U.clamp(nz, ZMIN, ZMAX);
    fit = null; Prefs.set('fit', null);
    if (!pages.length) { zoom = nz; updateUI(); return; }
    const a = anchor || { x: scrollEl.clientWidth / 2, y: scrollEl.clientHeight / 2 };
    const sx = scrollEl.scrollLeft + a.x, sy = scrollEl.scrollTop + a.y;
    let p = pages[0];
    for (const q of pages) { if (q.el.offsetTop <= sy) p = q; else break; }
    const fx = (sx - p.el.offsetLeft) / p.el.offsetWidth, fy = (sy - p.el.offsetTop) / p.el.offsetHeight;
    zoom = nz;
    layout();
    scrollEl.scrollLeft = p.el.offsetLeft + fx * p.el.offsetWidth - a.x;
    scrollEl.scrollTop = p.el.offsetTop + fy * p.el.offsetHeight - a.y;
    rerender();
    updateUI();
  }

  function rotate() {
    rot = (rot + 90) % 360;
    for (const p of pages) if (p.canvas) { p.canvas.width = 0; p.canvas.remove(); p.canvas = null; p.renderedKey = null; }
    if (fit) applyFit(false); else layout();
    rerender.flush();
    updateUI();
  }

  function updateCurPage() {
    if (!pages.length) return;
    const mid = scrollEl.scrollTop + scrollEl.clientHeight * 0.35;
    let idx = 0;
    for (let i = 0; i < pages.length; i++) { if (pages[i].el.offsetTop <= mid) idx = i; else break; }
    if (idx !== curPage) { curPage = idx; updateUI(); }
  }
  function goPage(i) {
    if (!pages.length) return;
    curPage = U.clamp(i, 0, pages.length - 1);
    scrollEl.scrollTop = pages[curPage].el.offsetTop - PAD;
    updateUI();
  }

  function updateUI() {
    if (document.activeElement !== zoomInput) zoomInput.value = Math.round(zoom * 100) + '%';
    U.$('#v-fit-width').classList.toggle('on', fit === 'width');
    U.$('#v-fit-page').classList.toggle('on', fit === 'page');
    U.$('#v-fit-width').classList.toggle('primary', fit === 'width');
    U.$('#v-fit-page').classList.toggle('primary', fit === 'page');
    if (kind === 'pdf') {
      pageLabel.textContent = 'Trang ' + (curPage + 1) + ' / ' + pages.length;
      U.$('#v-prev').disabled = curPage <= 0;
      U.$('#v-next').disabled = curPage >= pages.length - 1;
    }
  }

  return {
    init, load, clear,
    zoomIn: () => setZoom(zoom * 1.2), zoomOut: () => setZoom(zoom / 1.2),
    fitWidth: () => setFit('width'), fitPage: () => setFit('page'),
    state: () => ({ zoom, fit, rot, kind, pages: pages.length, curPage, rendered: pages.filter((p) => p.canvas).length })
  };
})();
