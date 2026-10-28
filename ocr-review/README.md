# OCR Review — công cụ duyệt / chấm kết quả OCR (1 file HTML, chạy offline)

Mở trực tiếp file HTML bằng **Chrome hoặc Edge** (`file://`). Không cần server, không cần cài đặt, không gọi mạng.
Mọi CSS/JS (kể cả pdf.js) đã nằm sẵn trong file.

| File | Dùng cho |
|---|---|
| **`dist/ocr-review.html`** | **Mọi loại giấy tờ** — render generic mọi JSON (object, mảng, lồng nhau). |
| **`dist/ocr-review-gpkd.html`** | **Giấy chứng nhận đăng ký doanh nghiệp (GPKD)** — như bản trên, thêm mẫu trường chuẩn (cảnh báo thiếu trường / trường ngoài mẫu, nút "+ Thêm tất cả") và kiểm tra định dạng riêng (mã số DN 10 số, số CCCD 12 số, giới tính, tỷ lệ %, số tiền…). |

Người dùng cuối chỉ cần **một** trong hai file trong `dist/`.

## Hướng dẫn sử dụng nhanh

1. Chuẩn bị thư mục gốc: mỗi thư mục con là một hồ sơ, gồm 1 file tài liệu (`.pdf .png .jpg .jpeg .webp .bmp .gif`) và 1 file `.json` kết quả OCR.
   Nếu thư mục gốc chứa trực tiếp ảnh + json (không có thư mục con) thì chính nó là 1 hồ sơ.
   ```
   thu_muc_goc/
   ├── ho_so_1/  giay_to.pdf  giay_to.json
   └── ho_so_2/  anh.png      anh.json
   ```
2. Mở `dist/ocr-review.html` (hoặc bản GPKD) bằng Chrome/Edge → bấm **Mở thư mục** (hoặc kéo-thả thư mục vào cửa sổ) → cho phép quyền **chỉnh sửa**.
   Lần sau có nút **Mở lại thư mục gần nhất**.
3. Nhập **tên người duyệt** ở thanh trên (được nhớ cho lần sau).
4. Với từng hồ sơ: so ảnh/PDF bên trái với các trường bên phải.
   - Sửa giá trị sai → trường tự đánh dấu **Sai**, tô vàng, hiện dòng `Gốc: …` với diff từng ký tự (đỏ gạch = bị xoá, xanh = thêm).
   - Bấm **✓** / **✗** để chấm Đúng / Sai, **↺** để khôi phục giá trị gốc, **×** (hiện khi rê chuột) để xoá trường.
   - **"Đúng cho mọi trường chưa duyệt"** để chấm nhanh phần còn lại.
   - `Enter` sang ô kế tiếp, `Shift+Enter` xuống dòng.
5. **Lưu** (`Ctrl+S`) hoặc **Lưu & tiếp** (`Ctrl+Enter`). Kết quả ghi thành `<tên-json-gốc>.reviewed.json` ngay trong thư mục hồ sơ.
   **File JSON gốc không bao giờ bị ghi đè.** Lần mở sau, file `.reviewed.json` được nạp làm trạng thái hiện tại.
6. **Báo cáo** → thống kê toàn bộ hồ sơ (độ chính xác, CER theo trường / theo hồ sơ) và xuất 3 file CSV (UTF-8 có BOM, mở thẳng bằng Excel).

> **Trình duyệt không hỗ trợ ghi thư mục** (Firefox, Safari…): tool chạy ở **chế độ chỉ đọc** (có banner giải thích).
> Khi bấm Lưu, file được **tải về** với tên `<thư-mục>__<tên>.reviewed.json` — hãy chép vào đúng thư mục hồ sơ.

### Các tab bên phải
- **Form**: card thu gọn được cho object; mảng object hiển thị #1, #2… (nút Xoá, "+ Thêm phần tử" — clone cấu trúc phần tử đầu, giá trị rỗng); "+ Thêm trường" cho object.
  Ô lọc theo tên trường (không cần gõ dấu), lọc "chỉ hiện: Đã sửa / Chưa duyệt / Sai", Undo/Redo, ô **Ghi chú hồ sơ**.
