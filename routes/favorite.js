const router = require("express").Router();
const favoriteController = require("../controllers/favoriteController");
const { verifyTokenAndAuthorization } = require("../middleware/verifyToken");

// Lấy danh sách yêu thích
router.get(
  "/",
  verifyTokenAndAuthorization,
  favoriteController.getUserFavorites
);

// Thêm vào yêu thích
router.post(
  "/",
  verifyTokenAndAuthorization,
  favoriteController.addToFavorites
);

// Kiểm tra yêu thích
router.get(
  "/check/:appliancesId",
  verifyTokenAndAuthorization,
  favoriteController.checkFavorite
);

// Xóa khỏi yêu thích
router.delete(
  "/:appliancesId",
  verifyTokenAndAuthorization,
  favoriteController.removeFromFavorites
);

// Xóa tất cả
router.delete(
  "/",
  verifyTokenAndAuthorization,
  favoriteController.clearAllFavorites
);

module.exports = router;
