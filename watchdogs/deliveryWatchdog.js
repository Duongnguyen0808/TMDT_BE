const Order = require("../models/Order");
const User = require("../models/User");
const { sendPushNotification } = require("../utils/notification_service");

const asListCondition = (field) => ({
    $or: [
        { [field]: { $exists: false } },
        { [field]: null },
    ],
});

module.exports = function startDeliveryWatchdog(io) {
    const intervalMs = Number(process.env.DELIVERY_WATCHDOG_INTERVAL_MS || 120000);
    const warnMinutes = Number(process.env.DELIVERY_PROOF_WARN_MINUTES || 15);
    const escalateMinutes = Number(process.env.DELIVERY_PROOF_ESC_MINUTES || 30);

    if (intervalMs <= 0) {
        console.warn("[deliveryWatchdog] disabled via interval <= 0");
        return;
    }

    const emit = (event, payload) => {
        try {
            if (io) io.emit(event, payload);
        } catch (err) {
            console.warn("[deliveryWatchdog] emit failed", err?.message || err);
        }
    };

    const sendDriverReminder = async (order) => {
        try {
            const driverUser = await User.findById(order.driverId).select("fcm username");
            if (driverUser && driverUser.fcm && driverUser.fcm !== "none") {
                await sendPushNotification(
                    driverUser.fcm,
                    "Nhắc gửi bằng chứng giao hàng",
                    `Đơn ${String(order._id).slice(-6)} cần bạn hoàn tất bằng chứng giao hàng`,
                    { type: "delivery_proof_reminder", orderId: String(order._id) }
                );
            }
        } catch (err) {
            console.warn("[deliveryWatchdog] sendDriverReminder", err?.message || err);
        }
    };

    const sendEscalationAlerts = async (order) => {
        const orderId = String(order._id);
        try {
            const driverUser = order.driverId
                ? await User.findById(order.driverId).select("fcm username")
                : null;
            if (driverUser && driverUser.fcm && driverUser.fcm !== "none") {
                await sendPushNotification(
                    driverUser.fcm,
                    "Đơn đang bị khiếu nại",
                    `Shop đang yêu cầu cập nhật lại bằng chứng cho đơn ${orderId.slice(-6)}`,
                    { type: "delivery_escalated", orderId }
                );
            }
        } catch (err) {
            console.warn("[deliveryWatchdog] notify driver escalation", err?.message || err);
        }

        try {
            const storeOwnerId = order.storeId?.owner;
            if (storeOwnerId) {
                const vendorUser = await User.findById(storeOwnerId).select("fcm username");
                if (vendorUser && vendorUser.fcm && vendorUser.fcm !== "none") {
                    await sendPushNotification(
                        vendorUser.fcm,
                        "Đơn cần xác nhận giao hàng",
                        `Đơn ${orderId.slice(-6)} chưa có bằng chứng, vui lòng xử lý`,
                        { type: "delivery_escalated", orderId }
                    );
                }
            }
        } catch (err) {
            console.warn("[deliveryWatchdog] notify vendor escalation", err?.message || err);
        }

        try {
            const customer = order.userId;
            if (customer && customer.fcm && customer.fcm !== "none") {
                await sendPushNotification(
                    customer.fcm,
                    "Đơn hàng đang được xác minh",
                    "Chúng tôi đang kiểm tra lại quá trình giao hàng, vui lòng chờ.",
                    { type: "delivery_escalated", orderId }
                );
            }
        } catch (err) {
            console.warn("[deliveryWatchdog] notify customer escalation", err?.message || err);
        }
    };

    const run = async () => {
        const now = Date.now();
        const warnCutoff = new Date(now - warnMinutes * 60000);
        const escalateCutoff = new Date(now - escalateMinutes * 60000);

        try {
            const warnOrders = await Order.find({
                orderStatus: { $in: ["PickedUp", "Delivering"] },
                driverId: { $ne: "" },
                deliveryProofPhoto: { $in: [null, ""] },
                pickupConfirmedAt: { $lte: warnCutoff },
                ...asListCondition("deliveryProofReminderSentAt"),
            })
                .select("_id driverId deliveryIssueStatus pickupConfirmedAt")
                .limit(20);

            for (const order of warnOrders) {
                order.deliveryProofReminderSentAt = new Date();
                order.deliveryIssueStatus = order.deliveryIssueStatus === "Escalated" ? "Escalated" : "Warned";
                await order.save();
                emit("order:delivery_warning", {
                    orderId: String(order._id),
                    level: "reminder",
                });
                await sendDriverReminder(order);
            }
        } catch (err) {
            console.warn("[deliveryWatchdog] warn stage", err?.message || err);
        }

        try {
            const escalateOrders = await Order.find({
                orderStatus: { $in: ["PickedUp", "Delivering"] },
                driverId: { $ne: "" },
                deliveryProofPhoto: { $in: [null, ""] },
                pickupConfirmedAt: { $lte: escalateCutoff },
                ...asListCondition("deliveryProofEscalatedAt"),
            })
                .populate({ path: "storeId", select: "owner title" })
                .populate({ path: "userId", select: "fcm username" })
                .select("_id driverId deliveryIssueStatus userId storeId");

            for (const order of escalateOrders) {
                order.deliveryProofEscalatedAt = new Date();
                order.deliveryIssueStatus = order.customerDisputeStatus === "Pending" ? "Disputed" : "Escalated";
                await order.save();
                emit("order:delivery_warning", {
                    orderId: String(order._id),
                    level: "escalated",
                });
                await sendEscalationAlerts(order);
            }
        } catch (err) {
            console.warn("[deliveryWatchdog] escalate stage", err?.message || err);
        }
    };

    setInterval(run, intervalMs);
    run().catch((err) => console.warn("[deliveryWatchdog] initial run", err?.message || err));
};
