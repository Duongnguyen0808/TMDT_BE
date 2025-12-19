const router = require("express").Router();
const {
  validateVoucher,
  getAvailableVouchers,
  claimVoucher,
  getMyVouchers,
  getPublicVouchers,
  seedDemoVouchers,
} = require("../controllers/voucherController");
const { verifyTokenAndAuthorization } = require("../middleware/verifyToken");
const { verifyAdmin } = require("../middleware/verifyToken");

// Validate voucher for an order
router.post("/validate", verifyTokenAndAuthorization, validateVoucher);

// Get available vouchers for user
router.get("/available", verifyTokenAndAuthorization, getAvailableVouchers);

// Claim a voucher by code
router.post("/claim", verifyTokenAndAuthorization, claimVoucher);

// My claimed vouchers
router.get("/my", verifyTokenAndAuthorization, getMyVouchers);

// Public vouchers (no auth) for hunting page
router.get("/public", getPublicVouchers);

// Dev helper: seed demo vouchers when DB empty
// In production, restrict to Admin; in dev, allow open for quick setup
if (process.env.NODE_ENV === 'production') {
  router.post('/_seedDemo', verifyAdmin, seedDemoVouchers);
} else {
  router.post('/_seedDemo', seedDemoVouchers);
}

module.exports = router;
