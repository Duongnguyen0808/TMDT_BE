const mongoose = require("mongoose");

const DriverSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        vendor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
        vehicleType: { type: String, default: "motorbike" },
        vehiclePlate: { type: String, default: "" },
        status: {
            type: String,
            enum: ["offline", "available", "busy"],
            default: "offline",
        },
        note: { type: String, default: "" },
    },
    { timestamps: true }
);

DriverSchema.index({ vendor: 1, status: 1 });

module.exports = mongoose.model("Driver", DriverSchema);
