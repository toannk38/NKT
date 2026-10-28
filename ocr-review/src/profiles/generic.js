/* =====================================================================
 * PROFILE — bản tổng quát: kiểm chấm mọi loại giấy tờ.
 * Không có mẫu (schema) cố định: mọi JSON được render generic.
 * ===================================================================== */
const PROFILE = {
  id: 'generic',
  short: 'Mọi loại giấy tờ',
  title: 'Duyệt kết quả OCR',
  description: 'Bản tổng quát: hiển thị và chấm mọi JSON kết quả OCR (object, mảng, giá trị lồng nhau).',
  labels: {},
  // Không ràng buộc schema
  schema: null,
  // Chỉ dùng các kiểm tra định dạng chung (ngày, email, điện thoại, khoảng trắng…)
  validators: []
};
