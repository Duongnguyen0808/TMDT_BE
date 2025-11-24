const Order = require("../models/Order");
const User = require("../models/User");
const Cart = require("../models/Cart");
const Voucher = require("../models/Voucher");
const VoucherClaim = require("../models/VoucherClaim");
const Appliances = require("../models/Appliances");
const Driver = require("../models/Driver");
const Store = require("../models/Store");
const Hub = require("../models/Hub");
const mongoose = require("mongoose");
const {
  sendOrderStatusNotification,
  sendOrderPlacedNotification,
  sendReturnRequestedNotification,
  sendReturnDecisionNotification,
  sendRefundProcessedNotification,
  sendPushNotification,
} = require("../utils/notification_service");
const { requestVnpayRefund } = require("../utils/vnpay");
const { settleDriverDeliveryPayout } = require("../utils/driverPayout");

// Proposal flow disabled: expose all available orders to all shippers
async function _startDriverProposal(_order) {
  return; // no-op
}

// Helper: rotate to next driver (called on decline or timeout)
async function _rotateDriverProposal(_order) { return; }

const PICKUP_CODE_TTL_MS = 2 * 60 * 60 * 1000; // 2h
const DELIVERY_BASE_FEE = Number(process.env.DELIVERY_BASE_FEE || 12000);
const DELIVERY_INCLUDED_KM = Number(process.env.DELIVERY_INCLUDED_KM || 2);
const DELIVERY_EXTRA_FEE_PER_KM = Number(
  process.env.DELIVERY_EXTRA_FEE_PER_KM || 2000
);
const DELIVERY_MAX_FEE = Number(process.env.DELIVERY_MAX_FEE || 120000);
const DELIVERY_ROUND_TO = Number(process.env.DELIVERY_ROUND_TO || 1000);
const EARTH_RADIUS_KM = 6371;

const generatePickupCode = () =>
  (Math.floor(100000 + Math.random() * 900000)).toString();

