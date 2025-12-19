const Order = require("../models/Order");
const User = require("../models/User");
const Store = require("../models/Store");
const Appliances = require("../models/Appliances");
const Voucher = require("../models/Voucher");
const ShipperApplication = require("../models/ShipperApplication");
const Rating = require("../models/Rating");

module.exports = {
  // Tổng quan Dashboard
  getDashboardOverview: async (req, res) => {
    try {
      // Đếm tổng số
      const totalUsers = await User.countDocuments();
      const totalStores = await Store.countDocuments();
      const totalProducts = await Appliances.countDocuments();
      const totalOrders = await Order.countDocuments();

      // Đếm theo trạng thái
      const pendingOrders = await Order.countDocuments({
        orderStatus: "Pending",
      });
      const completedOrders = await Order.countDocuments({
        orderStatus: "Delivered",
      });
      const cancelledOrders = await Order.countDocuments({
        orderStatus: "Cancelled",
      });

      // Tính tổng doanh thu
      const revenueResult = await Order.aggregate([
        { $match: { paymentStatus: "Completed" } },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$grandTotal" },
          },
        },
      ]);

      const totalRevenue = revenueResult[0]?.totalRevenue || 0;

      // Đếm user theo loại
      const userStats = await User.aggregate([
        {
          $group: {
            _id: "$userType",
            count: { $sum: 1 },
          },
        },
      ]);

      // Cửa hàng chờ duyệt
      const pendingStores = await Store.countDocuments({
        verification: "Đang chờ duyệt",
      });

      // Shipper chờ duyệt
      const pendingShippers = await ShipperApplication.countDocuments({
        approvalStatus: "pending",
      });

      res.status(200).json({
        status: true,
        data: {
          overview: {
            totalUsers,
            totalStores,
            totalProducts,
            totalOrders,
            totalRevenue,
            pendingStores,
            pendingShippers,
          },
          orders: {
            pending: pendingOrders,
            completed: completedOrders,
            cancelled: cancelledOrders,
          },
          users: userStats,
        },
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Thống kê doanh thu theo thời gian
  getRevenueStats: async (req, res) => {
    try {
      const { period = "month" } = req.query; // day, week, month, year

      let groupBy;
      switch (period) {
        case "day":
          groupBy = {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
            day: { $dayOfMonth: "$createdAt" },
          };
          break;
        case "week":
          groupBy = {
            year: { $year: "$createdAt" },
            week: { $week: "$createdAt" },
          };
          break;
        case "year":
          groupBy = { year: { $year: "$createdAt" } };
          break;
        default:
          // month
          groupBy = {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          };
      }

      const stats = await Order.aggregate([
        { $match: { paymentStatus: "Completed" } },
        {
          $group: {
            _id: groupBy,
            totalRevenue: { $sum: "$grandTotal" },
            orderCount: { $sum: 1 },
            avgOrderValue: { $avg: "$grandTotal" },
          },
        },
        { $sort: { "_id.year": -1, "_id.month": -1, "_id.day": -1 } },
        { $limit: 30 },
      ]);

      res.status(200).json({
        status: true,
        period,
        data: stats,
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Top cửa hàng theo doanh thu
  getTopStores: async (req, res) => {
    try {
      const { limit = 10 } = req.query;

      const topStores = await Order.aggregate([
        { $match: { paymentStatus: "Completed" } },
        {
          $group: {
            _id: "$storeId",
            totalRevenue: { $sum: "$grandTotal" },
            orderCount: { $sum: 1 },
          },
        },
        { $sort: { totalRevenue: -1 } },
        { $limit: parseInt(limit) },
        {
          $lookup: {
            from: "stores",
            localField: "_id",
            foreignField: "_id",
            as: "storeInfo",
          },
        },
        { $unwind: "$storeInfo" },
        {
          $project: {
            title: "$storeInfo.title",
            logoUrl: "$storeInfo.logoUrl",
            imageUrl: "$storeInfo.imageUrl",
            totalRevenue: 1,
            orderCount: 1,
            avgOrderValue: { $divide: ["$totalRevenue", "$orderCount"] },
          },
        },
      ]);

      res.status(200).json({
        status: true,
        data: topStores,
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Top sản phẩm bán chạy
  getTopProducts: async (req, res) => {
    try {
      const { limit = 10 } = req.query;

      const topProducts = await Order.aggregate([
        { $match: { paymentStatus: "Completed" } },
        { $unwind: "$orderItems" },
        {
          $group: {
            _id: "$orderItems.appliancesId",
            totalSold: { $sum: "$orderItems.quantity" },
            totalRevenue: {
              $sum: {
                $multiply: ["$orderItems.price", "$orderItems.quantity"],
              },
            },
          },
        },
        { $sort: { totalSold: -1 } },
        { $limit: parseInt(limit) },
        {
          $lookup: {
            from: "appliances",
            localField: "_id",
            foreignField: "_id",
            as: "productInfo",
          },
        },
        { $unwind: "$productInfo" },
        {
          $project: {
            productName: "$productInfo.title",
            imageUrl: "$productInfo.imageUrl",
            price: "$productInfo.price",
            totalSold: 1,
            totalRevenue: 1,
          },
        },
      ]);

      res.status(200).json({
        status: true,
        data: topProducts,
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Quản lý users
  getAllUsers: async (req, res) => {
    try {
      const {
        userType,
        verification,
        phoneVerification,
        page = 1,
        limit = 20,
      } = req.query;

      const query = {};
      if (userType) query.userType = userType;
      if (verification !== undefined)
        query.verification = verification === "true";
      if (phoneVerification !== undefined)
        query.phoneVerification = phoneVerification === "true";

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const users = await User.find(query)
        .select("-password -otp -__v")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await User.countDocuments(query);

      res.status(200).json({
        status: true,
        data: users,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Quản lý cửa hàng
  getAllStoresAdmin: async (req, res) => {
    try {
      const { verification, page = 1, limit = 20 } = req.query;

      const query = {};
      if (verification) query.verification = verification;

      const skip = (parseInt(page) - 1) * parseInt(limit);

      let stores = await Store.find(query)
        .populate("owner", "username email phone")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean();

      if (stores.length) {
        const storeIds = stores
          .map((store) => store?._id?.toString())
          .filter(Boolean);

        if (storeIds.length) {
          const ratingStats = await Rating.aggregate([
            {
              $match: {
                ratingType: "Store",
                product: { $in: storeIds },
              },
            },
            {
              $group: {
                _id: "$product",
                averageRating: { $avg: "$rating" },
                ratingCount: { $sum: 1 },
              },
            },
          ]);

          const ratingMap = ratingStats.reduce((acc, stat) => {
            acc[stat._id] = {
              averageRating: Number(
                Number.isFinite(stat.averageRating)
                  ? stat.averageRating
                  : 0
              ),
              ratingCount: stat.ratingCount || 0,
            };
            return acc;
          }, {});

          stores = stores.map((store) => {
            const stat = ratingMap[store._id.toString()];
            const fallbackRating =
              typeof store.rating === "number" && !Number.isNaN(store.rating)
                ? store.rating
                : 0;
            const fallbackCount =
              typeof store.ratingCount === "number" && store.ratingCount >= 0
                ? store.ratingCount
                : 0;

            return {
              ...store,
              rating:
                stat && Number.isFinite(stat.averageRating)
                  ? Number(stat.averageRating)
                  : fallbackRating,
              ratingCount:
                stat && Number.isFinite(stat.ratingCount)
                  ? stat.ratingCount
                  : fallbackCount,
            };
          });
        }
      }

      const total = await Store.countDocuments(query);

      res.status(200).json({
        status: true,
        data: stores,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Duyệt/Từ chối cửa hàng
  updateStoreVerification: async (req, res) => {
    try {
      const { id } = req.params;
      const { verification, verificationMessage } = req.body;

      if (!["Đã xác minh", "Bị từ chối"].includes(verification)) {
        return res.status(400).json({
          status: false,
          message: "Trạng thái không hợp lệ",
        });
      }

      const store = await Store.findByIdAndUpdate(
        id,
        {
          verification,
          verificationMessage:
            verificationMessage ||
            (verification === "Đã xác minh"
              ? "Cửa hàng của bạn đã được xác minh thành công"
              : "Cửa hàng của bạn bị từ chối xác minh"),
        },
        { new: true }
      );

      if (!store) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy cửa hàng",
        });
      }

      res.status(200).json({
        status: true,
        message: "Cập nhật trạng thái cửa hàng thành công",
        data: store,
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Thống kê theo khu vực
  getOrdersByRegion: async (req, res) => {
    try {
      const regionStats = await Order.aggregate([
        { $match: { paymentStatus: "Completed" } },
        {
          $group: {
            _id: "$storeAddress",
            orderCount: { $sum: 1 },
            totalRevenue: { $sum: "$grandTotal" },
          },
        },
        { $sort: { totalRevenue: -1 } },
        { $limit: 10 },
      ]);

      res.status(200).json({
        status: true,
        data: regionStats,
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Lấy tất cả orders
  getAllOrders: async (req, res) => {
    try {
      const { page = 1, limit = 20, orderStatus } = req.query;
      const skip = (page - 1) * limit;

      let filter = {};
      if (orderStatus) filter.orderStatus = orderStatus;

      const orders = await Order.find(filter)
        .populate("userId", "username email")
        .populate("storeId", "title")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await Order.countDocuments(filter);

      res.status(200).json({
        status: true,
        data: orders,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Lấy tất cả products
  getAllProducts: async (req, res) => {
    try {
      const { page = 1, limit = 20, keyword } = req.query;
      const skip = (page - 1) * limit;

      let filter = {};
      if (keyword) {
        filter.title = { $regex: keyword, $options: "i" };
      }

      let products = await Appliances.find(filter)
        .populate("store", "title logoUrl code")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean();

      if (products.length) {
        const productIds = products
          .map((product) => product?._id?.toString())
          .filter(Boolean);

        if (productIds.length) {
          const ratingStats = await Rating.aggregate([
            {
              $match: {
                ratingType: "Appliances",
                product: { $in: productIds },
              },
            },
            {
              $group: {
                _id: "$product",
                averageRating: { $avg: "$rating" },
                ratingCount: { $sum: 1 },
              },
            },
          ]);

          const ratingMap = ratingStats.reduce((acc, stat) => {
            acc[stat._id] = {
              averageRating: Number(
                Number.isFinite(stat.averageRating)
                  ? stat.averageRating
                  : 0
              ),
              ratingCount: stat.ratingCount || 0,
            };
            return acc;
          }, {});

          products = products.map((product) => {
            const stat = ratingMap[product._id.toString()];
            const fallbackRating =
              typeof product.rating === "number" &&
                !Number.isNaN(product.rating)
                ? product.rating
                : 0;
            const fallbackCount =
              typeof product.ratingCount === "number" &&
                product.ratingCount >= 0
                ? product.ratingCount
                : 0;

            return {
              ...product,
              rating:
                stat && Number.isFinite(stat.averageRating)
                  ? Number(stat.averageRating)
                  : fallbackRating,
              ratingCount:
                stat && Number.isFinite(stat.ratingCount)
                  ? stat.ratingCount
                  : fallbackCount,
            };
          });
        }
      }

      const total = await Appliances.countDocuments(filter);

      res.status(200).json({
        status: true,
        data: products,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Xóa product
  deleteProduct: async (req, res) => {
    try {
      await Appliances.findByIdAndDelete(req.params.id);
      res.status(200).json({
        status: true,
        message: "Đã xóa sản phẩm thành công",
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Xóa store
  deleteStore: async (req, res) => {
    try {
      await Store.findByIdAndDelete(req.params.id);
      res.status(200).json({
        status: true,
        message: "Đã xóa cửa hàng thành công",
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Xóa user
  deleteUser: async (req, res) => {
    try {
      await User.findByIdAndDelete(req.params.id);
      res.status(200).json({
        status: true,
        message: "Đã xóa người dùng thành công",
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Lấy chi tiết user
  getUserDetails: async (req, res) => {
    try {
      const user = await User.findById(req.params.id).select("-password");

      if (!user) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy người dùng",
        });
      }

      // Lấy thống kê đơn hàng nếu là Client
      let orderStats = null;
      if (user.userType === "Client") {
        const orders = await Order.find({ userId: user._id });
        orderStats = {
          totalOrders: orders.length,
          completedOrders: orders.filter((o) => o.orderStatus === "Delivered")
            .length,
          cancelledOrders: orders.filter((o) => o.orderStatus === "Cancelled")
            .length,
          totalSpent: orders
            .filter((o) => o.paymentStatus === "Completed")
            .reduce((sum, o) => sum + o.grandTotal, 0),
        };
      }

      // Lấy thông tin cửa hàng nếu là Vendor
      let storeInfo = null;
      if (user.userType === "Vendor") {
        storeInfo = await Store.findOne({ owner: user._id }).lean();
        if (storeInfo) {
          const [metrics] = await Order.aggregate([
            { $match: { storeId: storeInfo._id } },
            {
              $group: {
                _id: null,
                totalOrders: { $sum: 1 },
                completedOrders: {
                  $sum: {
                    $cond: [{ $eq: ["$orderStatus", "Delivered"] }, 1, 0],
                  },
                },
                cancelledOrders: {
                  $sum: {
                    $cond: [{ $eq: ["$orderStatus", "Cancelled"] }, 1, 0],
                  },
                },
                activeOrders: {
                  $sum: {
                    $cond: [
                      {
                        $in: [
                          "$orderStatus",
                          [
                            "Pending",
                            "Preparing",
                            "ReadyForPickup",
                            "WaitingShipper",
                            "PickedUp",
                            "Delivering",
                          ],
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                totalRevenue: {
                  $sum: {
                    $cond: [
                      { $eq: ["$paymentStatus", "Completed"] },
                      "$grandTotal",
                      0,
                    ],
                  },
                },
              },
            },
          ]);
          storeInfo.metrics = {
            totalOrders: metrics ? metrics.totalOrders || 0 : 0,
            completedOrders: metrics ? metrics.completedOrders || 0 : 0,
            cancelledOrders: metrics ? metrics.cancelledOrders || 0 : 0,
            activeOrders: metrics ? metrics.activeOrders || 0 : 0,
            totalRevenue: metrics ? metrics.totalRevenue || 0 : 0,
          };
        }
      }

      let driverStats = null;
      let shipperProfile = null;
      if (user.userType === "Driver") {
        const driverId = user._id.toString();
        shipperProfile = await ShipperApplication.findOne({
          user: user._id,
        }).lean();
        const statusBuckets = await Order.aggregate([
          { $match: { driverId } },
          {
            $group: {
              _id: "$orderStatus",
              count: { $sum: 1 },
              totalCommission: {
                $sum: { $ifNull: ["$driverCommissionAmount", 0] },
              },
              totalPayout: {
                $sum: { $ifNull: ["$driverPayoutAmount", 0] },
              },
            },
          },
        ]);

        const baseStats = {
          totalOrders: 0,
          completedOrders: 0,
          activeOrders: 0,
          cancelledOrders: 0,
          totalCommission: 0,
          totalPayout: 0,
          rating: user.rating || 0,
          ratingCount: user.ratingCount || 0,
        };
        const activeStatuses = [
          "Pending",
          "Preparing",
          "ReadyForPickup",
          "WaitingShipper",
          "PickedUp",
          "Delivering",
        ];

        statusBuckets.forEach((bucket) => {
          baseStats.totalOrders += bucket.count;
          baseStats.totalCommission += bucket.totalCommission || 0;
          baseStats.totalPayout += bucket.totalPayout || 0;
          if (bucket._id === "Delivered") {
            baseStats.completedOrders += bucket.count;
          } else if (bucket._id === "Cancelled") {
            baseStats.cancelledOrders += bucket.count;
          } else if (activeStatuses.includes(bucket._id)) {
            baseStats.activeOrders += bucket.count;
          }
        });

        driverStats = baseStats;
      }

      res.status(200).json({
        status: true,
        data: {
          user,
          orderStats,
          storeInfo,
          driverStats,
          shipperProfile,
        },
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // ============ VOUCHER MANAGEMENT ============

  // Lấy tất cả vouchers
  getAllVouchers: async (req, res) => {
    try {
      const { page = 1, limit = 20, search = "" } = req.query;

      let query = {};
      if (search) {
        query = {
          $or: [
            { code: { $regex: search, $options: "i" } },
            { title: { $regex: search, $options: "i" } },
          ],
        };
      }

      const vouchers = await Voucher.find(query)
        .populate("storeIds", "title")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      const total = await Voucher.countDocuments(query);

      res.status(200).json({
        status: true,
        data: vouchers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Tạo voucher mới
  createVoucher: async (req, res) => {
    try {
      const {
        code,
        title,
        description,
        type,
        value,
        maxDiscount,
        minOrderTotal,
        validFrom,
        validUntil,
        usageLimit,
        storeIds,
        isActive,
      } = req.body;

      // Kiểm tra mã voucher đã tồn tại
      const existing = await Voucher.findOne({ code: code.toUpperCase() });
      if (existing) {
        return res.status(400).json({
          status: false,
          message: "Mã voucher đã tồn tại",
        });
      }

      const voucher = new Voucher({
        code: code.toUpperCase(),
        title,
        description,
        type,
        value,
        maxDiscount,
        minOrderTotal,
        validFrom,
        validUntil,
        usageLimit,
        storeIds,
        isActive,
      });

      await voucher.save();

      res.status(201).json({
        status: true,
        message: "Tạo voucher thành công",
        data: voucher,
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Cập nhật voucher
  updateVoucher: async (req, res) => {
    try {
      const voucher = await Voucher.findByIdAndUpdate(
        req.params.id,
        { $set: req.body },
        { new: true }
      );

      if (!voucher) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy voucher",
        });
      }

      res.status(200).json({
        status: true,
        message: "Cập nhật voucher thành công",
        data: voucher,
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Xóa voucher
  deleteVoucher: async (req, res) => {
    try {
      await Voucher.findByIdAndDelete(req.params.id);
      res.status(200).json({
        status: true,
        message: "Đã xóa voucher thành công",
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
};
