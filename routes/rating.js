const router = require("express").Router();
const ratingController = require("../controllers/ratingController");
const { verifyTokenAndAuthorization } = require("../middleware/verifyToken");

router.post("/", verifyTokenAndAuthorization, ratingController.addRating);

router.get("/", verifyTokenAndAuthorization, ratingController.checkUserRating);

router.get(
  "/check-purchased/:ratingType/:product",
  verifyTokenAndAuthorization,
  ratingController.checkUserPurchased
);

router.get("/:ratingType/:product", ratingController.getRatings);

module.exports = router;
