const mongoose = require("mongoose");
const AppliancesSchema = new mongoose.Schema({
  title: { type: String, required: true },
  title_en: { type: String }, // Tiếng Anh
  time: { type: String, required: true },
  appliancesTags: { type: Array, required: true },
  category: { type: String, required: true },
  appliancesType: { type: Array, required: true },
  code: { type: String, required: true },
  isAvailable: { type: Boolean, default: true },
  store: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true },
  rating: { type: Number, min: 1, max: 5, default: 3 },
  ratingCount: { type: Number, default: 267 },
  averageRating: { type: Number, min: 0, max: 5, default: 0 },
  description: { type: String, required: true },
  description_en: { type: String }, // Tiếng Anh
  price: { type: Number, required: true },
  discount: { type: Number, min: 0, max: 100, default: 0 }, // % giảm giá
  additives: { type: Array, default: [] },
  imageUrl: { type: Array, required: true },
  stock: { type: Number, default: 999 }, // Số lượng tồn kho
  soldCount: { type: Number, default: 0 }, // Số lượng đã bán
});

// Indexes cho query hiệu quả
AppliancesSchema.index({ store: 1 });
AppliancesSchema.index({ category: 1 });
AppliancesSchema.index({ code: 1 });
AppliancesSchema.index({ isAvailable: 1 });
AppliancesSchema.index({ price: 1 });
AppliancesSchema.index({ rating: -1 });
AppliancesSchema.index({ soldCount: -1 });

module.exports = mongoose.model("Appliances", AppliancesSchema);
