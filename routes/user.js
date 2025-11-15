const router = require("express").Router();
const userController = require("../controllers/userController");
const { verifyTokenAndAuthorization } = require("../middleware/verifyToken");

router.get(
  "/verify/:otp",
  verifyTokenAndAuthorization,
  userController.verifyAccount
);
router.get(
  "/verify_phone/:phone",
  verifyTokenAndAuthorization,
  userController.verifyPhone
);

router.get("/", verifyTokenAndAuthorization, userController.getUser);

// Kiểm tra trạng thái xác minh
router.get(
  "/verification-status",
  verifyTokenAndAuthorization,
  userController.checkVerificationStatus
);

// Cập nhật FCM token
router.post(
  "/fcm-token",
  verifyTokenAndAuthorization,
  userController.updateFcmToken
);

// Xóa tài khoản
router.delete(
  "/delete-account",
  verifyTokenAndAuthorization,
  userController.deleteAccount
);

module.exports = router;
