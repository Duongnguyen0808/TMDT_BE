const router = require("express").Router();
const appliancesController = require("../controllers/appliancesController");
const { verifyVendor } = require("../middleware/verifyToken");

router.post("/", verifyVendor, appliancesController.addAppliances);

router.get("/byCode/:code", appliancesController.getAllAppliancessByCode);

router.get("/search/:search", appliancesController.searchAppliancess);
router.get("/recommendation/:code", appliancesController.getRandomAppliances);
router.get("/store-appliances/:id", appliancesController.getAppliancessByStore);

router.get("/:id", appliancesController.getAppliancesById);
router.get(
  "/:category/:code",
  appliancesController.getAppliancessByCategoryAndCode
);

module.exports = router;
