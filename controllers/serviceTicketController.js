const mongoose = require("mongoose");
const ServiceTicket = require("../models/ServiceTicket");
const User = require("../models/User");
const Store = require("../models/Store");

const allowedRequester = new Set(["Client", "Vendor", "Driver"]);
const allowedCategories = new Set([
    "Order",
    "Payment",
    "Account",
    "Delivery",
    "Store",
    "Driver",
    "Settlement",
    "Technical",
    "Other",
]);
const allowedPriorities = new Set(["Low", "Normal", "High", "Urgent"]);
const allowedStatuses = new Set([
    "Pending",
    "In Progress",
    "WaitingRequester",
    "Resolved",
    "Closed",
]);

const ticketOptions = {
    categories: Array.from(allowedCategories),
    priorities: Array.from(allowedPriorities),
    statuses: Array.from(allowedStatuses),
};

const normalizeAttachments = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr
        .filter((item) => item && typeof item === "object" && item.url)
        .map((item) => ({
            url: item.url,
            type: item.type || "other",
            name: item.name || "",
            size: item.size,
        }));
};

const normalizeTags = (tags) => {
    if (!Array.isArray(tags)) return [];
    return tags
        .map((tag) => `${tag}`.trim())
        .filter((tag) => tag.length)
        .slice(0, 8);
};

const parseObjectId = (value) =>
    mongoose.Types.ObjectId.isValid(value)
        ? new mongoose.Types.ObjectId(value)
        : undefined;

const buildRequestContext = ({ orderId, storeId, driverId, reservationId, shipmentId }) => {
    const context = {};
    if (orderId) {
        const id = parseObjectId(orderId);
        if (id) context.orderId = id;
    }
    if (storeId) {
        const id = parseObjectId(storeId);
        if (id) context.storeId = id;
    }
    if (driverId) {
        const id = parseObjectId(driverId);
        if (id) context.driverId = id;
    }
    if (reservationId) {
        const id = parseObjectId(reservationId);
        if (id) context.reservationId = id;
    }
    if (shipmentId) {
        const id = parseObjectId(shipmentId);
        if (id) context.shipmentId = id;
    }
    return context;
};

const loadRequesterMetadata = async (userId) => {
    const user = await User.findById(userId).select("username email phone userType");
    if (!user) return null;
    const data = {
        id: user._id,
        type: user.userType,
        name: user.username,
        email: user.email,
        phone: user.phone,
    };
    if (user.userType === "Vendor") {
        const store = await Store.findOne({ owner: String(user._id) }).select("_id");
        if (store) {
            data.storeId = store._id;
        }
    }
    return data;
};

const addMessage = (ticket, payload) => {
    ticket.messages.push({
        authorType: payload.authorType,
        authorId: payload.authorId,
        authorName: payload.authorName,
        body: payload.body,
        attachments: payload.attachments || [],
        internal: !!payload.internal,
        createdAt: payload.createdAt || new Date(),
    });
    ticket.lastMessageAt = new Date();
};

const mapSourceApp = (req) => {
    const header = (req.headers["x-client-app"] || "").toString().toLowerCase();
    if (["customer", "vendor", "shipper", "admin"].includes(header)) return header;
    const ua = (req.headers["user-agent"] || "").toLowerCase();
    if (ua.includes("vendor")) return "vendor";
    if (ua.includes("shipper")) return "shipper";
    return "unknown";
};

const paginateParams = (req) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(5, parseInt(req.query.limit, 10) || 20));
    return { page, limit, skip: (page - 1) * limit };
};

