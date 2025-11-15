const router = require("express").Router();
const adminController = require("../controllers/adminController");
const { verifyAdmin } = require("../middleware/verifyToken");

// Dashboard overview
router.get(
  "/dashboard/overview",
  verifyAdmin,
  adminController.getDashboardOverview
);

// Revenue statistics
router.get("/dashboard/revenue", verifyAdmin, adminController.getRevenueStats);

// Top stores
router.get("/dashboard/top-stores", verifyAdmin, adminController.getTopStores);

// Top products
router.get(
  "/dashboard/top-products",
  verifyAdmin,
  adminController.getTopProducts
);

// Region statistics
router.get(
  "/dashboard/regions",
  verifyAdmin,
  adminController.getOrdersByRegion
);

// User management
router.get("/users", verifyAdmin, adminController.getAllUsers);
router.get("/users/:id", verifyAdmin, adminController.getUserDetails);

// Store management
router.get("/stores", verifyAdmin, adminController.getAllStoresAdmin);
router.patch(
  "/stores/:id/verification",
  verifyAdmin,
  adminController.updateStoreVerification
);
router.delete("/stores/:id", verifyAdmin, adminController.deleteStore);

// Product management
router.get("/products", verifyAdmin, adminController.getAllProducts);
router.delete("/products/:id", verifyAdmin, adminController.deleteProduct);

// Order management
router.get("/orders", verifyAdmin, adminController.getAllOrders);

// User management - delete
router.delete("/users/:id", verifyAdmin, adminController.deleteUser);

// Voucher management
router.get("/vouchers", verifyAdmin, adminController.getAllVouchers);
router.post("/vouchers", verifyAdmin, adminController.createVoucher);
router.put("/vouchers/:id", verifyAdmin, adminController.updateVoucher);
router.delete("/vouchers/:id", verifyAdmin, adminController.deleteVoucher);

module.exports = router;
