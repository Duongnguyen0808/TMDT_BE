const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema({
  appliancesId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Appliances",
    required: true,
  },
  quantity: { type: Number, required: true, default: 1 },
  price: { type: Number, required: true },
  additives: { type: Array },
  instructions: { type: String, default: "" },
});

const OrderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    orderItems: [orderItemSchema],
    orderTotal: { type: Number, required: true },
    deliveryFee: { type: Number, required: true },
    grandTotal: { type: Number, required: true },
    deliveryAddress: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Address",
      required: true,
    },
    storeAddress: { type: String, required: true },
    paymentMethod: { type: String, required: true },
    paymentStatus: {
      type: String,
      enum: ["Pending", "Completed", "Failed"],
      default: "Pending",
    },
    orderStatus: {
      type: String,
      enum: [
        "Placed",
        "Preparing",
        "Manual",
        "Delivered",
        "Cancelled",
        "Ready",
        "Ou_for_Delivery",
      ],
      default: "Pending",
    },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
    },
    storeCoords: [Number],
    recipientCoords: [Number],
    driverId: { type: String, default: "" },
    rating: { type: Number, default: 3, min: 1, max: 5 },
    feedback: { type: String },
    promoCode: { type: String, default: "" },
    discountAmount: { type: Number },
    note: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", OrderSchema);
