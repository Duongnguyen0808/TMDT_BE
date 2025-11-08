const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    otp: { type: String, required: false, default: "none" },
    fcm: { type: String, required: false, default: "none" },
    password: { type: String, required: true },
    verification: { type: Boolean, default: false },
    phone: { type: String, default: "0123456789" },
    phoneVerification: { type: Boolean, default: false },
    // TTL-based auto deletion for unverified accounts
    // If set, MongoDB will automatically remove the document when expireAt time passes
    expireAt: { type: Date, required: false },
    address: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Address",
      required: false,
    },
    userType: {
      type: String,
      required: true,
      default: "Client",
      enum: ["Client", "Admin", "Vendor", "Driver"],
    },
    profile: {
      type: String,
      default:
        "https://ui-avatars.com/api/?name=User&background=6366f1&color=fff&size=200",
    },
  },
  { timestamps: true }
);

// TTL index: delete documents when expireAt time is reached
// Using expireAfterSeconds: 0 means the document expires exactly at expireAt
UserSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("User", UserSchema);
