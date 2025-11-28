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
    paymentGatewayTxnId: { type: String, default: "" },
    paymentGatewayTxnDate: { type: String, default: "" },
    paymentGatewayBankCode: { type: String, default: "" },
    paymentGatewayTrace: { type: String, default: "" },
    paymentGatewayPayload: { type: mongoose.Schema.Types.Mixed },
    orderStatus: {
      type: String,
      enum: [
        "Pending",
        "Preparing",
        "ReadyForPickup",
        // New intermediate: vendor finished prep, system finding driver
        "WaitingShipper",
        "PickedUp",
        "Delivering",
        "Delivered",
        "Cancelled"
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
    deliveryDistanceKm: { type: Number, default: 0 },
    driverId: { type: String, default: "" },
    // Automated driver proposal workflow
    proposedDriverId: { type: String, default: "" }, // user id of proposed driver
    proposalExpiresAt: { type: Date }, // time limit for current proposal
    proposalAttempts: { type: Number, default: 0 }, // how many drivers tried
    proposalHistory: [{ type: String }], // list of driver user ids already proposed
    // Shop ↔ shipper pickup handover details
    shopReadyBy: { type: String, default: "" },
    pickupCode: { type: String, default: "" },
    pickupCodeExpiresAt: { type: Date },
    pickupReadyAt: { type: Date },
    pickupAssignedAt: { type: Date },
    pickupCheckinAt: { type: Date },
    pickupCheckinLocation: {
      latitude: { type: Number },
      longitude: { type: Number },
    },
    pickupConfirmedAt: { type: Date },
    pickupNotes: { type: String, default: "" },
    handoverPhoto: { type: String, default: "" },
    deliveryProofPhoto: { type: String, default: "" },
    deliveryProofAlbum: [{ type: String }],
    deliveryProofNote: { type: String, default: "" },
    deliveryProofRecipient: { type: String, default: "" },
    deliveryProofAt: { type: Date },
    deliveryProofBy: { type: String, default: "" },
    deliveryProofLocation: {
      latitude: { type: Number },
      longitude: { type: Number },
    },
    deliveryProofReminderSentAt: { type: Date },
    deliveryProofEscalatedAt: { type: Date },
    deliveryIssueStatus: {
      type: String,
      enum: ["None", "Warned", "Escalated", "Disputed", "Resolved"],
      default: "None",
    },
    deliveryIssueNote: { type: String, default: "" },
    shopDeliveryConfirmStatus: {
      type: String,
      enum: ["None", "Pending", "Confirmed", "Rejected"],
      default: "None",
    },
    shopDeliveryConfirmedAt: { type: Date },
    shopDeliveryConfirmedBy: { type: String, default: "" },
    shopDeliveryConfirmNote: { type: String, default: "" },
    shopDeliveryRejectReason: { type: String, default: "" },
    shopDeliveryRejectedAt: { type: Date },
    customerDisputeStatus: {
      type: String,
      enum: ["None", "Pending", "Resolved", "Rejected"],
      default: "None",
    },
    customerDisputeNote: { type: String, default: "" },
    customerDisputeAt: { type: Date },
    customerDisputeResolvedAt: { type: Date },
    customerDisputeResolution: { type: String, default: "" },
    customerDisputeEvidence: [{ type: String }],
    shipperPickupBy: { type: String, default: "" },
    // Khi tài xế nhận đơn
    driverAssignedAt: { type: Date },
    // Vị trí hiện tại của tài xế cho đơn này (cập nhật định kỳ)
    driverLocation: {
      latitude: { type: Number },
      longitude: { type: Number },
      updatedAt: { type: Date },
    },
    // Logistics hubs & status flow (separate from delivery orderStatus)
    originHub: { type: mongoose.Schema.Types.ObjectId, ref: "Hub" },
    localHub: { type: mongoose.Schema.Types.ObjectId, ref: "Hub" },
    logisticStatus: {
      type: String,
      enum: [
        "SellerPending",      // chờ shop xác nhận & chuẩn bị
        "ToOriginHub",        // đang chuyển tới kho tổng
        "AtOriginHub",        // đã ở kho tổng
        "ToLocalHub",         // đang chuyển tới kho địa phương
        "AtLocalHub",         // đã tới kho gần khách (sẵn sàng cho shipper)
        "PickedUp",           // shipper đã lấy hàng từ kho địa phương
        "Delivering",         // đang giao (trùng orderStatus Delivering)
        "Delivered",          // đã giao
        "Cancelled"           // hủy bỏ
      ],
      default: "SellerPending"
    },
    rating: { type: Number, default: 3, min: 1, max: 5 },
    feedback: { type: String },
    promoCode: { type: String, default: "" },
    discountAmount: { type: Number },
    note: { type: String },
    cancellationReason: { type: String, default: "" },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    cancelledAt: { type: Date },
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
    refundReference: { type: String, default: "" },
    refundResponse: { type: mongoose.Schema.Types.Mixed },
    driverCommissionAmount: { type: Number, default: 0 },
    driverCommissionChargedAt: { type: Date },
    driverPayoutAmount: { type: Number, default: 0 },
    driverPayoutAt: { type: Date },
    driverPayoutMethod: { type: String, default: "" },
    driverPayoutReference: { type: String, default: "" },
  },
  { timestamps: true }
);

// Indexes cho query hiệu quả
OrderSchema.index({ userId: 1, createdAt: -1 });
OrderSchema.index({ storeId: 1, orderStatus: 1 });
OrderSchema.index({ paymentStatus: 1 });
OrderSchema.index({ orderStatus: 1 });
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ pickupReadyAt: -1 });

module.exports = mongoose.model("Order", OrderSchema);
