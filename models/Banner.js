const mongoose = require("mongoose");

const BannerSchema = new mongoose.Schema(
    {
        title: { type: String, required: true, trim: true },
        subtitle: { type: String, trim: true },
        description: { type: String, trim: true },
        imageUrl: { type: String, required: true, trim: true },
        category: { type: String, trim: true },
        redirectUrl: { type: String, trim: true },
        ctaText: { type: String, trim: true },
        actionType: {
            type: String,
            enum: ["none", "category", "url", "deeplink"],
            default: "none",
        },
        actionValue: { type: String, trim: true },
        isActive: { type: Boolean, default: true },
        productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Appliances" }],
        sortOrder: { type: Number, default: 0 },
        startAt: { type: Date },
        endAt: { type: Date },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    { timestamps: true }
);

module.exports = mongoose.model("Banner", BannerSchema);
