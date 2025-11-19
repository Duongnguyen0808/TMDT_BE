const router = require("express").Router();
const { verifyVendor, verifyToken } = require("../middleware/verifyToken");
const driverController = require("../controllers/driverController");

// Vendor manage drivers
router.post("/", verifyVendor, driverController.createDriver);
router.get("/", verifyVendor, driverController.listDrivers);
router.patch("/:id", verifyVendor, driverController.updateDriver);
router.post("/assign", verifyVendor, driverController.assignDriver);
router.post("/unassign", verifyVendor, driverController.unassignDriver);
router.get("/by-user/:userId", verifyVendor, driverController.getDriverByUser);

// Driver endpoints
router.get("/my/orders", verifyToken, driverController.myOrders);
router.patch("/my/orders/:id/status", verifyToken, driverController.driverUpdateOrderStatus);
router.get("/available/orders", verifyToken, driverController.availableOrders);
router.post("/orders/:id/claim", verifyToken, driverController.claimOrder);
router.patch("/orders/:id/location", verifyToken, driverController.updateLocation);

module.exports = router;
