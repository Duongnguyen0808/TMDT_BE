const VendorWallet = require("../models/VendorWallet");
const Store = require("../models/Store");

async function getOrCreateWallet(ownerId, session) {
    if (!ownerId) {
        const err = new Error("OWNER_REQUIRED");
        err.code = "OWNER_REQUIRED";
        throw err;
    }

    const store = await Store.findOne({ owner: ownerId }).select("_id title");
    if (!store) {
        const err = new Error("STORE_NOT_FOUND");
        err.code = "STORE_NOT_FOUND";
        throw err;
    }

    const query = VendorWallet.findOne({ store: store._id });
    if (session) query.session(session);

    let wallet = await query.exec();
    if (!wallet) {
        wallet = new VendorWallet({ owner: ownerId, store: store._id });
        await wallet.save({ session });
    }

    return { wallet, store };
}

async function creditVendorWallet(ownerId, amount, { description = "Vendor deposit", reference = "", metadata = {} } = {}, session) {
    if (!amount || amount <= 0) {
        const err = new Error("AMOUNT_INVALID");
        err.code = "AMOUNT_INVALID";
        throw err;
    }

    const ctx = await getOrCreateWallet(ownerId, session);
    ctx.wallet.balance += amount;
    ctx.wallet.lastDepositAt = new Date();
    ctx.wallet.appendTransaction({
        type: "deposit",
        amount,
        balanceAfter: ctx.wallet.balance,
        description,
        reference,
        metadata,
        createdAt: new Date(),
    });
    await ctx.wallet.save({ session });
    return ctx;
}

async function debitVendorWallet(ownerId, amount, { description = "Vendor withdraw", reference = "", metadata = {} } = {}, session) {
    if (!amount || amount <= 0) {
        const err = new Error("AMOUNT_INVALID");
        err.code = "AMOUNT_INVALID";
        throw err;
    }

    const ctx = await getOrCreateWallet(ownerId, session);
    if (ctx.wallet.balance < amount) {
        const err = new Error("INSUFFICIENT_VENDOR_WALLET_BALANCE");
        err.code = "INSUFFICIENT_VENDOR_WALLET_BALANCE";
        throw err;
    }

    ctx.wallet.balance -= amount;
    ctx.wallet.lastWithdrawAt = new Date();
    ctx.wallet.appendTransaction({
        type: "withdraw",
        amount: -amount,
        balanceAfter: ctx.wallet.balance,
        description,
        reference,
        metadata,
        createdAt: new Date(),
    });
    await ctx.wallet.save({ session });
    return ctx;
}

module.exports = {
    getOrCreateWallet,
    creditVendorWallet,
    debitVendorWallet,
};
