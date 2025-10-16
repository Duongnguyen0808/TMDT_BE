const router = require("express").Router();
const { placeOrder, getUserOrders } = require("../controllers/orderController");
const { verifyTokenAndAuthorization } = require("../middleware/verifyToken");

router.post("/", verifyTokenAndAuthorization, placeOrder);
router.get("/", verifyTokenAndAuthorization, getUserOrders);

module.exports = router;
