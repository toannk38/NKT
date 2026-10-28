/* =====================================================================
 * PROFILE — bản dành cho Giấy chứng nhận đăng ký doanh nghiệp (GPKD).
 * - schema: mẫu cấu trúc chuẩn → cảnh báo thiếu trường / trường ngoài mẫu,
 *   dùng làm khuôn khi thêm phần tử vào mảng rỗng.
 * - validators: kiểm tra định dạng riêng của GPKD (chỉ cảnh báo, không chặn lưu).
 * ===================================================================== */
const PROFILE = (() => {
  const PERSON = {
    ho_ten: '', gioi_tinh: '', ngay_sinh: '', dan_toc: '', quoc_tich: '',
    loai_giay_to: '', so_giay_to: '', ngay_cap: '', noi_cap: '',
    dia_chi_thuong_tru: '', dia_chi_lien_lac: ''
  };
  const digits = (v) => String(v).replace(/\D/g, '');

  return {
    id: 'gpkd',
    short: 'GPKD',
    title: 'Duyệt OCR · Giấy chứng nhận ĐKDN',
    description: 'Bản dành cho Giấy chứng nhận đăng ký doanh nghiệp: có mẫu trường chuẩn và kiểm tra định dạng riêng.',
    labels: {
      'thanh_vien[].ho_ten': 'Họ tên thành viên',
      'nguoi_dai_dien_theo_phap_luat[].ho_ten': 'Họ tên người đại diện',
      'tru_so_chinh.dia_chi': 'Địa chỉ trụ sở',
      'von_dieu_le.so_tien': 'Vốn điều lệ (số tiền)'
    },
    schema: {
      ma_so_doanh_nghiep: '',
      ten_cong_ty: { tieng_viet: '', tieng_nuoc_ngoai: '', viet_tat: '' },
      tru_so_chinh: { dia_chi: '', dien_thoai: '', fax: '', email: '', website: '' },
      von_dieu_le: { so_tien: '' },
      thanh_vien: [Object.assign({ phan_gop_von: '', ty_le: '', ghi_chu: '' }, PERSON)],
      nguoi_dai_dien_theo_phap_luat: [Object.assign({ chuc_danh: '' }, PERSON)]
    },
    validators: [
      {
        match: 'ma_so_doanh_nghiep',
        check: (v) => /^\d{10}(-\d{3})?$/.test(String(v).trim()) ? null
          : 'Mã số doanh nghiệp phải gồm 10 chữ số (chi nhánh: 10 số + "-" + 3 số)'
      },
      {
        match: 'so_giay_to',
        check: (v, ctx) => {
          const s = String(v).trim();
          if (!s) return null;
          const loai = String((ctx.parent && ctx.parent.loai_giay_to) || '').toLowerCase();
          if (/căn cước|cccd|định danh/.test(loai)) return /^\d{12}$/.test(s) ? null : 'Số CCCD/căn cước phải gồm 12 chữ số';
          if (/chứng minh|cmnd/.test(loai)) return /^(\d{9}|\d{12})$/.test(s) ? null : 'Số CMND phải gồm 9 hoặc 12 chữ số';
          if (/hộ chiếu|passport/.test(loai)) return /^[A-Z0-9]{6,12}$/i.test(s) ? null : 'Số hộ chiếu không hợp lệ';
          return null;
        }
      },
      {
        match: 'gioi_tinh',
        check: (v) => !String(v).trim() || /^(nam|nữ)$/i.test(String(v).trim()) ? null : 'Giới tính thường là "Nam" hoặc "Nữ"'
      },
      {
        match: 'ty_le',
        check: (v) => !String(v).trim() || /^\d{1,3}([.,]\d+)?\s*%?$/.test(String(v).trim()) ? null : 'Tỷ lệ nên là số phần trăm, vd "60" hoặc "60%"'
      },
      {
        match: /(^|\.)von_dieu_le\.so_tien$|(^|\.)phan_gop_von$/,
        check: (v) => {
          const s = String(v).trim();
          if (!s) return null;
          if (!/\d/.test(s)) return 'Số tiền không có chữ số';
          if (/^[\d.,\s]+(đồng|vnđ|vnd)?$/i.test(s) && digits(s).length >= 4) return null;
          return 'Số tiền nên có dạng "10.000.000.000 đồng"';
        }
      }
    ]
  };
})();
