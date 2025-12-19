const mongoose = require("mongoose");

const driverWalletTopupSchema = new mongoose.Schema(
    {
        driver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        amount: { type: Number, required: true },
        currency: { type: String, default: "VND" },
        status: {
            type: String,
            enum: ["Pending", "Completed", "Failed"],
            default: "Pending",
        },
        paymentMethod: { type: String, default: "VNPay" },
        paymentReference: { type: String, default: "" },
        paymentData: { type: mongoose.Schema.Types.Mixed },
        ipAddress: { type: String, default: "" },
        note: { type: String, default: "" },
        completedAt: { type: Date },
    },
    { timestamps: true }
);

driverWalletTopupSchema.index({ driver: 1, status: 1 });

driverWalletTopupSchema.methods.markCompleted = function markCompleted(reference, payload) {
    this.status = "Completed";
    this.paymentReference = reference || this.paymentReference;
    this.paymentData = payload || this.paymentData;
    this.completedAt = new Date();
};

driverWalletTopupSchema.methods.markFailed = function markFailed(payload) {
    this.status = "Failed";
    this.paymentData = payload || this.paymentData;
    this.completedAt = new Date();
};

module.exports = mongoose.model("DriverWalletTopup", driverWalletTopupSchema);
