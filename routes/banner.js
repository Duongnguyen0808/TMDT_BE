const router = require("express").Router();
const bannerController = require("../controllers/bannerController");
const { verifyAdmin } = require("../middleware/verifyToken");

router.get("/", bannerController.getActiveBanners);
router.get("/admin", verifyAdmin, bannerController.getAllBanners);
router.get("/:id", verifyAdmin, bannerController.getBannerById);
router.post("/", verifyAdmin, bannerController.createBanner);
router.put("/:id/products", verifyAdmin, bannerController.updateBannerProducts);
router.put("/:id", verifyAdmin, bannerController.updateBanner);
router.delete("/:id", verifyAdmin, bannerController.deleteBanner);
router.patch("/reorder", verifyAdmin, bannerController.updateBannerOrders);

module.exports = router;
