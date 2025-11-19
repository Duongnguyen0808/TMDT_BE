const mongoose = require("mongoose");

const ShipmentSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true },
    orders: [{ type: mongoose.Schema.Types.ObjectId, ref: "Order" }],
    originHub: { type: mongoose.Schema.Types.ObjectId, ref: "Hub" },
    localHub: { type: mongoose.Schema.Types.ObjectId, ref: "Hub" },
    status: {
        type: String,
        enum: [
            "Creating",
            "Consolidating",
            "DepartOrigin",
            "ArriveOrigin",
            "DepartLocal",
            "ArriveLocal",
            "ReadyPickup",
            "Completed",
            "Cancelled"
        ],
        default: "Creating"
    },
    timeline: {
        CreatingAt: { type: Date, default: Date.now },
        ConsolidatingAt: { type: Date },
        DepartOriginAt: { type: Date },
        ArriveOriginAt: { type: Date },
        DepartLocalAt: { type: Date },
        ArriveLocalAt: { type: Date },
        ReadyPickupAt: { type: Date },
        CompletedAt: { type: Date },
        CancelledAt: { type: Date }
    }
}, { timestamps: true });

ShipmentSchema.index({ status: 1 });
ShipmentSchema.index({ originHub: 1, localHub: 1 });

module.exports = mongoose.model("Shipment", ShipmentSchema);
