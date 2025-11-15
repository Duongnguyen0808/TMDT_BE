const Reservation = require("../models/Reservation");
const Appliances = require("../models/Appliances");
const mongoose = require("mongoose");

module.exports = {
  // Tạo reservation khi user bắt đầu checkout
  createReservation: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const userId = req.user.id;
      const { items } = req.body; // [{ productId, quantity }]

      if (!items || items.length === 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          status: false,
          message: "Danh sách sản phẩm trống",
        });
      }

      const reservations = [];

      for (const item of items) {
        const { productId, quantity } = item;

        // Kiểm tra sản phẩm
        const product = await Appliances.findById(productId).session(session);

        if (!product) {
          await session.abortTransaction();
          session.endSession();
          return res.status(404).json({
            status: false,
            message: `Sản phẩm ${productId} không tồn tại`,
          });
        }

        if (!product.isAvailable) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            status: false,
            message: `Sản phẩm "${product.title}" hiện không khả dụng`,
          });
        }

        // Tính stock khả dụng (stock thực - số lượng đang được reserve)
        const activeReservations = await Reservation.aggregate([
          {
            $match: {
              productId: new mongoose.Types.ObjectId(productId),
              status: "reserved",
              expiresAt: { $gt: new Date() },
            },
          },
          {
            $group: {
              _id: null,
              totalReserved: { $sum: "$quantity" },
            },
          },
        ]).session(session);

        const reservedQty = activeReservations[0]?.totalReserved || 0;
        const availableStock = product.stock - reservedQty;

        if (availableStock < quantity) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            status: false,
            message: `Sản phẩm "${product.title}" chỉ còn ${availableStock} sản phẩm khả dụng`,
          });
        }

        // Xóa reservation cũ của user cho sản phẩm này (nếu có)
        await Reservation.deleteMany(
          { userId, productId, status: "reserved" },
          { session }
        );

        // Tạo reservation mới
        const reservation = new Reservation({
          userId,
          productId,
          quantity,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 phút
        });

        await reservation.save({ session });
        reservations.push(reservation);
      }

      await session.commitTransaction();
      session.endSession();

      res.status(201).json({
        status: true,
        message: "Giữ hàng thành công trong 10 phút",
        reservations: reservations.map((r) => ({
          productId: r.productId,
          quantity: r.quantity,
          expiresAt: r.expiresAt,
        })),
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Kiểm tra reservation còn hiệu lực không
  checkReservation: async (req, res) => {
    try {
      const userId = req.user.id;
      const { productId } = req.params;

      const reservation = await Reservation.findOne({
        userId,
        productId,
        status: "reserved",
        expiresAt: { $gt: new Date() },
      });

      if (reservation) {
        const remainingTime = Math.floor(
          (reservation.expiresAt - new Date()) / 1000
        );
        res.status(200).json({
          status: true,
          reserved: true,
          quantity: reservation.quantity,
          expiresIn: remainingTime, // seconds
        });
      } else {
        res.status(200).json({
          status: true,
          reserved: false,
        });
      }
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Hủy reservation (khi user hủy checkout)
  cancelReservation: async (req, res) => {
    try {
      const userId = req.user.id;
      const { productIds } = req.body; // Array of productIds

      await Reservation.updateMany(
        {
          userId,
          productId: { $in: productIds },
          status: "reserved",
        },
        { status: "expired" }
      );

      res.status(200).json({
        status: true,
        message: "Đã hủy giữ hàng",
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Lấy stock khả dụng thực tế (stock - reserved)
  getAvailableStock: async (req, res) => {
    try {
      const { productId } = req.params;

      const product = await Appliances.findById(productId);
      if (!product) {
        return res.status(404).json({
          status: false,
          message: "Sản phẩm không tồn tại",
        });
      }

      // Tính số lượng đang được reserve
      const activeReservations = await Reservation.aggregate([
        {
          $match: {
            productId: new mongoose.Types.ObjectId(productId),
            status: "reserved",
            expiresAt: { $gt: new Date() },
          },
        },
        {
          $group: {
            _id: null,
            totalReserved: { $sum: "$quantity" },
          },
        },
      ]);

      const reservedQty = activeReservations[0]?.totalReserved || 0;
      const availableStock = product.stock - reservedQty;

      res.status(200).json({
        status: true,
        productId,
        totalStock: product.stock,
        reserved: reservedQty,
        available: Math.max(0, availableStock),
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
};
