const Order = require("../models/Order");
const DriverWalletTopup = require("../models/DriverWalletTopup");
const { creditWallet } = require("../utils/driverWallet");
const {
  buildVnpParams,
  createPaymentUrl,
  verifySecureHash,
} = require("../utils/vnpay");

const gatewayPayloadFromQuery = (query = {}) => ({
  paymentGatewayTxnId: query["vnp_TransactionNo"] || "",
  paymentGatewayTxnDate: query["vnp_PayDate"] || "",
  paymentGatewayBankCode: query["vnp_BankCode"] || "",
  paymentGatewayTrace: query["vnp_BankTranNo"] || "",
  paymentGatewayPayload: query,
});

async function handleWalletIpn(topup, query, rspCode) {
  if (!topup) {
    return { response: { RspCode: "01", Message: "Order not found" } };
  }

  if (rspCode === "00") {
    if (topup.status !== "Completed") {
      await creditWallet(topup.driver, topup.amount, {
        description: `VNPay top-up #${topup._id}`,
        reference: query["vnp_TransactionNo"] || topup.paymentReference,
        metadata: { source: "vnpay", payload: query },
      });
      topup.markCompleted(query["vnp_TransactionNo"], query);
      await topup.save();
    }
    return { response: { RspCode: "00", Message: "Wallet topup success" }, isWallet: true };
  }

  if (topup.status === "Pending") {
    topup.markFailed(query);
    await topup.save();
  }
  return { response: { RspCode: "00", Message: "Wallet topup failed" }, isWallet: true };
}

// POST /api/orders/payment
// Body: { userId, cartItems: [{ name, id: orderId, price, quantity, storeId }] }
// Returns: { url }
const createVnpayPayment = async (req, res) => {
  try {
    const { userId, cartItems = [] } = req.body || {};

    if (!cartItems.length) {
      return res
        .status(400)
        .json({ status: false, message: "CartItems empty" });
    }

    // Expect first item.id to be the orderId created previously
    const orderId = cartItems[0]?.id;
    if (!orderId) {
      return res
        .status(400)
        .json({ status: false, message: "Missing orderId" });
    }

    // Calculate amount from cart items
    const amount = cartItems.reduce((sum, item) => {
      const price = Number(item.price);
      const qty = Number(item.quantity || 1);
      return sum + (isNaN(price) ? 0 : price) * (isNaN(qty) ? 1 : qty);
    }, 0);

    const ipAddr = (
      req.headers["x-forwarded-for"] ||
      req.socket.remoteAddress ||
      ""
    ).toString();

    // Trim envs to avoid trailing spaces causing signature mismatch
    const tmnCode = (process.env.VNP_TMNCODE || "").trim();
    const hashSecret = (process.env.VNP_HASHSECRET || "").trim();
    const vnpUrl = (process.env.VNP_URL || "").trim(); // payment URL
    const returnUrl = (process.env.VNP_RETURNURL || "").trim(); // browser redirect URL

    // 💡 LOG DEBUG cấu hình VNPay sau khi trim
    console.log(
      "DEBUG: VNP_CONF tmnCode=",
      tmnCode,
      " hashSecret(first6)=",
      hashSecret.slice(0, 6),
      " vnpUrl=",
      vnpUrl,
      " returnUrl=",
      returnUrl
    );

    if (!tmnCode || !hashSecret || !vnpUrl || !returnUrl) {
      return res
        .status(500)
        .json({ status: false, message: "VNPay env missing" });
    }

    const params = buildVnpParams({
      amount,
      orderId,
      orderInfo: `Thanh toan don hang ${orderId} cho user ${userId || ""}`,
      ipAddr,
      locale: "vn",
      currCode: "VND",
      returnUrl,
      tmnCode,
      expireMinutes: 15,
    });

    const url = createPaymentUrl(vnpUrl, params, hashSecret);

    return res.status(200).json({ url });
  } catch (error) {
    console.error("[VNPay][create] error:", error);
    return res.status(500).json({
      status: false,
      message: "Create payment failed",
      error: error.message,
    });
  }
};

