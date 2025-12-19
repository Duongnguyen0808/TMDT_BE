const router = require("express").Router();
const storeController = require("../controllers/storeController");
const { verifyTokenAndAuthorization } = require("../middleware/verifyToken");

router.post("/", verifyTokenAndAuthorization, storeController.addStore);

// Route lấy tất cả stores (đặt trước các route có params)
router.get("/all", storeController.getAllNearByStore);

// Tìm cửa hàng gần nhất
router.get("/nearby/search", storeController.getNearbyStores);

// Tính khoảng cách giao hàng
router.get("/delivery/distance", storeController.calculateDeliveryDistance);

router.get(
  "/owner/profile",
  verifyTokenAndAuthorization,
  storeController.getStoreByOwner
);

// Cập nhật hồ sơ cửa hàng (partial update)
router.put(
  "/owner/profile",
  verifyTokenAndAuthorization,
  storeController.updateStoreByOwner
);

router.get("/:code", storeController.getRandomStore);

router.get("/all/:code", storeController.getAllNearByStore);

router.get("/byId/:id", storeController.getStoreById);
module.exports = router;
