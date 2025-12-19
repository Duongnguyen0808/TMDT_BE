const router = require("express").Router();
const {
    verifyVendor,
    verifyAdmin,
} = require("../middleware/verifyToken");
const {
    getVendorOverview,
    getPlatformOverview,
} = require("../controllers/analyticsController");

router.get("/vendor/:storeId/overview", verifyVendor, getVendorOverview);
router.get("/platform/overview", verifyAdmin, getPlatformOverview);

module.exports = router;
