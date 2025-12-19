const mongoose = require('mongoose');

// Schema cũ phục vụ broadcast notification thủ công
const PromotionSchema = new mongoose.Schema({
    title: { type: String, required: true },
    body: { type: String, required: true },
    imageUrl: { type: String }, // optional banner
    deepLink: { type: String }, // client navigates when tapped
}, { timestamps: true });
// Promotions model removed
module.exports = {};

module.exports = mongoose.model('Promotion', PromotionSchema);