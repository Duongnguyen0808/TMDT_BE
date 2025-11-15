const mongoose = require("mongoose");

const CartSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appliances",
      required: true,
    },
    additives: { type: Array, require: false, default: [] },
    totalPrice: { type: Number, required: true },
    quantity: { type: Number, required: true },
  },
  { timestamps: true }
);

// Index cho query hiệu quả
CartSchema.index({ userId: 1 });
CartSchema.index({ productId: 1 });
CartSchema.index({ userId: 1, productId: 1 }, { unique: true });

module.exports = mongoose.model("Cart", CartSchema);
