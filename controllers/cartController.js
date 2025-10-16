const Cart = require("../models/Cart");

module.exports = {
  addProductToCart: async (req, res) => {
    const userId = req.user.id;
    const { productId, additives, totalPrice, quantity } = req.body;

    let count;
    try {
      const existingProduct = await Cart.findOne({
        userId: userId,
        productId: productId,
      });
      count = await Cart.countDocuments({ userId: userId });
      if (existingProduct) {
        existingProduct.totalPrice += totalPrice * quantity;
        existingProduct.quantity += quantity;
        await existingProduct.save();
        return res.status(200).json({
          status: true,
          message: "Product quantity updated in cart.",
          cartCount: count,
        });
      } else {
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
          message: "Product added to cart.",
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
        message: "Product removed from cart.",
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
        select: "imageUrl title price rating ratingCount isAvailable",
        populate: { path: "store", select: "time coords" },
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
          return res
            .status(200)
            .json({ status: true, message: "Product quantity decremented." });
        } else {
          await Cart.findByIdAndDelete({ _id: id });
          return res.status(400).json({
            status: false,
            message: "Product successfully removed from cart.",
          });
        }
      } else {
        return res
          .status(400)
          .json({ status: false, message: "Cart item not found." });
      }
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
};
