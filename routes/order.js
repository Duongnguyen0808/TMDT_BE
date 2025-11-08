const router = require("express").Router();
const { placeOrder, getUserOrders } = require("../controllers/orderController");
const { createVnpayPayment } = require("../controllers/paymentController");
const { verifyTokenAndAuthorization } = require("../middleware/verifyToken");

router.post("/", verifyTokenAndAuthorization, placeOrder);
router.get("/", verifyTokenAndAuthorization, getUserOrders);

// VNPay payment URL creation
router.post("/payment", verifyTokenAndAuthorization, createVnpayPayment);

module.exports = router;
