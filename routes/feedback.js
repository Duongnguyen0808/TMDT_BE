const router = require("express").Router();
const feedbackController = require("../controllers/feedbackController");
const {
  verifyTokenAndAuthorization,
  verifyAdmin,
} = require("../middleware/verifyToken");

// User routes
router.post(
  "/",
  verifyTokenAndAuthorization,
  feedbackController.createFeedback
);
router.get(
  "/my-feedback",
  verifyTokenAndAuthorization,
  feedbackController.getUserFeedback
);

// Admin routes
router.get("/admin/all", verifyAdmin, feedbackController.getAllFeedback);
router.get("/admin/stats", verifyAdmin, feedbackController.getFeedbackStats);
router.patch(
  "/admin/:id",
  verifyAdmin,
  feedbackController.updateFeedbackStatus
);
router.delete("/admin/:id", verifyAdmin, feedbackController.deleteFeedback);

// User feedback detail route (kept last to avoid conflicting with /admin/* paths)
router.get(
  "/:id",
  verifyTokenAndAuthorization,
  feedbackController.getFeedbackById
);

module.exports = router;
