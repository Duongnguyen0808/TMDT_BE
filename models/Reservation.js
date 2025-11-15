const mongoose = require("mongoose");

const ReservationSchema = new mongoose.Schema(
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
    quantity: { type: Number, required: true },
    status: {
      type: String,
      enum: ["reserved", "confirmed", "expired"],
      default: "reserved",
    },
    // Tự động xóa sau 10 phút nếu không thanh toán
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 10 * 60 * 1000), // 10 phút
    },
  },
  { timestamps: true }
);

// TTL index: Tự động xóa reservation sau khi hết hạn
ReservationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index cho query
ReservationSchema.index({ userId: 1, productId: 1 });
ReservationSchema.index({ status: 1 });

module.exports = mongoose.model("Reservation", ReservationSchema);
