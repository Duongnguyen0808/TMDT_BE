const Voucher = require("../models/Voucher");
const VoucherClaim = require("../models/VoucherClaim");

// Simple debug logger for voucher flows
const vLog = (...args) => {
  try {
    console.log("[VOUCHER]", ...args);
  } catch (_) { }
};

// Lấy danh sách voucher khả dụng cho người dùng
const getAvailableVouchers = async (req, res) => {
  try {
    const { storeId, orderTotal } = req.query;
    const now = new Date();
    const uid = req.user?.id || req.user?._id || 'anonymous';
    vLog('GET /available start', { uid, storeId, orderTotal });

    let query = {
      isActive: true,
      $and: [
        {
          $or: [
            { validFrom: { $exists: false } },
            { validFrom: null },
            { validFrom: { $lte: now } },
          ],
        },
        {
          $or: [
            { validUntil: { $exists: false } },
            { validUntil: null },
            { validUntil: { $gte: now } },
          ],
        },
      ],
    };

    // Filter by store if provided
    if (storeId) {
      query.$and.push({
        $or: [
          { storeIds: { $size: 0 } },
          { storeIds: { $exists: false } },
          { storeIds: storeId },
        ],
      });
    }

    let vouchers = await Voucher.find(query).sort({ createdAt: -1 });
    vLog('Matched active window vouchers:', vouchers.length, 'codes:', vouchers.map(v => v.code));

    // Exclude vouchers already claimed by this user (claim-first flow)
    const myClaims = await VoucherClaim.find({ user: req.user.id }).select('voucher');
    const claimedIds = new Set(myClaims.map(c => String(c.voucher)));
    const beforeClaimFilter = vouchers.length;
    const beforeCodes = vouchers.map(v => v.code);
    vouchers = vouchers.filter(v => !claimedIds.has(String(v._id)));
    const removedClaimed = beforeCodes.filter((code, idx) => claimedIds.has(String(vouchers[idx]?._id))); // best-effort
    vLog('User claims:', myClaims.length, 'claimedIds:', Array.from(claimedIds));
    vLog('After remove claimed vouchers:', vouchers.length, 'removedCount(est):', beforeClaimFilter - vouchers.length);

    // Filter out vouchers that reached usage limit or min order requirement
    const usageFiltered = [];
    const minOrderFiltered = [];
    const kept = [];
    const totalNum = vouchers.length;
    const totalOrder = orderTotal ? parseFloat(orderTotal) : null;
    for (const v of vouchers) {
      if (v.usageLimit && v.usedCount >= v.usageLimit) {
        usageFiltered.push(v.code);
        continue;
      }
      if (totalOrder != null && v.minOrderTotal && totalOrder < v.minOrderTotal) {
        minOrderFiltered.push(v.code);
        continue;
      }
      kept.push(v);
    }
    vouchers = kept;
    vLog('Filter usage/minOrder', {
      totalBefore: totalNum,
      removedUsageLimit: usageFiltered,
      removedMinOrder: minOrderFiltered,
      finalCount: vouchers.length,
      finalCodes: vouchers.map(v => v.code),
    });

    res.status(200).json({ status: true, data: vouchers });
  } catch (error) {
    vLog('GET /available error', error?.message);
    res.status(500).json({ status: false, message: error.message });
  }
};

