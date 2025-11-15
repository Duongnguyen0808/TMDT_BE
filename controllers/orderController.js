const Order = require("../models/Order");
const User = require("../models/User");
const Cart = require("../models/Cart");
const Voucher = require("../models/Voucher");
const Appliances = require("../models/Appliances");
const Reservation = require("../models/Reservation");
const mongoose = require("mongoose");
const {
  sendOrderStatusNotification,
} = require("../utils/notification_service");

module.exports = {
  placeOrder: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const newOrder = new Order(req.body);
      const userId = newOrder.userId;

      // Kiểm tra user đã xác minh SĐT chưa (warning chỉ lần đầu)
      const user = await User.findById(userId).session(session);
      let phoneWarning = null;

      // Chỉ warning nếu chưa verify, đã verify 1 lần thì không warning nữa
      if (user && !user.phoneVerification) {
        phoneWarning = res.__("order.phone_not_verified_warning");
      }

      // Kiểm tra reservation và stock
      for (const item of newOrder.orderItems) {
        const product = await Appliances.findById(item.appliancesId).session(
          session
        );

        if (!product) {
          await session.abortTransaction();
          session.endSession();
          return res.status(404).json({
            status: false,
            message: `Sản phẩm ${item.appliancesId} không tồn tại`,
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

        // Kiểm tra reservation của user
        const reservation = await Reservation.findOne({
          userId,
          productId: item.appliancesId,
          status: "reserved",
          expiresAt: { $gt: new Date() },
        }).session(session);

        if (!reservation) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            status: false,
            message: `Sản phẩm "${product.title}" đã hết thời gian giữ hàng. Vui lòng thêm vào giỏ lại`,
          });
        }

        // Kiểm tra số lượng reservation khớp với order
        if (reservation.quantity < item.quantity) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            status: false,
            message: `Số lượng sản phẩm "${product.title}" vượt quá số lượng đã giữ`,
          });
        }

        // Kiểm tra stock thực tế
        if (product.stock < item.quantity) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            status: false,
            message: `Sản phẩm "${product.title}" chỉ còn ${product.stock} sản phẩm`,
          });
        }
      }

      // Lưu đơn hàng
      await newOrder.save({ session });
      const orderId = newOrder._id;

      // Cập nhật stock và soldCount
      for (const item of newOrder.orderItems) {
        await Appliances.findByIdAndUpdate(
          item.appliancesId,
          {
            $inc: {
              stock: -item.quantity,
              soldCount: item.quantity,
            },
          },
          { session }
        );

        // Đánh dấu reservation là confirmed
        await Reservation.updateMany(
          {
            userId,
            productId: item.appliancesId,
            status: "reserved",
          },
          { status: "confirmed" },
          { session }
        );
      }

      // Clear cart items for this order
      const appliancesIds = newOrder.orderItems.map(
        (item) => item.appliancesId
      );
      await Cart.deleteMany(
        {
          userId: newOrder.userId,
          productId: { $in: appliancesIds },
        },
        { session }
      );

      // Update voucher usedCount if promoCode exists
      if (newOrder.promoCode) {
        await Voucher.findOneAndUpdate(
          { code: newOrder.promoCode.toUpperCase() },
          { $inc: { usedCount: 1 } },
          { session }
        );
      }

      // Commit transaction
      await session.commitTransaction();
      session.endSession();

      const response = {
        status: true,
        message: "Đặt hàng thành công",
        orderId: orderId,
      };

      // Thêm warning nếu chưa verify SĐT
      if (phoneWarning) {
        response.warning = phoneWarning;
        response.requirePhoneVerification = false; // Không bắt buộc, chỉ khuyến khích
      }

      res.status(201).json(response);
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      res.status(500).json({ status: false, message: error.message });
    }
  },

  getUserOrders: async (req, res) => {
    const userId = req.user.id;
    const { paymentStatus, orderStatus } = req.query;

    let query = { userId };

    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }

    if (orderStatus) {
      query.orderStatus = orderStatus;
    }

    try {
      const orders = await Order.find(query)
        .populate({
          path: "orderItems.appliancesId",
          select: "imageUrl title rating time",
        })
        .populate({
          path: "deliveryAddress",
          select: "addressLine1",
        });

      res.status(200).json(orders);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  getStoreOrders: async (req, res) => {
    const id = req.params.id;
    const status = req.params.status;

    try {
      const orders = await Order.find({
        orderStatus: status,
        paymentStatus: "Completed",
        storeId: id,
      })
        .select(
          "userId deliveryAddress orderItems deliveryFee storeId storeCoords recipientCoords orderStatus createdAt updatedAt orderTotal grandTotal"
        )
        .populate({
          path: "userId",
          select: "phone profile",
        })
        .populate({
          path: "storeId",
          select: "title coords imageUrl logoUrl time",
        })
        .populate({
          path: "orderItems.appliancesId",
          select: "title imageUrl time price",
        })
        .populate({
          path: "deliveryAddress",
          select: "addressLine1",
        });

      res.status(200).json(orders);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  updateOrderStatus: async (req, res) => {
    const orderId = req.params.id;
    const orderStatus = req.body.orderStatus || req.query.status; // Hỗ trợ cả body và query
    const cancellationReason = req.body.cancellationReason || "";
    const userId = req.user.id;
    const userType = req.user.userType;

    if (!orderStatus) {
      return res.status(400).json({
        status: false,
        message: "Vui lòng cung cấp trạng thái đơn hàng",
      });
    }

    try {
      const existingOrder = await Order.findById(orderId);

      if (!existingOrder) {
        return res
          .status(404)
          .json({ status: false, message: "Không tìm thấy đơn hàng" });
      }

      // Kiểm tra quyền: User chỉ được hủy đơn của mình, Vendor/Admin có thể update bất kỳ
      if (orderStatus === "Cancelled") {
        if (
          userType === "Client" &&
          existingOrder.userId.toString() !== userId
        ) {
          return res.status(403).json({
            status: false,
            message: "Bạn không có quyền hủy đơn hàng này",
          });
        }

        if (existingOrder.orderStatus !== "Pending") {
          return res.status(400).json({
            status: false,
            message: "Chỉ có thể hủy đơn hàng đang chờ xử lý",
          });
        }

        if (!cancellationReason) {
          return res.status(400).json({
            status: false,
            message: "Vui lòng cung cấp lý do hủy đơn",
          });
        }
      }

      // Chỉ Vendor/Admin mới được chuyển sang Preparing/Delivered
      if (
        (orderStatus === "Preparing" || orderStatus === "Delivered") &&
        userType !== "Vendor" &&
        userType !== "Admin"
      ) {
        return res.status(403).json({
          status: false,
          message: "Bạn không có quyền thực hiện hành động này",
        });
      }

      const updateData = { orderStatus: orderStatus };
      if (orderStatus === "Cancelled" && cancellationReason) {
        updateData.cancellationReason = cancellationReason;
      }

      const updatedOrder = await Order.findByIdAndUpdate(orderId, updateData, {
        new: true,
      }).populate("userId");

      if (updatedOrder) {
        // Hoàn lại stock khi hủy đơn
        if (orderStatus === "Cancelled") {
          for (const item of updatedOrder.orderItems) {
            await Appliances.findByIdAndUpdate(item.appliancesId, {
              $inc: {
                stock: item.quantity,
                soldCount: -item.quantity,
              },
            });
          }

          // Hoàn lại số lượng voucher đã dùng
          if (updatedOrder.promoCode) {
            await Voucher.findOneAndUpdate(
              { code: updatedOrder.promoCode.toUpperCase() },
              { $inc: { usedCount: -1 } }
            );
          }
        }

        // Gửi push notification khi đơn hàng thay đổi trạng thái
        if (updatedOrder.userId && updatedOrder.userId.fcm) {
          await sendOrderStatusNotification(
            updatedOrder.userId.fcm,
            orderStatus,
            orderId
          );
        }

        res
          .status(200)
          .json({ status: true, message: "Cập nhật đơn hàng thành công" });
      } else {
        res
          .status(404)
          .json({ status: false, message: "Không tìm thấy đơn hàng" });
      }
    } catch (error) {
      res.status(404).json({ status: false, message: error.message });
    }
  },

  getOrderDetails: async (req, res) => {
    const orderId = req.params.id;

    try {
      const order = await Order.findById(orderId)
        .populate({
          path: "userId",
          select: "username email phone profile",
        })
        .populate({
          path: "storeId",
          select: "title imageUrl logoUrl coords",
        })
        .populate({
          path: "orderItems.appliancesId",
          select: "title imageUrl price",
        })
        .populate({
          path: "deliveryAddress",
          select: "addressLine latitude longitude",
        });

      if (!order) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy đơn hàng",
        });
      }

      res.status(200).json({
        status: true,
        data: order,
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  confirmReceived: async (req, res) => {
    const orderId = req.params.id;
    const userId = req.user.id;

    try {
      const order = await Order.findById(orderId);

      if (!order) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy đơn hàng",
        });
      }

      // Kiểm tra quyền sở hữu đơn hàng
      if (order.userId.toString() !== userId) {
        return res.status(403).json({
          status: false,
          message: "Bạn không có quyền xác nhận đơn hàng này",
        });
      }

      // Kiểm tra đơn hàng đã được giao chưa
      if (order.orderStatus !== "Delivered") {
        return res.status(400).json({
          status: false,
          message: "Chỉ có thể xác nhận đơn hàng đã được giao",
        });
      }

      // Với COD: Cập nhật paymentStatus từ Pending → Completed
      // Với VNPay: Đã Completed rồi, vẫn cho xác nhận để đánh dấu đã nhận hàng
      if (order.paymentMethod === "COD" && order.paymentStatus === "Pending") {
        order.paymentStatus = "Completed";
        await order.save();
        return res.status(200).json({
          status: true,
          message: "Xác nhận nhận hàng và hoàn tất thanh toán COD thành công",
        });
      } else if (order.paymentStatus === "Completed") {
        // Đơn đã thanh toán online, chỉ xác nhận đã nhận
        return res.status(200).json({
          status: true,
          message: "Xác nhận đã nhận hàng thành công",
        });
      } else {
        return res.status(400).json({
          status: false,
          message: "Trạng thái thanh toán không hợp lệ",
        });
      }
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
};