// GET /payment/vnpay/vnpay_return
// Handle browser redirect, verify signature, update order status and display result
const vnpayReturn = async (req, res) => {
  try {
    const query = req.query || {};
    // Đảm bảo hashSecret cũng được trim ở đây (lấy từ process.env)
    const hashSecret = (process.env.VNP_HASHSECRET || "").trim();
    const isValid = verifySecureHash(query, hashSecret);

    const txnRef = query["vnp_TxnRef"]; // our orderId
    const rspCode = query["vnp_ResponseCode"];

    if (!txnRef) {
      return res.status(400).send("Missing vnp_TxnRef");
    }

    const order = await Order.findById(txnRef);
    const walletTopup = order ? null : await DriverWalletTopup.findById(txnRef);

    if (!order && !walletTopup) {
      return res.status(404).send("Không tìm thấy giao dịch");
    }

    if (!isValid) {
      if (order) {
        await Order.findByIdAndUpdate(txnRef, {
          paymentStatus: "Failed",
          paymentMethod: "VNPay",
          ...gatewayPayloadFromQuery(query),
        });
      } else if (walletTopup) {
        walletTopup.markFailed(query);
        await walletTopup.save();
      }
      return res
        .status(200)
        .send(`Invalid signature. vnp_ResponseCode=${rspCode || ""}`);
    }

    if (order) {
      if (rspCode === "00") {
        await Order.findByIdAndUpdate(txnRef, {
          paymentStatus: "Completed",
          paymentMethod: "VNPay",
          ...gatewayPayloadFromQuery(query),
        });
        return res.status(200).send(`<!doctype html>
        <html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
        <body style="font-family:sans-serif;text-align:center;padding:24px;">
          <h3>Thanh toán thành công</h3>
          <p>Đơn hàng ${txnRef} đã được cập nhật.</p>
          <a href="/checkout-success" id="success-link">Tiếp tục</a>
          <script>window.location.href='/checkout-success';</script>
        </body></html>`);
      }

      await Order.findByIdAndUpdate(txnRef, {
        paymentStatus: "Failed",
        paymentMethod: "VNPay",
        ...gatewayPayloadFromQuery(query),
      });
      return res.status(200).send(`<!doctype html>
        <html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
        <body style="font-family:sans-serif;text-align:center;padding:24px;">
          <h3>Thanh toán thất bại</h3>
          <p>Mã phản hồi: ${rspCode}</p>
          <a href="/cancel" id="failed-link">Quay lại</a>
          <script>window.location.href='/cancel';</script>
        </body></html>`);
    }

    // Wallet top-up branch
    if (rspCode === "00") {
      walletTopup.paymentData = query;
      await walletTopup.save();
      return res.status(200).send(`<!doctype html>
        <html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
        <body style="font-family:sans-serif;text-align:center;padding:24px;">
          <h3>Nạp ví thành công</h3>
          <p>Thanh toán đã được ghi nhận, số dư sẽ cập nhật sau ít phút.</p>
          <a href="/wallet-success" id="success-link">Đóng</a>
          <script>window.location.href='/wallet-success';</script>
        </body></html>`);
    }

    walletTopup.markFailed(query);
    await walletTopup.save();
    return res.status(200).send(`<!doctype html>
        <html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
        <body style="font-family:sans-serif;text-align:center;padding:24px;">
          <h3>Nạp ví thất bại</h3>
          <p>Mã phản hồi: ${rspCode}</p>
          <a href="/wallet-failed" id="failed-link">Quay lại</a>
          <script>window.location.href='/wallet-failed';</script>
        </body></html>`);
  } catch (error) {
    console.error("[VNPay][return] error:", error);
    return res.status(500).send("Xử lý VNPay Return thất bại");
  }
};

// GET /payment/vnpay/vnpay_ipn
// Server-to-server IPN for reliable status update
const vnpayIpn = async (req, res) => {
  try {
    const query = req.query || {};
    // Đảm bảo hashSecret cũng được trim ở đây (lấy từ process.env)
    const hashSecret = (process.env.VNP_HASHSECRET || "").trim();
    const isValid = verifySecureHash(query, hashSecret);
    const txnRef = query["vnp_TxnRef"];
    const rspCode = query["vnp_ResponseCode"];

    if (!txnRef) {
      return res
        .status(200)
        .json({ RspCode: "01", Message: "Order not found" });
    }

    if (!isValid) {
      return res
        .status(200)
        .json({ RspCode: "97", Message: "Invalid signature" });
    }
    const order = await Order.findById(txnRef);
    if (order) {
      if (rspCode === "00") {
        await Order.findByIdAndUpdate(txnRef, {
          paymentStatus: "Completed",
          paymentMethod: "VNPay",
          ...gatewayPayloadFromQuery(query),
        });
        return res.status(200).json({ RspCode: "00", Message: "Success" });
      }
      await Order.findByIdAndUpdate(txnRef, {
        paymentStatus: "Failed",
        paymentMethod: "VNPay",
        ...gatewayPayloadFromQuery(query),
      });
      return res
        .status(200)
        .json({ RspCode: "00", Message: "Failed updated" });
    }

    const walletTopup = await DriverWalletTopup.findById(txnRef);
    const walletResult = await handleWalletIpn(walletTopup, query, rspCode);
    return res.status(200).json(walletResult.response);
  } catch (error) {
    console.error("[VNPay][ipn] error:", error);
    return res.status(200).json({ RspCode: "99", Message: "Unknown error" });
  }
};

module.exports = {
  createVnpayPayment,
  vnpayReturn,
  vnpayIpn,
};
