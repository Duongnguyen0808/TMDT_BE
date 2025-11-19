const mongoose = require("mongoose");

// Logistics hub / warehouse node. Could represent central or local hubs.
// Simplified structure: each hub has coordinates and a type.
const HubSchema = new mongoose.Schema({
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    type: { type: String, enum: ["central", "local"], default: "local" },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    address: { type: String, default: "" },
    active: { type: Boolean, default: true },
});

HubSchema.index({ code: 1 });
HubSchema.index({ active: 1 });
HubSchema.index({ type: 1 });
HubSchema.index({ latitude: 1, longitude: 1 });

module.exports = mongoose.model("Hub", HubSchema);
