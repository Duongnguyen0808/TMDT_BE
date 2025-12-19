const mongoose = require("mongoose");

const walletTransactionSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: ["deposit", "withdraw", "payout", "adjustment"],
            default: "deposit",
        },
        amount: { type: Number, required: true },
        balanceAfter: { type: Number, required: true },
        description: { type: String, default: "" },
        reference: { type: String, default: "" },
        metadata: { type: mongoose.Schema.Types.Mixed },
        createdAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const vendorWalletSchema = new mongoose.Schema(
    {
        owner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        store: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Store",
            required: true,
            unique: true,
        },
        balance: { type: Number, default: 0 },
        currency: { type: String, default: "VND" },
        transactions: { type: [walletTransactionSchema], default: [] },
        lastDepositAt: { type: Date },
        lastWithdrawAt: { type: Date },
    },
    { timestamps: true }
);

vendorWalletSchema.index({ owner: 1 });
vendorWalletSchema.index({ store: 1 });

vendorWalletSchema.methods.appendTransaction = function appendTransaction(tx) {
    if (!tx || typeof tx.amount !== "number") return;
    this.transactions.unshift(tx);
    const MAX_LOG = 100;
    if (this.transactions.length > MAX_LOG) {
        this.transactions = this.transactions.slice(0, MAX_LOG);
    }
};

module.exports = mongoose.model("VendorWallet", vendorWalletSchema);
