const mongoose = require("mongoose");

const CategorySchema = new mongoose.Schema({
  title: { type: String, require: true },
  title_en: { type: String }, // Tiếng Anh
  value: { type: String, require: true },
  imageUrl: { type: String, require: true },
});

module.exports = mongoose.model("Category", CategorySchema);
