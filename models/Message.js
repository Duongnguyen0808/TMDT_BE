const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema(
    {
        conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
        sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        senderType: { type: String, enum: ["Client", "Vendor", "Admin", "Driver"], required: true },
        content: { type: String, required: true },
        seen: { type: Boolean, default: false },
    },
    { timestamps: true }
);

MessageSchema.index({ conversation: 1, createdAt: -1 });

module.exports = mongoose.model("Message", MessageSchema);