- **Raw**: xem JSON hiện tại / gốc có tô màu, số dòng, Sao chép; **Sửa raw** → Áp dụng (báo lỗi kèm dòng/cột) / Huỷ / Định dạng.
  JSON gốc lỗi cú pháp vẫn mở được ở đây để sửa tay.
- **Đối chiếu**: "Danh sách thay đổi" (path, nhãn, Sửa/Thêm/Xoá, gốc → mới, hoàn tác từng mục) hoặc "Song song" (2 cột gốc | hiện tại, diff theo dòng + ký tự, cuộn đồng bộ).

### Xem tài liệu
Zoom `+`/`−`, ô %, **Vừa rộng**, **Vừa trang**, **100%**, `Ctrl + lăn chuột` (hoặc chụm trackpad) zoom quanh con trỏ, kéo chuột để di chuyển, xoay 90°.
PDF hiển thị mọi trang theo chiều dọc, "Trang x / y" và nút trang trước/sau. Chế độ "vừa" được giữ khi chuyển hồ sơ và tự fit lại khi đổi kích thước panel.
Bố cục trái-phải ↔ trên-dưới (màn hình < 900px tự trên-dưới), kéo thanh chia để đổi tỉ lệ, giao diện sáng/tối (tự động theo hệ thống hoặc chọn tay).

### Phím tắt (bấm `?` trong tool để xem)
| Phím | Tác dụng |
|---|---|
| `Ctrl+S` | Lưu |
| `Ctrl+Enter` | Lưu & sang hồ sơ tiếp |
| `Alt+↓` / `Alt+↑` | Hồ sơ tiếp / trước |
| `Ctrl+Z` / `Ctrl+Y` | Hoàn tác / làm lại (khi không đứng trong ô nhập) |
| `Enter` / `Shift+Enter` | Ô kế tiếp / xuống dòng |

## Quy tắc chấm & chỉ số
- Mỗi trường lá (leaf, định danh bằng path như `thanh_vien[0].ho_ten`) có trạng thái **Đúng**, **Sai** hoặc **Chưa duyệt**.
- Sửa giá trị khác gốc → tự đặt **Sai**; sửa về đúng giá trị gốc → bỏ trạng thái tự đặt. Nút ✓/✗ ghi đè.
- Trường **thêm mới** (OCR bỏ sót) và trường **bị xoá** (OCR bịa ra) đều tính là **Sai**. Xoá phần tử mảng sẽ dịch lại path/trạng thái các phần tử phía sau.
- Giữ kiểu dữ liệu: nếu gốc là number/boolean/null và giá trị nhập parse được thì giữ đúng kiểu, ngược lại lưu string.
- **Độ chính xác** = Đúng / (Đúng + Sai).
- **CER** = Σ Levenshtein(giá trị OCR, giá trị đúng) / Σ độ dài giá trị đúng — chỉ tính trên leaf kiểu string đã được duyệt.

## Cấu trúc file kết quả `<tên>.reviewed.json`
```json
{
  "data": { "...": "JSON đã chỉnh sửa, cùng schema với file gốc" },
  "review": {
    "tool": "ocr-review v1",
    "profile": "gpkd",
    "folder": "ten_folder",
    "source_json": "abc.json",
    "source_file": "abc.pdf",
    "reviewer": "tên người duyệt",
    "reviewed_at": "2024-05-02T09:15:00+07:00",
    "summary": { "total_fields": 32, "correct": 28, "wrong": 4, "unreviewed": 0, "accuracy": 0.875, "cer": 0.012 },
    "field_status": { "thanh_vien[0].ho_ten": "wrong" },
    "changes": [ { "path": "thanh_vien[0].ho_ten", "type": "modified", "original": "DOÀN THỊ MỸ TÌNH", "updated": "ĐOÀN THỊ MỸ TÌNH" } ],
    "note": ""
  }
}
```
`type` ∈ `modified | added | removed`. Có thể có thêm `index_map` (theo dõi phần tử mảng đã xoá/thêm) và, nếu JSON gốc lỗi cú pháp,
`source_parse_error` + `baseline` (bản đã sửa cú pháp dùng làm bản đối chiếu).
Tuỳ chọn trong ⚙ Cài đặt: lưu thêm `<tên>.updated.json` chỉ chứa dữ liệu thuần.

