const router = require("express").Router();
const { verifyAdmin } = require("../middleware/verifyToken");
const shipmentController = require("../controllers/shipmentController");

router.post("/", verifyAdmin, shipmentController.createShipment);
router.get("/", verifyAdmin, shipmentController.listShipments);
router.patch("/:id/advance", verifyAdmin, shipmentController.advanceShipment);

module.exports = router;
