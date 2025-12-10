const Order = require("../models/Order");
const User = require("../models/User");
const Cart = require("../models/Cart");
const Voucher = require("../models/Voucher");
const VoucherClaim = require("../models/VoucherClaim");
const Appliances = require("../models/Appliances");
const Driver = require("../models/Driver");
const Store = require("../models/Store");
const Hub = require("../models/Hub");
const Shipment = require("../models/Shipment");
const mongoose = require("mongoose");
const {
  sendOrderStatusNotification,
  sendOrderPlacedNotification,
  sendReturnRequestedNotification,
  sendReturnDecisionNotification,
  sendRefundProcessedNotification,
  sendPushNotification,
  sendVendorNewOrderNotification,
  sendDriverPickupReadyNotification,
  sendDriverOrderCancelledNotification,
  sendDriverDisputeResolutionNotification,
} = require("../utils/notification_service");
const { requestVnpayRefund } = require("../utils/vnpay");
const { settleDriverDeliveryPayout } = require("../utils/driverPayout");

// Luồng đề xuất tài xế đã tắt: mọi đơn sẵn sàng sẽ hiển thị cho tất cả shipper
async function _startDriverProposal(_order) {
  return; // không thực hiện hành động nào
}

// Hàm phụ: chuyển lượt cho tài xế kế tiếp khi từ chối hoặc hết hạn
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

// Chuẩn hoá dữ liệu toạ độ từ nhiều cấu trúc khác nhau, trả về [lat, lng] hợp lệ
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

// Tính khoảng cách đường chim bay giữa hai điểm bằng công thức Haversine
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

// Quy đổi khoảng cách thành phí giao hàng, áp dụng chặn min/max và làm tròn cấu hình
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

// API cũ: chỉ trả về phí dựa trên khoảng cách giữa cửa hàng và người nhận
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

// API mới: trả về cả phí, quãng đường chuẩn hoá và vị trí để client hiển thị chi tiết
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

// Lấy thông tin chủ cửa hàng (vendor) từ document hoặc from DB nếu chưa populate
const resolveStoreOwner = async (storeRef) => {
  if (!storeRef) return null;
  const raw = typeof storeRef.toObject === "function" ? storeRef.toObject() : storeRef;
  if (raw.owner) {
    return {
      ownerId: raw.owner._id ? raw.owner._id : raw.owner,
      title: raw.title || "",
    };
  }
  try {
    const doc = await Store.findById(raw._id || raw).select("owner title");
    if (!doc) return null;
    return { ownerId: doc.owner, title: doc.title || "" };
  } catch (_) {
    return null;
  }
};

// Tìm ra user account (để gửi thông báo) tương ứng với chủ cửa hàng
const findVendorUser = async (storeRef) => {
  const info = await resolveStoreOwner(storeRef);
  if (!info) return { user: null, storeTitle: "" };
  const storeTitle = info.title || "";
  if (!info.ownerId) return { user: null, storeTitle };
  try {
    const user = await User.findById(info.ownerId).select("fcm username");
    return { user, storeTitle };
  } catch (_) {
    return { user: null, storeTitle };
  }
};

// Lấy thông tin user của tài xế dùng cho thông báo real-time
const findDriverUser = async (driverId) => {
  if (!driverId) return null;
  try {
    return await User.findById(driverId).select("fcm username");
  } catch (_) {
    return null;
  }
};

// Các api cũ mới dùng nhiều tên trường khác nhau: gom về một hàm tra cứu duy nhất
const resolveProofPhoto = (payload = {}) => {
  return (
    payload.deliveryProofPhoto ||
    payload.proofPhoto ||
    payload.photoUrl ||
    payload.photo ||
    payload.imageUrl ||
    ""
  );
};

const LOGISTICS_STAGE_FLOW = [
  {
    key: "SellerPending",
    label: "Cửa hàng xác nhận",
    description: "Đang chờ cửa hàng đóng gói và bàn giao",
  },
  {
    key: "ToOriginHub",
    label: "Đang tới kho trung tâm",
    description: "Đơn rời cửa hàng để chuyển về kho trung tâm",
  },
  {
    key: "AtOriginHub",
    label: "Đã quét tại kho trung tâm",
    description: "Hệ thống ghi nhận đơn ở kho trung tâm",
  },
  {
    key: "ToLocalHub",
    label: "Đang tới kho địa phương",
    description: "Hàng đang được trung chuyển xuống kho gần khách",
  },
  {
    key: "AtLocalHub",
    label: "Sẵn sàng tại kho địa phương",
    description: "Kho địa phương đã sẵn sàng giao cho shipper",
  },
  {
    key: "PickedUp",
    label: "Shipper đã nhận hàng",
    description: "Tài xế xác nhận nhận hàng từ kho/ cửa hàng",
  },
  {
    key: "Delivering",
    label: "Shipper đang giao",
    description: "Đơn đang trên đường tới bạn",
  },
  {
    key: "Delivered",
    label: "Đơn đã giao",
    description: "Cửa hàng xác nhận đã giao thành công",
  },
  {
    key: "Cancelled",
    label: "Đơn đã hủy",
    description: "Đơn bị hủy bởi người dùng hoặc hệ thống",
  },
];

const LOGISTICS_STAGE_INDEX = LOGISTICS_STAGE_FLOW.reduce((acc, stage, idx) => {
  acc[stage.key] = idx;
  return acc;
}, {});

const formatHubInfo = (hubDoc) => {
  if (!hubDoc) return null;
  const hub = typeof hubDoc.toObject === "function" ? hubDoc.toObject() : hubDoc;
  return {
    id: hub._id ? String(hub._id) : "",
    code: hub.code || "",
    name: hub.name || "",
    type: hub.type || "",
    address: hub.address || "",
    latitude: hub.latitude,
    longitude: hub.longitude,
  };
};

const formatStoreInfo = (storeDoc) => {
  if (!storeDoc) return null;
  const store = typeof storeDoc.toObject === "function" ? storeDoc.toObject() : storeDoc;
  return {
    id: store._id ? String(store._id) : "",
    title: store.title || "",
    logoUrl: store.logoUrl || "",
    imageUrl: store.imageUrl || "",
    address: store.coords?.address || "",
    latitude: store.coords?.latitude,
    longitude: store.coords?.longitude,
    time: store.time || "",
  };
};