## Nhãn trường
Bảng `LABELS` ở đầu script (`src/js/00-labels.js`) ánh xạ key → tên tiếng Việt; key không có trong bảng được tự "humanize", key gốc luôn hiện bằng chữ nhỏ.
Có thể tra theo path đầy đủ (vd `"ten_cong_ty.tieng_viet"`, `"thanh_vien[].ho_ten"`).
Với giấy tờ khác, vào ⚙ **Nạp bảng nhãn tuỳ chỉnh (.json)** — file dạng `{ "so_hoa_don": "Số hoá đơn", ... }` (nhớ trong trình duyệt).

## Phát triển

```bash
npm install                    # cài pdfjs-dist@3.11.174 (chỉ cần khi build)
npm run build                  # → dist/ocr-review.html + dist/ocr-review-gpkd.html
npm test                       # build + test Playwright (Chromium)
npm run test-data              # sinh lại test-data/ (ảnh PNG, PDF nhiều trang…)
npm run screenshots            # chụp màn hình 1920×1080 & 1280×720, sáng & tối → docs/screenshots/
```

```
src/app.html           khung HTML (placeholder {{CSS}}, {{PDFJS}}, {{PDFJS_WORKER}}, {{APP}})
src/app.css            giao diện (biến màu light/dark)
src/js/00-labels.js    LABELS
src/profiles/*.js      PROFILE: generic (mọi giấy tờ) | gpkd (schema + validators)
src/js/01-utils.js     utils: DOM, path, diff LCS, Levenshtein, CSV, JSON
src/js/02-state.js     state: tuỳ chọn, mô hình hồ sơ, trạng thái trường, phân tích thay đổi, undo/redo
src/js/03-fs.js        fs: File System Access API, fallback webkitdirectory, IndexedDB
src/js/04-viewer.js    viewer: ảnh/PDF, zoom/fit/pan/xoay, render lười theo IntersectionObserver
src/js/05-ui.js        toast, hộp thoại
src/js/06-form.js      form
src/js/07-raw.js       raw
src/js/08-diff.js      diff
src/js/09-report.js    report + CSV
src/js/10-app.js       điều phối, sidebar, lưu, phím tắt, kéo-thả
build.js               ghép tất cả + pdf.js thành file trong dist/
```

Ghi chú kỹ thuật:
- pdf.js `pdfjs-dist@3.11.174` bản UMD được nhúng inline; worker nằm trong `<script type="text/js-worker" id="pdf-worker">`, tạo Blob URL gán cho `GlobalWorkerOptions.workerSrc`
  (kèm `workerPort` để worker chạy luồng riêng khi mở bằng `file://`). `getDocument` gọi với `isEvalSupported: false` (vá CVE-2024-4367).
- Canvas PDF render lại theo `devicePixelRatio` (debounce), giới hạn ~16M pixel/canvas, chỉ render các trang đang hiển thị.
- TIFF: hiển thị thông báo "chưa hỗ trợ", vẫn duyệt được JSON.

Bộ dữ liệu test (`test-data/`, dữ liệu hư cấu): ảnh PNG + JSON, PDF 3 trang, thiếu file tài liệu, JSON lỗi cú pháp, CCCD (schema khác),
TIFF, thừa file, hồ sơ đã có `.reviewed.json`, PDF 20 trang + ~550 trường; `test-data-single/` là thư mục gốc chứa trực tiếp ảnh + json.
