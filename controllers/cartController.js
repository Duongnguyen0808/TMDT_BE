const Cart = require("../models/Cart");
const Appliances = require("../models/Appliances");

module.exports = {
  addProductToCart: async (req, res) => {
    const userId = req.user.id;
    const { productId, additives, totalPrice, quantity } = req.body;

    // Validation
    if (!productId || !totalPrice || !quantity) {
      return res.status(400).json({
        status: false,
        message: "Thiếu thông tin sản phẩm",
      });
    }

    if (quantity <= 0 || totalPrice <= 0) {
      return res.status(400).json({
        status: false,
        message: "Số lượng và giá phải lớn hơn 0",
      });
    }

    if (quantity > 99) {
      return res.status(400).json({
        status: false,
        message: "Số lượng tối đa là 99",
      });
    }

    let count;
    try {
      // Kiểm tra tồn kho trước khi cộng dồn vào giỏ
      const product = await Appliances.findById(productId).select('title stock');
      if (!product) {
        return res.status(404).json({ status: false, message: 'Sản phẩm không tồn tại' });
      }
      const existingProduct = await Cart.findOne({
        userId: userId,
        productId: productId,
      });
      count = await Cart.countDocuments({ userId: userId });
      if (existingProduct) {
        const newQty = existingProduct.quantity + quantity;
        if (typeof product.stock === 'number' && newQty > product.stock) {
          return res.status(400).json({
            status: false,
            message: `Vượt quá tồn kho của "${product.title}" (còn ${product.stock})`,
          });
        }
        existingProduct.totalPrice += totalPrice * quantity;
        existingProduct.quantity = newQty;
        await existingProduct.save();
        return res.status(200).json({
          status: true,
          message: res.__("cart.updated"),
          cartCount: count,
        });
      } else {
        if (typeof product.stock === 'number' && quantity > product.stock) {
          return res.status(400).json({
            status: false,
            message: `Vượt quá tồn kho của "${product.title}" (còn ${product.stock})`,
          });
        }
        const newCartItem = new Cart({
          userId: userId,
          productId: productId,
          additives: additives,
          totalPrice: totalPrice,
          quantity: quantity,
        });
        await newCartItem.save();
        count = await Cart.countDocuments({ userId: userId });
        return res.status(201).json({
          status: true,
          message: "Thêm sản phẩm vào giỏ hàng thành công",
          cartCount: count,
        });
      }
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  removeCartItem: async (req, res) => {
    const userId = req.user.id;
    const cartItemId = req.params.id;
    try {
      await Cart.findOneAndDelete({ _id: cartItemId });
      const count = await Cart.countDocuments({ userId: userId });
      res.status(200).json({
        status: true,
        message: "Xóa sản phẩm khỏi giỏ hàng thành công",
        cartCount: count,
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
  getCart: async (req, res) => {
    const userId = req.user.id;
    try {
      const cart = await Cart.find({ userId: userId }).populate({
        path: "productId",
        select: "imageUrl title price rating ratingCount isAvailable stock",
        populate: { path: "store", select: "_id time coords" },
      });

      res.status(200).json({ cart });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
  getCartCount: async (req, res) => {
    const userId = req.user.id;
    try {
      const count = await Cart.countDocuments({ userId: userId });
      res.status(200).json({ status: true, count: count });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
  decrementProductQty: async (req, res) => {
    const userId = req.user.id;
    const id = req.params.id;
    try {
      const cartItem = await Cart.findById(id);
      if (cartItem) {
        const productPrice = cartItem.totalPrice / cartItem.quantity; // Assuming totalPrice is the total price for the quantity
        if (cartItem.quantity > 1) {
          cartItem.quantity -= 1;
          cartItem.totalPrice -= productPrice; // Assuming productPrice is available in the scope
          await cartItem.save();
          return res.status(200).json({
            status: true,
            message: "Giảm số lượng sản phẩm thành công",
          });
        } else {
          await Cart.findByIdAndDelete({ _id: id });
          return res.status(400).json({
            status: false,
            message: "Xóa sản phẩm khỏi giỏ hàng thành công",
          });
        }
      } else {
        return res.status(400).json({
          status: false,
          message: "Không tìm thấy sản phẩm trong giỏ hàng",
        });
      }
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
};
