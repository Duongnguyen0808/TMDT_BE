const router = require("express").Router();
const { verifyToken, verifyVendor } = require("../middleware/verifyToken");
const chatController = require("../controllers/chatController");

// User creates/gets a conversation with a vendor
router.post("/conversation", verifyToken, chatController.getOrCreateConversation);

// Vendor creates/gets a conversation with a user
router.post("/vendor/conversation", verifyVendor, chatController.vendorGetOrCreateConversation);

// Vendor unread summary grouped by user
router.get("/vendor/unread-summary", verifyVendor, chatController.vendorUnreadSummary);

// Lists
router.get("/user/conversations", verifyToken, chatController.listUserConversations);
router.get("/vendor/conversations", verifyVendor, chatController.listVendorConversations);

// Messages
router.get("/conversations/:id/messages", verifyToken, chatController.getMessages);
router.post("/conversations/:id/messages", verifyToken, chatController.sendMessage);

module.exports = router;
