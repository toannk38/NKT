#!/usr/bin/env node
/*
 * Chụp màn hình để tự kiểm tra giao diện: 1920×1080 và 1280×720, sáng & tối.
 *   node tests/screenshots.js   → docs/screenshots/*.png
 */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./helpers');

const OUT = path.join(H.ROOT, 'docs', 'screenshots');

async function prepare(page) {
  // Một vài thao tác duyệt để ảnh có trạng thái thực tế
  await page.fill('#reviewer', 'Nguyễn Văn Duyệt');
  await page.fill(H.leaf('thanh_vien[0].ho_ten') + ' textarea', 'ĐOÀN THỊ MỸ TÌNH');
  await page.fill(H.leaf('tru_so_chinh.dia_chi') + ' textarea', 'Số 128 Nguyễn Công Trỗi, Phường 6, Thành phố Tuy Hòa, Tỉnh Phú Yên, Việt Nam');
  await page.click(H.leaf('ma_so_doanh_nghiep') + ' .b-ok');
  await page.click(H.leaf('ten_cong_ty.tieng_viet') + ' .b-ok');
  await page.click(H.leaf('ten_cong_ty.tieng_nuoc_ngoai') + ' .b-ok');
  await page.click('#statsbar');
  await page.evaluate(() => document.querySelector('#form-scroll').scrollTo(0, 0));
  await page.waitForTimeout(400);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { srv, url } = await H.startServer();
  const browser = await H.chromium.launch();
  const shots = [];
  const sizes = [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }];
  for (const scheme of ['light', 'dark']) {
    for (const vp of sizes) {
      const tag = vp.width + 'x' + vp.height + '-' + scheme;
      const app = await H.openApp({ browser, mode: 'fsa', baseUrl: url, viewport: vp, colorScheme: scheme, file: 'ocr-review-gpkd.html' });
      const { page } = app;
      await page.screenshot({ path: path.join(OUT, 'empty-' + tag + '.png') });
      shots.push('empty-' + tag);
      await H.loadFolderOpfs(page, path.join(H.ROOT, 'test-data'));
      await page.waitForSelector('.vpage img');
      await prepare(page);
      await page.screenshot({ path: path.join(OUT, 'form-' + tag + '.png') });
      shots.push('form-' + tag);

      await page.click('.tab[data-tab="diff"]');
      await page.waitForSelector('.chg');
      await page.screenshot({ path: path.join(OUT, 'diff-list-' + tag + '.png') });
      await page.click('#tab-diff .seg button[data-v="side"]');
      await page.waitForSelector('.side-row .lc.del');
      await page.screenshot({ path: path.join(OUT, 'diff-side-' + tag + '.png') });
      await page.click('.tab[data-tab="raw"]');
      await page.waitForSelector('#tab-raw .code-view');
      await page.screenshot({ path: path.join(OUT, 'raw-' + tag + '.png') });
      shots.push('diff-list-' + tag, 'diff-side-' + tag, 'raw-' + tag);

      await page.click('.tab[data-tab="form"]');
      await H.selectDoc(page, 'hs2_gpkd_pdf');
      await page.waitForFunction(() => window.__ocrReview.Viewer.state().rendered > 0);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT, 'pdf-' + tag + '.png') });
      shots.push('pdf-' + tag);

      await page.click('#btn-report');
      await page.waitForSelector('.rp table.grid tbody tr');
      await page.screenshot({ path: path.join(OUT, 'report-' + tag + '.png') });
      shots.push('report-' + tag);
      await page.keyboard.press('Escape');

      await page.click('#btn-layout');
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, 'vertical-' + tag + '.png') });
      shots.push('vertical-' + tag);
      await app.close();
    }
  }
  // Bản tổng quát với giấy tờ khác (CCCD) — chế độ fallback có banner
  const app = await H.openApp({ browser, viewport: { width: 1600, height: 900 }, file: 'ocr-review.html' });
  await H.loadFolder(app.page, H.freshData());
  await H.selectDoc(app.page, 'hs5_cccd_anh');
  await app.page.waitForSelector('.vpage img');
  await app.page.fill(H.leaf('ho_va_ten') + ' textarea', 'LÊ THỊ HỒNG NHUNG');
  await app.page.click('#statsbar');
  await app.page.waitForTimeout(300);
  await app.page.screenshot({ path: path.join(OUT, 'generic-cccd-fallback-1600x900.png') });
  shots.push('generic-cccd-fallback-1600x900');
  await app.close();

  await browser.close();
  srv.close();
  fs.rmSync(H.TMP, { recursive: true, force: true });
  console.log('✔ ' + shots.length + ' ảnh trong ' + path.relative(process.cwd(), OUT));
}

main().catch((e) => { console.error(e); process.exit(1); });
