const router = require("express").Router();
const { verifyVendor } = require("../middleware/verifyToken");
const vendorWalletController = require("../controllers/vendorWalletController");

router.get("/", verifyVendor, vendorWalletController.summary);
router.get("/transactions", verifyVendor, vendorWalletController.transactions);
router.post("/deposit", verifyVendor, vendorWalletController.deposit);
router.post("/withdraw", verifyVendor, vendorWalletController.withdraw);

module.exports = router;
