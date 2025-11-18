const mongoose = require("mongoose");

const ConversationSchema = new mongoose.Schema(
    {
        participants: {
            user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
            vendor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        },
        lastMessage: { type: String, default: "" },
        lastAt: { type: Date, default: Date.now },
        unreadForUser: { type: Number, default: 0 },
        unreadForVendor: { type: Number, default: 0 },
    },
    { timestamps: true }
);

ConversationSchema.index({ "participants.user": 1, "participants.vendor": 1 }, { unique: true });

module.exports = mongoose.model("Conversation", ConversationSchema);