module.exports = {
    getTicketOptions(req, res) {
        return res.status(200).json({ status: true, data: ticketOptions });
    },

    async createTicket(req, res) {
        try {
            const requesterMeta = await loadRequesterMetadata(req.user.id);
            if (!requesterMeta) {
                return res.status(404).json({ status: false, message: "Không tìm thấy tài khoản" });
            }
            if (!allowedRequester.has(requesterMeta.type)) {
                return res.status(403).json({ status: false, message: "Loại tài khoản không được tạo yêu cầu" });
            }

            const { subject, description, category, priority, attachments, orderId, storeId, driverId, reservationId, shipmentId, tags } = req.body;
            if (!subject || !description) {
                return res.status(400).json({ status: false, message: "Tiêu đề và nội dung không được bỏ trống" });
            }

            const ticket = new ServiceTicket({
                subject: subject.trim(),
                description: description.trim(),
                category: allowedCategories.has(category) ? category : "Other",
                priority: allowedPriorities.has(priority) ? priority : "Normal",
                attachments: normalizeAttachments(attachments),
                requester: requesterMeta,
                context: buildRequestContext({ orderId, storeId, driverId, reservationId, shipmentId }),
                tags: normalizeTags(tags),
                sourceApp: mapSourceApp(req),
            });

            addMessage(ticket, {
                authorType: requesterMeta.type,
                authorId: requesterMeta.id,
                authorName: requesterMeta.name,
                body: description.trim(),
                attachments: normalizeAttachments(attachments),
            });

            await ticket.save();
            return res.status(201).json({ status: true, data: ticket });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    async listMyTickets(req, res) {
        try {
            const { page, limit, skip } = paginateParams(req);
            const query = { "requester.id": req.user.id };
            if (req.query.status && allowedStatuses.has(req.query.status)) {
                query.status = req.query.status;
            }
            const [items, total] = await Promise.all([
                ServiceTicket.find(query)
                    .sort({ lastMessageAt: -1 })
                    .skip(skip)
                    .limit(limit),
                ServiceTicket.countDocuments(query),
            ]);
            return res.status(200).json({
                status: true,
                data: items,
                pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
            });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    async getTicketById(req, res) {
        try {
            const { id } = req.params;
            const ticket = await ServiceTicket.findById(id);
            if (!ticket) {
                return res.status(404).json({ status: false, message: "Không tìm thấy yêu cầu" });
            }
            const isOwner = `${ticket.requester.id}` === req.user.id;
            if (!isOwner && req.user.userType !== "Admin") {
                return res.status(403).json({ status: false, message: "Bạn không thể xem yêu cầu này" });
            }
            return res.status(200).json({ status: true, data: ticket });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    async replyTicket(req, res) {
        try {
            const { id } = req.params;
            const { message, attachments } = req.body;
            if (!message || !message.trim()) {
                return res.status(400).json({ status: false, message: "Nội dung trả lời không được bỏ trống" });
            }
            const ticket = await ServiceTicket.findById(id);
            if (!ticket) {
                return res.status(404).json({ status: false, message: "Không tìm thấy yêu cầu" });
            }
            const isOwner = `${ticket.requester.id}` === req.user.id;
            const isAdmin = req.user.userType === "Admin";
            if (!isOwner && !isAdmin) {
                return res.status(403).json({ status: false, message: "Bạn không thể cập nhật yêu cầu này" });
            }
            const author = await User.findById(req.user.id).select("username userType");
            addMessage(ticket, {
                authorType: isAdmin ? "Admin" : ticket.requester.type,
                authorId: req.user.id,
                authorName: author?.username || "Người dùng",
                body: message.trim(),
                attachments: normalizeAttachments(attachments),
            });
            if (isAdmin) {
                ticket.status = req.body.status && allowedStatuses.has(req.body.status)
                    ? req.body.status
                    : ticket.status === "Pending"
                        ? "In Progress"
                        : ticket.status;
                if (ticket.status === "Resolved" && !ticket.resolvedAt) {
                    ticket.resolvedAt = new Date();
                }
                if (Array.isArray(req.body.tags)) {
                    ticket.tags = normalizeTags(req.body.tags);
                }
                if (typeof req.body.resolutionNote === "string") {
                    ticket.resolutionNote = req.body.resolutionNote;
                }
            } else {
                ticket.status = "Pending";
            }
            await ticket.save();
            return res.status(200).json({ status: true, data: ticket });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    async adminListTickets(req, res) {
        try {
            const filter = {};
            const { status, priority, category, requesterType, keyword } = req.query;
            if (status) {
                const list = status.split(",").filter((item) => allowedStatuses.has(item));
                if (list.length) filter.status = { $in: list };
            }
            if (priority) {
                const list = priority.split(",").filter((item) => allowedPriorities.has(item));
                if (list.length) filter.priority = { $in: list };
            }
            if (category) {
                const list = category.split(",").filter((item) => allowedCategories.has(item));
                if (list.length) filter.category = { $in: list };
            }
            if (requesterType) {
                const list = requesterType
                    .split(",")
                    .filter((item) => allowedRequester.has(item));
                if (list.length) filter["requester.type"] = { $in: list };
            }
            if (keyword && keyword.trim().length) {
                const regex = new RegExp(keyword.trim(), "i");
                filter.$or = [
                    { subject: regex },
                    { code: regex },
                    { description: regex },
                    { "requester.name": regex },
                ];
            }
            const { page, limit, skip } = paginateParams(req);
            const [items, total] = await Promise.all([
                ServiceTicket.find(filter)
                    .sort({ lastMessageAt: -1 })
                    .skip(skip)
                    .limit(limit),
                ServiceTicket.countDocuments(filter),
            ]);
            return res.status(200).json({
                status: true,
                data: items,
                pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
            });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    async adminUpdateTicket(req, res) {
        try {
            const { id } = req.params;
            const ticket = await ServiceTicket.findById(id);
            if (!ticket) {
                return res.status(404).json({ status: false, message: "Không tìm thấy yêu cầu" });
            }
            const { status, priority, category, tags, resolutionNote, context } = req.body;
            if (status && allowedStatuses.has(status)) {
                ticket.status = status;
                if (status === "Resolved" && !ticket.resolvedAt) {
                    ticket.resolvedAt = new Date();
                }
            }
            if (priority && allowedPriorities.has(priority)) {
                ticket.priority = priority;
            }
            if (category && allowedCategories.has(category)) {
                ticket.category = category;
            }
            if (Array.isArray(tags)) {
                ticket.tags = normalizeTags(tags);
            }
            if (typeof resolutionNote === "string") {
                ticket.resolutionNote = resolutionNote;
            }
            if (context && typeof context === "object") {
                const prev = ticket.context
                    ? typeof ticket.context.toObject === "function"
                        ? ticket.context.toObject()
                        : ticket.context
                    : {};
                ticket.context = {
                    ...prev,
                    ...buildRequestContext(context),
                };
            }
            await ticket.save();
            return res.status(200).json({ status: true, data: ticket });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },
};
