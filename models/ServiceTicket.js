const mongoose = require("mongoose");

const AttachmentSchema = new mongoose.Schema(
    {
        url: { type: String, required: true },
        type: { type: String, default: "other" },
        name: { type: String, default: "" },
        size: { type: Number },
    },
    { _id: false }
);

const MessageSchema = new mongoose.Schema(
    {
        authorType: {
            type: String,
            enum: ["Client", "Vendor", "Driver", "Admin", "System"],
            required: true,
        },
        authorId: { type: mongoose.Schema.Types.ObjectId },
        authorName: { type: String, default: "" },
        body: { type: String, required: true },
        attachments: { type: [AttachmentSchema], default: [] },
        internal: { type: Boolean, default: false },
        createdAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const ContextSchema = new mongoose.Schema(
    {
        orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
        storeId: { type: mongoose.Schema.Types.ObjectId, ref: "Store" },
        driverId: { type: mongoose.Schema.Types.ObjectId, ref: "Driver" },
        reservationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Reservation",
        },
        shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Shipment" },
    },
    { _id: false }
);

const ServiceTicketSchema = new mongoose.Schema(
    {
        code: { type: String, unique: true },
        subject: { type: String, required: true, trim: true },
        category: {
            type: String,
            enum: [
                "Order",
                "Payment",
                "Account",
                "Delivery",
                "Store",
                "Driver",
                "Settlement",
                "Technical",
                "Other",
            ],
            default: "Other",
        },
        priority: {
            type: String,
            enum: ["Low", "Normal", "High", "Urgent"],
            default: "Normal",
        },
        status: {
            type: String,
            enum: ["Pending", "In Progress", "WaitingRequester", "Resolved", "Closed"],
            default: "Pending",
        },
        description: { type: String, required: true },
        resolutionNote: { type: String, default: "" },
        attachments: { type: [AttachmentSchema], default: [] },
        requester: {
            id: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
                required: true,
            },
            type: {
                type: String,
                enum: ["Client", "Vendor", "Driver"],
                required: true,
            },
            name: { type: String },
            email: { type: String },
            phone: { type: String },
            storeId: { type: mongoose.Schema.Types.ObjectId, ref: "Store" },
        },
        context: { type: ContextSchema, default: () => ({}) },
        tags: { type: [String], default: [] },
        sourceApp: {
            type: String,
            enum: ["customer", "vendor", "shipper", "admin", "unknown"],
            default: "unknown",
        },
        messages: { type: [MessageSchema], default: [] },
        lastMessageAt: { type: Date, default: Date.now },
        resolvedAt: { type: Date },
    },
    { timestamps: true }
);

ServiceTicketSchema.pre("save", function handleCode(next) {
    if (!this.code) {
        const short = Math.random().toString(36).substring(2, 6).toUpperCase();
        this.code = `TK-${Date.now().toString(36).toUpperCase()}-${short}`;
    }
    if (this.messages && this.messages.length > 0) {
        this.lastMessageAt = this.messages[this.messages.length - 1].createdAt;
    }
    if (this.status === "Resolved" && !this.resolvedAt) {
        this.resolvedAt = new Date();
    }
    next();
});

ServiceTicketSchema.index({ "requester.id": 1, createdAt: -1 });
ServiceTicketSchema.index({ status: 1, priority: 1 });
ServiceTicketSchema.index({ code: 1 }, { unique: true });

module.exports = mongoose.model("ServiceTicket", ServiceTicketSchema);
