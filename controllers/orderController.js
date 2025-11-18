const Order = require("../models/Order");
const User = require("../models/User");
const Cart = require("../models/Cart");
const Voucher = require("../models/Voucher");
const VoucherClaim = require("../models/VoucherClaim");
const Appliances = require("../models/Appliances");
const Driver = require("../models/Driver");
const mongoose = require("mongoose");
const {
  sendOrderStatusNotification,
  sendOrderPlacedNotification,
  sendReturnRequestedNotification,
  sendReturnDecisionNotification,
  sendRefundProcessedNotification,
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

      // Kiểm tra tính khả dụng & tồn kho
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

        // Kiểm tra stock thực tế
        if (typeof product.stock === 'number' && product.stock < item.quantity) {
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

      // Cập nhật tồn kho và số lượng đã bán
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

      // Update voucher usage if promoCode exists
      if (newOrder.promoCode) {
        const code = String(newOrder.promoCode).toUpperCase();
        const voucher = await Voucher.findOneAndUpdate(
          { code },
          { $inc: { usedCount: 1 } },
          { session, new: true }
        );
        if (voucher) {
          // Mark user's claim as used
          await VoucherClaim.findOneAndUpdate(
            { voucher: voucher._id, user: newOrder.userId },
            { $set: { used: true, usedAt: new Date() } },
            { session }
          );
        }
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

      // Gửi thông báo đơn hàng mới (nếu có fcm token)
      try {
        if (user && user.fcm && user.fcm !== 'none') {
          await sendOrderPlacedNotification(user.fcm, orderId, newOrder.grandTotal || newOrder.orderTotal || 0);
        }
      } catch (e) { }

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
          "userId deliveryAddress orderItems deliveryFee storeId storeCoords recipientCoords orderStatus createdAt updatedAt orderTotal grandTotal driverId"
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
          select: "title imageUrl time price stock",
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

        // free driver on cancel
        if (existingOrder.driverId) {
          try {
            const drv = await Driver.findOne({ user: existingOrder.driverId });
            if (drv) {
              drv.status = "available";
              await drv.save();
            }
          } catch (e) { }
        }
      }

      // Chỉ Vendor/Admin mới được chuyển sang Preparing/Delivering/Delivered
      if (
        (orderStatus === "Preparing" || orderStatus === "Delivering" || orderStatus === "Delivered") &&
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

          // Hoàn lại số lượng voucher đã dùng và reset claim
          if (updatedOrder.promoCode) {
            const code = String(updatedOrder.promoCode).toUpperCase();
            const voucher = await Voucher.findOneAndUpdate(
              { code },
              { $inc: { usedCount: -1 } },
              { new: true }
            );
            if (voucher) {
              await VoucherClaim.findOneAndUpdate(
                { voucher: voucher._id, user: updatedOrder.userId },
                { $set: { used: false }, $unset: { usedAt: 1 } }
              );
            }
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

        // Free driver when delivered
        if (orderStatus === "Delivered" && updatedOrder.driverId) {
          try {
            const drv = await Driver.findOne({ user: updatedOrder.driverId });
            if (drv) {
              drv.status = "available";
              await drv.save();
            }
          } catch (e) { }
        }

        // Emit socket events for live updates
        try {
          const io = req.app.get("io");
          if (io) {
            io.emit("order:updated", { orderId: String(updatedOrder._id), status: orderStatus });
            if ((orderStatus === "Delivered" || orderStatus === "Cancelled") && updatedOrder.driverId) {
              try {
                const drv = await Driver.findOne({ user: updatedOrder.driverId });
                if (drv) io.emit("driver:status", { driverId: String(drv.user), status: drv.status });
              } catch (_) { }
            }
          }
        } catch (_) { }

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
          select: "title imageUrl price stock",
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

  // Client requests a return/refund on a delivered order
  requestReturn: async (req, res) => {
    const orderId = req.params.id;
    const userId = req.user.id;
    const { reason = "" } = req.body || {};

    try {
      const order = await Order.findById(orderId);
      if (!order) {
        return res.status(404).json({ status: false, message: "Không tìm thấy đơn hàng" });
      }
      if (String(order.userId) !== String(userId)) {
        return res.status(403).json({ status: false, message: "Bạn không có quyền yêu cầu trả hàng đơn này" });
      }
      if (order.orderStatus !== "Delivered") {
        return res.status(400).json({ status: false, message: "Chỉ có thể yêu cầu trả hàng cho đơn đã giao" });
      }
      if (order.returnStatus && order.returnStatus !== "None") {
        return res.status(400).json({ status: false, message: "Đơn hàng đã có yêu cầu trả/hoàn" });
      }

      order.returnStatus = "Requested";
      order.returnReason = reason;
      order.returnRequestedAt = new Date();
      await order.save();

      // Notify user of request submission
      try {
        const usr = await User.findById(userId).select('fcm');
        if (usr && usr.fcm && usr.fcm !== 'none') {
          await sendReturnRequestedNotification(usr.fcm, orderId, reason);
        }
      } catch (_) { }

      // Emit update
      try {
        const io = req.app.get("io");
        if (io) io.emit("order:updated", { orderId: String(order._id), returnStatus: order.returnStatus });
      } catch (_) { }

      return res.status(200).json({ status: true, message: "Đã gửi yêu cầu trả hàng/hoàn tiền" });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },

  // Vendor/Admin approve or reject return request
  reviewReturn: async (req, res) => {
    const orderId = req.params.id;
    const userType = req.user.userType;
    const { action, note = "" } = req.body || {}; // action: approve | reject

    if (userType !== "Vendor" && userType !== "Admin") {
      return res.status(403).json({ status: false, message: "Bạn không có quyền duyệt trả hàng" });
    }

    if (!action || !["approve", "reject"].includes(action)) {
      return res.status(400).json({ status: false, message: "Hành động không hợp lệ" });
    }

    try {
      const order = await Order.findById(orderId);
      if (!order) return res.status(404).json({ status: false, message: "Không tìm thấy đơn hàng" });
      if (order.returnStatus !== "Requested") {
        return res.status(400).json({ status: false, message: "Đơn không ở trạng thái chờ duyệt trả hàng" });
      }

      if (action === "approve") {
        order.returnStatus = "Approved";
      } else {
        order.returnStatus = "Rejected";
      }
      order.returnProcessedAt = new Date();
      if (note) order.note = note;
      await order.save();

      // Notify user of decision
      try {
        const usr = await User.findById(order.userId).select('fcm');
        if (usr && usr.fcm && usr.fcm !== 'none') {
          await sendReturnDecisionNotification(usr.fcm, orderId, action === 'approve' ? 'approve' : 'reject');
        }
      } catch (_) { }

      try {
        const io = req.app.get("io");
        if (io) io.emit("order:updated", { orderId: String(order._id), returnStatus: order.returnStatus });
      } catch (_) { }

      return res.status(200).json({ status: true, message: action === "approve" ? "Đã duyệt trả hàng" : "Đã từ chối trả hàng" });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },

  // Vendor/Admin confirms returned items and performs refund/stock rollback
  confirmReturned: async (req, res) => {
    const orderId = req.params.id;
    const userType = req.user.userType;
    const { refundAmount } = req.body || {}; // optional override amount

    if (userType !== "Vendor" && userType !== "Admin") {
      return res.status(403).json({ status: false, message: "Bạn không có quyền xác nhận trả hàng" });
    }

    try {
      const order = await Order.findById(orderId);
      if (!order) return res.status(404).json({ status: false, message: "Không tìm thấy đơn hàng" });
      if (!order.returnStatus || !["Approved", "Requested"].includes(order.returnStatus)) {
        return res.status(400).json({ status: false, message: "Đơn không ở trạng thái chấp nhận trả hàng" });
      }

      // Rollback stock and soldCount
      for (const item of order.orderItems) {
        await Appliances.findByIdAndUpdate(item.appliancesId, {
          $inc: { stock: item.quantity, soldCount: -item.quantity },
        });
      }

      // Rollback voucher usage and reset claim
      if (order.promoCode) {
        const code = String(order.promoCode).toUpperCase();
        const voucher = await Voucher.findOneAndUpdate(
          { code },
          { $inc: { usedCount: -1 } },
          { new: true }
        );
        if (voucher) {
          await VoucherClaim.findOneAndUpdate(
            { voucher: voucher._id, user: order.userId },
            { $set: { used: false }, $unset: { usedAt: 1 } }
          );
        }
      }

      // Process refund if paid
      if (order.paymentStatus === "Completed") {
        const amount = typeof refundAmount === "number" ? refundAmount : order.grandTotal;
        order.refundAmount = amount;
        order.refundMethod = order.paymentMethod;
        order.refundAt = new Date();
        order.paymentStatus = "Refunded";
        order.returnStatus = "Refunded";
        // Notify refund processed
        try {
          const usr = await User.findById(order.userId).select('fcm');
          if (usr && usr.fcm && usr.fcm !== 'none') {
            await sendRefundProcessedNotification(usr.fcm, orderId, amount);
          }
        } catch (_) { }
      } else {
        order.returnStatus = "Returned";
        // Notify return processed without refund
        try {
          const usr = await User.findById(order.userId).select('fcm');
          if (usr && usr.fcm && usr.fcm !== 'none') {
            await sendReturnDecisionNotification(usr.fcm, orderId, 'returned');
          }
        } catch (_) { }
      }

      await order.save();

      try {
        const io = req.app.get("io");
        if (io) io.emit("order:updated", { orderId: String(order._id), returnStatus: order.returnStatus });
      } catch (_) { }

      return res.status(200).json({ status: true, message: "Đã xác nhận hàng trả và xử lý hoàn tiền" });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },
};
