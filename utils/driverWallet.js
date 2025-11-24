const mongoose = require("mongoose");
const DriverWallet = require("../models/DriverWallet");

async function getOrCreateWallet(driverId, session) {
    if (!driverId) throw new Error("driverId is required");
    const query = DriverWallet.findOne({ driver: driverId });
    if (session) query.session(session);
    let wallet = await query.exec();
    if (!wallet) {
        wallet = new DriverWallet({ driver: driverId });
        await wallet.save({ session });
    }
    return wallet;
}

async function creditWallet(driverId, amount, { description = "Driver top-up", reference = "", metadata = {} } = {}, session) {
    if (amount <= 0) throw new Error("Amount must be greater than 0");
    const wallet = await getOrCreateWallet(driverId, session);
    wallet.balance += amount;
    wallet.lastTopupAt = new Date();
    wallet.appendTransaction({
        type: "topup",
        amount,
        balanceAfter: wallet.balance,
        description,
        reference,
        metadata,
        createdAt: new Date(),
    });
    await wallet.save({ session });
    return wallet;
}

async function debitWallet(driverId, amount, { description = "Commission charge", orderId = null, reference = "", metadata = {} } = {}, session) {
    if (amount <= 0) throw new Error("Amount must be greater than 0");
    const wallet = await getOrCreateWallet(driverId, session);
    if (wallet.balance < amount) {
        const err = new Error("INSUFFICIENT_DRIVER_WALLET_BALANCE");
        err.code = "INSUFFICIENT_DRIVER_WALLET_BALANCE";
        throw err;
    }
    wallet.balance -= amount;
    wallet.lastChargeAt = new Date();
    wallet.appendTransaction({
        type: "commission",
        amount: -amount,
        balanceAfter: wallet.balance,
        description,
        order: orderId ? new mongoose.Types.ObjectId(orderId) : undefined,
        reference,
        metadata,
        createdAt: new Date(),
    });
    await wallet.save({ session });
    return wallet;
}

module.exports = {
    getOrCreateWallet,
    creditWallet,
    debitWallet,
};
