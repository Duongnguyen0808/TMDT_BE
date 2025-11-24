const mongoose = require("mongoose");

const walletTransactionSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: ["topup", "commission", "adjustment", "refund"],
            default: "topup",
        },
        amount: { type: Number, required: true },
        balanceAfter: { type: Number, required: true },
        description: { type: String, default: "" },
        order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
        reference: { type: String, default: "" },
        metadata: { type: mongoose.Schema.Types.Mixed },
        createdAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const driverWalletSchema = new mongoose.Schema(
    {
        driver: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            unique: true,
            required: true,
        },
        balance: { type: Number, default: 0 },
        currency: { type: String, default: "VND" },
        transactions: { type: [walletTransactionSchema], default: [] },
        lastTopupAt: { type: Date },
        lastChargeAt: { type: Date },
    },
    { timestamps: true }
);

driverWalletSchema.index({ driver: 1 });

driverWalletSchema.methods.appendTransaction = function appendTransaction(tx) {
    if (!tx || typeof tx.amount !== "number") return;
    this.transactions.unshift(tx);
    // Giữ tối đa 100 giao dịch gần nhất trên document để tránh phình to
    const MAX_LOG = 100;
    if (this.transactions.length > MAX_LOG) {
        this.transactions = this.transactions.slice(0, MAX_LOG);
    }
};

module.exports = mongoose.model("DriverWallet", driverWalletSchema);
