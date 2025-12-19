const { getOrCreateWallet, creditVendorWallet, debitVendorWallet } = require("../utils/vendorWallet");

// Giới hạn tối thiểu cho thao tác nạp/rút thủ công để tránh giao dịch lẻ
const MIN_VENDOR_ADJUST = Number(process.env.VENDOR_WALLET_MIN || 10000);

// Chuẩn hoá payload trả về để FE tái sử dụng giữa summary/transactions
function mapWalletResponse(ctx, { limitTransactions = 20 } = {}) {
    const wallet = ctx.wallet;
    const store = ctx.store;
    return {
        store: store
            ? {
                id: String(store._id),
                title: store.title,
            }
            : null,
        balance: wallet.balance,
        currency: wallet.currency,
        lastDepositAt: wallet.lastDepositAt,
        lastWithdrawAt: wallet.lastWithdrawAt,
        transactions: wallet.transactions.slice(0, limitTransactions).map((tx) => ({
            type: tx.type,
            amount: tx.amount,
            balanceAfter: tx.balanceAfter,
            description: tx.description,
            reference: tx.reference,
            metadata: tx.metadata,
            createdAt: tx.createdAt,
        })),
    };
}

function handleError(res, error) {
    if (error?.code === "STORE_NOT_FOUND") {
        return res.status(404).json({ status: false, message: "Không tìm thấy cửa hàng cho tài khoản này" });
    }
    if (error?.code === "INSUFFICIENT_VENDOR_WALLET_BALANCE") {
        return res.status(400).json({ status: false, message: "Số dư ví không đủ để rút" });
    }
    if (error?.code === "AMOUNT_INVALID") {
        return res.status(400).json({ status: false, message: "Số tiền không hợp lệ" });
    }
    if (error?.code === "OWNER_REQUIRED") {
        return res.status(400).json({ status: false, message: "Thiếu thông tin tài khoản" });
    }
    return res.status(500).json({ status: false, message: error?.message || "Lỗi không xác định" });
}

module.exports = {
    summary: async (req, res) => {
        try {
            // getOrCreateWallet tự gắn store mặc định rồi trả về balance hiện tại
            const ctx = await getOrCreateWallet(req.user.id);
            return res.status(200).json({ status: true, data: mapWalletResponse(ctx) });
        } catch (error) {
            return handleError(res, error);
        }
    },

    transactions: async (req, res) => {
        try {
            const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 20, 100));
            const ctx = await getOrCreateWallet(req.user.id);
            const response = mapWalletResponse(ctx, { limitTransactions: limit });
            return res.status(200).json({ status: true, data: response.transactions });
        } catch (error) {
            return handleError(res, error);
        }
    },

    deposit: async (req, res) => {
        try {
            const amount = Number(req.body?.amount);
            const note = req.body?.note?.toString().trim();
            if (!amount || amount < MIN_VENDOR_ADJUST) {
                return res.status(400).json({
                    status: false,
                    message: `Số tiền tối thiểu là ${MIN_VENDOR_ADJUST.toLocaleString()}đ`,
                });
            }
            const ctx = await creditVendorWallet(req.user.id, amount, {
                description: note && note.length ? note : "Nạp ví cửa hàng",
                reference: "vendor-manual-deposit",
            });
            return res.status(200).json({
                status: true,
                message: "Đã nạp tiền vào ví",
                data: mapWalletResponse(ctx),
            });
        } catch (error) {
            return handleError(res, error);
        }
    },

    withdraw: async (req, res) => {
        try {
            const amount = Number(req.body?.amount);
            const note = req.body?.note?.toString().trim();
            if (!amount || amount < MIN_VENDOR_ADJUST) {
                return res.status(400).json({
                    status: false,
                    message: `Số tiền tối thiểu là ${MIN_VENDOR_ADJUST.toLocaleString()}đ`,
                });
            }
            const ctx = await debitVendorWallet(req.user.id, amount, {
                description: note && note.length ? note : "Rút ví cửa hàng",
                reference: "vendor-manual-withdraw",
            });
            return res.status(200).json({
                status: true,
                message: "Đã rút tiền khỏi ví",
                data: mapWalletResponse(ctx),
            });
        } catch (error) {
            return handleError(res, error);
        }
    },
};
