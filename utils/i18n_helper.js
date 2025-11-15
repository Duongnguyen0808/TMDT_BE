/**
 * Helper functions for i18n support
 */

/**
 * Format product data based on language
 * @param {Object} product - Product object from database
 * @param {String} lang - Language code (vi, en)
 * @returns {Object} - Formatted product with localized fields
 */
const formatProductByLanguage = (product, lang = "vi") => {
  if (!product) return null;

  const productObj = product._doc || product;

  return {
    ...productObj,
    title:
      lang === "en" && productObj.title_en
        ? productObj.title_en
        : productObj.title,
    description:
      lang === "en" && productObj.description_en
        ? productObj.description_en
        : productObj.description,
  };
};

/**
 * Format category data based on language
 * @param {Object} category - Category object from database
 * @param {String} lang - Language code (vi, en)
 * @returns {Object} - Formatted category with localized fields
 */
const formatCategoryByLanguage = (category, lang = "vi") => {
  if (!category) return null;

  const categoryObj = category._doc || category;

  return {
    ...categoryObj,
    title:
      lang === "en" && categoryObj.title_en
        ? categoryObj.title_en
        : categoryObj.title,
  };
};

/**
 * Format array of products based on language
 * @param {Array} products - Array of product objects
 * @param {String} lang - Language code (vi, en)
 * @returns {Array} - Array of formatted products
 */
const formatProductsArrayByLanguage = (products, lang = "vi") => {
  return products.map((product) => formatProductByLanguage(product, lang));
};

/**
 * Format array of categories based on language
 * @param {Array} categories - Array of category objects
 * @param {String} lang - Language code (vi, en)
 * @returns {Array} - Array of formatted categories
 */
const formatCategoriesArrayByLanguage = (categories, lang = "vi") => {
  return categories.map((category) => formatCategoryByLanguage(category, lang));
};

/**
 * Get language from request (query, header, or default)
 * @param {Object} req - Express request object
 * @returns {String} - Language code
 */
const getLanguage = (req) => {
  return (
    req.query.lang ||
    req.headers["accept-language"]?.split(",")[0]?.split("-")[0] ||
    "vi"
  );
};

module.exports = {
  formatProductByLanguage,
  formatCategoryByLanguage,
  formatProductsArrayByLanguage,
  formatCategoriesArrayByLanguage,
  getLanguage,
};
