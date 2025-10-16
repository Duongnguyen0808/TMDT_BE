const Appliances = require("../models/Appliances");

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

    try {
      const newAppliances = new Appliances(req.body);
      await newAppliances.save();
      res
        .status(201)
        .json({ status: true, message: "Thêm sản phẩm thành công" });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Lấy theo ID
  getAppliancesById: async (req, res) => {
    try {
      const appliances = await Appliances.findById(req.params.id);
      if (!appliances)
        return res
          .status(404)
          .json({ status: false, message: "Không tìm thấy" });
      res.status(200).json(appliances);
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
  getAppliancessByCategoryAndCode: async (req, res) => {
    const { category, code } = req.params;
    try {
      const appliancess = await Appliances.aggregate([
        {
          $match: {
            category: category.trim(),
            code: code.trim(),
            isAvailable: true,
          },
        },
        { $project: { __v: 0 } },
      ]);

      res.status(200).json(appliancess);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Search với Atlas Search
  searchAppliancess: async (req, res) => {
    try {
      const results = await Appliances.aggregate([
        {
          $search: {
            index: "appliances",
            text: {
              query: req.params.search,
              path: { wildcard: "*" },
            },
          },
        },
      ]);

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
};
