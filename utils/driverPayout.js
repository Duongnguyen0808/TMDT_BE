const { creditWallet } = require("./driverWallet");

const DRIVER_PAYOUT_MULTIPLIER = Number(process.env.DRIVER_PAYOUT_MULTIPLIER || 1);

async function settleDriverDeliveryPayout(order) {
    if (!order) return { settled: false, reason: "NO_ORDER" };
    if (!order.driverId) return { settled: false, reason: "NO_DRIVER" };
    if (order.paymentMethod !== "VNPay") return { settled: false, reason: "NOT_VNPAY" };
    if (order.paymentStatus !== "Completed") return { settled: false, reason: "PAYMENT_INCOMPLETE" };
    if (order.driverPayoutAt) return { settled: false, reason: "ALREADY_PAID" };

    const rawFee = Number(order.deliveryFee || 0);
    if (!rawFee || rawFee <= 0) return { settled: false, reason: "NO_FEE" };

    const payoutAmount = Math.max(0, Math.round(rawFee * DRIVER_PAYOUT_MULTIPLIER));
    if (!payoutAmount) return { settled: false, reason: "NO_AMOUNT" };

    const wallet = await creditWallet(order.driverId, payoutAmount, {
        description: `Thanh toán đơn VNPay #${order._id}`,
        reference: order.paymentGatewayTxnId || "vnpay-settlement",
        metadata: {
            orderId: String(order._id),
            paymentMethod: order.paymentMethod,
        },
    });

    order.driverPayoutAmount = payoutAmount;
    order.driverPayoutAt = new Date();
    order.driverPayoutMethod = order.paymentMethod;
    order.driverPayoutReference = order.paymentGatewayTxnId || "";
    await order.save();

    return {
        settled: true,
        amount: payoutAmount,
        balance: wallet.balance,
    };
}

module.exports = {
    settleDriverDeliveryPayout,
};
