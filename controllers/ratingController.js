const mongoose = require("mongoose");
const Rating = require("../models/Rating");
const Store = require("../models/Store");
const Appliances = require("../models/Appliances");
const Order = require("../models/Order");
const User = require("../models/User");

const ROLE_ALLOWED_TARGETS = Object.freeze({
  Client: new Set(["Store", "Driver", "Appliances"]),
  Driver: new Set(["Store"]),
  Vendor: new Set(["Driver", "Customer"]),
  Admin: new Set(["Store", "Driver", "Appliances", "Customer"]),
});

const RATING_LABELS = Object.freeze({
  Store: "cửa hàng",
  Driver: "shipper",
  Appliances: "sản phẩm",
  Customer: "khách hàng",
});

const toObjectId = (value) =>
  mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : null;

const buildTargetLabel = (ratingType) => RATING_LABELS[ratingType] || "đối tượng";

const ensureRoleAllowed = (userType, ratingType) => {
  const allowed = ROLE_ALLOWED_TARGETS[userType];
  return allowed ? allowed.has(ratingType) : false;
};

const fetchVendorStoreIds = async (vendorId) => {
  if (!vendorId) return [];
  const stores = await Store.find({ owner: vendorId }).select("_id").lean();
  return stores.map((store) => store._id);
};

const ensureTargetExists = async (ratingType, targetId) => {
  switch (ratingType) {
    case "Store":
      return Store.findById(targetId).select("_id title").lean();
    case "Appliances":
      return Appliances.findById(targetId).select("_id title").lean();
    case "Driver":
      return User.findOne({ _id: targetId, userType: "Driver" })
        .select("_id username")
        .lean();
    case "Customer":
      return User.findOne({ _id: targetId, userType: "Client" })
        .select("_id username")
        .lean();
    default:
      return null;
  }
};

const hasEligibleOrder = async ({ reviewer, ratingType, targetId }) => {
  try {
    const reviewerId = toObjectId(reviewer.id);
    switch (ratingType) {
      case "Appliances": {
        if (!reviewerId) return false;
        const applianceId = toObjectId(targetId);
        if (!applianceId) return false;
        return !!(await Order.exists({
          userId: reviewerId,
          orderStatus: "Delivered",
          "orderItems.appliancesId": applianceId,
        }));
      }
      case "Store": {
        const storeId = toObjectId(targetId);
        if (!storeId) return false;
        if (reviewer.userType === "Client") {
          if (!reviewerId) return false;
          return !!(await Order.exists({
            userId: reviewerId,
            storeId,
            orderStatus: "Delivered",
          }));
        }
        if (reviewer.userType === "Driver") {
          return !!(await Order.exists({
            driverId: String(reviewer.id),
            storeId,
            orderStatus: "Delivered",
          }));
        }
        return false;
      }
      case "Driver": {
        if (reviewer.userType === "Client") {
          if (!reviewerId) return false;
          return !!(await Order.exists({
            userId: reviewerId,
            driverId: targetId,
            orderStatus: "Delivered",
          }));
        }
        if (reviewer.userType === "Vendor") {
          const vendorStores = await fetchVendorStoreIds(reviewer.id);
          if (!vendorStores.length) return false;
          return !!(await Order.exists({
            storeId: { $in: vendorStores },
            driverId: targetId,
            orderStatus: "Delivered",
          }));
        }
        return false;
      }
      case "Customer": {
        if (reviewer.userType !== "Vendor") return false;
        const customerId = toObjectId(targetId);
        if (!customerId) return false;
        const vendorStores = await fetchVendorStoreIds(reviewer.id);
        if (!vendorStores.length) return false;
        return !!(await Order.exists({
          storeId: { $in: vendorStores },
          userId: customerId,
          orderStatus: "Delivered",
        }));
      }
      default:
        return false;
    }
  } catch (error) {
    console.warn("[rating] eligibility check failed", error?.message || error);
    return false;
  }
};

const recalcAggregateRating = async (ratingType, targetId) => {
  const stats = await Rating.aggregate([
    { $match: { ratingType, product: targetId } },
    {
      $group: {
        _id: "$product",
        averageRating: { $avg: "$rating" },
        ratingCount: { $sum: 1 },
      },
    },
  ]);

  if (!stats.length) return;
  const { averageRating, ratingCount } = stats[0];
  if (ratingType === "Store") {
    await Store.findByIdAndUpdate(targetId, {
      rating: averageRating,
      ratingCount,
    });
  } else if (ratingType === "Appliances") {
    await Appliances.findByIdAndUpdate(targetId, {
      rating: averageRating,
      ratingCount,
    });
  } else if (ratingType === "Driver" || ratingType === "Customer") {
    await User.findByIdAndUpdate(targetId, {
      rating: averageRating,
      ratingCount,
    });
  }
};

