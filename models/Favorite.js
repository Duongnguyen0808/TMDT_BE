const mongoose = require("mongoose");

const FavoriteSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    appliancesId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appliances",
      required: true,
    },
  },
  { timestamps: true }
);

// Đảm bảo 1 user không thể thêm 1 sản phẩm vào favorites nhiều lần
FavoriteSchema.index({ userId: 1, appliancesId: 1 }, { unique: true });

module.exports = mongoose.model("Favorite", FavoriteSchema);