const normalizeCoords = (coords) => {
  if (!coords) return null;
  if (Array.isArray(coords) && coords.length >= 2) {
    const lat = Number(coords[0]);
    const lng = Number(coords[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
    return null;
  }
  if (typeof coords === "object") {
    const lat = Number(coords.latitude ?? coords.lat);
    const lng = Number(coords.longitude ?? coords.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
  }
  return null;
};

const haversineDistanceKm = (fromCoords, toCoords) => {
  if (!fromCoords || !toCoords) return null;
  const [lat1, lng1] = fromCoords;
  const [lat2, lng2] = toCoords;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const rLat1 = (lat1 * Math.PI) / 180;
  const rLat2 = (lat2 * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(rLat1) * Math.cos(rLat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
};

const toPositiveNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
};

const deliveryFeeFromDistance = (distanceKm) => {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    return DELIVERY_BASE_FEE;
  }
  const effectiveKm = Math.max(distanceKm, 1);
  const included = Math.max(DELIVERY_INCLUDED_KM, 0);
  const extraDistance = Math.max(0, effectiveKm - included);
  const baseComponent = DELIVERY_BASE_FEE;
  const variableComponent = extraDistance * DELIVERY_EXTRA_FEE_PER_KM;
  const rawFee = baseComponent + variableComponent;
  const cappedFee = DELIVERY_MAX_FEE > 0 ? Math.min(rawFee, DELIVERY_MAX_FEE) : rawFee;
  if (DELIVERY_ROUND_TO > 0) {
    return Math.max(
      DELIVERY_BASE_FEE,
      Math.round(cappedFee / DELIVERY_ROUND_TO) * DELIVERY_ROUND_TO
    );
  }
  return Math.max(DELIVERY_BASE_FEE, Math.round(cappedFee));
};

const calculateDeliveryFee = (
  storeCoords,
  recipientCoords,
  overrideDistanceKm = null
) => {
  const distance =
    toPositiveNumber(overrideDistanceKm) ??
    haversineDistanceKm(storeCoords, recipientCoords);
  return deliveryFeeFromDistance(distance);
};

const computeDeliveryQuote = (
  storeCoords,
  recipientCoords,
  overrideDistanceKm = null
) => {
  const normalizedStore = normalizeCoords(storeCoords);
  const normalizedRecipient = normalizeCoords(recipientCoords);
  const fallbackDistance = haversineDistanceKm(
    normalizedStore,
    normalizedRecipient
  );
  const distance =
    toPositiveNumber(overrideDistanceKm) ?? fallbackDistance;
  const fee = deliveryFeeFromDistance(distance);
  return {
    fee,
    distanceKm:
      distance != null && Number.isFinite(distance)
        ? Number(distance.toFixed(2))
        : 0,
    normalizedStore,
    normalizedRecipient,
  };
};

const canVendorManageOrder = (orderDoc, user) => {
  if (!orderDoc || !user) return false;
  if (user.userType === "Admin") return true;
  if (user.userType !== "Vendor") return false;
  const store = orderDoc.storeId;
  if (!store) return false;
  const ownerId = store.owner || store?.owner?._id;
  if (!ownerId) return false;
  return String(ownerId) === String(user.id);
};

const CANCELLABLE_STATUSES = [
  "Pending",
  "Preparing",
  "ReadyForPickup",
  "WaitingShipper",
];

module.exports = {
  placeOrder: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const newOrder = new Order(req.body);
      const clientDistanceOverride = toPositiveNumber(
        req.body?.deliveryDistanceKm ??
        req.body?.routeDistanceKm ??
        req.body?.clientDistanceKm ??
        req.body?.distanceKm
      );
      const { fee: computedDeliveryFee, distanceKm } = computeDeliveryQuote(
        newOrder.storeCoords,
        newOrder.recipientCoords,
        clientDistanceOverride
      );
      const currentFee = Number(newOrder.deliveryFee || 0);
      const feeDelta = computedDeliveryFee - currentFee;
      newOrder.deliveryFee = computedDeliveryFee;
      newOrder.deliveryDistanceKm =
        clientDistanceOverride ?? distanceKm;
      if (Number.isFinite(feeDelta) && feeDelta !== 0) {
        const baseGrand = Number(newOrder.grandTotal || 0);
        if (Number.isFinite(baseGrand)) {
          newOrder.grandTotal = Math.max(0, baseGrand + feeDelta);
        } else {
          newOrder.grandTotal = Math.max(
            0,
            Number(newOrder.orderTotal || 0) + computedDeliveryFee
          );
        }
      } else if (!Number.isFinite(Number(newOrder.grandTotal))) {
        newOrder.grandTotal = Math.max(
          0,
          Number(newOrder.orderTotal || 0) + computedDeliveryFee
        );
      }
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
        const storeCoordsNormalized = normalizeCoords(newOrder.storeCoords);
        const recipientCoordsNormalized = normalizeCoords(newOrder.recipientCoords);
        const sLat = storeCoordsNormalized ? storeCoordsNormalized[0] : null;
        const sLng = storeCoordsNormalized ? storeCoordsNormalized[1] : null;
        const rLat = recipientCoordsNormalized ? recipientCoordsNormalized[0] : null;
        const rLng = recipientCoordsNormalized ? recipientCoordsNormalized[1] : null;
        let originHub = null;
        let localHub = null;
        if (sLat != null && sLng != null && centrals.length) {
          originHub = centrals.reduce((best, h) => {
            const d = haversineDistanceKm([sLat, sLng], [h.latitude, h.longitude]);
            if (!best || d < best.d) return { h, d }; else return best;
          }, null);
        }
        if (rLat != null && rLng != null && locals.length) {
          localHub = locals.reduce((best, h) => {
            const d = haversineDistanceKm([rLat, rLng], [h.latitude, h.longitude]);
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
          "userId deliveryAddress orderItems deliveryFee storeId storeCoords recipientCoords orderStatus createdAt updatedAt orderTotal grandTotal driverId pickupCode pickupReadyAt pickupAssignedAt pickupCheckinAt pickupConfirmedAt pickupCodeExpiresAt shopReadyBy shipperPickupBy pickupNotes handoverPhoto logisticStatus paymentMethod returnStatus returnReason returnRequestedAt returnProcessedAt refundAmount refundMethod refundAt refundReference"
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
    const returnStatusesParam = req.query.returnStatuses || req.query.returnStatus;
    const paymentFilter = (req.query.payment || '').toLowerCase(); // 'all' | 'completed'
    const returnOnly = req.query.returnOnly === '1' || req.query.returnOnly === 'true';
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);

    const parseListParam = (input) => {
      if (Array.isArray(input)) {
        return input
          .flatMap((raw) => String(raw).split(','))
          .map((v) => v.trim())
          .filter(Boolean);
      }
      if (typeof input === 'string' && input.length) {
        return input
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
      }
      return [];
    };

    const statuses = parseListParam(statusesParam);
    const returnStatuses = parseListParam(returnStatusesParam);

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

    if (returnStatuses.length) {
      query.returnStatus = { $in: returnStatuses };
    } else if (returnOnly) {
      query.returnStatus = { $nin: ['None', '', null] };
    }

    try {
      const start = Date.now();
      const total = await Order.countDocuments(query);
      const sortOption = (returnStatuses.length || returnOnly)
        ? { returnRequestedAt: -1, createdAt: -1 }
        : { createdAt: -1 };
      const orders = await Order.find(query)
        .select("userId deliveryAddress orderItems deliveryFee storeId storeCoords recipientCoords orderStatus createdAt updatedAt orderTotal grandTotal driverId paymentStatus paymentMethod pickupCode pickupReadyAt pickupAssignedAt pickupCheckinAt pickupConfirmedAt pickupCodeExpiresAt shopReadyBy shipperPickupBy pickupNotes handoverPhoto logisticStatus returnStatus returnReason returnRequestedAt returnProcessedAt refundAmount refundMethod refundAt refundReference")
        .populate({ path: 'userId', select: 'phone profile' })
        .populate({ path: 'storeId', select: 'title coords imageUrl logoUrl time' })
        .populate({ path: 'orderItems.appliancesId', select: 'title imageUrl time price stock' })
        .populate({ path: 'deliveryAddress', select: 'addressLine1' })
        .sort(sortOption)
        .skip((page - 1) * limit)
        .limit(limit);
      const duration = Date.now() - start;
      const returnLog = returnStatuses.length
        ? returnStatuses.join('|')
        : (returnOnly ? 'non-empty' : '-');
      console.log(`[getStoreOrdersAdvanced] storeId=${id} statuses=${statuses.join('|') || (req.query.status || '')} payment=${paymentFilter || 'completed'} return=${returnLog} page=${page} limit=${limit} total=${total} count=${orders.length} ms=${duration}`);
      return res.status(200).json({ status: true, page, limit, total, count: orders.length, data: orders });
    } catch (error) {
      console.error('[getStoreOrdersAdvanced][ERROR]', error);
      return res.status(500).json({ status: false, message: error.message });
    }
  },

  markReadyForPickup: async (req, res) => {
    const orderId = req.params.id;
    const actor = req.user;
    if (!actor || (actor.userType !== "Vendor" && actor.userType !== "Admin")) {
      return res.status(403).json({ status: false, message: "Chỉ Vendor/Admin mới cập nhật được trạng thái này" });
    }

    try {
      const order = await Order.findById(orderId)
        .populate({ path: "storeId", select: "owner title" })
        .populate({ path: "userId", select: "fcm" });
      if (!order) {
        return res.status(404).json({ status: false, message: "Không tìm thấy đơn hàng" });
      }

      if (!canVendorManageOrder(order, actor)) {
        return res.status(403).json({ status: false, message: "Đơn hàng không thuộc cửa hàng của bạn" });
      }

      const allowed = ["Pending", "Preparing", "WaitingShipper", "ReadyForPickup"];
      if (!allowed.includes(order.orderStatus)) {
        return res.status(400).json({ status: false, message: "Trạng thái hiện tại không thể chuyển sang ReadyForPickup" });
      }

      const now = new Date();
      const pickupCode = generatePickupCode();
      order.orderStatus = "ReadyForPickup";
      order.pickupCode = pickupCode;
      order.pickupReadyAt = now;
      order.pickupCodeExpiresAt = new Date(now.getTime() + PICKUP_CODE_TTL_MS);
      order.shopReadyBy = actor.id;
      await order.save();

      try {
        if (order.userId && order.userId.fcm) {
          await sendOrderStatusNotification(order.userId.fcm, "ReadyForPickup", orderId);
        }
      } catch (_) { }

      try {
        const io = req.app.get("io");
        if (io) {
          io.emit("order:ready", {
            orderId: String(order._id),
            storeId: String(order.storeId?._id || order.storeId),
            pickupReadyAt: order.pickupReadyAt,
          });
        }
      } catch (_) { }

      return res.status(200).json({
        status: true,
        message: "Cửa hàng đã sẵn sàng, hãy cung cấp mã cho shipper",
        pickupCode,
        expiresAt: order.pickupCodeExpiresAt,
      });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },

  regeneratePickupCode: async (req, res) => {
    const orderId = req.params.id;
    const actor = req.user;
    if (!actor || (actor.userType !== "Vendor" && actor.userType !== "Admin")) {
      return res.status(403).json({ status: false, message: "Chỉ Vendor/Admin được phép" });
    }

    try {
      const order = await Order.findById(orderId)
        .populate({ path: "storeId", select: "owner title" })
        .populate({ path: "userId", select: "fcm" });
      if (!order) {
        return res.status(404).json({ status: false, message: "Không tìm thấy đơn hàng" });
      }

      if (!canVendorManageOrder(order, actor)) {
        return res.status(403).json({ status: false, message: "Đơn hàng không thuộc cửa hàng của bạn" });
      }

      const allowed = ["ReadyForPickup", "WaitingShipper"];
      if (!allowed.includes(order.orderStatus)) {
        return res.status(400).json({ status: false, message: "Chỉ có thể tạo lại mã khi đơn đang chờ shipper" });
      }

      const now = new Date();
      const pickupCode = generatePickupCode();
      order.pickupCode = pickupCode;
      order.pickupCodeExpiresAt = new Date(now.getTime() + PICKUP_CODE_TTL_MS);
      order.pickupReadyAt = order.pickupReadyAt || now;
      await order.save();

      try {
        const io = req.app.get("io");
        if (io) {
          io.emit("order:pickup_code_regen", {
            orderId: String(order._id),
            storeId: String(order.storeId?._id || order.storeId),
            pickupReadyAt: order.pickupReadyAt,
          });
        }
      } catch (_) { }

      return res.status(200).json({
        status: true,
        message: "Đã tạo mã mới",
        pickupCode,
        expiresAt: order.pickupCodeExpiresAt,
      });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },

  driverPickupCheckin: async (req, res) => {
    const actor = req.user;
    if (!actor || actor.userType !== "Driver") {
      return res.status(403).json({ status: false, message: "Chỉ tài xế mới được thao tác" });
    }

    const orderId = req.params.id;
    const { latitude, longitude, note } = req.body || {};

    try {
      const order = await Order.findById(orderId);
      if (!order) {
        return res.status(404).json({ status: false, message: "Không tìm thấy đơn hàng" });
      }
      if (String(order.driverId) !== String(actor.id)) {
        return res.status(403).json({ status: false, message: "Bạn không phải shipper của đơn này" });
      }
      const allowed = ["WaitingShipper", "ReadyForPickup"];
      if (!allowed.includes(order.orderStatus)) {
        return res.status(400).json({ status: false, message: "Đơn không còn ở trạng thái chờ lấy" });
      }

      order.pickupCheckinAt = new Date();
      if (typeof latitude === "number" && typeof longitude === "number") {
        order.pickupCheckinLocation = { latitude, longitude };
      }
      if (note) {
        order.pickupNotes = note;
      }
      await order.save();

      try {
        const store = await Store.findById(order.storeId).select("owner title");
        if (store && store.owner) {
          const vendor = await User.findById(store.owner).select("fcm username");
          if (vendor && vendor.fcm && vendor.fcm !== "none") {
            const orderCode = String(order._id).slice(-6);
            await sendPushNotification(
              vendor.fcm,
              "Shipper đã đến cửa hàng",
              `Tài xế của đơn #${orderCode} đang chờ nhận hàng tại quầy`,
              {
                type: "shipper_checkin",
                orderId: String(order._id),
                storeTitle: store.title || "",
              }
            );
          }
        }
      } catch (notifyError) {
        console.warn(
          "[driverPickupCheckin] notify vendor failed",
          notifyError?.message || notifyError
        );
      }

      try {
        const io = req.app.get("io");
        if (io) {
          io.emit("order:shipper_checkin", {
            orderId: String(order._id),
            driverId: String(actor.id),
            pickupCheckinAt: order.pickupCheckinAt,
          });
        }
      } catch (_) { }

      return res.status(200).json({ status: true, message: "Đã thông báo cửa hàng bạn đang lấy hàng" });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },

  driverConfirmPickup: async (req, res) => {
    const actor = req.user;
    if (!actor || actor.userType !== "Driver") {
      return res.status(403).json({ status: false, message: "Chỉ tài xế mới được thao tác" });
    }

    const orderId = req.params.id;
    const { pickupCode, handoverPhoto, note } = req.body || {};
    const normalizedCode = String(pickupCode || "").trim();
    if (!normalizedCode) {
      return res.status(400).json({ status: false, message: "Vui lòng nhập mã xác nhận" });
    }

    try {
      const order = await Order.findById(orderId)
        .populate({ path: "userId", select: "fcm" })
        .populate({ path: "storeId", select: "owner title" });
      if (!order) {
        return res.status(404).json({ status: false, message: "Không tìm thấy đơn hàng" });
      }
      if (String(order.driverId) !== String(actor.id)) {
        return res.status(403).json({ status: false, message: "Bạn không phải shipper của đơn này" });
      }
      const allowed = ["WaitingShipper", "ReadyForPickup", "PickedUp"];
      if (!allowed.includes(order.orderStatus)) {
        return res.status(400).json({ status: false, message: "Đơn không còn ở trạng thái chờ bàn giao" });
      }
      if (!order.pickupCode) {
        return res.status(400).json({ status: false, message: "Đơn chưa được cửa hàng phát mã" });
      }
      if (order.pickupCode !== normalizedCode) {
        return res.status(400).json({ status: false, message: "Mã xác nhận không đúng" });
      }

      order.orderStatus = "PickedUp";
      order.pickupConfirmedAt = new Date();
      order.shipperPickupBy = actor.id;
      order.pickupCode = "";
      order.pickupCodeExpiresAt = null;
      order.handoverPhoto = handoverPhoto || order.handoverPhoto;
      if (note) {
        order.pickupNotes = note;
      }
      order.logisticStatus = "Delivering";
      await order.save();

      try {
        if (order.userId && order.userId.fcm) {
          await sendOrderStatusNotification(order.userId.fcm, "PickedUp", orderId);
        }
      } catch (_) { }

      try {
        const io = req.app.get("io");
        if (io) {
          io.emit("order:picked_up", {
            orderId: String(order._id),
            driverId: String(actor.id),
            pickupConfirmedAt: order.pickupConfirmedAt,
          });
        }
      } catch (_) { }

      return res.status(200).json({ status: true, message: "Đã xác nhận nhận hàng từ cửa hàng" });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },

  cancelOrder: async (req, res) => {
    const orderId = req.params.id;
    const userId = req.user.id;
    const userType = req.user.userType;
    const { reason, cancellationReason } = req.body || {};
    const cancelReason = (reason || cancellationReason || "").trim();

    if (!cancelReason) {
      return res.status(400).json({ status: false, message: "Vui lòng cung cấp lý do hủy đơn" });
    }

    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const order = await Order.findById(orderId)
        .populate({ path: "userId", select: "fcm" })
        .session(session);

      if (!order) {
        await session.abortTransaction();
        return res.status(404).json({ status: false, message: "Không tìm thấy đơn hàng" });
      }

      const ownerId = String(order.userId?._id || order.userId);
      const isOwner = ownerId === String(userId);
      if (!isOwner && userType !== "Admin") {
        await session.abortTransaction();
        return res.status(403).json({ status: false, message: "Bạn không có quyền hủy đơn này" });
      }

      if (order.orderStatus === "Cancelled") {
        await session.abortTransaction();
        return res.status(400).json({ status: false, message: "Đơn hàng đã được hủy trước đó" });
      }

      if (!CANCELLABLE_STATUSES.includes(order.orderStatus)) {
        await session.abortTransaction();
        return res.status(400).json({ status: false, message: "Đơn hàng đã được xử lý, không thể hủy" });
      }

      const now = new Date();

      // Hoàn kho
      for (const item of order.orderItems) {
        await Appliances.findByIdAndUpdate(
          item.appliancesId,
          { $inc: { stock: item.quantity, soldCount: -item.quantity } },
          { session }
        );
      }

      // Hoàn voucher cho user nếu có
      if (order.promoCode) {
        const code = String(order.promoCode).toUpperCase();
        const voucher = await Voucher.findOneAndUpdate(
          { code },
          { $inc: { usedCount: -1 } },
          { new: true, session }
        );
        if (voucher) {
          await VoucherClaim.findOneAndUpdate(
            { voucher: voucher._id, user: order.userId },
            { $set: { used: false }, $unset: { usedAt: 1 } },
            { session }
          );
        }
      }

      // Giải phóng tài xế nếu đã gán
      if (order.driverId) {
        try {
          const driverDoc = await Driver.findOne({ user: order.driverId }).session(session);
          if (driverDoc) {
            driverDoc.status = "available";
            await driverDoc.save({ session });
          }
        } catch (_) { }
        order.driverId = "";
        order.driverAssignedAt = null;
      }

      // Xử lý hoàn tiền nếu đã thanh toán
      if (order.paymentStatus === "Completed") {
        const amount = order.grandTotal || order.orderTotal;
        if (!amount || amount <= 0) {
          await session.abortTransaction();
          return res.status(400).json({ status: false, message: "Số tiền hoàn không hợp lệ" });
        }

        if (order.paymentMethod === "VNPay") {
          if (!order.paymentGatewayTxnDate || !order.paymentGatewayTxnId) {
            await session.abortTransaction();
            return res.status(400).json({ status: false, message: "Thiếu thông tin giao dịch VNPay" });
          }

          try {
            const refundResult = await requestVnpayRefund({
              orderId,
              amount,
              transactionDate: order.paymentGatewayTxnDate,
              transactionNo: order.paymentGatewayTxnId,
              reason: `Customer cancel ${orderId}`,
              createdBy: req.user?.email || req.user?.id || "client-cancel",
            });

            if (!refundResult.success) {
              await session.abortTransaction();
              return res.status(502).json({
                status: false,
                message: refundResult.message || "VNPay refund thất bại",
                gatewayResponse: refundResult.data,
              });
            }

            order.refundReference = refundResult.data?.vnp_TransactionNo || refundResult.data?.vnp_TransNo || "";
            order.refundResponse = refundResult.data;
          } catch (error) {
            await session.abortTransaction();
            return res.status(502).json({ status: false, message: error.message || "Không thể hoàn VNPay" });
          }
        }

        order.refundAmount = amount;
        order.refundMethod = order.paymentMethod;
        order.refundAt = now;
        order.paymentStatus = "Refunded";
      }

      order.orderStatus = "Cancelled";
      order.logisticStatus = "Cancelled";
      order.cancellationReason = cancelReason;
      order.cancelledBy = userId;
      order.cancelledAt = now;

      await order.save({ session });

      await session.commitTransaction();

      // Push & socket sau khi commit
      try {
        if (order.userId && order.userId.fcm) {
          await sendOrderStatusNotification(order.userId.fcm, "Cancelled", orderId);
        }
      } catch (_) { }

      try {
        const io = req.app.get("io");
        if (io) {
          io.emit("order:updated", {
            orderId: String(order._id),
            status: "Cancelled",
          });
        }
      } catch (_) { }

      return res.status(200).json({
        status: true,
        message: "Đơn hàng đã được hủy",
        data: {
          orderId,
          orderStatus: order.orderStatus,
          paymentStatus: order.paymentStatus,
          refundAmount: order.refundAmount || 0,
        },
      });
    } catch (error) {
      await session.abortTransaction();
      return res.status(500).json({ status: false, message: error.message });
    } finally {
      session.endSession();
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

    if (orderStatus === "ReadyForPickup") {
      return module.exports.markReadyForPickup(req, res);
    }
    if (orderStatus === "PickedUp") {
      return res.status(400).json({ status: false, message: "Shipper sẽ xác nhận nhận hàng bằng mã, không thể cập nhật thủ công" });
    }
    if (orderStatus === "Cancelled" && userType === "Client") {
      return module.exports.cancelOrder(req, res);
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
          try {
            await settleDriverDeliveryPayout(updatedOrder);
          } catch (payoutErr) {
            console.warn("[updateOrderStatus] payout failed", payoutErr?.message || payoutErr);
          }
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
    const actor = req.user;
    const userType = actor.userType;
    const { action, note = "" } = req.body || {}; // action: approve | reject

    if (userType !== "Vendor" && userType !== "Admin") {
      return res.status(403).json({ status: false, message: "Bạn không có quyền duyệt trả hàng" });
    }

    if (!action || !["approve", "reject"].includes(action)) {
      return res.status(400).json({ status: false, message: "Hành động không hợp lệ" });
    }

    try {
      const order = await Order.findById(orderId)
        .populate({ path: "storeId", select: "owner title" });
      if (!order) return res.status(404).json({ status: false, message: "Không tìm thấy đơn hàng" });
      if (userType === "Vendor" && !canVendorManageOrder(order, actor)) {
        return res.status(403).json({ status: false, message: "Đơn không thuộc cửa hàng của bạn" });
      }
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
    const actor = req.user;
    const userType = actor.userType;
    const { refundAmount } = req.body || {}; // optional override amount

    if (userType !== "Vendor" && userType !== "Admin") {
      return res.status(403).json({ status: false, message: "Bạn không có quyền xác nhận trả hàng" });
    }

    try {
      const order = await Order.findById(orderId)
        .populate({ path: "storeId", select: "owner title" });
      if (!order) return res.status(404).json({ status: false, message: "Không tìm thấy đơn hàng" });
      if (userType === "Vendor" && !canVendorManageOrder(order, actor)) {
        return res.status(403).json({ status: false, message: "Đơn không thuộc cửa hàng của bạn" });
      }
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

      const isCod = order.paymentMethod === "COD";
      const paidOnline = order.paymentStatus === "Completed";

      // Process refund if already collected (online or COD)
      if (paidOnline || isCod) {
        const baseAmount = Number(order.grandTotal || order.orderTotal || 0);
        const amount = typeof refundAmount === "number" ? refundAmount : baseAmount;
        if (!amount || amount <= 0) {
          return res.status(400).json({ status: false, message: "Số tiền hoàn không hợp lệ" });
        }

        if (paidOnline && order.paymentMethod === "VNPay") {
          if (!order.paymentGatewayTxnDate || !order.paymentGatewayTxnId) {
            return res.status(400).json({ status: false, message: "Thiếu thông tin giao dịch VNPay để hoàn tiền" });
          }
          try {
            const refundResult = await requestVnpayRefund({
              orderId: orderId,
              amount,
              transactionDate: order.paymentGatewayTxnDate,
              transactionNo: order.paymentGatewayTxnId,
              reason: `Refund order ${orderId}`,
              createdBy: req.user?.email || req.user?.id || "system",
            });
            if (!refundResult.success) {
              return res.status(502).json({
                status: false,
                message: refundResult.message || "VNPay refund thất bại",
                gatewayResponse: refundResult.data,
              });
            }
            order.refundReference = refundResult.data?.vnp_TransactionNo || refundResult.data?.vnp_TransNo || "";
            order.refundResponse = refundResult.data;
          } catch (err) {
            return res.status(502).json({ status: false, message: err.message || "VNPay refund error" });
          }
        }

        order.refundAmount = amount;
        order.refundMethod = order.paymentMethod || (isCod ? "COD" : "");
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
