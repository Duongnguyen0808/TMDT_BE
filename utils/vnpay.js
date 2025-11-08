const crypto = require("crypto");

// Sắp xếp object theo alphabet
function sortObject(obj) {
  const sorted = {};
  const keys = Object.keys(obj);
  keys.sort();
  keys.forEach((key) => (sorted[key] = obj[key]));
  return sorted;
}

// Format ngày kiểu VNPay yêu cầu
function formatDateYYYYMMDDHHmmss(date = new Date()) {
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}${MM}${dd}${HH}${mm}${ss}`;
}

// Tạo hash SHA512
function hmacSHA512(secret, data) {
  return crypto.createHmac("sha512", secret).update(data, "utf8").digest("hex");
}

// Build tham số gửi đến VNPay
function buildVnpParams({
  amount,
  orderId,
  orderInfo,
  ipAddr,
  bankCode,
  locale = "vn",
  currCode = "VND",
  returnUrl,
  tmnCode,
  expireMinutes = 15,
}) {
  const createDate = formatDateYYYYMMDDHHmmss();
  const expireDate = formatDateYYYYMMDDHHmmss(
    new Date(Date.now() + expireMinutes * 60 * 1000)
  );

  // ✅ FIX: ép IP về IPv4 nếu đang chạy localhost
  if (!ipAddr || ipAddr === "::1" || ipAddr === "::ffff:127.0.0.1") {
    ipAddr = "127.0.0.1";
  }

  const params = {
    vnp_Version: "2.1.0",
    vnp_Command: "pay",
    vnp_TmnCode: tmnCode,
    vnp_Amount: Math.round(Number(amount) * 100),
    vnp_CurrCode: currCode,
    vnp_TxnRef: orderId,
    vnp_OrderInfo: orderInfo,
    vnp_OrderType: "other",
    vnp_Locale: locale,
    vnp_ReturnUrl: returnUrl,
    vnp_IpAddr: ipAddr,
    vnp_CreateDate: createDate,
    vnp_ExpireDate: expireDate,
  };

  if (bankCode) params.vnp_BankCode = bankCode;

  return sortObject(params);
}

// Tạo URL thanh toán có hash hợp lệ
function createPaymentUrl(baseUrl, params, hashSecret) {
  const sorted = sortObject(params);
  // Raw string (không encode) để log đối chiếu
  const rawData = Object.keys(sorted)
    .map((k) => `${k}=${sorted[k]}`)
    .join("&");

  // Dữ liệu để ký: encode theo URL và thay %20 bằng '+' (phù hợp form-urlencoded)
  const signData = Object.keys(sorted)
    .map((k) => `${k}=${encodeURIComponent(sorted[k]).replace(/%20/g, "+")}`)
    .join("&");

  // Đảm bảo hashSecret được trim trước khi dùng
  const secureHash = hmacSHA512(hashSecret.trim(), signData.trim());
  sorted.vnp_SecureHash = secureHash;

  // Tham số URL: encode và thay %20 bằng '+' để đồng nhất với cách ký
  const urlParams = Object.keys(sorted)
    .map((k) => `${k}=${encodeURIComponent(sorted[k]).replace(/%20/g, "+")}`)
    .join("&");

  const fullUrl = `${baseUrl}?${urlParams}`;

  console.log("--- VNPay URL Created ---");
  console.log("RAW:", rawData);
  console.log("SIGN ENCODED:", signData);
  console.log("HASH:", secureHash);
  console.log("URL:", fullUrl);

  return fullUrl;
}

// Xác thực chữ ký trả về từ VNPay
function verifySecureHash(query, hashSecret) {
  const { vnp_SecureHash, vnp_SecureHashType, ...rest } = query;
  const sorted = sortObject(rest);
  // Dữ liệu để ký: encode theo URL và thay %20 bằng '+'
  const signData = Object.keys(sorted)
    .map((k) => `${k}=${encodeURIComponent(sorted[k]).replace(/%20/g, "+")}`)
    .join("&");

  // Đảm bảo hashSecret được trim trước khi dùng
  const signed = hmacSHA512(hashSecret.trim(), signData.trim());

  console.log("--- Verify Hash ---");
  console.log("SIGN ENCODED:", signData);
  console.log("CALC:", signed);
  console.log("FROM VNPay:", vnp_SecureHash);

  return signed === vnp_SecureHash;
}

module.exports = {
  buildVnpParams,
  createPaymentUrl,
  verifySecureHash,
};
