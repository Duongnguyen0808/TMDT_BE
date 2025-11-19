const mongoose = require("mongoose");

const ShipperApplicationSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
        fullName: { type: String, required: true },
        phone: { type: String, required: true },
        vehicleType: {
            type: String,
            enum: ["motorbike", "car", "light_truck", "heavy_truck"],
            default: "motorbike"
        },
        vehiclePlate: { type: String, default: "" },
        idFrontUrl: { type: String, required: true },
        idBackUrl: { type: String, required: true },
        driverLicenseUrl: { type: String, required: true },
        vehicleRegUrl: { type: String, required: true },
        selfieUrl: { type: String, required: true },
        approvalStatus: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
        rejectionReason: { type: String, default: "" },
        reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        reviewedAt: { type: Date },
    },
    { timestamps: true }
);

ShipperApplicationSchema.index({ approvalStatus: 1, createdAt: -1 });

module.exports = mongoose.model("ShipperApplication", ShipperApplicationSchema);
