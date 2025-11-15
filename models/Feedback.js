const mongoose = require("mongoose");

const FeedbackSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["Bug", "Feature Request", "Complaint", "Suggestion", "Other"],
      default: "Other",
    },
    status: {
      type: String,
      enum: ["Pending", "In Progress", "Resolved", "Closed"],
      default: "Pending",
    },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High", "Urgent"],
      default: "Medium",
    },
    adminResponse: {
      type: String,
      default: "",
    },
    attachments: [
      {
        url: String,
        type: String, // image, document, etc.
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Feedback", FeedbackSchema);
