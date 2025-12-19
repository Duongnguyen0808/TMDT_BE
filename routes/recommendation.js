const router = require("express").Router();
const {
    verifyToken,
    verifyVendor,
} = require("../middleware/verifyToken");
const {
    getUserRecommendations,
    getStoreRecommendations,
} = require("../controllers/recommendationController");

router.get("/user", verifyToken, getUserRecommendations);
router.get("/store/:storeId", verifyVendor, getStoreRecommendations);

module.exports = router;
