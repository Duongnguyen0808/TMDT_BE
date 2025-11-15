const Appliances = require("../models/Appliances");
const {
  formatProductByLanguage,
  formatProductsArrayByLanguage,
  getLanguage,
} = require("../utils/i18n_helper");

module.exports = {
  // Thêm sản phẩm mới
  addAppliances: async (req, res) => {
    const {
      title,
      appliancesTags,
      category,
      code,
      store,
      description,
      time,
      price,
      imageUrl,
      stock, // Thêm stock
    } = req.body;

    // validate
    if (
      !title ||
      !appliancesTags ||
      !category ||
      !code ||
      !store ||
      !description ||
      !time ||
      !price ||
      !imageUrl
    ) {
      return res
        .status(400)
        .json({ status: false, message: "Thiếu trường bắt buộc" });
    }

    // Validate stock
    if (stock !== undefined && (stock < 0 || !Number.isInteger(stock))) {
      return res.status(400).json({
        status: false,
        message: "Số lượng tồn kho phải là số nguyên không âm",
      });
    }

    try {
      const newAppliances = new Appliances({
        ...req.body,
        stock: stock !== undefined ? stock : 999, // Default 999 nếu không truyền
        soldCount: 0,
      });
      await newAppliances.save();
      res.status(201).json({
        status: true,
        message: res.__("product.created"),
        product: {
          _id: newAppliances._id,
          title: newAppliances.title,
          stock: newAppliances.stock,
        },
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Lấy tất cả sản phẩm (không lọc)
  getAllAppliances: async (req, res) => {
    try {
      const lang = getLanguage(req);
      const appliances = await Appliances.find({ isAvailable: true });
      const formattedAppliances = formatProductsArrayByLanguage(
        appliances,
        lang
      );
      res.status(200).json(formattedAppliances);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Lấy theo ID
  getAppliancesById: async (req, res) => {
    try {
      const lang = getLanguage(req);
      const appliances = await Appliances.findById(req.params.id);
      if (!appliances)
        return res
          .status(404)
          .json({ status: false, message: res.__("product.not_found") });
      const formattedProduct = formatProductByLanguage(appliances, lang);
      res.status(200).json(formattedProduct);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Random appliances theo code hoặc fallback
  getRandomAppliances: async (req, res) => {
    try {
      let randomList = [];

      if (req.params.code) {
        randomList = await Appliances.aggregate([
          { $match: { code: req.params.code.trim(), isAvailable: true } },
          { $sample: { size: 3 } },
          { $project: { __v: 0 } },
        ]);
      }

      if (!randomList.length) {
        randomList = await Appliances.aggregate([
          { $match: { isAvailable: true } },
          { $sample: { size: 5 } },
          { $project: { __v: 0 } },
        ]);
      }

      if (randomList.length) {
        res.status(200).json(randomList);
      } else {
        res
          .status(404)
          .json({ status: false, message: "Không tìm thấy sản phẩm" });
      }
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  getAllAppliancessByCode: async (req, res) => {
    const code = req.params.code;
    try {
      const appliancesList = await Appliances.find({ code: code });

      return res.status(200).json(appliancesList);
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },

  // Lấy danh sách theo Store
  getAppliancessByStore: async (req, res) => {
    try {
      const appliancess = await Appliances.find({ store: req.params.id });
      res.status(200).json(appliancess);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Lấy theo category + code
  // Lấy sản phẩm theo category + code (KHÔNG fallback - phải đúng category)
  getAppliancessByCategoryAndCode: async (req, res) => {
    const { category, code } = req.params;
    try {
      // Chỉ lấy sản phẩm thuộc đúng category, không fallback
      const appliancess = await Appliances.find({
        category: category.trim(),
        isAvailable: true,
      }).select("-__v");

      res.status(200).json(appliancess);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Search nâng cấp: bỏ dấu tiếng Việt, fuzzy và autocomplete + filters
  searchAppliancess: async (req, res) => {
    try {
      const query = (req.params.search || "").trim();
      if (!query) {
        return res.status(200).json([]);
      }

      // Get filter parameters
      const { category, minPrice, maxPrice, minRating, sortBy } = req.query;

      // Build filter conditions for regex search
      const matchFilters = {
        isAvailable: true,
        $or: [
          { title: { $regex: query, $options: "i" } },
          { appliancesTags: { $regex: query, $options: "i" } },
          { description: { $regex: query, $options: "i" } },
          { category: { $regex: query, $options: "i" } },
        ],
      };

      if (category && category !== "Tất cả") {
        matchFilters.category = category;
      }

      if (minPrice || maxPrice) {
        matchFilters.price = {};
        if (minPrice) matchFilters.price.$gte = parseFloat(minPrice);
        if (maxPrice) matchFilters.price.$lte = parseFloat(maxPrice);
      }

      if (minRating) {
        matchFilters.rating = { $gte: parseFloat(minRating) };
      }

      // Use simple find with regex instead of Atlas Search
      let results = await Appliances.find(matchFilters)
        .select("-__v")
        .limit(30);

      // Apply sorting based on sortBy parameter
      if (sortBy === "price_asc") {
        results.sort((a, b) => a.price - b.price);
      } else if (sortBy === "price_desc") {
        results.sort((a, b) => b.price - a.price);
      } else if (sortBy === "rating") {
        results.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      } else if (sortBy === "popular") {
        results.sort((a, b) => (b.ratingCount || 0) - (a.ratingCount || 0));
      }

      res.status(200).json(results);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Random appliances theo category + code (recommendation)
  getRandomAppliancessByCategoryAndCode: async (req, res) => {
    const { category, code } = req.params;

    try {
      let appliancess = await Appliances.aggregate([
        {
          $match: {
            category: category.trim(),
            code: code.trim(),
            isAvailable: true,
          },
        },
        { $sample: { size: 10 } },
      ]);

      if (!appliancess || appliancess.length === 0) {
        appliancess = await Appliances.aggregate([
          { $match: { code: code.trim(), isAvailable: true } },
          { $sample: { size: 10 } },
        ]);
      }

      if (!appliancess || appliancess.length === 0) {
        appliancess = await Appliances.aggregate([
          { $match: { isAvailable: true } },
          { $sample: { size: 10 } },
        ]);
      }

      res.status(200).json(appliancess);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Lấy sản phẩm bán chạy (rating >= 4.5)
  getBestsellers: async (req, res) => {
    try {
      // Chỉ lấy sản phẩm có rating >= 4.5 (bán chạy)
      const bestsellers = await Appliances.find({
        isAvailable: true,
        rating: { $gte: 4.5 }, // Rating >= 4.5
      })
        .sort({ rating: -1 }) // Sắp xếp theo rating giảm dần
        .limit(10)
        .select("-__v");

      res.status(200).json(bestsellers);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Lấy sản phẩm Hot Deals (có discount > 0)
  getHotDeals: async (req, res) => {
    try {
      const hotDeals = await Appliances.find({
        isAvailable: true,
        discount: { $gt: 0 }, // Có giảm giá
      })
        .sort({ discount: -1 }) // Sắp xếp theo % giảm giá cao nhất
        .limit(20)
        .select("-__v");

      res.status(200).json(hotDeals);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Lấy tất cả sản phẩm theo category (không lọc code)
  getAppliancesByCategory: async (req, res) => {
    try {
      const categoryId = req.params.categoryId;
      const appliances = await Appliances.find({
        category: categoryId,
        isAvailable: true,
      }).select("-__v");

      res.status(200).json(appliances);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Cập nhật sản phẩm
  updateAppliances: async (req, res) => {
    const appliancesId = req.params.id;
    const updateData = req.body;

    try {
      const updatedAppliances = await Appliances.findByIdAndUpdate(
        appliancesId,
        updateData,
        { new: true, runValidators: true }
      );

      if (!updatedAppliances) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy sản phẩm",
        });
      }

      res.status(200).json({
        status: true,
        message: "Cập nhật sản phẩm thành công",
        data: updatedAppliances,
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Xóa sản phẩm
  deleteAppliances: async (req, res) => {
    const appliancesId = req.params.id;

    try {
      const deletedAppliances = await Appliances.findByIdAndDelete(
        appliancesId
      );

      if (!deletedAppliances) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy sản phẩm",
        });
      }

      res.status(200).json({
        status: true,
        message: "Xóa sản phẩm thành công",
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Tìm kiếm và lọc nâng cao
  advancedSearch: async (req, res) => {
    try {
      const {
        keyword,
        category,
        minPrice,
        maxPrice,
        minRating,
        tags,
        storeId,
        sortBy = "createdAt",
        sortOrder = "desc",
        page = 1,
        limit = 20,
      } = req.query;

      // Build query
      const query = { isAvailable: true };

      // Keyword search (title, description, tags)
      if (keyword) {
        query.$or = [
          { title: { $regex: keyword, $options: "i" } },
          { description: { $regex: keyword, $options: "i" } },
          { appliancesTags: { $regex: keyword, $options: "i" } },
        ];
      }

      // Category filter
      if (category && category !== "Tất cả") {
        query.category = category;
      }

      // Price range
      if (minPrice || maxPrice) {
        query.price = {};
        if (minPrice) query.price.$gte = parseFloat(minPrice);
        if (maxPrice) query.price.$lte = parseFloat(maxPrice);
      }

      // Rating filter
      if (minRating) {
        query.rating = { $gte: parseFloat(minRating) };
      }

      // Tags filter (multiple tags)
      if (tags) {
        const tagArray = tags.split(",").map((t) => t.trim());
        query.appliancesTags = { $in: tagArray };
      }

      // Store filter
      if (storeId) {
        query.store = storeId;
      }

      // Sort options
      const sortOptions = {};
      sortOptions[sortBy] = sortOrder === "asc" ? 1 : -1;

      // Pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Execute query
      const products = await Appliances.find(query)
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit))
        .select("-__v")
        .populate("category", "title")
        .populate("store", "title logoUrl");

      // Count total
      const total = await Appliances.countDocuments(query);

      res.status(200).json({
        status: true,
        data: products,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Lọc sản phẩm theo nhiều tiêu chí
  filterProducts: async (req, res) => {
    try {
      const {
        categories,
        minPrice,
        maxPrice,
        ratings,
        stores,
        sortBy = "price",
        sortOrder = "asc",
      } = req.body;

      const query = { isAvailable: true };

      // Multiple categories
      if (categories && categories.length > 0) {
        query.category = { $in: categories };
      }

      // Price range
      if (minPrice !== undefined || maxPrice !== undefined) {
        query.price = {};
        if (minPrice !== undefined) query.price.$gte = parseFloat(minPrice);
        if (maxPrice !== undefined) query.price.$lte = parseFloat(maxPrice);
      }

      // Multiple rating filters
      if (ratings && ratings.length > 0) {
        query.rating = { $in: ratings.map((r) => parseFloat(r)) };
      }

      // Multiple stores
      if (stores && stores.length > 0) {
        query.store = { $in: stores };
      }

      // Sort
      const sortOptions = {};
      sortOptions[sortBy] = sortOrder === "asc" ? 1 : -1;

      const products = await Appliances.find(query)
        .sort(sortOptions)
        .select("-__v");

      res.status(200).json({
        status: true,
        count: products.length,
        data: products,
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
};
