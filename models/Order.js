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
    paymentMethod: {
      type: String,
      required: true,
      default: "Stripe",
      enum: ["Stripe", "PayPal", "Paypal", "Card", "VNPay", "COD"],
    },
    paymentStatus: {
      type: String,
      enum: ["Pending", "Completed", "Failed", "Refunded"],
      default: "Pending",
    },
    orderStatus: {
      type: String,
      enum: ["Pending", "Preparing", "Delivering", "Delivered", "Cancelled"],
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
    cancellationReason: { type: String, default: "" },
    // Return/Refund
    returnStatus: {
      type: String,
      enum: [
        "None",
        "Requested",
        "Approved",
        "Rejected",
        "Returned",
        "Refunded",
      ],
      default: "None",
    },
    returnReason: { type: String, default: "" },
    returnRequestedAt: { type: Date },
    returnProcessedAt: { type: Date },
    refundAmount: { type: Number, default: 0 },
    refundMethod: { type: String, default: "" },
    refundAt: { type: Date },
  },
  { timestamps: true }
);

// Indexes cho query hiệu quả
OrderSchema.index({ userId: 1, createdAt: -1 });
OrderSchema.index({ storeId: 1, orderStatus: 1 });
OrderSchema.index({ paymentStatus: 1 });
OrderSchema.index({ orderStatus: 1 });
OrderSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Order", OrderSchema);
