#!/usr/bin/env node
/*
 * Sinh bộ dữ liệu test trong test-data/ (dùng Playwright/Chromium để vẽ ảnh PNG & PDF).
 *   node scripts/make-test-data.js
 * Dữ liệu là hư cấu, chỉ dùng để kiểm thử tool.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', 'test-data');

/* ---------- Dữ liệu đúng (ground truth) ---------- */
const TRUTH = {
  ma_so_doanh_nghiep: '4400999827',
  ten_cong_ty: { tieng_viet: 'CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ MINH TÂM PHÚ YÊN', tieng_nuoc_ngoai: 'MINH TAM PHU YEN TRADING SERVICE COMPANY LIMITED', viet_tat: 'MINH TAM PY CO., LTD' },
  tru_so_chinh: { dia_chi: 'Số 128 Nguyễn Công Trỗi, Phường 6, Thành phố Tuy Hòa, Tỉnh Phú Yên, Việt Nam', dien_thoai: '0257 3823 456', fax: '', email: 'minhtampy@example.vn', website: '' },
  von_dieu_le: { so_tien: '10.000.000.000 đồng' },
  thanh_vien: [
    { ho_ten: 'ĐOÀN THỊ MỸ TÌNH', quoc_tich: 'Việt Nam', phan_gop_von: '6.000.000.000', ty_le: '60', so_giay_to: '054186001234', ghi_chu: '', gioi_tinh: 'Nữ', ngay_sinh: '12/05/1986', dan_toc: 'Kinh', loai_giay_to: 'Thẻ căn cước công dân', ngay_cap: '20/04/2021', noi_cap: 'Cục Cảnh sát quản lý hành chính về trật tự xã hội', dia_chi_thuong_tru: 'Số 45 Lê Thánh Tôn, Phường 7, Thành phố Tuy Hòa, Tỉnh Phú Yên, Việt Nam', dia_chi_lien_lac: 'Số 45 Lê Thánh Tôn, Phường 7, Thành phố Tuy Hòa, Tỉnh Phú Yên, Việt Nam' },
    { ho_ten: 'NGUYỄN VĂN HẢI', quoc_tich: 'Việt Nam', phan_gop_von: '4.000.000.000', ty_le: '40', so_giay_to: '054082009876', ghi_chu: '', gioi_tinh: 'Nam', ngay_sinh: '03/11/1982', dan_toc: 'Kinh', loai_giay_to: 'Thẻ căn cước công dân', ngay_cap: '15/08/2021', noi_cap: 'Cục Cảnh sát quản lý hành chính về trật tự xã hội', dia_chi_thuong_tru: 'Thôn Phú Lương, Xã Hòa An, Huyện Phú Hòa, Tỉnh Phú Yên, Việt Nam', dia_chi_lien_lac: 'Số 128 Nguyễn Công Trỗi, Phường 6, Thành phố Tuy Hòa, Tỉnh Phú Yên, Việt Nam' }
  ],
  nguoi_dai_dien_theo_phap_luat: [
    { ho_ten: 'ĐOÀN THỊ MỸ TÌNH', gioi_tinh: 'Nữ', chuc_danh: 'Giám đốc', ngay_sinh: '12/05/1986', dan_toc: 'Kinh', quoc_tich: 'Việt Nam', loai_giay_to: 'Thẻ căn cước công dân', so_giay_to: '054186001234', ngay_cap: '20/04/2021', noi_cap: 'Cục Cảnh sát quản lý hành chính về trật tự xã hội', dia_chi_thuong_tru: 'Số 45 Lê Thánh Tôn, Phường 7, Thành phố Tuy Hòa, Tỉnh Phú Yên, Việt Nam', dia_chi_lien_lac: 'Số 45 Lê Thánh Tôn, Phường 7, Thành phố Tuy Hòa, Tỉnh Phú Yên, Việt Nam' }
  ]
};
const clone = (o) => JSON.parse(JSON.stringify(o));

/** Kết quả OCR có lỗi cố ý */
function ocrWithErrors(t) {
  const o = clone(t);
  o.tru_so_chinh.dia_chi = o.tru_so_chinh.dia_chi.replace('Nguyễn Công Trỗi', 'Nguyễn Công Trí');
  o.tru_so_chinh.dien_thoai = '0257 3828 456';
  o.thanh_vien[0].ho_ten = 'DOÀN THỊ MỸ TÌNH';
  o.thanh_vien[0].ngay_cap = '20/O4/2021';
  o.thanh_vien[1].dia_chi_lien_lac = o.thanh_vien[1].dia_chi_lien_lac.replace('Nguyễn Công Trỗi', 'Nguyễn Công Trí');
  o.nguoi_dai_dien_theo_phap_luat[0].ho_ten = 'DOÀN THỊ MỸ TÌNH';
  o.nguoi_dai_dien_theo_phap_luat[0].chuc_danh = 'Giám đôc';
  return o;
}

