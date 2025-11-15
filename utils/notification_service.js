const admin = require("firebase-admin");

/**
 * Gửi push notification qua Firebase Cloud Messaging
 * @param {string} fcmToken - FCM token của user
 * @param {string} title - Tiêu đề notification
 * @param {string} body - Nội dung notification
 * @param {Object} data - Dữ liệu bổ sung (optional)
 * @returns {Promise<Object>}
 */
const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  try {
    if (!fcmToken || fcmToken === "none") {
      // Silent return - không log cảnh báo
      return { success: false, message: "Invalid FCM token" };
    }

    const message = {
      notification: {
        title: title,
        body: body,
      },
      data: data,
      token: fcmToken,
    };

    const response = await admin.messaging().send(message);
    console.log("✅ Push notification đã gửi thành công:", response);

    return { success: true, messageId: response };
  } catch (error) {
    console.error("❌ Lỗi gửi push notification:", error.message);
    return { success: false, message: error.message };
  }
};

/**
 * Gửi notification cho nhiều users
 * @param {Array<string>} fcmTokens - Danh sách FCM tokens
 * @param {string} title - Tiêu đề
 * @param {string} body - Nội dung
 * @param {Object} data - Dữ liệu bổ sung
 * @returns {Promise<Object>}
 */
const sendMulticastNotification = async (fcmTokens, title, body, data = {}) => {
  try {
    // Lọc tokens hợp lệ
    const validTokens = fcmTokens.filter((token) => token && token !== "none");

    if (validTokens.length === 0) {
      // Silent return - không log cảnh báo
      return { success: false, message: "No valid FCM tokens" };
    }

    const message = {
      notification: {
        title: title,
        body: body,
      },
      data: data,
      tokens: validTokens,
    };

    const response = await admin.messaging().sendMulticast(message);
    console.log(
      `✅ Đã gửi ${response.successCount}/${validTokens.length} notifications`
    );

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
    };
  } catch (error) {
    console.error("❌ Lỗi gửi multicast notification:", error.message);
    return { success: false, message: error.message };
  }
};

/**
 * Gửi notification khi đơn hàng thay đổi trạng thái
 * @param {string} fcmToken - FCM token của user
 * @param {string} orderStatus - Trạng thái đơn hàng
 * @param {string} orderId - ID đơn hàng
 */
const sendOrderStatusNotification = async (fcmToken, orderStatus, orderId) => {
  const statusMessages = {
    Pending: "Đơn hàng của bạn đang chờ xác nhận",
    Preparing: "Đơn hàng của bạn đang được chuẩn bị",
    Delivered: "Đơn hàng của bạn đã được giao thành công",
    Cancelled: "Đơn hàng của bạn đã bị hủy",
  };

  const title = "📦 Cập nhật đơn hàng";
  const body =
    statusMessages[orderStatus] || "Đơn hàng của bạn đã được cập nhật";

  return await sendPushNotification(fcmToken, title, body, {
    type: "order_update",
    orderId: orderId,
    orderStatus: orderStatus,
  });
};

/**
 * Gửi notification khi thanh toán thành công
 */
const sendPaymentSuccessNotification = async (fcmToken, orderId, amount) => {
  const title = "💳 Thanh toán thành công";
  const body = `Thanh toán ${amount.toLocaleString(
    "vi-VN"
  )}đ cho đơn hàng #${orderId}`;

  return await sendPushNotification(fcmToken, title, body, {
    type: "payment_success",
    orderId: orderId,
    amount: amount.toString(),
  });
};

module.exports = {
  sendPushNotification,
  sendMulticastNotification,
  sendOrderStatusNotification,
  sendPaymentSuccessNotification,
};
