const Rating = require("../models/Rating");
const Store = require("../models/Store");
const Appliances = require("../models/Appliances");
const Order = require("../models/Order");

module.exports = {
  // Check if user purchased this product
  checkUserPurchased: async (req, res) => {
    const { product, ratingType } = req.params;
    const userId = req.body.id;

    try {
      if (ratingType === "Appliances") {
        // Check if user has completed order with this product
        const order = await Order.findOne({
          userId: userId,
          "orderItems.appliancesId": product,
          orderStatus: "Delivered",
        });

        if (order) {
          return res.status(200).json({
            status: true,
            message: "User has purchased this product",
          });
        } else {
          return res.status(200).json({
            status: false,
            message: "User has not purchased this product yet",
          });
        }
      } else if (ratingType === "Store") {
        // For store, check if user has any completed order from this store
        const storeProducts = await Appliances.find({ store: product }).select(
          "_id"
        );
        const productIds = storeProducts.map((p) => p._id);

        const order = await Order.findOne({
          userId: userId,
          "orderItems.appliancesId": { $in: productIds },
          orderStatus: "Delivered",
        });

        if (order) {
          return res.status(200).json({
            status: true,
            message: "User has purchased from this store",
          });
        } else {
          return res.status(200).json({
            status: false,
            message: "User has not purchased from this store yet",
          });
        }
      }
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  addRating: async (req, res) => {
    const newRating = new Rating({
      userId: req.body.id,
      ratingType: req.body.ratingType,
      product: req.body.product,
      rating: req.body.rating,
    });
    try {
      await newRating.save();
      if (req.body.ratingType === "Store") {
        const store = await Rating.aggregate([
          {
            $match: {
              ratingType: req.body.ratingType,
              product: req.body.product,
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
        if (store.length > 0) {
          const averageRating = store[0].averageRating;
          const ratingCount = store[0].ratingCount;
          await Store.findByIdAndUpdate(
            req.body.product,
            {
              rating: averageRating,
              ratingCount: ratingCount,
            },
            { new: true }
          );
        }
      } else if (req.body.ratingType === "Appliances") {
        const appliances = await Rating.aggregate([
          {
            $match: {
              ratingType: req.body.ratingType,
              product: req.body.product,
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
        if (appliances.length > 0) {
          const averageRating = appliances[0].averageRating;
          const ratingCount = appliances[0].ratingCount;
          await Appliances.findByIdAndUpdate(
            req.body.product,
            {
              rating: averageRating,
              ratingCount: ratingCount,
            },
            { new: true }
          );
        }
      }
      res
        .status(200)
        .json({ status: true, message: "Rating has been successfully added" });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  checkUserRating: async (req, res) => {
    const ratingType = req.params.ratingType;
    const product = req.params.product;
    try {
      const existingRating = await Rating.findOne({
        userId: req.body.id,
        ratingType: ratingType,
        product: product,
      });
      if (existingRating) {
        res.status(2000).json({
          status: true,
          message: "You has already rated this store",
          rating: existingRating.rating,
        });
      } else {
        res.status(200).json({
          status: false,
          message: "User has not rated this store yet",
        });
      }
    } catch (error) {}
  },

  getRatings: async (req, res) => {
    const ratingType = req.params.ratingType;
    const product = req.params.product;
    try {
      const ratings = await Rating.find({
        ratingType: ratingType,
        product: product,
      })
        .populate({
          path: "userId",
          select: "username profile",
        })
        .sort({ createdAt: -1 })
        .limit(50);

      res.status(200).json({ status: true, ratings: ratings });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
};
