const router = require("express").Router();
const {
  validateVoucher,
  getAvailableVouchers,
} = require("../controllers/voucherController");
const { verifyTokenAndAuthorization } = require("../middleware/verifyToken");

// Validate voucher for an order
router.post("/validate", verifyTokenAndAuthorization, validateVoucher);

// Get available vouchers for user
router.get("/available", verifyTokenAndAuthorization, getAvailableVouchers);

module.exports = router;
