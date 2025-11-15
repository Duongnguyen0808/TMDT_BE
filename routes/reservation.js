const router = require("express").Router();
const reservationController = require("../controllers/reservationController");
const { verifyTokenAndAuthorization } = require("../middleware/verifyToken");

// Tạo reservation khi bắt đầu checkout
router.post(
  "/",
  verifyTokenAndAuthorization,
  reservationController.createReservation
);

// Kiểm tra reservation
router.get(
  "/:productId",
  verifyTokenAndAuthorization,
  reservationController.checkReservation
);

// Lấy stock khả dụng
router.get("/stock/:productId", reservationController.getAvailableStock);

// Hủy reservation
router.delete(
  "/",
  verifyTokenAndAuthorization,
  reservationController.cancelReservation
);

module.exports = router;
