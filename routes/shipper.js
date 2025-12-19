const router = require("express").Router();
const { verifyToken, verifyAdmin } = require("../middleware/verifyToken");
const rateLimit = require('express-rate-limit');

// Rate limiting for public apply: max 20 per IP per hour
const publicApplyLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: false, message: 'Quá nhiều yêu cầu tạo hồ sơ từ IP này. Thử lại sau.' }
});
const shipperController = require("../controllers/shipperController");

// Public registration/apply (no auth)
router.post("/public/apply", publicApplyLimiter, shipperController.publicApply);

// Shipper self-service
router.post("/apply", verifyToken, shipperController.apply);
router.get("/me/application", verifyToken, shipperController.myApplication);

// Admin review
router.get("/applications", verifyAdmin, shipperController.listApplications);
router.get("/applications/:id", verifyAdmin, shipperController.getApplication);
router.put("/applications/:id/approve", verifyAdmin, shipperController.approve);
router.put("/applications/:id/reject", verifyAdmin, shipperController.reject);
router.put("/applications/bulk-approve", verifyAdmin, shipperController.bulkApprove);
router.put("/applications/bulk-reject", verifyAdmin, shipperController.bulkReject);

module.exports = router;
