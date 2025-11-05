const mongoose = require('mongoose');

const AddressSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    addressLine1: { type: String, required: true },
    default: { type: Boolean, default: false },
    deliveryInstructions: { type: String, required: false },
    latitude: { type: Number, required: false },
    longitude: { type: Number, required: false },
    // Lưu hiển thị đầy đủ địa chỉ (từ autocomplete/place nếu có)
    displayName: { type: String, required: false },
    // refId từ VietMap (autocomplete v4)
    refId: { type: String, required: false },
    // Theo dõi vị trí dùng gần nhất và tần suất sử dụng
    usageCount: { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: Date.now },
}, { timestamps: true });

// Index để truy vấn địa chỉ gần đây nhanh hơn
AddressSchema.index({ userId: 1, lastUsedAt: -1 });

// Hook tự động cập nhật lastUsedAt khi tăng usageCount hoặc đặt default
AddressSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate() || {};
  const now = new Date();
  const hasIncUsage = update.$inc && typeof update.$inc.usageCount === 'number';
  const setDefaultTrue = update.default === true || (update.$set && update.$set.default === true);
  if (hasIncUsage || setDefaultTrue) {
    if (!update.$set) update.$set = {};
    update.$set.lastUsedAt = now;
    this.setUpdate(update);
  }
  next();
});

module.exports = mongoose.model('Address', AddressSchema);