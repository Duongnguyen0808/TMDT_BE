const Order = require("../models/Order");
const User = require("../models/User");
const Cart = require("../models/Cart");
const Voucher = require("../models/Voucher");
const VoucherClaim = require("../models/VoucherClaim");
const Appliances = require("../models/Appliances");
const Driver = require("../models/Driver");
const Hub = require("../models/Hub");
const mongoose = require("mongoose");
const {
  sendOrderStatusNotification,
  sendOrderPlacedNotification,
  sendReturnRequestedNotification,
  sendReturnDecisionNotification,
  sendRefundProcessedNotification,
} = require("../utils/notification_service");

// Proposal flow disabled: expose all available orders to all shippers
async function _startDriverProposal(_order) {
  return; // no-op
}

// Helper: rotate to next driver (called on decline or timeout)
async function _rotateDriverProposal(_order) { return; }

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

      // Gán logistics hubs đơn giản (nearest central then nearest local)
      try {
        const hubs = await Hub.find({ active: true }).session(session);
        // Separate central and local
        const centrals = hubs.filter(h => h.type === "central");
        const locals = hubs.filter(h => h.type === "local");
        // Helper distance
        const dist = (aLat, aLng, bLat, bLng) => {
          const R = 6371;
          const dLat = (bLat - aLat) * Math.PI / 180;
          const dLng = (bLng - aLng) * Math.PI / 180;
          const lat1 = aLat * Math.PI / 180;
          const lat2 = bLat * Math.PI / 180;
          const a = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          return R * c;
        };
        // coords: storeCoords & recipientCoords
        const sLat = Array.isArray(newOrder.storeCoords) ? newOrder.storeCoords[0] : null;
        const sLng = Array.isArray(newOrder.storeCoords) ? newOrder.storeCoords[1] : null;
        const rLat = Array.isArray(newOrder.recipientCoords) ? newOrder.recipientCoords[0] : null;
        const rLng = Array.isArray(newOrder.recipientCoords) ? newOrder.recipientCoords[1] : null;
        let originHub = null;
        let localHub = null;
        if (sLat != null && sLng != null && centrals.length) {
          originHub = centrals.reduce((best, h) => {
            const d = dist(sLat, sLng, h.latitude, h.longitude);
            if (!best || d < best.d) return { h, d }; else return best;
          }, null);
        }
        if (rLat != null && rLng != null && locals.length) {
          localHub = locals.reduce((best, h) => {
            const d = dist(rLat, rLng, h.latitude, h.longitude);
            if (!best || d < best.d) return { h, d }; else return best;
          }, null);
        }
        if (originHub && localHub) {
          newOrder.originHub = originHub.h._id;
          newOrder.localHub = localHub.h._id;
          newOrder.logisticStatus = "SellerPending";
          await newOrder.save({ session });
        }
      } catch (e) { }

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
    const includeAll = req.query.all === '1' || req.query.all === 'true';

    try {
      const baseQuery = { storeId: id, orderStatus: status };
      // Mặc định trước đây lọc paymentStatus=Completed khiến Vendor không thấy đơn Pending mới.
      // Giờ nếu không yêu cầu all thì vẫn giữ Completed, còn ?all=1 sẽ trả tất cả.
      if (!includeAll) baseQuery.paymentStatus = "Completed";
      const start = Date.now();
      const orders = await Order.find(baseQuery)
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

      const duration = Date.now() - start;
      console.log(`[getStoreOrders] storeId=${id} status=${status} all=${includeAll} count=${orders.length} ms=${duration}`);
      res.status(200).json({ status: true, count: orders.length, data: orders });
    } catch (error) {
      console.error('[getStoreOrders][ERROR]', error);
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Advanced: multi-status + pagination
  getStoreOrdersAdvanced: async (req, res) => {
    const id = req.params.id;
    const statusesParam = req.query.statuses; // comma separated list
    const paymentFilter = (req.query.payment || '').toLowerCase(); // 'all' | 'completed'
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);

    const statuses = Array.isArray(statusesParam)
      ? statusesParam.flatMap(s => String(s).split(','))
      : (typeof statusesParam === 'string' && statusesParam.length)
        ? statusesParam.split(',')
        : [];

    const query = { storeId: id };
    if (statuses.length) {
      query.orderStatus = { $in: statuses };
    }
    // Nếu không truyền statuses vẫn cho phép dùng status=Pending cũ (backward) qua query ?status=Pending
    if (!statuses.length && req.query.status) {
      query.orderStatus = req.query.status;
    }
    // Default: chỉ Completed trừ khi payment=all
    if (paymentFilter !== 'all') {
      query.paymentStatus = 'Completed';
    }

    try {
      const start = Date.now();
      const total = await Order.countDocuments(query);
      const orders = await Order.find(query)
        .select("userId deliveryAddress orderItems deliveryFee storeId storeCoords recipientCoords orderStatus createdAt updatedAt orderTotal grandTotal driverId paymentStatus")
        .populate({ path: 'userId', select: 'phone profile' })
        .populate({ path: 'storeId', select: 'title coords imageUrl logoUrl time' })
        .populate({ path: 'orderItems.appliancesId', select: 'title imageUrl time price stock' })
        .populate({ path: 'deliveryAddress', select: 'addressLine1' })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);
      const duration = Date.now() - start;
      console.log(`[getStoreOrdersAdvanced] storeId=${id} statuses=${statuses.join('|') || (req.query.status || '')} payment=${paymentFilter || 'completed'} page=${page} limit=${limit} total=${total} count=${orders.length} ms=${duration}`);
      return res.status(200).json({ status: true, page, limit, total, count: orders.length, data: orders });
    } catch (error) {
      console.error('[getStoreOrdersAdvanced][ERROR]', error);
      return res.status(500).json({ status: false, message: error.message });
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
      // Quyền cập nhật trạng thái:
      // - Vendor/Admin: Preparing | Delivering | Delivered
      // - Driver (được gán đơn): Delivering | Delivered
      if (orderStatus === "Preparing") {
        if (userType !== "Vendor" && userType !== "Admin") {
          return res.status(403).json({ status: false, message: "Chỉ Vendor/Admin mới được chuyển sang Preparing" });
        }
      } else if (orderStatus === "Delivering" || orderStatus === "Delivered") {
        if (userType === "Driver") {
          if (String(existingOrder.driverId) !== String(userId)) {
            return res.status(403).json({ status: false, message: "Bạn không phải tài xế của đơn này" });
          }
        } else if (userType !== "Vendor" && userType !== "Admin") {
          return res.status(403).json({ status: false, message: "Bạn không có quyền thực hiện hành động này" });
        }
      }

      const updateData = { orderStatus: orderStatus };
      // Sync logisticStatus where appropriate
      if (orderStatus === "Delivering") updateData.logisticStatus = "Delivering";
      if (orderStatus === "Delivered") updateData.logisticStatus = "Delivered";
      if (orderStatus === "Cancelled") updateData.logisticStatus = "Cancelled";
      // WaitingShipper no longer triggers timed proposal; orders will be visible for open claim
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

        // Proposal system disabled
        res.status(200).json({ status: true, message: "Cập nhật đơn hàng thành công" });
      } else {
        res
          .status(404)
          .json({ status: false, message: "Không tìm thấy đơn hàng" });
      }
    } catch (error) {
      res.status(404).json({ status: false, message: error.message });
    }
  },

  // Proposal accept endpoint disabled
  acceptDriverProposal: async (_req, res) => {
    return res.status(410).json({ status: false, message: 'Driver proposal đã tắt. Vui lòng dùng cơ chế nhận đơn mở.' });
  },

  // Proposal decline endpoint disabled
  declineDriverProposal: async (_req, res) => {
    return res.status(410).json({ status: false, message: 'Driver proposal đã tắt. Không cần từ chối.' });
  },

  // Manual rotation disabled
  nextDriverProposal: async (_req, res) => {
    return res.status(410).json({ status: false, message: 'Driver proposal đã tắt. Không cần xoay vòng.' });
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

  // Progress logistics status with validation (Admin only or internal automation)
  advanceLogistics: async (req, res) => {
    const orderId = req.params.id;
    const userType = req.user.userType;
    const { targetStatus } = req.body || {};
    if (!targetStatus) {
      return res.status(400).json({ status: false, message: "Thiếu targetStatus" });
    }
    // Allow Admin to drive transitions manually.
    if (userType !== "Admin") {
      return res.status(403).json({ status: false, message: "Chỉ Admin được phép chuyển logistics" });
    }
    const allowedSequence = [
      "SellerPending",
      "ToOriginHub",
      "AtOriginHub",
      "ToLocalHub",
      "AtLocalHub",
      "PickedUp",
      "Delivering",
      "Delivered"
    ];
    try {
      const order = await Order.findById(orderId).populate("originHub localHub");
      if (!order) return res.status(404).json({ status: false, message: "Không tìm thấy đơn" });
      const current = order.logisticStatus || "SellerPending";
      const currentIdx = allowedSequence.indexOf(current);
      const targetIdx = allowedSequence.indexOf(targetStatus);
      if (targetIdx === -1) return res.status(400).json({ status: false, message: "targetStatus không hợp lệ" });
      if (targetIdx !== currentIdx + 1) {
        return res.status(400).json({ status: false, message: "Không thể nhảy tới trạng thái không liền kề" });
      }
      order.logisticStatus = targetStatus;
      // Sync orderStatus for delivery phases
      if (targetStatus === "Delivering") order.orderStatus = "Delivering";
      if (targetStatus === "Delivered") order.orderStatus = "Delivered";
      await order.save();
      try {
        const io = req.app.get("io");
        if (io) io.emit("order:logistics", { orderId: String(order._id), logisticStatus: order.logisticStatus });
      } catch (_) { }
      return res.status(200).json({ status: true, message: "Đã chuyển logistics", logisticStatus: order.logisticStatus });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },
  // Bulk sync logisticStatus for legacy orders (Admin only)
  syncLogisticsLegacy: async (req, res) => {
    const userType = req.user.userType;
    if (userType !== "Admin") {
      return res.status(403).json({ status: false, message: "Chỉ Admin được phép sync" });
    }
    const map = {
      Pending: "SellerPending",
      Preparing: "AtLocalHub", // coi như đã tới kho địa phương để shipper thấy
      Delivering: "Delivering",
      Delivered: "Delivered",
      Cancelled: "Cancelled"
    };
    try {
      const orders = await Order.find({ logisticStatus: { $exists: false } }).select("_id orderStatus");
      for (const o of orders) {
        const ls = map[o.orderStatus] || "SellerPending";
        await Order.updateOne({ _id: o._id }, { $set: { logisticStatus: ls } });
      }
      return res.status(200).json({ status: true, updated: orders.length });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },
};
