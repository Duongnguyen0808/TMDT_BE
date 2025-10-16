const router = require('express').Router();
const userController = require('../controllers/userController');
const { verifyTokenAndAuthorization } = require('../middleware/verifyToken');

// Verify account
router.get("/verify/:otp", verifyTokenAndAuthorization, userController.verifyAccount);

// Verify phone
router.get("/verify_phone/:phone", verifyTokenAndAuthorization, userController.verifyPhone);

// Get user info
router.get("/", verifyTokenAndAuthorization, userController.getUser);

// Delete user
router.delete("/", verifyTokenAndAuthorization, userController.deleteUser);

module.exports = router;
