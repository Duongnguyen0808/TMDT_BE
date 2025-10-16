const mongoose = require('mongoose');

const StoreSchema = new mongoose.Schema({
    title: {type: String, required: true}, // Tên cửa hàng
    time: {type: String, required: true}, // Thời gian hoạt động
    imageUrl: {type: String, required: true}, // Hình ảnh chính
    appliances: {type: Array, default: []}, // Danh sách món 
    pickup: {type: Boolean, default: true}, // Cho phép lấy tại quán
    delivery: {type: Boolean, default: true}, // Cho phép giao hàng
    isAvailable: {type: Boolean, default: true}, // Cửa hàng đang hoạt động
    owner: {type: String, required: true}, // Chủ sở hữu
    code: {type: String, required: true}, // Mã cửa hàng
    logoUrl: {type: String, required: true}, // Logo cửa hàng
    rating: {type: Number, min: 1, max: 5, default: 3}, // Điểm đánh giá
    ratingCount: {type: String, default: "267"}, // Số lượng đánh giá
    verification: {type: String, default: "Đang chờ duyệt", enum: ["Đang chờ duyệt", "Đã xác minh", "Bị từ chối"]}, 
    verificationMessage: {type: String, default: "Cửa hàng của bạn đang được xem xét. Chúng tôi sẽ thông báo cho bạn khi quá trình xác minh hoàn tất."},
    coords: {
        id: {type: String },
        latitude: {type: Number, required: true},  // Vĩ độ
        longitude: {type: Number, required: true}, // Kinh độ
        latitudeDelta: {type: Number, default: 0.0122},
        longitudeDelta: {type: Number,  default: 0.0122},
        address: {type: String, required: true}, // Địa chỉ
        title: {type: String, required: true},   // Tên địa điểm
    } 
});

module.exports = mongoose.model('Store', StoreSchema);
