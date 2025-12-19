const User = require('../models/User');
const { isValidFcmToken } = require('../utils/notification_service');

/**
 * POST /api/fcm/register
 * body: { userId?, email?, token, projectId? }
 * - Cập nhật FCM token cho user, lưu projectId nếu có (đa project)
 */
exports.registerToken = async (req, res) => {
    try {
        const { userId, email, token, projectId } = req.body;
        if (!token) return res.status(400).json({ success: false, message: 'Thiếu token' });
        if (!isValidFcmToken(token)) return res.status(400).json({ success: false, message: 'Token không hợp lệ' });
        if (!userId && !email) return res.status(400).json({ success: false, message: 'Cần userId hoặc email' });

        // Cho phép lookup theo userId hoặc email để phục vụ app public lẫn dashboard
        const query = userId ? { _id: userId } : { email };
        const user = await User.findOne(query);
        if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy user' });

        // Một user chỉ giữ một token cuối cùng, nên ghi đè trực tiếp để tránh gửi nhầm
        user.fcm = token;
        if (projectId) user.fcmProject = projectId; // lưu projectId client gửi lên
        await user.save();

        return res.json({ success: true, message: 'Đã cập nhật token', userId: user._id, projectId: user.fcmProject });
    } catch (e) {
        return res.status(500).json({ success: false, message: e.message });
    }
};

/**
 * POST /api/fcm/delete
 * body: { userId?, email? }
 * - Xoá token (set về 'none') khi user logout hoặc uninstall.
 */
exports.deleteToken = async (req, res) => {
    try {
        const { userId, email } = req.body;
        if (!userId && !email) return res.status(400).json({ success: false, message: 'Cần userId hoặc email' });
        const query = userId ? { _id: userId } : { email };
        const user = await User.findOne(query);
        if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy user' });
        // Reset token về 'none' để các job gửi thông báo bỏ qua user này
        user.fcm = 'none';
        user.fcmProject = '';
        await user.save();
        return res.json({ success: true, message: 'Đã xoá token', userId: user._id });
    } catch (e) {
        return res.status(500).json({ success: false, message: e.message });
    }
};

/**
 * GET /api/fcm/my-token?userId=... | email=...
 */
exports.getTokenInfo = async (req, res) => {
    try {
        const { userId, email } = req.query;
        if (!userId && !email) return res.status(400).json({ success: false, message: 'Cần userId hoặc email' });
        const query = userId ? { _id: userId } : { email };
        const user = await User.findOne(query).select('fcm fcmProject');
        if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy user' });
        return res.json({ success: true, fcm: user.fcm, projectId: user.fcmProject });
    } catch (e) {
        return res.status(500).json({ success: false, message: e.message });
    }
};