/* ---------- Mẫu HTML giấy chứng nhận ---------- */
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const CSS = `
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: "DejaVu Serif", "Liberation Serif", serif; font-size: 13.5px; color: #111; margin: 0; }
  .sheet { width: 794px; padding: 36px 48px; box-sizing: border-box; background: #fffef8; }
  .hd { display: flex; justify-content: space-between; text-align: center; font-size: 12.5px; }
  .hd b { display: block; }
  h1 { text-align: center; font-size: 19px; margin: 22px 0 4px; letter-spacing: .3px; }
  h2 { text-align: center; font-size: 15px; margin: 0 0 18px; font-weight: normal; }
  .mst { text-align: center; font-size: 14px; margin-bottom: 16px; }
  .mst b { font-size: 16px; letter-spacing: 2px; }
  .sec { font-weight: bold; margin: 12px 0 4px; }
  p { margin: 3px 0; line-height: 1.45; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin-top: 6px; }
  td, th { border: 1px solid #333; padding: 4px 5px; vertical-align: top; }
  .sign { margin-top: 30px; text-align: right; padding-right: 30px; }
  .stamp { display: inline-block; width: 120px; height: 120px; border: 3px solid #c0392b; border-radius: 50%; color: #c0392b; font-size: 10px; text-align: center; line-height: 1.3; padding-top: 38px; box-sizing: border-box; transform: rotate(-12deg); opacity: .8; }
  .pb { page-break-before: always; }
`;
function header(t) {
  return `<div class="hd"><div><b>SỞ KẾ HOẠCH VÀ ĐẦU TƯ</b><b>TỈNH PHÚ YÊN</b><b>PHÒNG ĐĂNG KÝ KINH DOANH</b></div>
  <div><b>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</b><b>Độc lập - Tự do - Hạnh phúc</b></div></div>
  <h1>GIẤY CHỨNG NHẬN ĐĂNG KÝ DOANH NGHIỆP</h1>
  <h2>CÔNG TY TRÁCH NHIỆM HỮU HẠN HAI THÀNH VIÊN TRỞ LÊN</h2>
  <div class="mst">Mã số doanh nghiệp: <b>${esc(t.ma_so_doanh_nghiep)}</b><br>Đăng ký lần đầu: ngày 15 tháng 06 năm 2021</div>`;
}
function companyPart(t) {
  return `<div class="sec">1. Tên công ty</div>
  <p>Tên công ty viết bằng tiếng Việt: <b>${esc(t.ten_cong_ty.tieng_viet)}</b></p>
  <p>Tên công ty viết bằng tiếng nước ngoài: ${esc(t.ten_cong_ty.tieng_nuoc_ngoai)}</p>
  <p>Tên công ty viết tắt: ${esc(t.ten_cong_ty.viet_tat)}</p>
  <div class="sec">2. Địa chỉ trụ sở chính</div>
  <p>${esc(t.tru_so_chinh.dia_chi)}</p>
  <p>Điện thoại: ${esc(t.tru_so_chinh.dien_thoai)} &nbsp;&nbsp; Fax: ${esc(t.tru_so_chinh.fax)}</p>
  <p>Email: ${esc(t.tru_so_chinh.email)} &nbsp;&nbsp; Website: ${esc(t.tru_so_chinh.website)}</p>
  <div class="sec">3. Vốn điều lệ</div>
  <p>Vốn điều lệ: ${esc(t.von_dieu_le.so_tien)}</p>`;
}
function membersPart(list, start = 0) {
  return `<div class="sec">4. Danh sách thành viên góp vốn</div>
  <table><tr><th>STT</th><th>Tên thành viên</th><th>Quốc tịch</th><th>Địa chỉ liên lạc</th><th>Phần vốn góp (VNĐ)</th><th>Tỷ lệ (%)</th><th>Số giấy tờ pháp lý</th></tr>
  ${list.map((m, i) => `<tr><td>${start + i + 1}</td><td>${esc(m.ho_ten)}<br><small>${esc(m.gioi_tinh)}, sinh ${esc(m.ngay_sinh)}, dân tộc ${esc(m.dan_toc)}</small></td><td>${esc(m.quoc_tich)}</td><td>${esc(m.dia_chi_lien_lac)}<br><small>Thường trú: ${esc(m.dia_chi_thuong_tru)}</small></td><td>${esc(m.phan_gop_von)}</td><td>${esc(m.ty_le)}</td><td>${esc(m.loai_giay_to)}: ${esc(m.so_giay_to)}<br><small>Cấp ngày ${esc(m.ngay_cap)} tại ${esc(m.noi_cap)}</small></td></tr>`).join('')}
  </table>`;
}
function repPart(t) {
  const r = t.nguoi_dai_dien_theo_phap_luat[0];
  return `<div class="sec">5. Người đại diện theo pháp luật của công ty</div>
  <p>Họ và tên: <b>${esc(r.ho_ten)}</b> &nbsp;&nbsp; Giới tính: ${esc(r.gioi_tinh)}</p>
  <p>Chức danh: ${esc(r.chuc_danh)}</p>
  <p>Sinh ngày: ${esc(r.ngay_sinh)} &nbsp;&nbsp; Dân tộc: ${esc(r.dan_toc)} &nbsp;&nbsp; Quốc tịch: ${esc(r.quoc_tich)}</p>
  <p>Loại giấy tờ pháp lý của cá nhân: ${esc(r.loai_giay_to)}</p>
  <p>Số giấy tờ pháp lý của cá nhân: ${esc(r.so_giay_to)}</p>
  <p>Ngày cấp: ${esc(r.ngay_cap)} &nbsp;&nbsp; Nơi cấp: ${esc(r.noi_cap)}</p>
  <p>Địa chỉ thường trú: ${esc(r.dia_chi_thuong_tru)}</p>
  <p>Địa chỉ liên lạc: ${esc(r.dia_chi_lien_lac)}</p>
  <div class="sign"><div><b>TRƯỞNG PHÒNG</b></div><div class="stamp">PHÒNG ĐĂNG KÝ<br>KINH DOANH<br>PHÚ YÊN</div><div><b>Trần Văn Bình</b></div></div>`;
}
const page = (inner) => `<!doctype html><html lang="vi"><head><meta charset="utf-8"><style>${CSS}</style></head><body>${inner}</body></html>`;

