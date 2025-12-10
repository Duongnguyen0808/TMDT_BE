const crypto = require("crypto");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetchFn }) => fetchFn(...args));

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

async function requestVnpayRefund({
  orderId,
  amount,
  transactionDate,
  transactionNo,
  reason = "Refund order",
  createdBy = "system",
  transactionType,
}) {
  // API refund của VNPay yêu cầu bộ env tối thiểu, thiếu là fail ngay nên kiểm tra sớm để log dễ
  const apiUrl = (process.env.VNP_API_URL || "").trim();
  const tmnCode = (process.env.VNP_TMNCODE || "").trim();
  const hashSecret = (process.env.VNP_HASHSECRET || "").trim();
  if (!apiUrl || !tmnCode || !hashSecret) {
    throw new Error("VNPay refund env missing");
  }
  if (!transactionDate || !transactionNo) {
    throw new Error("Missing VNPay transaction metadata for refund");
  }

  const requestId = `refund${Date.now()}`;
  const createDate = formatDateYYYYMMDDHHmmss();
  const refundAmount = Math.round(Number(amount || 0) * 100);
  if (!refundAmount) {
    throw new Error("Refund amount must be greater than 0");
  }

  const payload = {
    vnp_RequestId: requestId,
    vnp_Version: "2.1.0",
    vnp_Command: "refund",
    vnp_TmnCode: tmnCode,
    vnp_TransactionType:
      transactionType || process.env.VNP_REFUND_TYPE || "02", // 02: full refund
    vnp_TxnRef: orderId,
    vnp_Amount: refundAmount,
    vnp_OrderInfo: `${reason} ${orderId}`.trim(),
    vnp_TransactionNo: transactionNo,
    vnp_TransactionDate: transactionDate,
    vnp_CreateBy: createdBy,
    vnp_CreateDate: createDate,
    vnp_IpAddr: "127.0.0.1",
    vnp_RefundReason: reason,
  };

  // VNPay bắt buộc sắp theo alphabet rồi ký giống như payment nên tái sử dụng helper ở trên
  const sorted = sortObject(payload);
  const signData = Object.keys(sorted)
    .map((k) => `${k}=${encodeURIComponent(sorted[k]).replace(/%20/g, "+")}`)
    .join("&");
  const secureHash = hmacSHA512(hashSecret.trim(), signData.trim());
  const body = { ...sorted, vnp_SecureHash: secureHash };

  // VNPay API trả JSON nên fetch trực tiếp, caller sẽ xử lý mã phản hồi chi tiết nếu cần
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  const success = data?.vnp_ResponseCode === "00";
  return {
    success,
    data,
    message: success ? "Refund success" : data?.vnp_Message || "Refund failed",
  };
}

module.exports = {
  buildVnpParams,
  createPaymentUrl,
  verifySecureHash,
  requestVnpayRefund,
};
