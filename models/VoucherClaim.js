const mongoose = require('mongoose');

const VoucherClaimSchema = new mongoose.Schema(
    {
        voucher: { type: mongoose.Schema.Types.ObjectId, ref: 'Voucher', required: true },
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        claimedAt: { type: Date, default: Date.now },
        used: { type: Boolean, default: false },
        usedAt: { type: Date },
    },
    { timestamps: true }
);

// A user can only claim a specific voucher once
VoucherClaimSchema.index({ voucher: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('VoucherClaim', VoucherClaimSchema);