const formatDeliveryAddress = (addressDoc) => {
  if (!addressDoc) return null;
  const addr = typeof addressDoc.toObject === "function" ? addressDoc.toObject() : addressDoc;
  return {
    id: addr._id ? String(addr._id) : "",
    addressLine1: addr.addressLine1 || addr.addressLine || "",
    displayName: addr.displayName || "",
    deliveryInstructions: addr.deliveryInstructions || "",
    latitude: addr.latitude,
    longitude: addr.longitude,
  };
};

// Suy ra timestamp cho từng mốc logistics dựa trên dữ liệu đơn + shipment timeline
const resolveStageTimestamp = (stageKey, orderDoc, shipmentDoc) => {
  const timeline = shipmentDoc?.timeline || {};
  switch (stageKey) {
    case "SellerPending":
      return orderDoc.pickupReadyAt || orderDoc.createdAt || null;
    case "ToOriginHub":
      return timeline.DepartOriginAt || orderDoc.pickupAssignedAt || null;
    case "AtOriginHub":
      return timeline.ArriveOriginAt || null;
    case "ToLocalHub":
      return timeline.DepartLocalAt || null;
    case "AtLocalHub":
      return timeline.ArriveLocalAt || timeline.ReadyPickupAt || orderDoc.pickupReadyAt || null;
    case "PickedUp":
      return orderDoc.pickupConfirmedAt || null;
    case "Delivering":
      return orderDoc.deliveryProofAt || null;
    case "Delivered":
      return orderDoc.shopDeliveryConfirmedAt || orderDoc.deliveryProofAt || null;
    case "Cancelled":
      return orderDoc.cancelledAt || null;
    default:
      return null;
  }
};

// Gộp lộ trình kho, hub và trạng thái để phía mobile hiển thị dạng tiến trình
const buildLogisticsTimeline = (orderDoc, shipmentDoc) => {
  const timeline = LOGISTICS_STAGE_FLOW.map((stage) => {
    const timestamp = resolveStageTimestamp(stage.key, orderDoc, shipmentDoc);
    let hubRef = null;
    if (["ToOriginHub", "AtOriginHub"].includes(stage.key)) {
      hubRef = formatHubInfo(orderDoc.originHub || shipmentDoc?.originHub);
    } else if (["ToLocalHub", "AtLocalHub", "PickedUp"].includes(stage.key)) {
      hubRef = formatHubInfo(orderDoc.localHub || shipmentDoc?.localHub);
    }
    return {
      key: stage.key,
      label: stage.label,
      description: stage.description,
      timestamp,
      hub: hubRef,
      state: "pending",
    };
  });

  const currentStatus = orderDoc.logisticStatus || "SellerPending";
  const currentIdx = LOGISTICS_STAGE_INDEX[currentStatus] ?? 0;
  const isCancelled = currentStatus === "Cancelled" || orderDoc.orderStatus === "Cancelled";

  timeline.forEach((stage, idx) => {
    if (stage.key === "Cancelled") {
      if (isCancelled) {
        stage.timestamp = stage.timestamp || orderDoc.cancelledAt || orderDoc.updatedAt || null;
        stage.description = orderDoc.cancellationReason || stage.description;
        stage.state = stage.timestamp ? "done" : "active";
      } else {
        stage.state = "pending";
      }
      return;
    }

    if (isCancelled) {
      stage.state = stage.timestamp ? "done" : "pending";
      return;
    }

    if (idx < currentIdx) {
      stage.state = "done";
    } else if (idx === currentIdx) {
      stage.state = stage.timestamp ? "done" : "active";
    } else {
      stage.state = "pending";
    }
  });

  return timeline;
};

// Phát sự kiện socket để dashboard/ứng dụng đồng bộ trạng thái logistics theo thời gian thực
const emitOrderLogistics = (req, orderId, logisticStatus, extra = {}) => {
  try {
    const io = req.app.get("io");
    if (io) {
      io.emit("order:logistics", {
        orderId: String(orderId),
        logisticStatus,
        ...extra,
      });
    }
  } catch (emitErr) {
    console.warn("[orderController] emitOrderLogistics failed", emitErr?.message || emitErr);
  }
};

