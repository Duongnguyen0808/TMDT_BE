const Voucher = require("../models/Voucher");

// Lấy danh sách voucher khả dụng cho người dùng
const getAvailableVouchers = async (req, res) => {
  try {
    const { storeId, orderTotal } = req.query;
    const now = new Date();

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

    // Filter out vouchers that reached usage limit or min order requirement
    vouchers = vouchers.filter((v) => {
      if (v.usageLimit && v.usedCount >= v.usageLimit) return false;
      if (
        orderTotal &&
        v.minOrderTotal &&
        parseFloat(orderTotal) < v.minOrderTotal
      )
        return false;
      return true;
    });

    res.status(200).json({
      status: true,
      data: vouchers,
    });
  } catch (error) {
    res.status(500).json({ status: false, message: error.message });
  }
};

const validateVoucher = async (req, res) => {
  try {
    const { promoCode, orderTotal, storeId } = req.body || {};
    const code = (promoCode || "").trim().toUpperCase();
    const total = Number(orderTotal) || 0;

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
        return res
          .status(200)
          .json({
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

    return res
      .status(200)
      .json({
        status: true,
        valid: true,
        promoCode: code,
        discountAmount: discount,
      });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

module.exports = { validateVoucher, getAvailableVouchers };
