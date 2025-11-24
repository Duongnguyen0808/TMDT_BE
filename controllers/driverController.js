const CryptoJS = require("crypto-js");
const User = require("../models/User");
const Driver = require("../models/Driver");
const Order = require("../models/Order");
const Store = require("../models/Store");
const Hub = require("../models/Hub");
const mongoose = require("mongoose");
const { settleDriverDeliveryPayout } = require("../utils/driverPayout");

module.exports = {
    myProfile: async (req, res) => {
        try {
            if (!req.user || req.user.userType !== "Driver") {
                return res.status(403).json({ status: false, message: "Chỉ tài xế mới xem hồ sơ này" });
            }

            const userId = req.user.id;
            const [user, driver] = await Promise.all([
                User.findById(userId).select("username email phone userType profile verification phoneVerification"),
                Driver.findOne({ user: userId }).select("vehicleType vehiclePlate status note vendor hub"),
            ]);

            let storeInfo = null;
            if (driver && driver.vendor) {
                const store = await Store.findById(driver.vendor).select("title");
                if (store) {
                    storeInfo = { id: store._id, title: store.title };
                }
            }

            const safeUser = user
                ? {
                    id: user._id,
                    _id: user._id,
                    username: user.username,
                    email: user.email,
                    phone: user.phone,
                    userType: user.userType,
                    profile: user.profile,
                    verification: user.verification,
                    phoneVerification: user.phoneVerification,
                }
                : {
                    id: userId,
                    _id: userId,
                    username: req.user.email?.split("@")[0] || "Tài xế",
                    email: req.user.email || "",
                    phone: null,
                    userType: req.user.userType || "Driver",
                    profile: "",
                    verification: false,
                    phoneVerification: false,
                };

            const safeDriver = driver
                ? {
                    id: driver._id,
                    vehicleType: driver.vehicleType,
                    vehiclePlate: driver.vehiclePlate,
                    status: driver.status,
                    note: driver.note,
                    vendor: driver.vendor,
                    hub: driver.hub,
                    store: storeInfo,
                }
                : null;

            return res.status(200).json({
                status: true,
                data: {
                    user: safeUser,
                    driver: safeDriver,
                },
            });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    // Vendor tạo tài xế mới (tạo User + Driver)
    createDriver: async (req, res) => {
        try {
            const vendorId = req.user.id;
            const { username, email, phone, password, vehicleType, vehiclePlate, note } = req.body;
            if (!username || !email || !password) {
                return res.status(400).json({ status: false, message: "Thiếu thông tin tài xế (username, email, password)" });
            }

            const exist = await User.findOne({ email });
            if (exist) return res.status(400).json({ status: false, message: "Email đã tồn tại" });

            const newUser = new User({
                username,
                email,
                phone: phone || "",
                password: CryptoJS.AES.encrypt(password, process.env.SECRET).toString(),
                userType: "Driver",
                verification: true,
                phoneVerification: !!phone,
            });
            await newUser.save();

            const d = new Driver({
                user: newUser._id,
                vendor: vendorId,
                vehicleType: vehicleType || "motorbike",
                vehiclePlate: vehiclePlate || "",
                note: note || "",
                status: "offline",
            });
            await d.save();

            return res.status(201).json({ status: true, data: { id: d._id, userId: newUser._id } });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    // Danh sách tài xế thuộc vendor
    listDrivers: async (req, res) => {
        try {
            const vendorId = req.user.id;
            const drivers = await Driver.find({ vendor: vendorId })
                .populate({ path: "user", select: "username email phone profile" })
                .lean();
            return res.status(200).json({ status: true, data: drivers });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    // Cập nhật thông tin/ trạng thái tài xế
    updateDriver: async (req, res) => {
        try {
            const vendorId = req.user.id;
            const { id } = req.params;
            const payload = {};
            const allow = ["vehicleType", "vehiclePlate", "status", "note"];
            for (const k of allow) if (k in req.body) payload[k] = req.body[k];

            const driver = await Driver.findOneAndUpdate({ _id: id, vendor: vendorId }, payload, { new: true });
            if (!driver) return res.status(404).json({ status: false, message: "Không tìm thấy tài xế" });
            return res.status(200).json({ status: true, data: driver });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    // Gán tài xế cho đơn hàng
    assignDriver: async (req, res) => {
        try {
            const vendorId = req.user.id;
            const { orderId, driverId } = req.body;
            if (!orderId || !driverId) return res.status(400).json({ status: false, message: "Thiếu orderId hoặc driverId" });

            const driver = await Driver.findOne({ _id: driverId, vendor: vendorId }).populate("user");
            if (!driver) return res.status(404).json({ status: false, message: "Tài xế không thuộc quyền quản lý" });

            const order = await Order.findById(orderId).populate("storeId");
            if (!order) return res.status(404).json({ status: false, message: "Không tìm thấy đơn hàng" });

            const store = order.storeId;
            if (!store || String(store.owner) !== String(vendorId)) {
                return res.status(403).json({ status: false, message: "Đơn hàng không thuộc cửa hàng của bạn" });
            }

            order.driverId = String(driver.user._id);
            await order.save();

            if (driver.status !== "busy") {
                driver.status = "busy";
                await driver.save();
            }

            try {
                const io = req.app.get("io");
                if (io) {
                    io.emit("order:assigned", { orderId: String(order._id), driverId: String(driver.user._id) });
                    io.emit("driver:status", { driverId: String(driver.user._id), status: driver.status });
                }
            } catch (_) { }

            return res.status(200).json({ status: true, message: "Đã gán tài xế cho đơn hàng" });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    // Driver: danh sách đơn được gán cho tôi
    myOrders: async (req, res) => {
        try {
            const driverUserId = req.user.id;
            const orders = await Order.find({ driverId: String(driverUserId) })
                .select("userId deliveryAddress orderItems deliveryFee orderTotal grandTotal orderStatus storeId storeCoords recipientCoords createdAt updatedAt logisticStatus pickupCode pickupCodeExpiresAt pickupReadyAt pickupAssignedAt pickupCheckinAt pickupCheckinLocation pickupConfirmedAt pickupNotes handoverPhoto shopReadyBy shipperPickupBy")
                .populate({ path: "userId", select: "phone profile" })
                .populate({ path: "storeId", select: "title coords logoUrl imageUrl" })
                .populate({ path: "orderItems.appliancesId", select: "title imageUrl price" })
                .populate({ path: "deliveryAddress", select: "addressLine1" });
            return res.status(200).json({ status: true, data: orders });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    // Driver: danh sách đơn còn trống để nhận (mở cho tất cả shipper)
    availableOrders: async (req, res) => {
        try {
            const orders = await Order.find({
                driverId: "",
                paymentStatus: { $in: ["Completed", "Pending"] },
                orderStatus: { $in: ["ReadyForPickup", "WaitingShipper"] }
            })
                .select("storeId orderStatus deliveryAddress orderItems deliveryFee grandTotal orderTotal createdAt pickupReadyAt pickupCode pickupCodeExpiresAt logisticStatus")
                .populate({ path: "storeId", select: "title coords logoUrl imageUrl" })
                .populate({ path: "orderItems.appliancesId", select: "title imageUrl price" })
                .populate({ path: "deliveryAddress", select: "addressLine1" });
            return res.status(200).json({ status: true, data: orders });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    // Driver: nhận đơn (claim) – atomic qua điều kiện driverId rỗng + trạng thái phù hợp
    claimOrder: async (req, res) => {
        try {
            const driverUserId = req.user.id;
            const { id } = req.params;

            try {
                const u = await User.findById(driverUserId).select("userType");
                if (!u || u.userType !== "Driver") {
                    return res.status(403).json({ status: false, message: "Tài khoản không phải tài xế" });
                }
            } catch (_) { }

            const activeCount = await Order.countDocuments({ driverId: String(driverUserId), orderStatus: { $in: ["PickedUp", "Delivering"] } });
            if (activeCount >= 5) {
                return res.status(400).json({ status: false, message: "Bạn đã đạt giới hạn 5 đơn đang giao" });
            }

            let driver = await Driver.findOne({ user: driverUserId });
            if (!driver) {
                driver = new Driver({
                    user: driverUserId,
                    vendor: null,
                    vehicleType: "motorbike",
                    vehiclePlate: "",
                    note: "",
                    status: "available",
                });
                await driver.save();
                console.log(`[claimOrder] Auto-created driver profile user=${driverUserId}`);
            }

            console.log(`[claimOrder] driver=${driverUserId} order=${id} activeDelivering=${activeCount}`);
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                const order = await Order.findOne({
                    _id: id,
                    driverId: "",
                    orderStatus: { $in: ["ReadyForPickup", "WaitingShipper"] },
                }).session(session);

                if (!order) {
                    await session.abortTransaction();
                    session.endSession();
                    console.warn(`[claimOrder][FAILED] order=${id} not available / race condition`);
                    return res.status(409).json({ status: false, message: "Đơn không còn sẵn sàng hoặc đã được nhận" });
                }

                order.driverId = String(driverUserId);
                order.driverAssignedAt = new Date();
                order.orderStatus = "WaitingShipper";
                order.pickupAssignedAt = new Date();
                await order.save({ session });

                const driverDoc = await Driver.findOne({ user: driverUserId }).session(session);
                if (driverDoc && driverDoc.status !== "busy") {
                    driverDoc.status = "busy";
                    await driverDoc.save({ session });
                }

                await session.commitTransaction();
                session.endSession();

                try {
                    const io = req.app.get("io");
                    if (io) {
                        io.emit("order:assigned", { orderId: String(order._id), driverId: String(driverUserId) });
                        io.emit("driver:status", { driverId: String(driverUserId), status: "busy" });
                    }
                } catch (_) { }

                console.log(`[claimOrder][SUCCESS] order=${order._id} driver=${driverUserId}`);
                return res.status(200).json({
                    status: true,
                    message: "Nhận đơn thành công",
                    orderId: String(order._id),
                    commissionCharged: 0,
                });
            } catch (error) {
                await session.abortTransaction();
                session.endSession();
                throw error;
            }
        } catch (error) {
            console.error("[claimOrder][ERROR]", error);
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    // Driver: cập nhật vị trí hiện tại cho đơn – cho phép client gửi theo chu kỳ
    updateLocation: async (req, res) => {
        try {
            const driverUserId = req.user.id;
            const { id } = req.params;
            const { latitude, longitude } = req.body;
            if (typeof latitude !== "number" || typeof longitude !== "number") {
                return res.status(400).json({ status: false, message: "Thiếu toạ độ hợp lệ" });
            }

            const order = await Order.findById(id);
            if (!order) return res.status(404).json({ status: false, message: "Không tìm thấy đơn hàng" });
            if (String(order.driverId) !== String(driverUserId)) {
                return res.status(403).json({ status: false, message: "Bạn không phải tài xế của đơn này" });
            }

            order.driverLocation = { latitude, longitude, updatedAt: new Date() };
            await order.save();

            try {
                const io = req.app.get("io");
                if (io) io.emit("driver:location", { orderId: String(order._id), driverId: String(driverUserId), latitude, longitude });
            } catch (_) { }

            return res.status(200).json({ status: true, message: "Đã cập nhật vị trí" });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    // Driver: cập nhật trạng thái đơn hàng (chỉ các bước giao)
    driverUpdateOrderStatus: async (req, res) => {
        try {
            const driverUserId = req.user.id;
            const { id } = req.params;
            const { status } = req.body;
            if (!status) return res.status(400).json({ status: false, message: "Thiếu trạng thái" });

            const order = await Order.findById(id);
            if (!order) return res.status(404).json({ status: false, message: "Không tìm thấy đơn hàng" });
            if (String(order.driverId) !== String(driverUserId)) {
                return res.status(403).json({ status: false, message: "Bạn không phải tài xế của đơn này" });
            }

            const allowed = ["Delivering", "Delivered"];
            if (!allowed.includes(status)) {
                return res.status(400).json({ status: false, message: "Trạng thái không hợp lệ" });
            }

            if (status === "Delivering" && !["PickedUp", "Delivering"].includes(order.orderStatus)) {
                return res.status(400).json({ status: false, message: "Bạn cần xác nhận lấy hàng trước" });
            }
            if (status === "Delivered" && !["Delivering", "PickedUp"].includes(order.orderStatus)) {
                return res.status(400).json({ status: false, message: "Đơn chưa sẵn sàng để hoàn tất" });
            }

            order.orderStatus = status;
            if (status === "Delivering") order.logisticStatus = "Delivering";
            if (status === "Delivered") order.logisticStatus = "Delivered";
            await order.save();

            if (status === "Delivered") {
                try {
                    await settleDriverDeliveryPayout(order);
                } catch (payoutError) {
                    console.warn("[driverUpdateOrderStatus] payout failed", payoutError?.message || payoutError);
                }
            }

            if (status === "Delivered" && order.driverId) {
                const drv = await Driver.findOne({ user: order.driverId });
                if (drv) {
                    const remaining = await Order.countDocuments({
                        driverId: String(order.driverId),
                        orderStatus: { $in: ["Delivering"] },
                        _id: { $ne: order._id },
                    });
                    if (remaining === 0) {
                        drv.status = "available";
                        await drv.save();
                    }
                }
            }

            return res.status(200).json({ status: true, message: "Cập nhật trạng thái thành công" });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    // Lấy tài xế theo userId trong phạm vi vendor
    getDriverByUser: async (req, res) => {
        try {
            const vendorId = req.user.id;
            const { userId } = req.params;
            const driver = await Driver.findOne({ vendor: vendorId, user: userId })
                .populate({ path: "user", select: "username email phone profile" })
                .lean();
            if (!driver) return res.status(404).json({ status: false, message: "Không tìm thấy tài xế" });
            return res.status(200).json({ status: true, data: driver });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    // Bỏ gán tài xế khỏi đơn
    unassignDriver: async (req, res) => {
        try {
            const vendorId = req.user.id;
            const { orderId } = req.body;
            if (!orderId) return res.status(400).json({ status: false, message: "Thiếu orderId" });

            const order = await Order.findById(orderId).populate("storeId");
            if (!order) return res.status(404).json({ status: false, message: "Không tìm thấy đơn hàng" });
            if (!order.driverId) return res.status(200).json({ status: true, message: "Đơn không có tài xế" });

            const store = order.storeId;
            if (!store || String(store.owner) !== String(vendorId)) {
                return res.status(403).json({ status: false, message: "Đơn hàng không thuộc cửa hàng của bạn" });
            }

            const drv = await Driver.findOne({ user: order.driverId, vendor: vendorId });
            if (drv) {
                drv.status = "available";
                await drv.save();
            }

            order.driverId = "";
            await order.save();

            try {
                const io = req.app.get("io");
                if (io) {
                    io.emit("order:unassigned", { orderId: String(order._id) });
                    if (drv) io.emit("driver:status", { driverId: String(drv.user), status: drv.status });
                }
            } catch (_) { }

            return res.status(200).json({ status: true, message: "Đã bỏ gán tài xế" });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },
};