module.exports = {
  async checkUserPurchased(req, res) {
    try {
      const reviewer = req.user;
      const ratingType = (req.params.ratingType || "").trim();
      const targetId = (req.params.product || "").trim();
      if (!ratingType || !targetId) {
        return res
          .status(400)
          .json({ status: false, message: "Thiếu loại hoặc đối tượng cần đánh giá" });
      }

      if (!ensureRoleAllowed(reviewer.userType, ratingType) && reviewer.userType !== "Admin") {
        return res.status(403).json({
          status: false,
          message: `Tài khoản của bạn không được đánh giá ${buildTargetLabel(ratingType)}`,
        });
      }

      const target = await ensureTargetExists(ratingType, targetId);
      if (!target) {
        return res.status(404).json({ status: false, message: "Đối tượng không tồn tại" });
      }

      if (reviewer.userType === "Admin") {
        return res.status(200).json({
          status: true,
          message: "Quản trị viên luôn có thể thao tác đánh giá",
        });
      }

      const eligible = await hasEligibleOrder({ reviewer, ratingType, targetId });
      return res.status(200).json({
        status: eligible,
        message: eligible
          ? `Bạn có thể đánh giá ${buildTargetLabel(ratingType)} này`
          : `Bạn chưa có giao dịch phù hợp để đánh giá ${buildTargetLabel(ratingType)} này`,
      });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },

  async addRating(req, res) {
    try {
      const reviewer = req.user;
      const ratingType = (req.body.ratingType || "").trim();
      const targetId = (req.body.product || "").trim();
      const ratingValue = Number(req.body.rating);
      const comment = typeof req.body.comment === "string" ? req.body.comment.trim() : "";

      if (!ratingType || !targetId) {
        return res
          .status(400)
          .json({ status: false, message: "Thiếu loại hoặc đối tượng cần đánh giá" });
      }

      if (!Number.isFinite(ratingValue) || ratingValue < 1 || ratingValue > 5) {
        return res.status(400).json({ status: false, message: "Điểm đánh giá không hợp lệ" });
      }

      if (!ensureRoleAllowed(reviewer.userType, ratingType) && reviewer.userType !== "Admin") {
        return res.status(403).json({
          status: false,
          message: `Tài khoản của bạn không thể đánh giá ${buildTargetLabel(ratingType)}`,
        });
      }

      const target = await ensureTargetExists(ratingType, targetId);
      if (!target) {
        return res.status(404).json({ status: false, message: "Đối tượng không tồn tại" });
      }

      if (reviewer.userType !== "Admin") {
        const eligible = await hasEligibleOrder({ reviewer, ratingType, targetId });
        if (!eligible) {
          return res.status(400).json({
            status: false,
            message: `Bạn chưa có giao dịch để đánh giá ${buildTargetLabel(ratingType)}`,
          });
        }
      }

      const reviewerId = toObjectId(reviewer.id);
      if (!reviewerId) {
        return res.status(400).json({ status: false, message: "Tài khoản không hợp lệ" });
      }

      let ratingDoc = await Rating.findOne({
        userId: reviewerId,
        ratingType,
        product: targetId,
      });

      if (ratingDoc) {
        ratingDoc.rating = ratingValue;
        ratingDoc.comment = comment;
      } else {
        ratingDoc = new Rating({
          userId: reviewerId,
          ratingType,
          product: targetId,
          rating: ratingValue,
          comment,
        });
      }

      const isNewRating = ratingDoc.isNew;
      await ratingDoc.save();
      await recalcAggregateRating(ratingType, targetId);

      return res.status(isNewRating ? 201 : 200).json({
        status: true,
        message: isNewRating ? "Đã ghi nhận đánh giá" : "Đã cập nhật đánh giá",
        data: ratingDoc,
      });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },

  async checkUserRating(req, res) {
    try {
      const reviewerId = toObjectId(req.user.id);
      const ratingType = (req.query.ratingType || req.body?.ratingType || "").trim();
      const targetId = (req.query.product || req.body?.product || "").trim();
      if (!reviewerId || !ratingType || !targetId) {
        return res.status(400).json({ status: false, message: "Thiếu thông tin kiểm tra" });
      }

      const existingRating = await Rating.findOne({
        userId: reviewerId,
        ratingType,
        product: targetId,
      });

      if (existingRating) {
        return res.status(200).json({
          status: true,
          message: "Bạn đã đánh giá đối tượng này",
          rating: existingRating.rating,
          comment: existingRating.comment,
        });
      }

      return res.status(200).json({ status: false, message: "Bạn chưa đánh giá đối tượng này" });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },

  async getRatings(req, res) {
    const ratingType = (req.params.ratingType || "").trim();
    const product = (req.params.product || "").trim();
    const limitParam = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), 100)
      : 50;

    if (!ratingType || !product) {
      return res
        .status(400)
        .json({ status: false, message: "Thiếu loại hoặc đối tượng cần xem đánh giá" });
    }

    try {
      const matchStage = { ratingType, product };
      const [ratingsRaw, stats] = await Promise.all([
        Rating.find(matchStage)
          .populate({
            path: "userId",
            select: "username profile",
          })
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean(),
        Rating.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: "$rating",
              count: { $sum: 1 },
            },
          },
        ]),
      ]);

      let ratings = ratingsRaw.map((entry) => ({
        ...entry,
        relatedProductId: null,
        relatedProductTitle: "",
      }));

      if (ratingType === "Store" && ratings.length) {
        const userIds = ratings
          .map((rating) => {
            const user = rating.userId;
            if (!user) return null;
            if (typeof user === "string") return toObjectId(user);
            if (user._id) return toObjectId(user._id);
            return null;
          })
          .filter(Boolean);

        if (userIds.length) {
          const orders = await Order.find({
            storeId: product,
            userId: { $in: userIds },
            orderStatus: "Delivered",
          })
            .sort({ updatedAt: -1 })
            .select("userId orderItems")
            .populate({
              path: "orderItems.appliancesId",
              select: "title",
            })
            .lean();

          const productHints = new Map();
          for (const ord of orders) {
            const uid = ord.userId?.toString();
            if (!uid || productHints.has(uid)) continue;
            const item = (ord.orderItems || []).find(
              (entry) => entry?.appliancesId && entry.appliancesId.title
            );
            if (!item) continue;
            const appliance = item.appliancesId;
            const productId = appliance?._id?.toString?.() || "";
            productHints.set(uid, {
              productId,
              productTitle: appliance?.title || "",
            });
          }

          ratings = ratings.map((rating) => {
            const user = rating.userId;
            const uid =
              typeof user === "string"
                ? user
                : user?._id?.toString?.() || null;
            const hint = uid ? productHints.get(uid) : null;
            if (!hint) return rating;
            return {
              ...rating,
              relatedProductId: hint.productId || null,
              relatedProductTitle: hint.productTitle || "",
            };
          });
        }
      }

      const summary = {
        total: 0,
        average: 0,
        breakdown: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
      };

      let weightedSum = 0;
      stats.forEach((entry) => {
        const value = typeof entry._id === "number" ? entry._id : Number(entry._id);
        const count = entry.count || 0;
        if (!Number.isFinite(value) || !count) return;
        const bucket = Math.min(5, Math.max(1, Math.round(value)));
        summary.breakdown[bucket.toString()] =
          (summary.breakdown[bucket.toString()] || 0) + count;
        summary.total += count;
        weightedSum += value * count;
      });

      if (summary.total > 0 && weightedSum > 0) {
        summary.average = Number((weightedSum / summary.total).toFixed(2));
      }

      return res.status(200).json({ status: true, ratings, summary });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },

  async getUserRatings(req, res) {
    try {
      const userId = req.user.id;
      const rawRatings = await Rating.find({ userId })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();

      const storeIds = [];
      const appliancesIds = [];
      const userTargetIds = [];

      rawRatings.forEach((r) => {
        if (r.ratingType === "Store") storeIds.push(r.product);
        if (r.ratingType === "Appliances") appliancesIds.push(r.product);
        if ((r.ratingType === "Driver" || r.ratingType === "Customer") && mongoose.Types.ObjectId.isValid(r.product)) {
          userTargetIds.push(r.product);
        }
      });

      const [stores, appliances, users] = await Promise.all([
        storeIds.length
          ? Store.find({ _id: { $in: storeIds } }).select("_id title imageUrl rating")
          : Promise.resolve([]),
        appliancesIds.length
          ? Appliances.find({ _id: { $in: appliancesIds } }).select("_id title imageUrl rating price discount")
          : Promise.resolve([]),
        userTargetIds.length
          ? User.find({ _id: { $in: userTargetIds } }).select("_id username profile userType rating ratingCount")
          : Promise.resolve([]),
      ]);

      const storeMap = stores.reduce((acc, store) => {
        acc[store._id.toString()] = store;
        return acc;
      }, {});
      const appliancesMap = appliances.reduce((acc, item) => {
        acc[item._id.toString()] = item;
        return acc;
      }, {});
      const userMap = users.reduce((acc, user) => {
        acc[user._id.toString()] = user;
        return acc;
      }, {});

      const ratings = rawRatings.map((r) => {
        const base = {
          _id: r._id,
          userId: r.userId,
          ratingType: r.ratingType,
          product: r.product,
          rating: r.rating,
          comment: r.comment,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };

        if (r.ratingType === "Store") {
          const store = storeMap[r.product];
          return {
            ...base,
            entity: store
              ? {
                kind: "Store",
                title: store.title,
                imageUrl: store.imageUrl,
                rating: store.rating,
              }
              : null,
          };
        }

        if (r.ratingType === "Appliances") {
          const app = appliancesMap[r.product];
          return {
            ...base,
            entity: app
              ? {
                kind: "Appliances",
                title: app.title,
                imageUrl: app.imageUrl,
                rating: app.rating,
                price: app.price,
                discount: app.discount,
              }
              : null,
          };
        }

        if (r.ratingType === "Driver" || r.ratingType === "Customer") {
          const user = userMap[r.product];
          return {
            ...base,
            entity: user
              ? {
                kind: r.ratingType,
                name: user.username,
                avatar: user.profile,
                rating: user.rating,
                ratingCount: user.ratingCount,
                role: user.userType,
              }
              : null,
          };
        }

        return { ...base, entity: null };
      });

      res.status(200).json({ status: true, ratings });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
};
