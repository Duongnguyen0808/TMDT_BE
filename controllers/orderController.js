const Order = require("../models/Order");

const placeOrder = async (req, res) => {
  const newOrder = new Order({ ...req.body, userId: req.user.id });
  try {
    await newOrder.save();
    res.status(201).json({
      status: true,
      message: "Order placed successfully",
      orderId: newOrder._id,
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: "Failed to place order",
      error: error.message,
    });
  }
};

const getUserOrders = async (req, res) => {
  const userId = req.user.id;
  const { paymentStatus, orderStatus } = req.query;

  let query = { userId };
  if (paymentStatus) query.paymentStatus = paymentStatus;
  if (orderStatus) query.orderStatus = orderStatus;

  try {
    const orders = await Order.find(query).populate({
      path: "orderItems.appliancesId",
      select: "imageUrl title rating time",
    });
    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({
      status: false,
      message: "Failed to retrieve orders",
      error: error.message,
    });
  }
};

module.exports = {
  placeOrder,
  getUserOrders,
};
