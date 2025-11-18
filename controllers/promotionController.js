const Promotion = require('../models/Promotion');
const { sendPromotionBlast } = require('../utils/notification_service');

module.exports = {
    // Promotions feature removed
    module.exports = {};
    stats: async (_req, res) => {
        try {
            const sent = await Promotion.find({ status: 'sent' }).select('title variant successCount failureCount sentAt userTypes');
            res.status(200).json({ status: true, items: sent });
        } catch (e) {
            res.status(500).json({ status: false, message: e.message });
        }
    },
};