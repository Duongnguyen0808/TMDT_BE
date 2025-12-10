const mongoose = require("mongoose");
const DriverWalletTopup = require("../models/DriverWalletTopup");
const {
    getOrCreateWallet,
    creditWallet,
    debitWallet,
} = require("../utils/driverWallet");
const { buildVnpParams, createPaymentUrl } = require("../utils/vnpay");

// Hạn chế số tiền nạp nhỏ để giảm phí giao dịch
const MIN_TOPUP_AMOUNT = Number(process.env.DRIVER_TOPUP_MIN || 50000);

// Chặn mọi request không phải tài xế dùng ví này
function ensureDriver(req, res) {
    if (!req.user || req.user.userType !== "Driver") {
        res.status(403).json({ status: false, message: "Chỉ tài xế mới sử dụng ví" });
        return false;
    }
    return true;
}

module.exports = {
    getWallet: async (req, res) => {
        if (!ensureDriver(req, res)) return;
        try {
            const wallet = await getOrCreateWallet(req.user.id);
            return res.status(200).json({
                status: true,
                data: {
                    balance: wallet.balance,
                    currency: wallet.currency,
                    lastTopupAt: wallet.lastTopupAt,
                    lastChargeAt: wallet.lastChargeAt,
                    transactions: wallet.transactions.slice(0, 10),
                },
            });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    createTopupIntent: async (req, res) => {
        if (!ensureDriver(req, res)) return;
        const { amount, note = "" } = req.body || {};
        const numericAmount = Number(amount);
        if (!numericAmount || numericAmount < MIN_TOPUP_AMOUNT) {
            return res.status(400).json({
                status: false,
                message: `Số tiền tối thiểu để nạp là ${MIN_TOPUP_AMOUNT.toLocaleString()}đ`,
            });
        }

        try {
            const ipAddr = (
                req.headers["x-forwarded-for"] ||
                req.socket.remoteAddress ||
                ""
            ).toString();

            // Lưu lịch sử yêu cầu trước khi chuyển qua VNPay
            const topup = new DriverWalletTopup({
                driver: req.user.id,
                amount: numericAmount,
                ipAddress: ipAddr,
                note,
            });
            await topup.save();

            const tmnCode = (process.env.VNP_TMNCODE || "").trim();
            const hashSecret = (process.env.VNP_HASHSECRET || "").trim();
            const vnpUrl = (process.env.VNP_URL || "").trim();
            const returnUrl = (process.env.VNP_WALLET_RETURNURL || process.env.VNP_RETURNURL || "").trim();

            if (!tmnCode || !hashSecret || !vnpUrl || !returnUrl) {
                return res.status(500).json({ status: false, message: "VNPay env missing" });
            }

            const params = buildVnpParams({
                amount: numericAmount,
                orderId: topup._id.toString(),
                orderInfo: `Topup driver wallet ${topup._id}`,
                ipAddr,
                locale: "vn",
                currCode: "VND",
                returnUrl,
                tmnCode,
                expireMinutes: 15,
            });

            const url = createPaymentUrl(vnpUrl, params, hashSecret);

            return res.status(200).json({
                status: true,
                topupId: topup._id,
                url,
            });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    manualAdjust: async (req, res) => {
        if (!ensureDriver(req, res)) return;
        const { amount, action = "debit", note = "" } = req.body || {};
        const numericAmount = Number(amount);
        if (!numericAmount || numericAmount <= 0) {
            return res.status(400).json({ status: false, message: "Số tiền không hợp lệ" });
        }

        const isCredit = String(action).toLowerCase() === "credit";
        try {
            const description = note?.toString().trim() || (isCredit ? "Manual credit (test)" : "Manual debit (test)");
            const metadata = { source: "manual-adjust" };
            const wallet = isCredit
                ? await creditWallet(req.user.id, numericAmount, {
                    description,
                    reference: "manual-adjust",
                    metadata,
                })
                : await debitWallet(req.user.id, numericAmount, {
                    description,
                    reference: "manual-adjust",
                    metadata,
                });

            return res.status(200).json({
                status: true,
                message: isCredit ? "Đã cộng tiền vào ví" : "Đã trừ tiền khỏi ví",
                data: {
                    balance: wallet.balance,
                    currency: wallet.currency,
                    lastTopupAt: wallet.lastTopupAt,
                    lastChargeAt: wallet.lastChargeAt,
                },
            });
        } catch (error) {
            if (error && error.code === "INSUFFICIENT_DRIVER_WALLET_BALANCE") {
                return res.status(400).json({ status: false, message: "Ví không đủ để trừ số tiền này" });
            }
            return res.status(500).json({ status: false, message: error.message });
        }
    },
};