// Kiểm tra vendor hiện tại có quyền thao tác với đơn không (tránh sửa nhầm cửa hàng khác)
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
      // 1) Chuẩn hoá phí giao hàng dựa trên toạ độ để tránh client tự ý gửi số tiền thấp
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

      // 2) Đảm bảo từng sản phẩm còn tồn kho và đang mở bán trước khi trừ
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

      // 3) Tự động gán kho trung tâm/kho địa phương gần nhất để hiển thị tiến trình giao nhận
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

      // 4) Trừ tồn + cộng soldCount sau khi xác nhận nằm trong transaction
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

      // 5) Xoá các item đã mua khỏi giỏ để tránh hiển thị trùng
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

      // 6) Ghi nhận voucher đã dùng + đánh dấu claim của user
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

      // 7) Báo cho khách & vendor biết có đơn mới (tối ưu trải nghiệm realtime)
      try {
        if (user && user.fcm && user.fcm !== 'none') {
          await sendOrderPlacedNotification(user.fcm, orderId, newOrder.grandTotal || newOrder.orderTotal || 0);
        }
      } catch (e) { }

      try {
        const { user: vendorUser, storeTitle } = await findVendorUser(newOrder.storeId);
        if (vendorUser && vendorUser.fcm && vendorUser.fcm !== 'none') {
          await sendVendorNewOrderNotification(
            vendorUser.fcm,
            orderId,
            storeTitle,
            newOrder.grandTotal || newOrder.orderTotal || 0
          );
        }
      } catch (_) { }

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
      const rawStatuses = String(orderStatus)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (rawStatuses.length === 1) {
        query.orderStatus = rawStatuses[0];
      } else if (rawStatuses.length > 1) {
        query.orderStatus = { $in: rawStatuses };
      }
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
      // Nếu không truyền all thì vẫn ưu tiên những đơn đã thanh toán xong để dễ soát tiền
      if (
        orderStatus === "Delivered" &&
        (userType === "Vendor" || userType === "Admin") &&
        (!updatedOrder.shopDeliveryConfirmStatus || updatedOrder.shopDeliveryConfirmStatus === "None")
      ) {
        updatedOrder.shopDeliveryConfirmStatus = "Confirmed";
        updatedOrder.shopDeliveryConfirmedAt = new Date();
        updatedOrder.shopDeliveryConfirmedBy = userId;
        if (req.body?.note) updatedOrder.shopDeliveryConfirmNote = req.body.note;
        await updatedOrder.save();
      }
      if (!includeAll) baseQuery.paymentStatus = "Completed";
      const start = Date.now();
      const orders = await Order.find(baseQuery)
        .select(
          "userId deliveryAddress orderItems deliveryFee storeId storeCoords recipientCoords orderStatus createdAt updatedAt orderTotal grandTotal driverId pickupCode pickupReadyAt pickupAssignedAt pickupCheckinAt pickupConfirmedAt pickupCodeExpiresAt shopReadyBy shipperPickupBy pickupNotes handoverPhoto logisticStatus paymentMethod returnStatus returnReason returnRequestedAt returnProcessedAt refundAmount refundMethod refundAt refundReference deliveryProofPhoto deliveryProofNote deliveryProofRecipient deliveryProofAt deliveryProofBy deliveryProofLocation shopDeliveryConfirmStatus shopDeliveryConfirmedAt shopDeliveryConfirmedBy shopDeliveryConfirmNote shopDeliveryRejectReason shopDeliveryRejectedAt"
        )
        .populate({
          path: "userId",
          select: "username phone email profile",
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

  listPendingDeliveryProofs: async (req, res) => {
    const storeId = req.params.id;
    const actor = req.user;
    if (!actor || (actor.userType !== "Vendor" && actor.userType !== "Admin")) {
      return res.status(403).json({ status: false, message: "Chỉ Vendor/Admin được phép xem danh sách này" });
    }
    if (!storeId) {
      return res.status(400).json({ status: false, message: "Thiếu storeId" });
    }

    try {
      const store = await Store.findById(storeId).select("owner title");
      if (!store) {
        return res.status(404).json({ status: false, message: "Không tìm thấy cửa hàng" });
      }
      if (actor.userType === "Vendor" && String(store.owner) !== String(actor.id)) {
        return res.status(403).json({ status: false, message: "Cửa hàng không thuộc quyền sở hữu của bạn" });
      }

      const orders = await Order.find({
        storeId,
        shopDeliveryConfirmStatus: "Pending",
      })
        .select(
          "userId deliveryAddress orderItems deliveryFee orderStatus logisticStatus shopDeliveryConfirmStatus deliveryProofPhoto deliveryProofNote deliveryProofRecipient deliveryProofAt deliveryProofLocation createdAt updatedAt"
        )
        .populate({ path: "userId", select: "username phone" })
        .populate({ path: "deliveryAddress", select: "addressLine1" })
        .populate({ path: "orderItems.appliancesId", select: "title imageUrl price" })
        .sort({ deliveryProofAt: -1, updatedAt: -1 })
        .lean();

      return res.status(200).json({ status: true, count: orders.length, data: orders });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
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
        .select("userId deliveryAddress orderItems deliveryFee storeId storeCoords recipientCoords orderStatus createdAt updatedAt orderTotal grandTotal driverId paymentStatus paymentMethod pickupCode pickupReadyAt pickupAssignedAt pickupCheckinAt pickupConfirmedAt pickupCodeExpiresAt shopReadyBy shipperPickupBy pickupNotes handoverPhoto logisticStatus returnStatus returnReason returnRequestedAt returnProcessedAt refundAmount refundMethod refundAt refundReference deliveryProofPhoto deliveryProofNote deliveryProofRecipient deliveryProofAt deliveryProofBy deliveryProofLocation shopDeliveryConfirmStatus shopDeliveryConfirmedAt shopDeliveryConfirmedBy shopDeliveryConfirmNote shopDeliveryRejectReason shopDeliveryRejectedAt")
        .populate({ path: 'userId', select: 'username phone email profile' })
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
        if (order.driverId) {
          const driverUser = await findDriverUser(order.driverId);
          if (driverUser && driverUser.fcm && driverUser.fcm !== "none") {
            await sendDriverPickupReadyNotification(
              driverUser.fcm,
              orderId,
              order.storeId?.title || "",
              pickupCode,
              order.pickupCodeExpiresAt
            );
          }
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

      try {
        if (order.driverId) {
          const driverUser = await findDriverUser(order.driverId);
          if (driverUser && driverUser.fcm && driverUser.fcm !== "none") {
            await sendDriverPickupReadyNotification(
              driverUser.fcm,
              orderId,
              order.storeId?.title || "",
              pickupCode,
              order.pickupCodeExpiresAt
            );
          }
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

      emitOrderLogistics(req, orderId, order.logisticStatus, {
        stage: "PickedUp",
        pickupConfirmedAt: order.pickupConfirmedAt,
      });

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

  submitDeliveryProof: async (req, res) => {
    const actor = req.user;
    if (!actor || actor.userType !== "Driver") {
      return res.status(403).json({ status: false, message: "Chỉ tài xế mới gửi được bằng chứng bàn giao" });
    }

    const orderId = req.params.id;
    const {
      note,
      deliveryNote,
      recipientName,
      latitude,
      longitude,
      deliveryLatitude,
      deliveryLongitude,
      keepConfirmation,
      retainConfirmation,
      forceReconfirm,
      supplementOnly,
      supplemental,
      appendOnly,
    } = req.body || {};
    const proofPhoto = resolveProofPhoto(req.body || {});
    if (!proofPhoto) {
      return res.status(400).json({ status: false, message: "Vui lòng đính kèm ảnh bàn giao" });
    }

    try {
      const order = await Order.findById(orderId)
        .populate({ path: "userId", select: "fcm" })
        .populate({ path: "storeId", select: "owner title" });
      if (!order) {
        return res.status(404).json({ status: false, message: "Không tìm thấy đơn hàng" });
      }
      if (!order.driverId || String(order.driverId) !== String(actor.id)) {
        return res.status(403).json({ status: false, message: "Bạn không phải shipper của đơn này" });
      }
      const allowedStatuses = ["PickedUp", "Delivering", "Delivered"];
      if (!allowedStatuses.includes(order.orderStatus)) {
        return res.status(400).json({ status: false, message: "Đơn chưa ở trạng thái cho phép hoàn tất" });
      }

      // Cho phép shipper bổ sung ảnh mà không reset trạng thái nếu shop đã xác nhận
      const isSupplement = Boolean(
        supplementOnly || supplemental || appendOnly || req.body?.additionalProof
      );
      const forceReview = Boolean(forceReconfirm || req.body?.forceReview);
      let codPaymentUpdated = false;
      order.orderStatus = "Delivering";
      order.logisticStatus = "Delivering";
      order.deliveryProofPhoto = proofPhoto;
      order.deliveryProofNote = note || deliveryNote || order.deliveryProofNote || "";
      if (recipientName) {
        order.deliveryProofRecipient = recipientName;
      }
      order.deliveryProofAt = new Date();
      order.deliveryProofBy = actor.id;
      const lat = Number(latitude ?? deliveryLatitude);
      const lng = Number(longitude ?? deliveryLongitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        order.deliveryProofLocation = { latitude: lat, longitude: lng };
      }
      const alreadyConfirmed = order.shopDeliveryConfirmStatus === "Confirmed";
      const requestKeep = Boolean(keepConfirmation || retainConfirmation);
      const shouldKeepConfirmation = !forceReview && (isSupplement || requestKeep || alreadyConfirmed);

      if (!Array.isArray(order.deliveryProofAlbum)) {
        order.deliveryProofAlbum = [];
      }
      order.deliveryProofAlbum.push(proofPhoto);
      order.deliveryProofAlbum = order.deliveryProofAlbum
        .filter((url) => typeof url === "string" && url.trim().length > 0)
        .slice(-6);

      // Nếu shop chưa xác nhận hoặc yêu cầu rà soát lại thì reset toàn bộ dấu vết confirm
      if (!shouldKeepConfirmation) {
        order.shopDeliveryConfirmStatus = "Pending";
        order.shopDeliveryConfirmedAt = null;
        order.shopDeliveryConfirmedBy = "";
        order.shopDeliveryConfirmNote = "";
        order.shopDeliveryRejectReason = "";
        order.shopDeliveryRejectedAt = null;
        order.deliveryIssueStatus = "None";
        order.deliveryIssueNote = "";
        order.deliveryProofReminderSentAt = null;
        order.deliveryProofEscalatedAt = null;
      }

      if (!isSupplement && order.customerDisputeStatus === "Pending") {
        order.customerDisputeStatus = "Resolved";
        order.customerDisputeResolvedAt = new Date();
        order.customerDisputeResolution = "Driver đã cập nhật bằng chứng giao hàng";
      }

      if (
        order.paymentMethod === "COD" &&
        (order.paymentStatus === "Pending" || order.paymentStatus === "Unpaid")
      ) {
        order.paymentStatus = "Completed";
        order.paymentStatusUpdatedAt = new Date();
        codPaymentUpdated = true;
      }
      await order.save();

      if (order.driverId) {
        try {
          const driverDoc = await Driver.findOne({ user: order.driverId });
          if (driverDoc && driverDoc.status !== "available") {
            driverDoc.status = "available";
            await driverDoc.save();
            try {
              const io = req.app.get("io");
              if (io) {
                io.emit("driver:status", {
                  driverId: String(order.driverId),
                  status: "available",
                });
              }
            } catch (_) { }
          }
        } catch (driverErr) {
          console.warn("[submitDeliveryProof] update driver status fail", driverErr?.message || driverErr);
        }
      }

      emitOrderLogistics(req, orderId, order.logisticStatus, {
        stage: "ProofSubmitted",
        deliveryProofAt: order.deliveryProofAt,
      });

      try {
        const storeOwnerId = order.storeId?.owner || order.storeId?.owner?._id;
        if (storeOwnerId) {
          const vendor = await User.findById(storeOwnerId).select("fcm username");
          if (vendor && vendor.fcm && vendor.fcm !== "none") {
            const orderCode = String(order._id).slice(-6);
            await sendPushNotification(
              vendor.fcm,
              "Shipper đã gửi bằng chứng giao hàng",
              `Đơn #${orderCode} đã được cập nhật ảnh bàn giao, vui lòng xác nhận`,
              {
                type: "delivery_proof",
                orderId: String(order._id),
                storeTitle: order.storeId?.title || "",
              }
            );
          }
        }
      } catch (notifyErr) {
        console.warn("[submitDeliveryProof] notify vendor failed", notifyErr?.message || notifyErr);
      }

      try {
        const io = req.app.get("io");
        if (io) {
          io.emit("order:delivery_proof", {
            orderId: String(order._id),
            driverId: String(actor.id),
            shopDeliveryConfirmStatus: order.shopDeliveryConfirmStatus,
            deliveryProofAt: order.deliveryProofAt,
          });
        }
      } catch (_) { }

      return res.status(200).json({
        status: true,
        message: "Đã gửi bằng chứng giao hàng, chờ shop xác nhận",
        data: {
          orderId,
          shopDeliveryConfirmStatus: order.shopDeliveryConfirmStatus,
          deliveryProofPhoto: order.deliveryProofPhoto,
          deliveryProofAlbum: order.deliveryProofAlbum,
          confirmationRetained: shouldKeepConfirmation,
          supplemental: isSupplement,
          codPaymentCompleted: codPaymentUpdated,
        },
      });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },

  shopConfirmDelivery: async (req, res) => {
    const actor = req.user;
    if (!actor || (actor.userType !== "Vendor" && actor.userType !== "Admin")) {
      return res.status(403).json({ status: false, message: "Chỉ cửa hàng hoặc Admin mới xác nhận giao hàng" });
    }

    const orderId = req.params.id;
    const actionRaw = (req.body?.action || req.body?.decision || "confirm").toLowerCase();
    const action = actionRaw === "reject" ? "reject" : "confirm";
    const note = req.body?.note || req.body?.reason || "";

    try {
      const order = await Order.findById(orderId)
        .populate({ path: "storeId", select: "owner title" })
        .populate({ path: "userId", select: "fcm" });
      if (!order) {
        return res.status(404).json({ status: false, message: "Không tìm thấy đơn hàng" });
      }

      if (actor.userType === "Vendor") {
        const ownerId = order.storeId?.owner || order.storeId?.owner?._id;
        if (!ownerId || String(ownerId) !== String(actor.id)) {
          return res.status(403).json({ status: false, message: "Đơn hàng không thuộc cửa hàng của bạn" });
        }
      }

      if (action === "confirm") {
        order.shopDeliveryConfirmStatus = "Confirmed";
        order.shopDeliveryConfirmedAt = new Date();
        order.shopDeliveryConfirmedBy = actor.id;
        if (note) order.shopDeliveryConfirmNote = note;
        order.shopDeliveryRejectReason = "";
        order.shopDeliveryRejectedAt = null;
        order.orderStatus = "Delivered";
        order.logisticStatus = "Delivered";
        order.deliveryIssueStatus = "Resolved";
        order.deliveryIssueNote = "";
        if (order.customerDisputeStatus === "Pending") {
          order.customerDisputeStatus = "Resolved";
          order.customerDisputeResolvedAt = new Date();
          order.customerDisputeResolution = note || "Shop xác nhận khách đã nhận";
        }
        await order.save();

        emitOrderLogistics(req, orderId, order.logisticStatus, {
          stage: "Delivered",
          shopDeliveryConfirmStatus: order.shopDeliveryConfirmStatus,
        });

        // Release driver & settle payout once shop confirms
        if (order.driverId) {
          try {
            const driver = await Driver.findOne({ user: order.driverId });
            if (driver && driver.status !== "available") {
              driver.status = "available";
              await driver.save();
            }
          } catch (driverErr) {
            console.warn("[shopConfirmDelivery] update driver status fail", driverErr?.message || driverErr);
          }
          try {
            await settleDriverDeliveryPayout(order);
          } catch (payoutErr) {
            console.warn("[shopConfirmDelivery] payout fail", payoutErr?.message || payoutErr);
          }
        }

        try {
          if (order.userId && order.userId.fcm) {
            await sendOrderStatusNotification(order.userId.fcm, "Delivered", orderId);
          }
        } catch (_) { }

        try {
          const driverUser = await User.findById(order.driverId).select("fcm username");
          if (driverUser && driverUser.fcm && driverUser.fcm !== "none") {
            await sendPushNotification(
              driverUser.fcm,
              "Shop đã xác nhận đơn giao",
              `Đơn ${String(order._id).slice(-6)} đã được shop chấp nhận bằng chứng giao hàng`,
              { type: "delivery_confirmed", orderId: String(order._id) }
            );
          }
        } catch (_) { }

        try {
          const io = req.app.get("io");
          if (io) {
            io.emit("order:delivery_confirm", {
              orderId: String(order._id),
              shopDeliveryConfirmStatus: order.shopDeliveryConfirmStatus,
            });
          }
        } catch (_) { }

        return res.status(200).json({ status: true, message: "Đã xác nhận khách đã nhận hàng" });
      }

      // Nếu shop phát hiện giao sai => chuyển về trạng thái Escalated để shipper bổ sung
      order.shopDeliveryConfirmStatus = "Rejected";
      order.shopDeliveryRejectReason = note || "Shop từ chối bằng chứng giao hàng";
      order.shopDeliveryRejectedAt = new Date();
      order.orderStatus = "Delivering";
      order.logisticStatus = "Delivering";
      order.deliveryIssueStatus = "Escalated";
      order.deliveryIssueNote = order.shopDeliveryRejectReason;
      await order.save();

      emitOrderLogistics(req, orderId, order.logisticStatus, {
        stage: "DeliveryRejected",
        shopDeliveryConfirmStatus: order.shopDeliveryConfirmStatus,
      });

      try {
        const driverUser = await User.findById(order.driverId).select("fcm username");
        if (driverUser && driverUser.fcm && driverUser.fcm !== "none") {
          await sendPushNotification(
            driverUser.fcm,
            "Shop chưa chấp nhận bằng chứng",
            `Vui lòng liên hệ shop để xử lý lại đơn ${String(order._id).slice(-6)}`,
            { type: "delivery_rejected", orderId: String(order._id) }
          );
        }
      } catch (_) { }

      try {
        if (order.userId && order.userId.fcm && order.userId.fcm !== "none") {
          await sendPushNotification(
            order.userId.fcm,
            "Đơn hàng đang được xác minh",
            "Shop đang kiểm tra lại bằng chứng giao hàng, chúng tôi sẽ cập nhật sớm.",
            { type: "delivery_rejected", orderId: String(order._id) }
          );
        }
      } catch (_) { }

      try {
        const io = req.app.get("io");
        if (io) {
          io.emit("order:delivery_confirm", {
            orderId: String(order._id),
            shopDeliveryConfirmStatus: order.shopDeliveryConfirmStatus,
          });
        }
      } catch (_) { }

      return res.status(200).json({ status: true, message: "Đã từ chối bằng chứng giao hàng" });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },

  createDeliveryDispute: async (req, res) => {
    const orderId = req.params.id;
    const userId = req.user.id;
    const { reason = "", note = "" } = req.body || {};

    try {
      const order = await Order.findById(orderId)
        .populate({ path: "storeId", select: "owner title" })
        .populate({ path: "userId", select: "fcm username" });
      if (!order) {
        return res.status(404).json({ status: false, message: "Không tìm thấy đơn hàng" });
      }
      if (String(order.userId?._id || order.userId) !== String(userId)) {
        return res.status(403).json({ status: false, message: "Bạn không có quyền khiếu nại đơn này" });
      }
      if (!order.deliveryProofPhoto) {
        return res.status(400).json({ status: false, message: "Đơn chưa có bằng chứng giao hàng để khiếu nại" });
      }

      // Khách hàng chỉ có thể mở khiếu nại sau khi shipper upload proof
      order.customerDisputeStatus = "Pending";
      order.customerDisputeNote = (note || reason || "Khách báo chưa nhận hàng").trim();
      order.customerDisputeAt = new Date();
      order.deliveryIssueStatus = "Disputed";
      order.deliveryIssueNote = order.customerDisputeNote;
      await order.save();

      try {
        const ownerId = order.storeId?.owner || order.storeId?.owner?._id;
        if (ownerId) {
          const vendor = await User.findById(ownerId).select("fcm username");
          if (vendor && vendor.fcm && vendor.fcm !== "none") {
            await sendPushNotification(
              vendor.fcm,
              "Khách báo chưa nhận hàng",
              `Đơn ${String(order._id).slice(-6)} đang bị khiếu nại, vui lòng kiểm tra`,
              { type: "delivery_dispute", orderId: String(order._id) }
            );
          }
        }
      } catch (_) { }

      try {
        if (order.driverId) {
          const driver = await User.findById(order.driverId).select("fcm username");
          if (driver && driver.fcm && driver.fcm !== "none") {
            await sendPushNotification(
              driver.fcm,
              "Khách báo chưa nhận hàng",
              `Vui lòng phối hợp với shop để xử lý đơn ${String(order._id).slice(-6)}`,
              { type: "delivery_dispute", orderId: String(order._id) }
            );
          }
        }
      } catch (_) { }

      return res.status(200).json({ status: true, message: "Đã ghi nhận khiếu nại, shop sẽ phản hồi sớm" });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },

  reviewDeliveryDispute: async (req, res) => {
    const orderId = req.params.id;
    const actor = req.user;
    const { action, note = "" } = req.body || {};

    if (!action || !["resolve", "reject"].includes(action)) {
      return res.status(400).json({ status: false, message: "Hành động không hợp lệ" });
    }

    if (actor.userType !== "Vendor" && actor.userType !== "Admin") {
      return res.status(403).json({ status: false, message: "Chỉ shop/Admin mới xử lý khiếu nại" });
    }

    try {
      const order = await Order.findById(orderId).populate({ path: "storeId", select: "owner title" }).populate({ path: "userId", select: "fcm username" });
      if (!order) {
        return res.status(404).json({ status: false, message: "Không tìm thấy đơn hàng" });
      }
      if (actor.userType === "Vendor" && !canVendorManageOrder(order, actor)) {
        return res.status(403).json({ status: false, message: "Đơn không thuộc cửa hàng của bạn" });
      }
      if (order.customerDisputeStatus !== "Pending") {
        return res.status(400).json({ status: false, message: "Đơn không có khiếu nại đang chờ" });
      }

      const resolutionNote = note || (action === "resolve" ? "Shop đã xử lý khiếu nại" : "Shop từ chối khiếu nại");
      order.customerDisputeResolvedAt = new Date();
      order.customerDisputeResolution = resolutionNote;
      order.deliveryIssueNote = resolutionNote;
      if (action === "resolve") {
        order.customerDisputeStatus = "Resolved";
        order.deliveryIssueStatus = "Resolved";
      } else {
        order.customerDisputeStatus = "Rejected";
        order.deliveryIssueStatus = "Escalated";
      }
      await order.save();

      try {
        if (order.userId && order.userId.fcm && order.userId.fcm !== "none") {
          await sendPushNotification(
            order.userId.fcm,
            "Kết quả xử lý khiếu nại",
            resolutionNote,
            { type: "delivery_dispute_update", orderId: String(order._id) }
          );
        }
      } catch (_) { }

      try {
        if (order.driverId) {
          const driverUser = await findDriverUser(order.driverId);
          if (driverUser && driverUser.fcm && driverUser.fcm !== "none") {
            await sendDriverDisputeResolutionNotification(
              driverUser.fcm,
              orderId,
              resolutionNote
            );
          }
        }
      } catch (_) { }

      return res.status(200).json({ status: true, message: "Đã cập nhật khiếu nại" });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },

  escalateDeliveryIssue: async (req, res) => {
    const orderId = req.params.id;
    const actor = req.user;
    const { note = "" } = req.body || {};

    if (actor.userType !== "Vendor" && actor.userType !== "Admin") {
      return res.status(403).json({ status: false, message: "Chỉ shop/Admin mới có quyền" });
    }

    try {
      const order = await Order.findById(orderId)
        .populate({ path: "storeId", select: "owner title" })
        .populate({ path: "userId", select: "fcm username" });
      if (!order) {
        return res.status(404).json({ status: false, message: "Không tìm thấy đơn hàng" });
      }
      if (actor.userType === "Vendor" && !canVendorManageOrder(order, actor)) {
        return res.status(403).json({ status: false, message: "Đơn không thuộc cửa hàng của bạn" });
      }

      order.deliveryIssueStatus = "Escalated";
      order.deliveryIssueNote = note || "Shop yêu cầu xác minh lại giao hàng";
      order.deliveryProofEscalatedAt = new Date();
      await order.save();

      try {
        if (order.driverId) {
          const driver = await User.findById(order.driverId).select("fcm username");
          if (driver && driver.fcm && driver.fcm !== "none") {
            await sendPushNotification(
              driver.fcm,
              "Shop yêu cầu cập nhật",
              `Vui lòng liên hệ shop & cung cấp lại bằng chứng cho đơn ${String(order._id).slice(-6)}`,
              { type: "delivery_escalated", orderId: String(order._id) }
            );
          }
        }
      } catch (_) { }

      try {
        if (order.userId && order.userId.fcm && order.userId.fcm !== "none") {
          await sendPushNotification(
            order.userId.fcm,
            "Đơn đang được xác minh",
            "Shop đang phối hợp với shipper để hoàn tất giao hàng",
            { type: "delivery_escalated", orderId: String(order._id) }
          );
        }
      } catch (_) { }

      return res.status(200).json({ status: true, message: "Đã escalated đơn hàng" });
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

      // Khi huỷ phải hoàn kho, hoàn voucher, giải phóng shipper và hoàn tiền nếu đã thanh toán
      const order = await Order.findById(orderId)
        .populate({ path: "userId", select: "fcm" })
        .session(session);

      if (!order) {
        await session.abortTransaction();
        return res.status(404).json({ status: false, message: "Không tìm thấy đơn hàng" });
      }

      const previousDriverId = order.driverId ? String(order.driverId) : "";

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
        if (previousDriverId) {
          const driverUser = await findDriverUser(previousDriverId);
          if (driverUser && driverUser.fcm && driverUser.fcm !== "none") {
            await sendDriverOrderCancelledNotification(
              driverUser.fcm,
              orderId,
              cancelReason
            );
          }
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
    if (orderStatus === "Delivered" && userType === "Driver") {
      return module.exports.submitDeliveryProof(req, res);
    }

    try {
      const existingOrder = await Order.findById(orderId);

      if (!existingOrder) {
        return res
          .status(404)
          .json({ status: false, message: "Không tìm thấy đơn hàng" });
      }

      if (
        orderStatus === "Delivered" &&
        (userType === "Vendor" || userType === "Admin") &&
        existingOrder.shopDeliveryConfirmStatus === "Pending"
      ) {
        req.body.action = req.body.action || "confirm";
        return module.exports.shopConfirmDelivery(req, res);
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

        if (orderStatus === "Cancelled" && updatedOrder.driverId) {
          try {
            const driverUser = await findDriverUser(updatedOrder.driverId);
            if (driverUser && driverUser.fcm && driverUser.fcm !== "none") {
              await sendDriverOrderCancelledNotification(
                driverUser.fcm,
                orderId,
                cancellationReason
              );
            }
          } catch (_) { }
        }

        // Free driver when delivered
        if (
          orderStatus === "Delivered" &&
          updatedOrder.driverId &&
          updatedOrder.shopDeliveryConfirmStatus === "Confirmed"
        ) {
          try {
            const drv = await Driver.findOne({ user: updatedOrder.driverId });
            if (drv && drv.status !== "available") {
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

  getLogisticsTimeline: async (req, res) => {
    const orderId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ status: false, message: "orderId không hợp lệ" });
    }

    try {
      const order = await Order.findById(orderId)
        .populate({ path: "storeId", select: "title logoUrl imageUrl coords owner time" })
        .populate({ path: "originHub", select: "name code type address latitude longitude" })
        .populate({ path: "localHub", select: "name code type address latitude longitude" })
        .populate({ path: "deliveryAddress", select: "addressLine1 addressLine displayName deliveryInstructions latitude longitude" });

      if (!order) {
        return res.status(404).json({ status: false, message: "Không tìm thấy đơn hàng" });
      }

      const actor = req.user;
      if (actor.userType === "Client" && String(order.userId) !== String(actor.id)) {
        return res.status(403).json({ status: false, message: "Bạn không có quyền xem đơn hàng này" });
      }
      if (actor.userType === "Vendor" && !canVendorManageOrder(order, actor)) {
        return res.status(403).json({ status: false, message: "Đơn không thuộc cửa hàng của bạn" });
      }
      if (actor.userType === "Driver" && order.driverId && String(order.driverId) !== String(actor.id)) {
        return res.status(403).json({ status: false, message: "Bạn không phải shipper của đơn này" });
      }

      const shipmentDoc = await Shipment.findOne({ orders: order._id })
        .sort({ createdAt: -1 })
        .populate({ path: "originHub", select: "name code type address latitude longitude" })
        .populate({ path: "localHub", select: "name code type address latitude longitude" })
        .lean();

      const orderPayload = order.toObject({ virtuals: false, getters: false });
      // Chuẩn hoá dữ liệu trả về cho mobile/web theo cùng cấu trúc timeline
      const timeline = buildLogisticsTimeline(orderPayload, shipmentDoc);
      const progressStages = timeline.filter((stage) => stage.key !== "Cancelled");
      const doneStages = progressStages.filter((stage) => stage.state === "done").length;
      const progressPercent = progressStages.length
        ? Math.min(100, Math.round((doneStages / progressStages.length) * 100))
        : 0;
      const nextStage = timeline.find((stage) => stage.state === "active")
        || timeline.find((stage) => stage.state === "pending")
        || null;

      let driverProfile = null;
      if (orderPayload.driverId) {
        try {
          const [driverUser, driverRecord] = await Promise.all([
            User.findById(orderPayload.driverId).select("username phone profile"),
            Driver.findOne({ user: orderPayload.driverId }).select("vehicleType vehiclePlate status"),
          ]);
          driverProfile = {
            id: String(orderPayload.driverId),
            name: driverUser?.username || "",
            phone: driverUser?.phone || "",
            avatar: driverUser?.profile || "",
            status: driverRecord?.status || "offline",
            vehicleType: driverRecord?.vehicleType || "",
            vehiclePlate: driverRecord?.vehiclePlate || "",
            lastKnownLocation: orderPayload.driverLocation || null,
            lastUpdate: orderPayload.driverLocation?.updatedAt || null,
          };
        } catch (driverErr) {
          console.warn("[getLogisticsTimeline] driver lookup failed", driverErr?.message || driverErr);
        }
      }

      const payload = {
        orderId: String(order._id),
        orderCode: String(order._id).slice(-6),
        orderStatus: orderPayload.orderStatus,
        logisticStatus: orderPayload.logisticStatus,
        deliveryIssueStatus: orderPayload.deliveryIssueStatus,
        shopDeliveryConfirmStatus: orderPayload.shopDeliveryConfirmStatus,
        customerDisputeStatus: orderPayload.customerDisputeStatus,
        timeline,
        progressPercent,
        nextStage,
        hubs: {
          origin: formatHubInfo(orderPayload.originHub || shipmentDoc?.originHub),
          local: formatHubInfo(orderPayload.localHub || shipmentDoc?.localHub),
        },
        shipment: shipmentDoc
          ? {
            id: String(shipmentDoc._id),
            code: shipmentDoc.code,
            status: shipmentDoc.status,
            timeline: shipmentDoc.timeline,
          }
          : null,
        store: formatStoreInfo(orderPayload.storeId),
        deliveryAddress: formatDeliveryAddress(orderPayload.deliveryAddress),
        driver: driverProfile,
        driverLocation: orderPayload.driverLocation || null,
        deliveryProof: {
          photo: orderPayload.deliveryProofPhoto || "",
          note: orderPayload.deliveryProofNote || "",
          recipient: orderPayload.deliveryProofRecipient || "",
          deliveredAt: orderPayload.deliveryProofAt || null,
          location: orderPayload.deliveryProofLocation || null,
        },
        shopConfirmation: {
          status: orderPayload.shopDeliveryConfirmStatus || "None",
          confirmedAt: orderPayload.shopDeliveryConfirmedAt || null,
          confirmedBy: orderPayload.shopDeliveryConfirmedBy || "",
          note: orderPayload.shopDeliveryConfirmNote || "",
          rejectReason: orderPayload.shopDeliveryRejectReason || "",
          rejectedAt: orderPayload.shopDeliveryRejectedAt || null,
        },
        dispute: {
          status: orderPayload.customerDisputeStatus || "None",
          note: orderPayload.customerDisputeNote || "",
          submittedAt: orderPayload.customerDisputeAt || null,
          resolvedAt: orderPayload.customerDisputeResolvedAt || null,
          resolution: orderPayload.customerDisputeResolution || "",
          evidence: orderPayload.customerDisputeEvidence || [],
        },
        socketEvent: "order:logistics",
        updatedAt: orderPayload.updatedAt,
        createdAt: orderPayload.createdAt,
      };

      return res.status(200).json({ status: true, data: payload });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
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
      const order = await Order.findById(orderId)
        .populate({ path: "storeId", select: "owner title" })
        .populate({ path: "userId", select: "fcm username" });

      if (!order) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy đơn hàng",
        });
      }

      // Kiểm tra quyền sở hữu đơn hàng
      const orderOwnerId = order.userId?._id || order.userId;
      if (String(orderOwnerId) !== String(userId)) {
        return res.status(403).json({
          status: false,
          message: "Bạn không có quyền xác nhận đơn hàng này",
        });
      }

      const allowedStatuses = ["Delivering", "Delivered"];
      if (!allowedStatuses.includes(order.orderStatus)) {
        return res.status(400).json({
          status: false,
          message: "Đơn hàng chưa sẵn sàng để xác nhận",
        });
      }

      if (!order.deliveryProofPhoto) {
        return res.status(400).json({
          status: false,
          message: "Shipper chưa đính kèm bằng chứng giao hàng",
        });
      }

      const alreadyConfirmed = order.shopDeliveryConfirmStatus === "Confirmed";
      const now = new Date();

      const normalizedPayment = (order.paymentStatus || "").toLowerCase();
      const paymentComplete = ["completed", "paid", "settled"].includes(normalizedPayment);
      if (!paymentComplete) {
        if (order.paymentMethod === "COD") {
          return res.status(400).json({
            status: false,
            message: "Shipper chưa cập nhật biên nhận COD",
          });
        }
        return res.status(400).json({
          status: false,
          message: "Trạng thái thanh toán không hợp lệ",
        });
      }

      if (!alreadyConfirmed) {
        order.shopDeliveryConfirmStatus = "Confirmed";
        order.shopDeliveryConfirmedAt = now;
        order.shopDeliveryConfirmedBy = userId;
        order.shopDeliveryConfirmNote = "Khách xác nhận đã nhận hàng";
        order.shopDeliveryRejectReason = "";
        order.shopDeliveryRejectedAt = null;
        order.orderStatus = "Delivered";
        order.logisticStatus = "Delivered";
        order.deliveryIssueStatus = "Resolved";
        order.deliveryIssueNote = "";
        if (order.customerDisputeStatus === "Pending") {
          order.customerDisputeStatus = "Resolved";
          order.customerDisputeResolvedAt = now;
          order.customerDisputeResolution = "Khách xác nhận đã nhận hàng";
        }
      }

      await order.save();

      if (!alreadyConfirmed) {
        emitOrderLogistics(req, orderId, order.logisticStatus, {
          stage: "Delivered",
          shopDeliveryConfirmStatus: order.shopDeliveryConfirmStatus,
        });

        if (order.driverId) {
          try {
            const driver = await Driver.findOne({ user: order.driverId });
            if (driver && driver.status !== "available") {
              driver.status = "available";
              await driver.save();
            }
          } catch (driverErr) {
            console.warn("[confirmReceived] update driver status fail", driverErr?.message || driverErr);
          }
          try {
            await settleDriverDeliveryPayout(order);
          } catch (payoutErr) {
            console.warn("[confirmReceived] payout fail", payoutErr?.message || payoutErr);
          }
        }

        try {
          const driverUser = await User.findById(order.driverId).select("fcm username");
          if (driverUser && driverUser.fcm && driverUser.fcm !== "none") {
            await sendPushNotification(
              driverUser.fcm,
              "Khách đã xác nhận giao hàng",
              `Đơn ${String(order._id).slice(-6)} đã được khách xác nhận hoàn tất`,
              { type: "delivery_confirmed", orderId: String(order._id) }
            );
          }
        } catch (_) { }

        try {
          const ownerId = order.storeId?.owner || order.storeId?.owner?._id;
          if (ownerId) {
            const vendorUser = await User.findById(ownerId).select("fcm username");
            if (vendorUser && vendorUser.fcm && vendorUser.fcm !== "none") {
              await sendPushNotification(
                vendorUser.fcm,
                "Khách đã xác nhận",
                `Đơn ${String(order._id).slice(-6)} đã được khách xác nhận thành công`,
                { type: "delivery_confirmed", orderId: String(order._id) }
              );
            }
          }
        } catch (_) { }

        try {
          const io = req.app.get("io");
          if (io) {
            io.emit("order:delivery_confirm", {
              orderId: String(order._id),
              shopDeliveryConfirmStatus: order.shopDeliveryConfirmStatus,
            });
          }
        } catch (_) { }
      }

      try {
        if (order.userId && order.userId.fcm && order.userId.fcm !== "none") {
          await sendOrderStatusNotification(order.userId.fcm, "Delivered", orderId);
        }
      } catch (_) { }

      return res.status(200).json({
        status: true,
        message: "Xác nhận đã nhận hàng thành công",
      });
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
      if (targetStatus === "Delivered") {
        order.orderStatus = "Delivered";
        order.shopDeliveryConfirmStatus = "Confirmed";
        order.shopDeliveryConfirmedAt = new Date();
        order.shopDeliveryConfirmedBy = req.user.id;
      }
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
