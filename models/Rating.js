const mongoose = require("mongoose");

const RatingSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    ratingType: {
      type: String,
      required: true,
      enum: ["Store", "Driver", "Appliances", "Customer"],
    },
    product: { type: String, required: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Rating", RatingSchema);
