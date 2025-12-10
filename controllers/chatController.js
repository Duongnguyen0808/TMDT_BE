const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Store = require("../models/Store");
const User = require("../models/User");

// Bảo vệ mọi API chat: vendorId phải là userType=Vendor hoặc sở hữu store
const ensureVendorUser = async (vendorId) => {
    const vendor = await User.findById(vendorId);
    if (!vendor) {
        const err = new Error("Vendor không tồn tại");
        err.status = 404;
        throw err;
    }

    if (vendor.userType !== "Vendor") {
        const ownsStore = await Store.exists({ owner: vendorId });
        if (ownsStore) {
            vendor.userType = "Vendor";
            await vendor.save();
        } else {
            const err = new Error("Tài khoản này không phải cửa hàng");
            err.status = 403;
            throw err;
        }
    }

    return vendor;
};

module.exports = {
    // Tạo hoặc lấy hội thoại giữa user (từ token) và vendor (body.vendorId)
    getOrCreateConversation: async (req, res) => {
        try {
            const userId = req.user.id;
            let { vendorId, storeId } = req.body;

            if (!vendorId && storeId) {
                // Client chỉ biết storeId => lấy owner làm đầu mối chat
                const store = await Store.findById(storeId).select("owner title");
                if (!store) {
                    return res.status(404).json({ status: false, message: "Không tìm thấy cửa hàng" });
                }
                vendorId = store.owner;
            }

            if (!vendorId) {
                return res.status(400).json({ status: false, message: "Thiếu vendorId" });
            }

            await ensureVendorUser(vendorId);

            let conv = await Conversation.findOne({
                "participants.user": userId,
                "participants.vendor": vendorId,
            });

            if (!conv) {
                // Lazy create hội thoại đầu tiên, tránh tạo trùng bằng unique constraint
                conv = new Conversation({
                    participants: { user: userId, vendor: vendorId },
                    lastMessage: "",
                    lastAt: new Date(),
                });
                await conv.save();
            }

            // return with peer names
            const vendor = await User.findById(vendorId);
            const user = await User.findById(userId);

            return res.status(200).json({
                status: true,
                data: {
                    id: conv._id,
                    participants: {
                        user: { id: user._id, name: user.username },
                        vendor: { id: vendor._id, name: vendor.username },
                    },
                    lastMessage: conv.lastMessage,
                    lastAt: conv.lastAt,
                },
            });
        } catch (error) {
            return res.status(error.status || 500).json({ status: false, message: error.message });
        }
    },

    // Vendor tạo hoặc lấy hội thoại với user cụ thể (body.userId)
    vendorGetOrCreateConversation: async (req, res) => {
        try {
            const vendorId = req.user.id; // vendor từ token
            const { userId } = req.body;
            if (!userId) return res.status(400).json({ status: false, message: "Thiếu userId" });

            // đảm bảo userId tồn tại
            const user = await User.findById(userId);
            if (!user) return res.status(404).json({ status: false, message: "Người dùng không tồn tại" });
            // đảm bảo vendor tồn tại và là Vendor
            await ensureVendorUser(vendorId);

            let conv = await Conversation.findOne({
                "participants.user": userId,
                "participants.vendor": vendorId,
            });

            if (!conv) {
                conv = new Conversation({
                    participants: { user: userId, vendor: vendorId },
                    lastMessage: "",
                    lastAt: new Date(),
                });
                await conv.save();
            }

            const vendor = await User.findById(vendorId);

            return res.status(200).json({
                status: true,
                data: {
                    id: conv._id,
                    participants: {
                        user: { id: user._id, name: user.username },
                        vendor: { id: vendor._id, name: vendor.username },
                    },
                    lastMessage: conv.lastMessage,
                    lastAt: conv.lastAt,
                },
            });
        } catch (error) {
            return res.status(error.status || 500).json({ status: false, message: error.message });
        }
    },

    // Danh sách hội thoại của user (role từ token)
    listUserConversations: async (req, res) => {
        try {
            const userId = req.user.id;
            const items = await Conversation.find({ "participants.user": userId })
                .sort({ lastAt: -1 })
                .lean();

            const vendorIds = items.map((c) => c.participants.vendor);
            const vendors = await User.find({ _id: { $in: vendorIds } })
                .select("_id username profile")
                .lean();
            const vendorMap = new Map(vendors.map((v) => [String(v._id), v]));

            const data = items.map((c) => ({
                id: c._id,
                peer: vendorMap.get(String(c.participants.vendor)) || null,
                lastMessage: c.lastMessage,
                lastAt: c.lastAt,
                unread: c.unreadForUser || 0,
            }));

            return res.status(200).json({ status: true, data });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    // Danh sách hội thoại của Vendor
    listVendorConversations: async (req, res) => {
        try {
            const vendorId = req.user.id;
            const items = await Conversation.find({ "participants.vendor": vendorId })
                .sort({ lastAt: -1 })
                .lean();

            const userIds = items.map((c) => c.participants.user);
            const users = await User.find({ _id: { $in: userIds } })
                .select("_id username profile")
                .lean();
            const userMap = new Map(users.map((u) => [String(u._id), u]));

            const data = items.map((c) => ({
                id: c._id,
                peer: userMap.get(String(c.participants.user)) || null,
                lastMessage: c.lastMessage,
                lastAt: c.lastAt,
                unread: c.unreadForVendor || 0,
            }));

            return res.status(200).json({ status: true, data });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    // Lấy tin nhắn theo hội thoại
    getMessages: async (req, res) => {
        try {
            const { id } = req.params; // conversation id
            const { limit = 30, before } = req.query;
            const lim = Math.min(parseInt(limit), 100);

            const filter = { conversation: id };
            if (before) filter.createdAt = { $lt: new Date(before) };

            const messages = await Message.find(filter)
                .sort({ createdAt: -1 })
                .limit(lim)
                .lean();

            // reset unread counter for current viewer
            const conversation = await Conversation.findById(id);
            if (conversation) {
                const me = await User.findById(req.user.id).select("userType");
                if (me && me.userType === "Vendor") {
                    if (conversation.unreadForVendor > 0) {
                        conversation.unreadForVendor = 0;
                        await conversation.save();
                    }
                } else {
                    if (conversation.unreadForUser > 0) {
                        conversation.unreadForUser = 0;
                        await conversation.save();
                    }
                }
            }

            return res.status(200).json({ status: true, data: messages.reverse() });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    // Gửi tin nhắn (REST fallback, cũng dùng để phát socket)
    sendMessage: async (req, res) => {
        try {
            const { id } = req.params; // conversation id
            const { content } = req.body;
            if (!content || !content.trim()) {
                return res.status(400).json({ status: false, message: "Nội dung trống" });
            }

            const conversation = await Conversation.findById(id);
            if (!conversation) return res.status(404).json({ status: false, message: "Không tìm thấy hội thoại" });

            const userId = req.user.id;
            const isMember =
                String(conversation.participants.user) === String(userId) ||
                String(conversation.participants.vendor) === String(userId);
            if (!isMember) {
                return res.status(403).json({ status: false, message: "Không có quyền trong hội thoại này" });
            }

            const me = await User.findById(userId).select("userType");
            // Lưu lịch sử để socket và mobile đồng bộ dễ dàng
            const msg = await Message.create({
                conversation: conversation._id,
                sender: userId,
                senderType: me.userType,
                content,
            });

            conversation.lastMessage = content;
            conversation.lastAt = new Date();
            // increase unread for the other side
            if (me.userType === "Vendor") {
                conversation.unreadForUser = (conversation.unreadForUser || 0) + 1;
            } else {
                // treat all non-vendor as client
                conversation.unreadForVendor = (conversation.unreadForVendor || 0) + 1;
            }
            await conversation.save();

            // emit via socket to room
            const io = req.app.get("io");
            if (io) {
                io.to(`conv:${conversation._id}`).emit("message:new", {
                    _id: msg._id,
                    conversation: String(conversation._id),
                    sender: String(userId),
                    senderType: me.userType,
                    content,
                    createdAt: msg.createdAt,
                });
                io.to(`conv:${conversation._id}`).emit("conversation:update", {
                    id: String(conversation._id),
                    lastMessage: conversation.lastMessage,
                    lastAt: conversation.lastAt,
                });
            }

            return res.status(201).json({ status: true, data: msg });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    // Unread summary for vendor grouped by user
    vendorUnreadSummary: async (req, res) => {
        try {
            const vendorId = req.user.id;
            const items = await Conversation.find({ "participants.vendor": vendorId })
                .select("participants unreadForVendor")
                .lean();
            const data = items
                .filter((c) => (c.unreadForVendor || 0) > 0)
                .map((c) => ({
                    userId: String(c.participants.user),
                    conversationId: String(c._id),
                    unread: c.unreadForVendor || 0,
                }));
            return res.status(200).json({ status: true, data });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },
};
