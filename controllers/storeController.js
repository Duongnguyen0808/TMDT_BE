const Store = require("../models/Store");
const User = require("../models/User");

module.exports = {
  addStore: async (req, res) => {
    const { title, time, imageUrl, owner, code, logoUrl, coords } = req.body;
    if (
      !title ||
      !time ||
      !imageUrl ||
      !owner ||
      !code ||
      !logoUrl ||
      !coords ||
      !coords.latitude ||
      !coords.longitude ||
      !coords.address ||
      !coords.title
    ) {
      return res
        .status(400)
        .json({ status: false, message: "Bạn có một trường bị thiếu" });
    }
    try {
      // Lưu nguyên request body vì schema đã kiểm soát trường
      const newStore = new Store(req.body);
      await newStore.save();

      // Cập nhật userType từ Client sang Vendor
      await User.findByIdAndUpdate(owner, { userType: "Vendor" });

      res.status(201).json({
        status: true,
        message: "Cửa hàng đã thêm thành công",
        store: newStore,
      });
    } catch (e) {
      res.status(500).json({ status: false, message: e.message });
    }
  },

  getStoreById: async (req, res) => {
    try {
      const store = await Store.findById(req.params.id);
      if (!store)
        return res
          .status(404)
          .json({ status: false, message: "Không tìm thấy cửa hàng" });
      res.status(200).json(store);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  getStoreByOwner: async (req, res) => {
    const ownerId = req.user.id; // Lấy từ token
    try {
      const store = await Store.findOne({ owner: ownerId });
      if (!store) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy cửa hàng",
        });
      }
      res.status(200).json(store);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  getRandomStore: async (req, res) => {
    try {
      const code = req.params.code;
      let randomStore = [];

      if (code) {
        randomStore = await Store.aggregate([
          { $match: { code: code, isAvailable: true } },
          { $sample: { size: 5 } },
          { $project: { __v: 0 } },
        ]);
      }

      // Nếu không tìm được theo mã, fallback sang danh sách chung
      if (randomStore.length === 0) {
        randomStore = await Store.aggregate([
          { $match: { isAvailable: true } },
          { $sample: { size: 5 } },
          { $project: { __v: 0 } },
        ]);
      }

      res.status(200).json(randomStore);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  getAllNearByStore: async (req, res) => {
    try {
      const code = req.params.code; // Có thể undefined nếu gọi /all
      let allNearByStores = [];

      if (code) {
        allNearByStores = await Store.aggregate([
          { $match: { code: code, isAvailable: true } },
          { $project: { __v: 0 } },
        ]);
      }

      if (allNearByStores.length === 0 || !code) {
        allNearByStores = await Store.aggregate([
          { $match: { isAvailable: true } },
          { $project: { __v: 0 } },
        ]);
      }

      res.status(200).json(allNearByStores);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Tìm cửa hàng gần nhất dựa trên vị trí người dùng
  getNearbyStores: async (req, res) => {
    try {
      const { latitude, longitude, maxDistance = 10000 } = req.query; // maxDistance tính bằng mét (mặc định 10km)

      if (!latitude || !longitude) {
        return res.status(400).json({
          status: false,
          message: "Vui lòng cung cấp tọa độ (latitude, longitude)",
        });
      }

      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);

      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({
          status: false,
          message: "Tọa độ không hợp lệ",
        });
      }

      // Tìm cửa hàng gần nhất sử dụng $geoNear
      const nearbyStores = await Store.aggregate([
        {
          $geoNear: {
            near: {
              type: "Point",
              coordinates: [lng, lat], // [longitude, latitude]
            },
            distanceField: "distance", // Khoảng cách tính bằng mét
            maxDistance: parseInt(maxDistance),
            spherical: true,
            query: { isAvailable: true }, // Chỉ lấy cửa hàng đang hoạt động
          },
        },
        {
          $project: {
            __v: 0,
          },
        },
        {
          $sort: { distance: 1 }, // Sắp xếp theo khoảng cách tăng dần
        },
      ]);

      res.status(200).json({
        status: true,
        count: nearbyStores.length,
        stores: nearbyStores,
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Tính khoảng cách giao hàng
  calculateDeliveryDistance: async (req, res) => {
    try {
      const { storeId, userLatitude, userLongitude } = req.query;

      if (!storeId || !userLatitude || !userLongitude) {
        return res.status(400).json({
          status: false,
          message: "Thiếu thông tin cửa hàng hoặc vị trí người dùng",
        });
      }

      const store = await Store.findById(storeId);
      if (!store) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy cửa hàng",
        });
      }

      // Lấy tọa độ cửa hàng
      const storeLat = store.coords.latitude;
      const storeLng = store.coords.longitude;

      // Tính khoảng cách Haversine (km)
      const distance = calculateHaversineDistance(
        parseFloat(userLatitude),
        parseFloat(userLongitude),
        storeLat,
        storeLng
      );

      // Tính phí giao hàng (ví dụ: 5000đ cho km đầu, 3000đ/km tiếp theo)
      let deliveryFee = 5000; // Phí cơ bản
      if (distance > 1) {
        deliveryFee += Math.ceil(distance - 1) * 3000;
      }

      res.status(200).json({
        status: true,
        storeId: store._id,
        storeName: store.title,
        distance: distance.toFixed(2), // km
        deliveryFee: deliveryFee,
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
  // Cập nhật thông tin cửa hàng theo owner (partial update)
  updateStoreByOwner: async (req, res) => {
    const ownerId = req.user.id;
    try {
      const store = await Store.findOne({ owner: ownerId });
      if (!store) {
        return res.status(404).json({ status: false, message: "Không tìm thấy cửa hàng" });
      }
      const { title, time, logoUrl, coords } = req.body;
      if (title !== undefined) store.title = title;
      if (time !== undefined) store.time = time;
      if (logoUrl !== undefined && logoUrl) store.logoUrl = logoUrl;
      if (coords && typeof coords === 'object') {
        if (coords.address !== undefined) store.coords.address = coords.address;
        // Chỉ cho phép cập nhật địa chỉ, tránh mất lat/long
      }
      await store.save();
      return res.status(200).json({ status: true, message: "Cập nhật thành công", store });
    } catch (e) {
      return res.status(500).json({ status: false, message: e.message });
    }
  },
};

// Hàm tính khoảng cách Haversine
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Bán kính Trái Đất (km)
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
    Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Khoảng cách (km)
}

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}
