const mongoose = require('mongoose');

const VoucherSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true, unique: true },
    title: { type: String },
    description: { type: String },
    type: { type: String, enum: ['percentage', 'fixed'], required: true },
    value: { type: Number, required: true },
    maxDiscount: { type: Number },
    minOrderTotal: { type: Number, default: 0 },
    validFrom: { type: Date },
    validUntil: { type: Date },
    usageLimit: { type: Number },
    usedCount: { type: Number, default: 0 },
    storeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Store' }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

VoucherSchema.methods.isValidNow = function () {
  const now = new Date();
  if (!this.isActive) return false;
  if (this.validFrom && now < this.validFrom) return false;
  if (this.validUntil && now > this.validUntil) return false;
  if (this.usageLimit && this.usedCount >= this.usageLimit) return false;
  return true;
};

module.exports = mongoose.model('Voucher', VoucherSchema);