'use strict';
/*
 * Test Playwright (Chromium) cho ocr-review.
 *   npm test          (build + chạy toàn bộ)
 *   node --test tests/
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');

let browser;
before(async () => { browser = await H.chromium.launch(); });
after(async () => { await browser.close(); fs.rmSync(H.TMP, { recursive: true, force: true }); });

async function setup(opts = {}) {
  const app = await H.openApp(Object.assign({ browser }, opts));
  const data = H.freshData(opts.data || 'test-data');
  await H.loadFolder(app.page, data);
  return Object.assign(app, { data });
}
const statText = (page) => page.textContent('#statsbar');
// Mỗi test tối đa 90 giây
const T = (name, fn) => test(name, { timeout: 90000 }, fn);

describe('Nạp thư mục (chế độ fallback input)', () => {
  T('liệt kê hồ sơ theo natural sort, cảnh báo thiếu/thừa file, banner chỉ đọc', async () => {
    const { page, errors, close } = await setup();
    const names = await page.$$eval('.doc-item .di-name', (els) => els.map((e) => e.textContent));
    assert.deepEqual(names, ['hs1_gpkd_anh', 'hs2_gpkd_pdf', 'hs3_thieu_file', 'hs4_json_loi', 'hs5_cccd_anh', 'hs6_tiff', 'hs7_thua_file', 'hs8_da_duyet', 'hs10_gpkd_20_trang']);
    assert.match(await page.textContent('.doc-item:has-text("hs3_thieu_file")'), /Thiếu file tài liệu/);
    assert.match(await page.textContent('.doc-item:has-text("hs7_thua_file")'), /Thừa file JSON/);
    assert.match(await page.textContent('.doc-item:has-text("hs4_json_loi")'), /JSON lỗi/);
    assert.match(await page.textContent('.doc-item:has-text("hs8_da_duyet")'), /Đã lưu/);
    assert.ok(await page.isVisible('#banner'));
    assert.match(await page.textContent('#banner'), /Chế độ chỉ đọc/);
    // hồ sơ đầu tiên tự mở, ảnh hiển thị
    await page.waitForSelector('.vpage img');
    assert.deepEqual(errors, []);
    await close();
  });

  T('thư mục gốc chứa trực tiếp ảnh + json được coi là 1 hồ sơ', async () => {
    const { page, close } = await setup({ data: 'test-data-single' });
    const names = await page.$$eval('.doc-item .di-name', (els) => els.map((e) => e.textContent));
    assert.equal(names.length, 1);
    assert.match(names[0], /test-data-single/);
    await close();
  });

  T('TIFF hiện thông báo chưa hỗ trợ, không crash', async () => {
    const { page, errors, close } = await setup();
    await H.selectDoc(page, 'hs6_tiff');
    await page.waitForSelector('.vmsg');
    assert.match(await page.textContent('.vmsg'), /TIFF chưa hỗ trợ hiển thị/);
    assert.ok(await page.isVisible(H.leaf('ma_so_doanh_nghiep')));
    assert.deepEqual(errors, []);
    await close();
  });

  T('sidebar: tìm kiếm & lọc', async () => {
    const { page, close } = await setup();
    await page.fill('#sb-search', 'cccd');
    await page.waitForFunction(() => document.querySelectorAll('.doc-item').length === 1);
    await page.fill('#sb-search', '');
    await page.click('#sb-filter button[data-v="saved"]');
    await page.waitForFunction(() => document.querySelectorAll('.doc-item').length === 1);
    assert.match(await page.textContent('.doc-item'), /hs8_da_duyet/);
    await page.click('#sb-filter button[data-v="wrong"]');
    assert.equal(await page.$$eval('.doc-item', (e) => e.length), 1);
    await close();
  });
});

describe('Form: sửa trường, diff, trạng thái', () => {
  T('sửa trường → tô vàng, hiện "Gốc" với diff ký tự, tự đánh dấu Sai; sửa về gốc → bỏ', async () => {
    const { page, close } = await setup();
    const ps = 'thanh_vien[0].ho_ten';
    const ta = H.leaf(ps) + ' textarea';
    assert.equal(await page.inputValue(ta), 'DOÀN THỊ MỸ TÌNH');
    await page.fill(ta, 'ĐOÀN THỊ MỸ TÌNH');
    const row = H.leaf(ps);
    assert.ok(await page.$eval(row, (r) => r.classList.contains('modified') && r.classList.contains('st-wrong')));
    assert.equal(await page.textContent(row + ' .lf-orig del'), 'D');
    assert.equal(await page.textContent(row + ' .lf-orig ins'), 'Đ');
    await page.waitForFunction(() => /Sai: 1/.test(document.querySelector('#statsbar').textContent));
    // CER > 0
    assert.match(await statText(page), /CER: [\d,]+%/);
    // tab Đối chiếu
    await page.click('.tab[data-tab="diff"]');
    await page.waitForSelector('.chg');
    assert.match(await page.textContent('.chg-list'), /thanh_vien\[0\]\.ho_ten/);
    assert.equal(await page.textContent('.chg .chg-type'), 'Sửa');
    await page.click('.seg button[data-v="side"]');
    await page.waitForSelector('.side-row .lc.del');
    assert.match(await page.textContent('.side-row .lc.del'), /DOÀN/);
    assert.match(await page.textContent('.side-row .lc.ins'), /ĐOÀN/);
    // hoàn tác từ danh sách thay đổi
    await page.click('.seg button[data-v="list"]');
    await page.click('.chg [data-act="undo"]');
    await page.click('.tab[data-tab="form"]');
    assert.equal(await page.inputValue(ta), 'DOÀN THỊ MỸ TÌNH');
    // sửa rồi sửa về đúng gốc → trạng thái tự đặt bị bỏ
    await page.fill(ta, 'X');
    await page.fill(ta, 'DOÀN THỊ MỸ TÌNH');
    assert.ok(await page.$eval(row, (r) => !r.classList.contains('modified') && !r.classList.contains('st-wrong')));
    await close();
  });

  T('đánh dấu Đúng/Sai, Đúng cho mọi trường chưa duyệt, thống kê', async () => {
    const { page, close } = await setup();
    const row = H.leaf('ma_so_doanh_nghiep');
    await page.click(row + ' .b-ok');
    assert.ok(await page.$eval(row, (r) => r.classList.contains('st-correct')));
    await page.waitForFunction(() => /Đúng: 1/.test(document.querySelector('#statsbar').textContent));
    await page.click(row + ' .b-bad');
    assert.ok(await page.$eval(row, (r) => r.classList.contains('st-wrong')));
    await page.click(row + ' .b-bad');   // bấm lại → bỏ đánh dấu
    assert.ok(await page.$eval(row, (r) => !r.classList.contains('st-wrong') && !r.classList.contains('st-correct')));
    await page.click('#btn-mark-all');
    await page.waitForFunction(() => /Chưa duyệt: 0/.test(document.querySelector('#statsbar').textContent));
    assert.match(await statText(page), /Độ chính xác: 100,0%/);
    // lọc chỉ hiện "Sai"
    await page.fill(H.leaf('tru_so_chinh.dien_thoai') + ' textarea', '0257 3823 456');
    await page.click('.form-tools .seg button[data-v="wrong"]');
    const visible = await page.$$eval('.leaf:not(.hidden)', (e) => e.map((x) => x.dataset.ps));
    assert.deepEqual(visible, ['tru_so_chinh.dien_thoai']);
    await close();
  });

  T('giữ kiểu dữ liệu number/boolean/null', async () => {
    const { page, close } = await setup();
    await H.selectDoc(page, 'hs5_cccd_anh');
    await page.fill(H.leaf('do_tin_cay') + ' textarea', '0.95');
    await page.fill(H.leaf('anh_chan_dung') + ' textarea', 'false');
    await page.fill(H.leaf('mat_sau') + ' textarea', 'không có');
    const d = await page.evaluate(() => window.__ocrReview.S.cur.data);
    assert.equal(d.do_tin_cay, 0.95);
    assert.equal(d.anh_chan_dung, false);
    assert.equal(d.mat_sau, 'không có');
    await page.fill(H.leaf('mat_sau') + ' textarea', '');
    assert.equal(await page.evaluate(() => window.__ocrReview.S.cur.data.mat_sau), null);
    await close();
  });

  T('Enter sang ô kế tiếp, Shift+Enter xuống dòng', async () => {
    const { page, close } = await setup();
    await page.click(H.leaf('ma_so_doanh_nghiep') + ' textarea');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.closest('.leaf').dataset.ps), 'ten_cong_ty.tieng_viet');
    await page.keyboard.press('Shift+Enter');
    assert.match(await page.inputValue(H.leaf('ten_cong_ty.tieng_viet') + ' textarea'), /\n$/);
    await close();
  });
});

describe('Undo / Redo & cấu trúc', () => {
  T('Ctrl+Z / Ctrl+Y khi focus ngoài ô nhập', async () => {
    const { page, close } = await setup();
    const ta = H.leaf('tru_so_chinh.dia_chi') + ' textarea';
    const orig = await page.inputValue(ta);
    await page.fill(ta, orig.replace('Công Trí', 'Công Trỗi'));
    await page.click('#statsbar');        // blur → change → ghi lịch sử
    await page.keyboard.press('Control+z');
    assert.equal(await page.inputValue(ta), orig);
    await page.keyboard.press('Control+y');
    assert.match(await page.inputValue(ta), /Công Trỗi/);
    await close();
  });

  T('xoá phần tử mảng: remap trạng thái, diff "Xoá", undo khôi phục', async () => {
    const { page, close } = await setup();
    await page.click(H.leaf('thanh_vien[1].ho_ten') + ' .b-ok');
    await page.click('.card[data-ps="thanh_vien[0]"] > .card-h [data-act="del"]');
    const row = H.leaf('thanh_vien[0].ho_ten');
    assert.equal(await page.inputValue(row + ' textarea'), 'NGUYỄN VĂN HẢI');
    assert.ok(await page.$eval(row, (r) => r.classList.contains('st-correct')));
    assert.ok(await page.$eval(row, (r) => !r.classList.contains('modified')));
    assert.equal(await page.$$eval('.card[data-ps^="thanh_vien["]', (e) => e.length), 1);
    // trường bị xoá tính là Sai
    await page.click('.tab[data-tab="diff"]');
    await page.waitForSelector('.chg');
    const types = await page.$$eval('.chg-type', (e) => e.map((x) => x.textContent));
    assert.ok(types.every((t) => t === 'Xoá'));
    assert.ok(types.length >= 10);
    await page.click('.tab[data-tab="form"]');
    await page.click('#statsbar');
    await page.keyboard.press('Control+z');
    assert.equal(await page.inputValue(row + ' textarea'), 'DOÀN THỊ MỸ TÌNH');
    assert.ok(await page.$eval(H.leaf('thanh_vien[1].ho_ten'), (r) => r.classList.contains('st-correct')));
    await close();
  });

  T('thêm phần tử (clone cấu trúc rỗng) và thêm trường', async () => {
    const { page, close } = await setup();
    await page.click('.card[data-ps="nguoi_dai_dien_theo_phap_luat"] > .card-h [data-act="add-item"]');
    const v = await page.inputValue(H.leaf('nguoi_dai_dien_theo_phap_luat[1].ho_ten') + ' textarea');
    assert.equal(v, '');
    await page.fill(H.leaf('nguoi_dai_dien_theo_phap_luat[1].ho_ten') + ' textarea', 'NGUYỄN VĂN HẢI');
    assert.ok(await page.$eval(H.leaf('nguoi_dai_dien_theo_phap_luat[1].ho_ten'), (r) => r.classList.contains('st-wrong')));
    // thêm trường mới vào object
    await page.click('.card[data-ps="von_dieu_le"] > .card-h [data-act="add-field"]');
    await page.fill('dialog input', 'bang_chu');
    await page.keyboard.press('Enter');
    await page.waitForSelector(H.leaf('von_dieu_le.bang_chu'));
    await page.click('.tab[data-tab="diff"]');
    await page.waitForSelector('.chg');
    assert.match(await page.textContent('.chg-list'), /Thêm/);
    await close();
  });
});

describe('Raw', () => {
  T('JSON gốc lỗi: mở tab Raw để sửa, báo lỗi dòng/cột, Áp dụng', async () => {
    const { page, close } = await setup();
    await H.selectDoc(page, 'hs4_json_loi');
    assert.match(await page.textContent('#tab-form'), /JSON gốc lỗi cú pháp/);
    await page.click('.tab[data-tab="raw"]');
    await page.waitForSelector('#tab-raw .raw-err');
    assert.match(await page.textContent('#tab-raw .raw-err'), /dòng 7, cột 3/);
    let text = await page.inputValue('#tab-raw textarea');
    text = text.replace('"MINH TAM PY CO., LTD",', '"MINH TAM PY CO., LTD"');
    await page.fill('#tab-raw textarea', text);
    await page.click('#tab-raw button:has-text("Áp dụng")');
    assert.match(await page.textContent('#tab-raw .raw-err'), /dòng \d+, cột \d+/);   // còn lỗi thứ 2
    text = text.replace('"dan_toc": "Kinh"\n      "loai_giay_to"', '"dan_toc": "Kinh",\n      "loai_giay_to"');
    await page.fill('#tab-raw textarea', text);
    await page.click('#tab-raw button:has-text("Áp dụng")');
    await page.waitForSelector('#tab-raw .code-view');
    await page.click('.tab[data-tab="form"]');
    await page.waitForSelector(H.leaf('ma_so_doanh_nghiep'));
    await close();
  });

  T('xem raw có số dòng & tô màu, sửa raw áp dụng vào dữ liệu', async () => {
    const { page, close } = await setup();
    await page.click('.tab[data-tab="raw"]');
    await page.waitForSelector('#tab-raw .j-key');
    assert.equal(await page.textContent('#tab-raw .cl .ln'), '1');
    await page.click('#tab-raw button:has-text("Sửa raw")');
    const t = await page.inputValue('#tab-raw textarea');
    await page.fill('#tab-raw textarea', t.replace('"4400999827"', '"4400999828"'));
    await page.click('#tab-raw button:has-text("Áp dụng")');
    await page.click('.tab[data-tab="form"]');
    assert.ok(await page.$eval(H.leaf('ma_so_doanh_nghiep'), (r) => r.classList.contains('st-wrong')));
    await close();
  });
});

describe('Lưu kết quả', () => {
  T('nhắc nhập tên người duyệt, Ctrl+S tải file <folder>__<tên>.reviewed.json đúng cấu trúc', async () => {
    const { page, close } = await setup();
    await page.fill(H.leaf('thanh_vien[0].ho_ten') + ' textarea', 'ĐOÀN THỊ MỸ TÌNH');
    await page.click(H.leaf('ma_so_doanh_nghiep') + ' .b-ok');
    await page.fill('#doc-note', 'Ảnh hơi mờ');
    await page.click('#statsbar');
    await page.keyboard.press('Control+s');
    await page.waitForSelector('dialog input');
    const dl = await H.download(page, async () => { await page.fill('dialog input', 'Nguyễn Kiểm Tra'); await page.keyboard.press('Enter'); });
    assert.equal(dl.name, 'hs1_gpkd_anh__giay_dkdn.reviewed.json');
    const out = JSON.parse(dl.text);
    assert.equal(out.data.thanh_vien[0].ho_ten, 'ĐOÀN THỊ MỸ TÌNH');
    assert.equal(out.data.thanh_vien[1].ho_ten, 'NGUYỄN VĂN HẢI');
    const r = out.review;
    assert.equal(r.tool, 'ocr-review v1');
    assert.equal(r.folder, 'hs1_gpkd_anh');
    assert.equal(r.source_json, 'giay_dkdn.json');
    assert.equal(r.source_file, 'giay_dkdn.png');
    assert.equal(r.reviewer, 'Nguyễn Kiểm Tra');
    assert.match(r.reviewed_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
    assert.equal(r.field_status['thanh_vien[0].ho_ten'], 'wrong');
    assert.equal(r.field_status.ma_so_doanh_nghiep, 'correct');
    assert.deepEqual(r.changes, [{ path: 'thanh_vien[0].ho_ten', type: 'modified', original: 'DOÀN THỊ MỸ TÌNH', updated: 'ĐOÀN THỊ MỸ TÌNH' }]);
    assert.equal(r.summary.total_fields, 50);
    assert.equal(r.summary.correct, 1);
    assert.equal(r.summary.wrong, 1);
    assert.equal(r.summary.unreviewed, 48);
    assert.equal(r.summary.accuracy, 0.5);
    assert.ok(r.summary.cer > 0);
    assert.equal(r.note, 'Ảnh hơi mờ');
    assert.match(await page.textContent('.doc-item.active'), /Đã lưu/);
    await page.waitForFunction(() => (localStorage.getItem('ocr-review:prefs') || '').includes('Nguyễn Kiểm Tra'));
    await close();
  });

  T('Ctrl+Enter lưu & sang hồ sơ tiếp; beforeunload cảnh báo khi còn thay đổi', async () => {
    const { page, close } = await setup();
    await page.fill('#reviewer', 'Tester');
    const dl = await H.download(page, () => page.keyboard.press('Control+Enter'));
    assert.equal(dl.name, 'hs1_gpkd_anh__giay_dkdn.reviewed.json');
    await page.waitForFunction(() => window.__ocrReview.S.cur.name === 'hs2_gpkd_pdf');
    await page.keyboard.press('Alt+ArrowDown');
    await page.waitForFunction(() => window.__ocrReview.S.cur.name === 'hs3_thieu_file');
    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForFunction(() => window.__ocrReview.S.cur.name === 'hs2_gpkd_pdf');
    await page.fill(H.leaf('ma_so_doanh_nghiep') + ' textarea', '123');
    const prevented = await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
    assert.equal(prevented, true);
    await close();
  });

  T('hồ sơ đã có .reviewed.json được nạp làm trạng thái hiện tại', async () => {
    const { page, close } = await setup();
    await H.selectDoc(page, 'hs8_da_duyet');
    assert.equal(await page.inputValue(H.leaf('thanh_vien[0].ho_ten') + ' textarea'), 'ĐOÀN THỊ MỸ TÌNH');
    assert.ok(await page.$eval(H.leaf('ma_so_doanh_nghiep'), (r) => r.classList.contains('st-correct')));
    assert.equal(await page.inputValue('#doc-note'), 'Đã duyệt một phần');
    assert.match(await page.textContent('#saved-info'), /Người duyệt mẫu/);
    await close();
  });
});

describe('Chế độ File System Access (giả lập bằng OPFS)', () => {
  T('ghi <tên>.reviewed.json (+ .updated.json) vào chính thư mục hồ sơ, không ghi đè file gốc', async () => {
    const { srv, url } = await H.startServer();
    const app = await H.openApp({ browser, mode: 'fsa', baseUrl: url });
    const { page, errors } = app;
    await H.loadFolderOpfs(page, path.join(H.ROOT, 'test-data'));
    assert.ok(!(await page.isVisible('#banner')));
    const before = await H.readOpfs(page, ['hs1_gpkd_anh', 'giay_dkdn.json']);
    await page.fill('#reviewer', 'FSA Tester');
    await page.click('#btn-settings');
    await page.check('#opt-save-updated');
    await page.click('#btn-settings');
    await page.fill(H.leaf('thanh_vien[0].ho_ten') + ' textarea', 'ĐOÀN THỊ MỸ TÌNH');
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => window.__ocrReview.S.cur.saved && !window.__ocrReview.S.cur.dirty);
    const saved = JSON.parse(await H.readOpfs(page, ['hs1_gpkd_anh', 'giay_dkdn.reviewed.json']));
    assert.equal(saved.data.thanh_vien[0].ho_ten, 'ĐOÀN THỊ MỸ TÌNH');
    assert.equal(saved.review.reviewer, 'FSA Tester');
    const upd = JSON.parse(await H.readOpfs(page, ['hs1_gpkd_anh', 'giay_dkdn.updated.json']));
    assert.equal(upd.thanh_vien[0].ho_ten, 'ĐOÀN THỊ MỸ TÌNH');
    assert.equal(await H.readOpfs(page, ['hs1_gpkd_anh', 'giay_dkdn.json']), before);
    // Handle thư mục được lưu vào IndexedDB (chỉ kiểm tra khoá: headless-shell bị crash khi
    // giải tuần tự handle OPFS từ IndexedDB — handle thư mục thật trên Chrome không bị)
    const keys = await page.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('ocr-review', 1);
      r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess = () => { r.result.close(); res(q.result); }; };
    }));
    assert.deepEqual(keys, ['lastDir']);
    await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('ocr-review'); r.onsuccess = r.onerror = r.onblocked = () => res(); }));
    // Mở lại → nạp từ reviewed.json
    await page.reload();
    await page.click('#es-open');
    await page.waitForFunction(() => window.__ocrReview.S.docs.length && window.__ocrReview.S.docs.every((d) => d.loaded));
    assert.equal(await page.inputValue(H.leaf('thanh_vien[0].ho_ten') + ' textarea'), 'ĐOÀN THỊ MỸ TÌNH');
    assert.match(await page.textContent('.doc-item.active'), /Đã lưu/);
    assert.deepEqual(errors, []);
    await app.close();
    srv.close();
  });
});

describe('Báo cáo & CSV', () => {
  T('modal báo cáo + xuất 3 file CSV (UTF-8 BOM, CRLF)', async () => {
    const { page, close } = await setup();
    await page.fill(H.leaf('thanh_vien[0].ho_ten') + ' textarea', 'ĐOÀN THỊ MỸ TÌNH');
    await page.click('#statsbar');
    await page.click('#btn-report');
    await page.waitForSelector('.rp table.grid tbody tr');
    assert.match(await page.textContent('.rp-cards'), /Số hồ sơ/);
    const firstRow = await page.textContent('.rp table.grid tbody tr');
    assert.match(firstRow, /thanh_vien\[\]\.ho_ten|nguoi_dai_dien_theo_phap_luat\[\]\.ho_ten/);

    const d1 = await H.download(page, () => page.click('#csv-detail'));
    assert.match(d1.name, /_chi_tiet_truong\.csv$/);
    assert.deepEqual([...d1.buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.ok(d1.text.includes('\r\n'));
    const lines = d1.text.replace(/^\ufeff/, '').split('\r\n');
    assert.equal(lines[0], 'Thư mục,Path,Nhãn,Trạng thái,Giá trị gốc (OCR),Giá trị đúng,Loại thay đổi');
    assert.ok(lines.some((l) => l.startsWith('hs1_gpkd_anh,thanh_vien[0].ho_ten,') && l.includes('Sai') && l.includes('DOÀN THỊ MỸ TÌNH') && l.includes('ĐOÀN THỊ MỸ TÌNH')));
    assert.ok(lines.some((l) => l.includes('"Số 128 Nguyễn Công Trí, Phường 6')));   // có dấu phẩy → được đặt trong ""

    const d2 = await H.download(page, () => page.click('#csv-fields'));
    assert.match(d2.text, /^\ufeffPath,Nhãn,Tổng,Đúng,Sai,Chưa duyệt,Độ chính xác,CER\r\n/);
    assert.match(d2.text, /thanh_vien\[\]\.ho_ten/);
    const d3 = await H.download(page, () => page.click('#csv-docs'));
    assert.match(d3.text, /^\ufeffThư mục,Trạng thái,Tổng trường/);
    assert.match(d3.text, /hs1_gpkd_anh,Có thay đổi chưa lưu/);
    assert.match(d3.text, /hs4_json_loi,JSON lỗi/);
    await close();
  });
});

describe('Viewer: zoom / fit / trang', () => {
  T('PDF nhiều trang: fit, zoom, Ctrl+wheel, xoay, chuyển trang', async () => {
    const { page, errors, close } = await setup();
    await H.selectDoc(page, 'hs2_gpkd_pdf');
    await page.waitForFunction(() => window.__ocrReview.Viewer.state().rendered > 0);
    const st0 = await page.evaluate(() => window.__ocrReview.Viewer.state());
    assert.equal(st0.kind, 'pdf'); assert.equal(st0.pages, 3);
    assert.equal(await page.textContent('#v-page'), 'Trang 1 / 3');
    await page.click('#v-fit-width');
    const zw = (await page.evaluate(() => window.__ocrReview.Viewer.state())).zoom;
    // canvas rộng gần bằng khung xem
    const fitOk = await page.evaluate(() => { const s = document.querySelector('#vscroll'), p = document.querySelector('.vpage'); return Math.abs(p.offsetWidth - (s.clientWidth - 24)) <= 2; });
    assert.ok(fitOk);
    await page.click('#v-fit-page');
    const zp = (await page.evaluate(() => window.__ocrReview.Viewer.state())).zoom;
    assert.ok(zp < zw);
    await page.click('#v-zoom-in');
    const z2 = await page.evaluate(() => window.__ocrReview.Viewer.state());
    assert.ok(Math.abs(z2.zoom - zp * 1.2) < 1e-6);
    assert.equal(z2.fit, null);
    assert.equal(await page.inputValue('#v-zoom'), Math.round(z2.zoom * 100) + '%');
    await page.fill('#v-zoom', '150');
    await page.press('#v-zoom', 'Enter');
    assert.equal((await page.evaluate(() => window.__ocrReview.Viewer.state())).zoom, 1.5);
    // Ctrl + wheel
    const box = await page.locator('#vscroll').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');
    await page.waitForFunction(() => window.__ocrReview.Viewer.state().zoom > 1.5);
    // canvas được render lại nét theo zoom (sau debounce)
    await page.waitForFunction(() => { const c = document.querySelector('.vpage canvas'); const z = window.__ocrReview.Viewer.state().zoom; return c && Math.abs(c.width - c.parentElement.offsetWidth) <= 2 && z > 1.5; });
    // xoay
    const wBefore = await page.$eval('.vpage', (e) => e.offsetWidth);
    await page.click('#v-rotate');
    const wAfter = await page.$eval('.vpage', (e) => e.offsetWidth);
    assert.notEqual(wBefore, wAfter);
    // chuyển trang
    await page.click('#v-fit-width');
    await page.click('#v-next');
    await page.waitForFunction(() => /Trang 2 \/ 3/.test(document.querySelector('#v-page').textContent));
    // giữ chế độ fit khi chuyển hồ sơ; ResizeObserver fit lại khi panel đổi kích thước
    await H.selectDoc(page, 'hs1_gpkd_anh');
    await page.waitForSelector('.vpage img');
    assert.equal((await page.evaluate(() => window.__ocrReview.Viewer.state())).fit, 'width');
    const z1 = (await page.evaluate(() => window.__ocrReview.Viewer.state())).zoom;
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.waitForFunction((z) => Math.abs(window.__ocrReview.Viewer.state().zoom - z) > 0.01, z1);
    assert.deepEqual(errors, []);
    await close();
  });

  T('đổi bố cục trái-phải ↔ trên-dưới, lưu tỉ lệ & tuỳ chọn', async () => {
    const { page, close } = await setup();
    assert.ok(await page.$eval('#workspace', (e) => e.classList.contains('split-h')));
    await page.click('#btn-layout');
    assert.ok(await page.$eval('#workspace', (e) => e.classList.contains('split-v')));
    await page.click('#btn-theme');
    const prefs = JSON.parse(await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 300)); return localStorage.getItem('ocr-review:prefs'); }));
    assert.equal(prefs.layout, 'v');
    assert.equal(prefs.theme, 'light');
    await page.setViewportSize({ width: 850, height: 900 });
    await page.click('#btn-layout');   // về 'h' nhưng màn hẹp vẫn trên-dưới
    assert.ok(await page.$eval('#workspace', (e) => e.classList.contains('split-v')));
    await close();
  });
});

describe('Bản GPKD', () => {
  T('cảnh báo thiếu trường theo mẫu & kiểm tra định dạng', async () => {
    const { page, close } = await setup({ file: 'ocr-review-gpkd.html' });
    assert.equal(await page.textContent('#profile-badge'), 'GPKD');
    // ngày cấp "20/O4/2021" bị cảnh báo
    assert.match(await page.textContent(H.leaf('thanh_vien[0].ngay_cap') + ' .lf-warn'), /Ngày không đúng dạng/);
    await H.selectDoc(page, 'hs2_gpkd_pdf');
    assert.match(await page.textContent('#tab-form'), /Thiếu 1 trường theo mẫu GPKD/);
    await page.click('[data-act="add-missing-all"]');
    await page.waitForSelector(H.leaf('tru_so_chinh.website'));
    assert.doesNotMatch(await page.textContent('#tab-form'), /Thiếu 1 trường theo mẫu/);
    await close();
  });
});

describe('Hiệu năng', () => {
  T('PDF 20 trang + JSON ~550 trường', async () => {
    const { page, errors, close } = await setup();
    const t0 = Date.now();
    await H.selectDoc(page, 'hs10_gpkd_20_trang');
    await page.waitForFunction(() => window.__ocrReview.Viewer.state().pages === 20 && window.__ocrReview.Viewer.state().rendered > 0);
    const tLoad = Date.now() - t0;
    const n = await page.$$eval('.leaf', (e) => e.length);
    assert.ok(n > 500, 'số trường: ' + n);
    // chỉ render các trang đang hiển thị
    const rendered = (await page.evaluate(() => window.__ocrReview.Viewer.state())).rendered;
    assert.ok(rendered < 20, 'render ' + rendered + ' trang');
    // gõ phím phản hồi nhanh
    const t1 = Date.now();
    const ta = H.leaf('thanh_vien[20].ho_ten') + ' textarea';
    await page.click(ta);
    await page.keyboard.type('ABC');
    const tType = Date.now() - t1;
    console.log('    tải: ' + tLoad + 'ms, ' + n + ' trường, gõ 3 ký tự: ' + tType + 'ms, trang đã render: ' + rendered);
    assert.ok(tLoad < 8000);
    assert.deepEqual(errors, []);
    await close();
  });
});
