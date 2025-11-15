const Favorite = require("../models/Favorite");

module.exports = {
  // Thêm sản phẩm vào danh sách yêu thích
  addToFavorites: async (req, res) => {
    const userId = req.user.id;
    const { appliancesId } = req.body;

    if (!appliancesId) {
      return res.status(400).json({
        status: false,
        message: "Thiếu thông tin sản phẩm",
      });
    }

    try {
      // Kiểm tra đã tồn tại chưa
      const existing = await Favorite.findOne({ userId, appliancesId });
      if (existing) {
        return res.status(400).json({
          status: false,
          message: "Sản phẩm đã có trong danh sách yêu thích",
        });
      }

      const favorite = new Favorite({ userId, appliancesId });
      await favorite.save();

      res.status(201).json({
        status: true,
        message: "Đã thêm vào danh sách yêu thích",
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Xóa sản phẩm khỏi danh sách yêu thích
  removeFromFavorites: async (req, res) => {
    const userId = req.user.id;
    const { appliancesId } = req.params;

    try {
      const result = await Favorite.findOneAndDelete({ userId, appliancesId });

      if (!result) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy sản phẩm trong danh sách yêu thích",
        });
      }

      res.status(200).json({
        status: true,
        message: "Đã xóa khỏi danh sách yêu thích",
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Lấy danh sách yêu thích của user
  getUserFavorites: async (req, res) => {
    const userId = req.user.id;

    try {
      const favorites = await Favorite.find({ userId })
        .populate({
          path: "appliancesId",
          select: "title imageUrl price rating time description category",
          populate: {
            path: "store",
            select: "title logoUrl",
          },
        })
        .sort({ createdAt: -1 });

      res.status(200).json(favorites);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Kiểm tra sản phẩm có trong favorites không
  checkFavorite: async (req, res) => {
    const userId = req.user.id;
    const { appliancesId } = req.params;

    try {
      const favorite = await Favorite.findOne({ userId, appliancesId });

      res.status(200).json({
        status: true,
        isFavorite: !!favorite,
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Xóa tất cả favorites của user
  clearAllFavorites: async (req, res) => {
    const userId = req.user.id;

    try {
      await Favorite.deleteMany({ userId });

      res.status(200).json({
        status: true,
        message: "Đã xóa tất cả sản phẩm yêu thích",
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
};
