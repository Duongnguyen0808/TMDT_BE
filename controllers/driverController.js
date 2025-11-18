const CryptoJS = require("crypto-js");
const User = require("../models/User");
const Driver = require("../models/Driver");
const Order = require("../models/Order");
const Store = require("../models/Store");

module.exports = {
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

            // mark driver busy
            if (driver.status !== "busy") {
                driver.status = "busy";
                await driver.save();
            }

            // emit socket events
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
                .select("userId deliveryAddress orderItems deliveryFee orderTotal grandTotal orderStatus storeId storeCoords recipientCoords createdAt updatedAt")
                .populate({ path: "userId", select: "phone profile" })
                .populate({ path: "storeId", select: "title coords logoUrl imageUrl" })
                .populate({ path: "orderItems.appliancesId", select: "title imageUrl price" })
                .populate({ path: "deliveryAddress", select: "addressLine1" });
            return res.status(200).json({ status: true, data: orders });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    // Driver: cập nhật trạng thái đơn hàng (chỉ các bước giao)
    driverUpdateOrderStatus: async (req, res) => {
        try {
            const driverUserId = req.user.id;
            const { id } = req.params; // order id
            const { status } = req.body; // Delivering | Delivered
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

            order.orderStatus = status;
            await order.save();

            // if completed delivery, free the driver
            if (status === "Delivered" && order.driverId) {
                const drv = await Driver.findOne({ user: order.driverId });
                if (drv && drv.status !== "available") {
                    drv.status = "available";
                    await drv.save();
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

            // emit socket events
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
