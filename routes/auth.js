const router = require("express").Router();
const authController = require("../controllers/authController");
const { verifyToken } = require("../middleware/verifyToken");

router.post("/register", authController.createUser);

router.post("/login", authController.loginUser);

// Đăng ký Admin (chỉ dùng lần đầu)
router.post("/register-admin", authController.createAdmin);

// Xác minh số điện thoại
router.post("/send-phone-otp", verifyToken, authController.sendPhoneOtp);
router.post("/verify-phone-otp", verifyToken, authController.verifyPhoneOtp);

module.exports = router;
