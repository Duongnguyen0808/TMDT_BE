const router = require("express").Router();
const appliancesController = require("../controllers/appliancesController");
const { verifyVendor } = require("../middleware/verifyToken");

router.post("/", verifyVendor, appliancesController.addAppliances);

// Routes tĩnh phải đặt TRƯỚC các routes có params
router.get("/all", appliancesController.getAllAppliances);
router.get("/bestsellers", appliancesController.getBestsellers);
router.get("/hot-deals", appliancesController.getHotDeals);
router.get("/search/:search", appliancesController.searchAppliancess);
router.get(
  "/category/:categoryId",
  appliancesController.getAppliancesByCategory
);

// Tìm kiếm nâng cao
router.get("/advanced/search", appliancesController.advancedSearch);
router.post("/advanced/filter", appliancesController.filterProducts);

// Routes có params
router.get("/byCode/:code", appliancesController.getAllAppliancessByCode);
router.get("/recommendation/:code", appliancesController.getRandomAppliances);
router.get("/store-appliances/:id", appliancesController.getAppliancessByStore);

// Update và Delete routes (cần verify vendor) - ĐẶT TRƯỚC GET /:id
router.put("/:id", verifyVendor, appliancesController.updateAppliances);
router.delete("/:id", verifyVendor, appliancesController.deleteAppliances);

router.get("/:id", appliancesController.getAppliancesById);
router.get(
  "/:category/:code",
  appliancesController.getAppliancessByCategoryAndCode // Lấy theo category, không fallback
);

module.exports = router;
