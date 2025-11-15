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
router.get(
  "/store/:id/:status",
  verifyTokenAndAuthorization,
  orderController.getStoreOrders
);
router.put(
  "/:id",
  verifyTokenAndAuthorization,
  orderController.updateOrderStatus
);

// Confirm received order
router.put(
  "/:id/confirm-received",
  verifyTokenAndAuthorization,
  orderController.confirmReceived
);

// VNPay payment URL creation
router.post("/payment", verifyTokenAndAuthorization, createVnpayPayment);

module.exports = router;
