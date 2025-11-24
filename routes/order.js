const router = require("express").Router();
const orderController = require("../controllers/orderController");
const { createVnpayPayment } = require("../controllers/paymentController");
const { verifyTokenAndAuthorization } = require("../middleware/verifyToken");

router.post("/", verifyTokenAndAuthorization, orderController.placeOrder);
router.get(
  "/:id",
  verifyTokenAndAuthorization,
  orderController.getOrderDetails
);
router.get("/", verifyTokenAndAuthorization, orderController.getUserOrders);
// Advanced (pagination + multi-status) first to avoid shadowing
router.get(
  "/store/:id",
  verifyTokenAndAuthorization,
  orderController.getStoreOrdersAdvanced
);
// Legacy single-status route retained for backward compatibility
router.get(
  "/store/:id/:status",
  verifyTokenAndAuthorization,
  orderController.getStoreOrders
);
router.post(
  "/:id/ready-for-pickup",
  verifyTokenAndAuthorization,
  orderController.markReadyForPickup
);
router.post(
  "/:id/pickup-code/regenerate",
  verifyTokenAndAuthorization,
  orderController.regeneratePickupCode
);
router.post(
  "/:id/cancel",
  verifyTokenAndAuthorization,
  orderController.cancelOrder
);
router.put(
  "/:id",
  verifyTokenAndAuthorization,
  orderController.updateOrderStatus
);
router.post(
  "/:id/shipper-checkin",
  verifyTokenAndAuthorization,
  orderController.driverPickupCheckin
);
router.post(
  "/:id/shipper-confirm-pickup",
  verifyTokenAndAuthorization,
  orderController.driverConfirmPickup
);

// Logistics progression (Admin only)
router.patch(
  "/:id/logistics",
  verifyTokenAndAuthorization,
  orderController.advanceLogistics
);

// Bulk legacy logistics sync
router.post(
  "/logistics-sync",
  verifyTokenAndAuthorization,
  orderController.syncLogisticsLegacy
);

// Confirm received order
router.put(
  "/:id/confirm-received",
  verifyTokenAndAuthorization,
  orderController.confirmReceived
);

// Returns/Refunds
router.post(
  "/:id/return-request",
  verifyTokenAndAuthorization,
  orderController.requestReturn
);
router.put(
  "/:id/return-review",
  verifyTokenAndAuthorization,
  orderController.reviewReturn
);
router.put(
  "/:id/return-confirm",
  verifyTokenAndAuthorization,
  orderController.confirmReturned
);

// VNPay payment URL creation
router.post("/payment", verifyTokenAndAuthorization, createVnpayPayment);

// Driver proposal workflow
router.post("/driver/accept/:id", verifyTokenAndAuthorization, orderController.acceptDriverProposal);
router.post("/driver/decline/:id", verifyTokenAndAuthorization, orderController.declineDriverProposal);
router.post("/driver/next/:id", verifyTokenAndAuthorization, orderController.nextDriverProposal);
module.exports = router;