const validateVoucher = async (req, res) => {
  try {
    const { promoCode, orderTotal, storeId } = req.body || {};
    const code = (promoCode || "").trim().toUpperCase();
    const total = Number(orderTotal) || 0;
    const uid = req.user?.id || req.user?._id || 'anonymous';
    vLog('POST /validate start', { uid, code, total, storeId });

    if (!code)
      return res
        .status(400)
        .json({ status: false, message: "Thiếu mã voucher" });
    if (total <= 0)
      return res
        .status(400)
        .json({ status: false, message: "Tổng đơn không hợp lệ" });

    let voucher = await Voucher.findOne({ code });
    let discount = 0;

    if (
      voucher &&
      voucher.isValidNow() &&
      total >= (voucher.minOrderTotal || 0)
    ) {
      // Require claim by user before voucher can be used
      const claim = await VoucherClaim.findOne({ voucher: voucher._id, user: req.user.id });
      if (!claim) {
        return res.status(200).json({
          status: false,
          valid: false,
          promoCode: code,
          discountAmount: 0,
          message: "Bạn cần nhận voucher này trước khi sử dụng",
        });
      }
      if (claim.used) {
        return res.status(200).json({
          status: false,
          valid: false,
          promoCode: code,
          discountAmount: 0,
          message: "Bạn đã sử dụng voucher này",
        });
      }
      if (voucher.storeIds && voucher.storeIds.length > 0 && storeId) {
        const allowed = voucher.storeIds.some(
          (id) => id.toString() === String(storeId)
        );
        if (!allowed) {
          return res
            .status(400)
            .json({
              status: false,
              message: "Mã không áp dụng cho cửa hàng này",
            });
        }
      }

      if (voucher.type === "percentage") {
        discount = Math.floor((total * Number(voucher.value || 0)) / 100);
        if (voucher.maxDiscount)
          discount = Math.min(discount, Number(voucher.maxDiscount));
      } else if (voucher.type === "fixed") {
        discount = Math.min(Number(voucher.value || 0), total);
      }
    } else {
      // Fallback các mã demo nếu chưa có dữ liệu DB
      if (code === "GIAM10") {
        discount = Math.floor(total * 0.1);
        discount = Math.min(discount, 50000);
      } else if (code === "GIAM50K") {
        discount = Math.min(50000, total);
      } else {
        return res.status(200).json({
          status: false,
          valid: false,
          promoCode: code,
          discountAmount: 0,
          message: "Voucher không hợp lệ",
        });
      }
    }

    if (discount <= 0) {
      return res
        .status(200)
        .json({
          status: false,
          valid: false,
          promoCode: code,
          discountAmount: 0,
          message: "Voucher không áp dụng",
        });
    }

    vLog('POST /validate result', { code, valid: discount > 0, discount });
    return res.status(200).json({
      status: true,
      valid: true,
      promoCode: code,
      discountAmount: discount,
    });
  } catch (error) {
    vLog('POST /validate error', error?.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// Public list of active vouchers (no auth required), for browsing/hunting
const getPublicVouchers = async (req, res) => {
  try {
    const now = new Date();
    const { storeId, orderTotal } = req.query || {};
    vLog('GET /public start', { storeId, orderTotal });
    let query = {
      isActive: true,
      $and: [
        {
          $or: [{ validFrom: { $exists: false } }, { validFrom: null }, { validFrom: { $lte: now } }],
        },
        {
          $or: [{ validUntil: { $exists: false } }, { validUntil: null }, { validUntil: { $gte: now } }],
        },
      ],
    };
    if (storeId) {
      query.$and.push({
        $or: [{ storeIds: { $size: 0 } }, { storeIds: { $exists: false } }, { storeIds: storeId }],
      });
    }
    let vouchers = await Voucher.find(query).sort({ createdAt: -1 });
    vLog('Public matched active window:', vouchers.length, 'codes:', vouchers.map(v => v.code));
    const usageFiltered = [];
    const minOrderFiltered = [];
    const kept = [];
    const totalOrder = orderTotal ? parseFloat(orderTotal) : null;
    for (const v of vouchers) {
      if (v.usageLimit && v.usedCount >= v.usageLimit) {
        usageFiltered.push(v.code);
        continue;
      }
      if (totalOrder != null && v.minOrderTotal && totalOrder < v.minOrderTotal) {
        minOrderFiltered.push(v.code);
        continue;
      }
      kept.push(v);
    }
    vLog('Public filter usage/minOrder', {
      removedUsageLimit: usageFiltered,
      removedMinOrder: minOrderFiltered,
      finalCount: kept.length,
      finalCodes: kept.map(v => v.code),
    });
    return res.status(200).json({ status: true, data: kept });
  } catch (error) {
    vLog('GET /public error', error?.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// User claims a voucher by code (one per user)
const claimVoucher = async (req, res) => {
  try {
    const code = (req.body?.code || req.query?.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ status: false, message: 'Thiếu mã voucher' });
    const uid = req.user?.id || req.user?._id || 'anonymous';
    vLog('POST /claim start', { uid, code });
    const voucher = await Voucher.findOne({ code });
    if (!voucher) return res.status(404).json({ status: false, message: 'Không tìm thấy voucher' });
    if (!voucher.isValidNow()) return res.status(400).json({ status: false, message: 'Voucher không còn hiệu lực' });

    // Create unique claim; if exists, just return ok
    try {
      const claim = await VoucherClaim.findOneAndUpdate(
        { voucher: voucher._id, user: req.user.id },
        { $setOnInsert: { claimedAt: new Date(), used: false } },
        { new: true, upsert: true }
      );
      vLog('POST /claim success', { code: voucher.code, used: claim.used });
      return res.status(200).json({ status: true, message: 'Đã nhận voucher', data: { code: voucher.code, used: claim.used } });
    } catch (e) {
      vLog('POST /claim db error', e?.message);
      return res.status(500).json({ status: false, message: e.message });
    }
  } catch (error) {
    vLog('POST /claim error', error?.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// List claimed vouchers of current user
// Supports filters: usable=1, orderTotal, storeId
const getMyVouchers = async (req, res) => {
  try {
    const { usable, orderTotal, storeId } = req.query || {};
    const total = orderTotal ? Number(orderTotal) : null;
    const uid = req.user?.id || req.user?._id || 'anonymous';
    vLog('GET /my start', { uid, usable, orderTotal, storeId });
    const claims = await VoucherClaim.find({ user: req.user.id })
      .populate('voucher');

    let items = claims
      .filter(c => !!c.voucher)
      .map(c => {
        const v = c.voucher;
        const base = v.toObject({ getters: false, virtuals: false });
        return {
          ...base, // includes _id, code, title, type, value, etc.
          used: c.used,
          usedAt: c.usedAt,
          isValid: v.isValidNow(),
        };
      });

    vLog('GET /my claims', { totalClaims: claims.length, mappedItems: items.length, codes: items.map(i => i.code) });
    if (usable) {
      items = items.filter(it => {
        if (it.used) return false; // not used yet
        if (!it.isValid) return false; // within date/active/usage limit
        if (typeof it.minOrderTotal === 'number' && total != null && total < it.minOrderTotal) return false;
        if (Array.isArray(it.storeIds) && it.storeIds.length > 0 && storeId) {
          const allowed = it.storeIds.some(id => String(id) === String(storeId));
          if (!allowed) return false;
        }
        return true;
      });
      vLog('GET /my usable filter', { finalCount: items.length, finalCodes: items.map(i => i.code) });
    }

    return res.status(200).json({ status: true, data: items });
  } catch (error) {
    vLog('GET /my error', error?.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

module.exports = { validateVoucher, getAvailableVouchers, claimVoucher, getMyVouchers, getPublicVouchers };

// --- Dev helper: seed demo vouchers ---
// Create a couple of demo vouchers if DB is empty
const seedDemoVouchers = async (req, res) => {
  try {
    const count = await Voucher.countDocuments();
    if (count > 0) {
      return res.status(200).json({ status: true, message: 'Vouchers already exist', count });
    }
    const now = new Date();
    const in30d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const items = [
      {
        code: 'GIAM10',
        title: 'Giảm 10% tối đa 50K',
        type: 'percentage',
        value: 10,
        maxDiscount: 50000,
        minOrderTotal: 100000,
        validFrom: now,
        validUntil: in30d,
        isActive: true,
      },
      {
        code: 'GIAM50K',
        title: 'Giảm trực tiếp 50K',
        type: 'fixed',
        value: 50000,
        minOrderTotal: 200000,
        validFrom: now,
        validUntil: in30d,
        isActive: true,
      },
    ];
    await Voucher.insertMany(items);
    return res.status(201).json({ status: true, message: 'Seeded demo vouchers', count: items.length });
  } catch (e) {
    return res.status(500).json({ status: false, message: e.message });
  }
};

module.exports.seedDemoVouchers = seedDemoVouchers;