/* ---------- File TIFF tối thiểu (8x8 xám, không nén) ---------- */
function tinyTiff() {
  const w = 8, h = 8;
  const entries = [[256, 3, 1, w], [257, 3, 1, h], [258, 3, 1, 8], [259, 3, 1, 1], [262, 3, 1, 1], [273, 4, 1, 0], [277, 3, 1, 1], [278, 3, 1, h], [279, 4, 1, w * h]];
  const ifdOff = 8, ifdSize = 2 + entries.length * 12 + 4, dataOff = ifdOff + ifdSize;
  const buf = Buffer.alloc(dataOff + w * h);
  buf.write('II', 0, 'ascii'); buf.writeUInt16LE(42, 2); buf.writeUInt32LE(ifdOff, 4);
  buf.writeUInt16LE(entries.length, ifdOff);
  entries.forEach(([tag, type, count, val], i) => {
    const o = ifdOff + 2 + i * 12;
    buf.writeUInt16LE(tag, o); buf.writeUInt16LE(type, o + 2); buf.writeUInt32LE(count, o + 4);
    const v = tag === 273 ? dataOff : val;
    if (type === 3) buf.writeUInt16LE(v, o + 8); else buf.writeUInt32LE(v, o + 8);
  });
  for (let i = 0; i < w * h; i++) buf[dataOff + i] = (i * 37) % 256;
  return buf;
}

