const Category = require("../models/Category");
const {
  formatCategoriesArrayByLanguage,
  getLanguage,
} = require("../utils/i18n_helper");

module.exports = {
  createCategory: async (req, res) => {
    const newCategory = new Category(req.body);
    try {
      await newCategory.save();
      res
        .status(201)
        .json({ status: true, message: res.__("category.created") });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  getAllCategories: async (req, res) => {
    try {
      const lang = getLanguage(req);
      const categories = await Category.find(
        { title: { $ne: "More" } },
        { __v: 0 }
      );
      const formattedCategories = formatCategoriesArrayByLanguage(
        categories,
        lang
      );
      res.status(200).json(formattedCategories);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
  getRandomCategories: async (req, res) => {
    try {
      const lang = getLanguage(req);
      let categories = await Category.aggregate([
        { $match: { value: { $ne: "more" } } },
        { $sample: { size: 4 } },
      ]);

      const moreCategory = await Category.findOne(
        { value: "more" },
        { __v: 0 }
      );
      if (moreCategory) {
        categories.push(moreCategory);
      }
      const formattedCategories = formatCategoriesArrayByLanguage(
        categories,
        lang
      );
      res.status(200).json(formattedCategories);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
};
