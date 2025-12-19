const Promotion = require('../models/Promotion');
const { sendPromotionBlast } = require('../utils/notification_service');

// Controller này bị deprecate, chỉ giữ route thống kê để DevOps truy xuất số liệu promotion cũ
module.exports = {
    // Promotions feature removed
    module.exports = {};
    // Endpoint nội bộ để xem lại lịch sử chiến dịch đã gửi (không tạo mới)
    stats: async (_req, res) => {
        try {
            const sent = await Promotion.find({ status: 'sent' }).select('title variant successCount failureCount sentAt userTypes');
            res.status(200).json({ status: true, items: sent });
        } catch (e) {
            res.status(500).json({ status: false, message: e.message });
        }
    },
};