function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }
function dir(name) { const d = path.join(OUT, name); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); return d; }

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 1.5 });
  const pg = await ctx.newPage();

  async function png(html, file, selector = '.sheet') {
    await pg.setContent(html);
    await pg.locator(selector).screenshot({ path: file });
  }
  async function pdf(html, file) {
    await pg.setContent(html);
    await pg.pdf({ path: file, format: 'A4', printBackground: true });
  }

  const onePage = page(`<div class="sheet">${header(TRUTH)}${companyPart(TRUTH)}${membersPart(TRUTH.thanh_vien)}${repPart(TRUTH)}</div>`);

  // 1. Ảnh PNG + JSON
  let d = dir('hs1_gpkd_anh');
  await png(onePage, path.join(d, 'giay_dkdn.png'));
  writeJson(path.join(d, 'giay_dkdn.json'), ocrWithErrors(TRUTH));

  // 2. PDF 3 trang + JSON
  d = dir('hs2_gpkd_pdf');
  await pdf(page(`<div>${header(TRUTH)}${companyPart(TRUTH)}</div><div class="pb">${membersPart(TRUTH.thanh_vien)}</div><div class="pb">${repPart(TRUTH)}</div>`), path.join(d, 'gpkd.pdf'));
  const o2 = ocrWithErrors(TRUTH);
  o2.von_dieu_le.so_tien = '10.000.000.00O đồng';
  o2.thanh_vien[1].ho_ten = 'NGUYEN VĂN HẢI';
  delete o2.tru_so_chinh.website;          // OCR bỏ sót trường
  o2.thanh_vien.push({ ho_ten: 'TRƯỞNG PHÒNG', quoc_tich: '', phan_gop_von: '', ty_le: '', so_giay_to: '', ghi_chu: '', gioi_tinh: '', ngay_sinh: '', dan_toc: '', loai_giay_to: '', ngay_cap: '', noi_cap: '', dia_chi_thuong_tru: '', dia_chi_lien_lac: '' }); // OCR bịa thêm
  writeJson(path.join(d, 'gpkd.json'), o2);

  // 3. Thiếu file tài liệu
  d = dir('hs3_thieu_file');
  writeJson(path.join(d, 'ket_qua.json'), ocrWithErrors(TRUTH));

  // 4. JSON lỗi cú pháp
  d = dir('hs4_json_loi');
  await png(onePage, path.join(d, 'scan.png'));
  const bad = JSON.stringify(ocrWithErrors(TRUTH), null, 2)
    .replace('"viet_tat": "MINH TAM PY CO., LTD"', '"viet_tat": "MINH TAM PY CO., LTD",')   // dấu phẩy thừa
    .replace('"dan_toc": "Kinh",\n      "loai_giay_to"', '"dan_toc": "Kinh"\n      "loai_giay_to"'); // thiếu dấu phẩy
  fs.writeFileSync(path.join(d, 'scan.json'), bad);

  // 5. CCCD (schema khác) — minh hoạ bản tổng quát
  d = dir('hs5_cccd_anh');
  await png(page(`<div class="sheet" style="width:860px;height:540px;padding:24px 30px;border-radius:18px;background:linear-gradient(135deg,#e8f1ff,#fdf7e6);font-family:'DejaVu Sans',sans-serif">
    <div style="text-align:center;font-weight:bold;font-size:15px">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM<br><span style="font-weight:normal">Độc lập - Tự do - Hạnh phúc</span></div>
    <div style="text-align:center;color:#b00;font-weight:bold;font-size:20px;margin:10px 0 14px">CĂN CƯỚC CÔNG DÂN</div>
    <div style="display:flex;gap:24px"><div style="width:160px;height:210px;background:#cfd8e3;border:1px solid #889"></div>
    <div style="font-size:15px;line-height:1.75">Số / No.: <b style="font-size:19px;letter-spacing:1px">079203004567</b><br>Họ và tên: <b>LÊ THỊ HỒNG NHUNG</b><br>Ngày sinh: 21/09/2003 &nbsp; Giới tính: Nữ &nbsp; Quốc tịch: Việt Nam<br>Quê quán: Xã Tân Lộc, Huyện Thới Bình, Tỉnh Cà Mau<br>Nơi thường trú: 27/4 Đường Trường Chinh, Phường 15, Quận Tân Bình, TP. Hồ Chí Minh<br>Có giá trị đến: 21/09/2028</div></div></div>`), path.join(d, 'cccd_mat_truoc.png'));
  writeJson(path.join(d, 'cccd_mat_truoc.json'), {
    loai_giay_to: 'Căn cước công dân', so: '079203004567', ho_va_ten: 'LÊ THI HỒNG NHUNG', ngay_sinh: '21/09/2003', gioi_tinh: 'Nữ', quoc_tich: 'Việt Nam',
    que_quan: 'Xã Tân Lộc, Huyện Thới Bình, Tỉnh Cà Mau', noi_thuong_tru: '27/4 Đường Trường Chinh, Phường 15, Quận Tân Bình, TP. Hồ Chỉ Minh',
    co_gia_tri_den: '21/09/2028', do_tin_cay: 0.93, mat_sau: null, anh_chan_dung: true, dac_diem: ['Nốt ruồi cách 2cm dưới đuôi mắt trái', 'Sẹo chấm']
  });

  // 6. TIFF (chưa hỗ trợ hiển thị)
  d = dir('hs6_tiff');
  fs.writeFileSync(path.join(d, 'scan.tif'), tinyTiff());
  writeJson(path.join(d, 'scan.json'), ocrWithErrors(TRUTH));

  // 7. Thừa file
  d = dir('hs7_thua_file');
  await png(onePage, path.join(d, 'trang1.png'));
  writeJson(path.join(d, 'trang1.json'), ocrWithErrors(TRUTH));
  writeJson(path.join(d, 'trang1_ban_cu.json'), TRUTH);
  fs.writeFileSync(path.join(d, 'ghi_chu.txt'), 'File thừa để kiểm tra cảnh báo.\n');

  // 8. Đã có kết quả duyệt từ lần trước
  d = dir('hs8_da_duyet');
  await png(onePage, path.join(d, 'gpkd.png'));
  const o8 = ocrWithErrors(TRUTH);
  writeJson(path.join(d, 'gpkd.json'), o8);
  const fixed = clone(o8);
  fixed.thanh_vien[0].ho_ten = 'ĐOÀN THỊ MỸ TÌNH';
  writeJson(path.join(d, 'gpkd.reviewed.json'), {
    data: fixed,
    review: {
      tool: 'ocr-review v1', folder: 'hs8_da_duyet', source_json: 'gpkd.json', source_file: 'gpkd.png', reviewer: 'Người duyệt mẫu',
      reviewed_at: '2024-05-02T09:15:00+07:00', summary: {}, field_status: { 'thanh_vien[0].ho_ten': 'wrong', ma_so_doanh_nghiep: 'correct' },
      changes: [{ path: 'thanh_vien[0].ho_ten', type: 'modified', original: 'DOÀN THỊ MỸ TÌNH', updated: 'ĐOÀN THỊ MỸ TÌNH' }], note: 'Đã duyệt một phần'
    }
  });

  // 10. PDF 20 trang + JSON vài trăm trường (kiểm tra hiệu năng)
  d = dir('hs10_gpkd_20_trang');
  const big = clone(TRUTH);
  const ho = ['NGUYỄN', 'TRẦN', 'LÊ', 'PHẠM', 'HOÀNG', 'HUỲNH', 'PHAN', 'VŨ', 'VÕ', 'ĐẶNG'];
  const dem = ['VĂN', 'THỊ', 'MINH', 'HỮU', 'ĐỨC', 'NGỌC'];
  const ten = ['AN', 'BÌNH', 'CƯỜNG', 'DŨNG', 'GIANG', 'HÀ', 'KHÁNH', 'LINH', 'MAI', 'NAM', 'PHÚC', 'QUANG', 'SƠN', 'THẢO', 'TRÍ', 'UYÊN', 'VY', 'YẾN'];
  big.thanh_vien = [];
  for (let i = 0; i < 38; i++) {
    const m = clone(TRUTH.thanh_vien[i % 2]);
    m.ho_ten = ho[i % ho.length] + ' ' + dem[i % dem.length] + ' ' + ten[(i * 7) % ten.length];
    m.so_giay_to = '0540' + String(80000000 + i * 7919).slice(0, 8);
    m.ty_le = (100 / 38).toFixed(2);
    m.phan_gop_von = '263.157.894';
    big.thanh_vien.push(m);
  }
  const pagesHtml = [`<div>${header(big)}${companyPart(big)}</div>`];
  for (let p = 0; p < 19; p++) {
    const slice = big.thanh_vien.slice(p * 2, p * 2 + 2);
    pagesHtml.push(`<div class="pb">${membersPart(slice, p * 2)}${p === 18 ? repPart(big) : '<p style="margin-top:40px;color:#666">(Trang ' + (p + 2) + ' — danh sách thành viên, tiếp theo)</p>'}</div>`);
  }
  await pdf(page(pagesHtml.join('')), path.join(d, 'gpkd_20_trang.pdf'));
  const oBig = clone(big);
  oBig.thanh_vien[3].ho_ten = oBig.thanh_vien[3].ho_ten.replace('Đ', 'D');
  oBig.thanh_vien[7].ngay_sinh = '03/1l/1982';
  oBig.thanh_vien[12].dia_chi_lien_lac = oBig.thanh_vien[12].dia_chi_lien_lac.replace('Trỗi', 'Trí');
  writeJson(path.join(d, 'gpkd_20_trang.json'), oBig);

  // Thư mục gốc chứa trực tiếp ảnh + json (không có thư mục con)
  d = path.join(OUT, '..', 'test-data-single');
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  fs.copyFileSync(path.join(OUT, 'hs1_gpkd_anh', 'giay_dkdn.png'), path.join(d, 'giay_dkdn.png'));
  writeJson(path.join(d, 'giay_dkdn.json'), ocrWithErrors(TRUTH));

  await browser.close();
  console.log('✔ Đã tạo dữ liệu test trong', path.relative(process.cwd(), OUT), 'và test-data-single/');
}

main().catch((e) => { console.error(e); process.exit(1); });
