const admin = require("firebase-admin");
const https = require('https');
const { GoogleAuth, JWT } = require('google-auth-library');
const User = require('../models/User');

// Multi-project registry { projectId: firebaseAdminApp }
// Cho phép mỗi user gắn với project riêng (driver app, vendor app) nhưng vẫn dùng chung backend
const appRegistry = {};

function initServiceAccount(jsonStr) {
  let parsed;
  try { parsed = JSON.parse(jsonStr); } catch (e) {
    console.error('[FCM][Init] Failed parse JSON service account:', e.message);
    return null;
  }
  if (!parsed.project_id || !parsed.private_key || !parsed.client_email) {
    console.error('[FCM][Init] Missing keys in service account JSON');
    return null;
  }
  if (parsed.private_key.includes('\\n')) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  const pid = parsed.project_id;
  if (appRegistry[pid]) return appRegistry[pid];
  try {
    const app = admin.initializeApp({ credential: admin.credential.cert(parsed) }, pid);
    appRegistry[pid] = app;
    console.log(`[FCM] Initialized project ${pid}`);
    return app;
  } catch (e) {
    console.error(`[FCM] Failed initialize project ${pid}:`, e.message);
    return null;
  }
}

// Lazy init Firebase Admin SDK (avoid multiple initializations in watch mode)
let CAN_USE_ADMIN = false; // true if at least one app initialized
if (!admin.apps || admin.apps.length === 0) {
  try {
    const rawLen = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ? process.env.FIREBASE_SERVICE_ACCOUNT_JSON.length : 0;
    console.log(`[FCM][Init] Starting initialization. JSON length=${rawLen}, base64=${!!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64}, discrete=${!!process.env.FIREBASE_PROJECT_ID}`);
    // Preferred: provide full service account JSON in env FIREBASE_SERVICE_ACCOUNT_JSON
    const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const svcBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    const envProjectId = process.env.FIREBASE_PROJECT_ID;
    const envClientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const envPrivateKeyRaw = process.env.FIREBASE_PRIVATE_KEY; // may contain \n
    if (svcJson) {
      const app = initServiceAccount(svcJson);
      CAN_USE_ADMIN = CAN_USE_ADMIN || !!app;
    } else if (svcBase64) {
      const decoded = Buffer.from(svcBase64, 'base64').toString('utf8');
      const app = initServiceAccount(decoded);
      CAN_USE_ADMIN = CAN_USE_ADMIN || !!app;
    } else if (envProjectId && envClientEmail && envPrivateKeyRaw) {
      // Initialize from discrete env vars (projectId, clientEmail, privateKey)
      const privateKey = envPrivateKeyRaw.replace(/\\n/g, '\n');
      const jsonStr = JSON.stringify({
        project_id: envProjectId,
        client_email: envClientEmail,
        private_key: privateKey,
      });
      const app = initServiceAccount(jsonStr);
      CAN_USE_ADMIN = CAN_USE_ADMIN || !!app;
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      // Fallback: GOOGLE_APPLICATION_CREDENTIALS points to a JSON file path
      const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      const svc = require(path);
      const app = initServiceAccount(JSON.stringify(svc));
      CAN_USE_ADMIN = CAN_USE_ADMIN || !!app;
    } else {
      // Last resort: try application default credentials (if set up on host)
      admin.initializeApp();
      console.warn(
        "[FCM] Initialized without explicit service account. Ensure environment ADC is configured."
      );
      // Do NOT set CAN_USE_ADMIN true here; ADC may fail locally
    }

    // Secondary project support (env variable for another JSON): FIREBASE_SERVICE_ACCOUNT_JSON_ALT
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON_ALT) {
      console.log('[FCM][Init] Attempting alternate project init...');
      const altApp = initServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_ALT);
      CAN_USE_ADMIN = CAN_USE_ADMIN || !!altApp;
    }
  } catch (e) {
    console.error("[FCM] Initialization error:", e.message);
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      console.error('[FCM] FIREBASE_SERVICE_ACCOUNT_JSON begins with:', process.env.FIREBASE_SERVICE_ACCOUNT_JSON.substring(0, 60));
    }
  }
}

// Legacy FCM HTTP fallback using server key
const FIREBASE_SERVER_KEY = process.env.FIREBASE_SERVER_KEY;
const canUseLegacy = !!FIREBASE_SERVER_KEY;

// HTTP v1 support using service account (preferred over legacy)
function getServiceAccountFromEnv() {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      if (parsed.project_id && parsed.client_email && parsed.private_key) return parsed;
    }
  } catch (_) { }
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return {
      project_id: process.env.FIREBASE_PROJECT_ID,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY.includes('\\n') ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : process.env.FIREBASE_PRIVATE_KEY,
    };
  }
  try {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const svc = require(process.env.GOOGLE_APPLICATION_CREDENTIALS);
      if (svc.project_id && svc.client_email && svc.private_key) return svc;
    }
  } catch (_) { }
  return null;
}

async function sendViaHttpV1(message, preferProjectId) {
  const svc = getServiceAccountFromEnv();
  if (!svc) throw new Error('HTTP v1 requires service account credentials in env');
  const projectId = preferProjectId || svc.project_id;
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  // Use a JWT client with the service account to obtain access tokens
  const client = new JWT({
    email: svc.client_email,
    key: svc.private_key,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });
  const token = await client.authorize();
  const payload = { message };
  const data = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token.access_token}`,
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); } catch (_) { resolve({ statusCode: res.statusCode, body }); }
        } else {
          reject(new Error(`FCM HTTP v1 error ${res.statusCode}: ${body}`));
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.write(data);
    req.end();
  });
}

const sendViaLegacy = (payload) => new Promise((resolve, reject) => {
  if (!FIREBASE_SERVER_KEY) {
    return reject(new Error('Missing FIREBASE_SERVER_KEY for legacy FCM fallback'));
  }
  const data = JSON.stringify(payload);
  const options = {
    hostname: 'fcm.googleapis.com',
    path: '/fcm/send',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `key=${FIREBASE_SERVER_KEY}`,
      'Content-Length': Buffer.byteLength(data),
    },
  };
  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => (body += chunk));
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed);
        } catch (_) {
          resolve({ statusCode: res.statusCode, body });
        }
      } else {
        reject(new Error(`FCM legacy error ${res.statusCode}: ${body}`));
      }
    });
  });
  req.on('error', (err) => reject(err));
  req.write(data);
  req.end();
});

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

    if (CAN_USE_ADMIN) {
      // Ưu tiên gửi bằng Firebase Admin với project tương ứng token để tránh lỗi SenderId mismatch
      // Determine project by looking up user
      let projectIdForToken = null;
      try {
        const user = await User.findOne({ fcm: fcmToken }).select('fcmProject');
        if (user && user.fcmProject) projectIdForToken = user.fcmProject;
      } catch (_) { }
      // Choose app: prefer matching projectId, else first registered app
      let chosenApp = null;
      if (projectIdForToken && appRegistry[projectIdForToken]) {
        chosenApp = appRegistry[projectIdForToken];
      } else {
        const keys = Object.keys(appRegistry);
        if (keys.length) chosenApp = appRegistry[keys[0]];
      }
      if (!chosenApp) {
        return { success: false, message: 'No Firebase app available for sending' };
      }
      const message = { notification: { title, body }, data, token: fcmToken };
      let response;
      try {
        response = await chosenApp.messaging().send(message);
        console.log(`✅ Push notification sent via project ${chosenApp.name}:`, response);
        return { success: true, project: chosenApp.name, messageId: response };
      } catch (e) {
        if (e.code === 'messaging/mismatched-credential') {
          console.warn('[FCM] SenderId mismatch – attempting legacy fallback if configured');
          // Try legacy fallback if available
          if (canUseLegacy) {
            try {
              const legacyPayload = { to: fcmToken, notification: { title, body }, data, priority: 'high' };
              const legacyResp = await sendViaLegacy(legacyPayload);
              return {
                success: true,
                legacy: true,
                warning: 'Used legacy fallback due to mismatched-credential',
                response: legacyResp,
              };
            } catch (legacyErr) {
              console.error('[FCM] Legacy fallback failed after mismatched-credential:', legacyErr.message);
            }
          }
          // Provide detailed guidance for caller
          return {
            success: false,
            code: e.code,
            message: 'SenderId mismatch: FCM token belongs to different Firebase project.',
            help: {
              cause: 'Token was generated from a client app whose google-services.json / firebase_options.dart projectId differs from the service account projectId used here.',
              fix: [
                'Ensure service account JSON matches client app project (check project_id).',
                'Confirm google-services.json (Android) & GoogleService-Info.plist (iOS) are for SAME project.',
                'If using multiple Firebase projects, store fcmProject (projectId) with each user when saving their token.',
                'Regenerate the FCM token after fixing credentials (uninstall/reinstall app or call deleteToken()).',
              ],
            },
          };
        }
        throw e; // rethrow for outer catch
      }
    }

    // Prefer HTTP v1 over legacy if we have service account
    try {
      const httpV1Message = { token: fcmToken, notification: { title, body }, data };
      const httpResp = await sendViaHttpV1(httpV1Message);
      console.log('✅ Push notification (HTTP v1) sent:', httpResp);
      return { success: true, httpV1: true, response: httpResp };
    } catch (e) {
      console.warn('[FCM] HTTP v1 fallback failed:', e.message);
    }

    if (canUseLegacy) {
      const legacyPayload = {
        to: fcmToken,
        notification: { title, body },
        data,
        priority: 'high',
      };
      const resp = await sendViaLegacy(legacyPayload);
      console.log("✅ Push notification (legacy) đã gửi thành công:", resp);
      return { success: true, legacy: true, response: resp };
    }

    throw new Error(
      "FCM not configured. Set FIREBASE_SERVICE_ACCOUNT_* or FIREBASE_SERVER_KEY in .env (debug: CAN_USE_ADMIN=false, FIREBASE_SERVER_KEY missing)"
    );
  } catch (error) {
    console.error("❌ Lỗi gửi push notification:", error.message, 'code:', error.code || 'none');
    if (error.code === 'messaging/mismatched-credential') {
      return {
        success: false,
        code: error.code,
        message: 'SenderId mismatch: token project != server credentials project',
        help: {
          verifyServiceAccount: 'Check FIREBASE_SERVICE_ACCOUNT_JSON project_id matches client app.',
          verifyClientConfig: 'Compare google-services.json (project_number/sender_id & project_id) with service account.',
          multiProjectNote: 'If supporting multi-project, persist and use correct projectId per user (see user.fcmProject).',
        },
      };
    }
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

    if (CAN_USE_ADMIN) {
      // Group tokens by project from user records
      const users = await User.find({ fcm: { $in: validTokens } }).select('fcm fcmProject');
      const projectBuckets = {};
      users.forEach(u => {
        const pid = u.fcmProject || '__default';
        if (!projectBuckets[pid]) projectBuckets[pid] = [];
        projectBuckets[pid].push(u.fcm);
      });
      let totalSuccess = 0;
      let totalFailure = 0;
      for (const [pid, tokens] of Object.entries(projectBuckets)) {
        let app = pid !== '__default' ? appRegistry[pid] : null;
        if (!app) {
          // fallback first app
          const first = Object.keys(appRegistry)[0];
          app = appRegistry[first];
        }
        if (!app) continue;
        const message = { notification: { title, body }, data, tokens };
        const response = await app.messaging().sendMulticast(message);
        console.log(`✅ Project ${app.name} sent ${response.successCount}/${tokens.length}`);
        totalSuccess += response.successCount;
        totalFailure += response.failureCount;
      }

      // Dọn dẹp token lỗi
      try {
        const invalidIndexes = [];
        response.responses.forEach((r, idx) => {
          if (!r.success && r.error && r.error.code) {
            const code = r.error.code;
            if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
              invalidIndexes.push(idx);
            }
          }
        });
        if (invalidIndexes.length) {
          const toInvalidate = invalidIndexes.map(i => validTokens[i]);
          console.log(`[FCM] Cleaning up ${toInvalidate.length} invalid tokens`);
          await User.updateMany({ fcm: { $in: toInvalidate } }, { $set: { fcm: 'none' } });
        }
      } catch (e) {
        console.warn('[FCM] Token cleanup error:', e.message);
      }

      return {
        success: true,
        successCount: totalSuccess,
        failureCount: totalFailure,
      };
    }

    // Try HTTP v1 first for multicast by iterating tokens (no batch API)
    try {
      let successCount = 0;
      let failureCount = 0;
      for (const t of validTokens) {
        try {
          const msg = { token: t, notification: { title, body }, data };
          await sendViaHttpV1(msg);
          successCount += 1;
        } catch (_) {
          failureCount += 1;
        }
      }
      console.log(`✅ (HTTP v1) Đã gửi ${successCount}/${validTokens.length} notifications`);
      return { success: true, httpV1: true, successCount, failureCount };
    } catch (e) {
      console.warn('[FCM] HTTP v1 multicast fallback failed:', e.message);
    }

    if (canUseLegacy) {
      // Legacy does not support true multicast; send as a single 'registration_ids'
      const legacyPayload = {
        registration_ids: validTokens,
        notification: { title, body },
        data,
        priority: 'high',
      };
      const resp = await sendViaLegacy(legacyPayload);
      const successCount = Array.isArray(resp?.results) ? resp.results.filter(r => r && r.message_id).length : 0;
      const failureCount = Array.isArray(resp?.results) ? resp.results.length - successCount : 0;
      console.log(`✅ (legacy) Đã gửi ${successCount}/${validTokens.length} notifications`);
      return { success: true, legacy: true, successCount, failureCount };
    }

    throw new Error(
      "FCM not configured. Set FIREBASE_SERVICE_ACCOUNT_* or FIREBASE_SERVER_KEY in .env (debug: CAN_USE_ADMIN=false, FIREBASE_SERVER_KEY missing)"
    );
  } catch (error) {
    console.error("❌ Lỗi gửi multicast notification:", error.message, 'code:', error.code || 'none');
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

/**
 * Gửi notification theo topic (ví dụ: promotions hoặc global announcements)
 * Client phải subscribe: firebaseMessaging.subscribeToTopic('promotions')
 */
const sendTopicNotification = async (topic, title, body, data = {}) => {
  try {
    if (!topic) return { success: false, message: "Missing topic" };
    if (CAN_USE_ADMIN) {
      const message = { notification: { title, body }, data, topic };
      const response = await admin.messaging().send(message);
      console.log(`✅ Topic notification sent to '${topic}' =>`, response);
      return { success: true, messageId: response };
    }
    if (canUseLegacy) {
      const legacyPayload = {
        to: `/topics/${topic}`,
        notification: { title, body },
        data,
        priority: 'high',
      };
      const resp = await sendViaLegacy(legacyPayload);
      console.log(`✅ (legacy) Topic notification sent to '${topic}' =>`, resp);
      return { success: true, legacy: true, response: resp };
    }
    throw new Error(
      "FCM not configured. Set FIREBASE_SERVICE_ACCOUNT_* or FIREBASE_SERVER_KEY in .env (debug: CAN_USE_ADMIN=false, FIREBASE_SERVER_KEY missing)"
    );
  } catch (error) {
    console.error("❌ Lỗi gửi topic notification:", error.message, 'code:', error.code || 'none');
    return { success: false, message: error.message };
  }
};

/**
 * Helper: validate token format quickly (can extend for regex)
 */
const isValidFcmToken = (token) => !!token && token !== "none" && token.length > 20;
const orderCode = (orderId) => `#${String(orderId).slice(-6)}`;

const sendVendorNewOrderNotification = async (fcmToken, orderId, storeTitle = "", amount = 0) => {
  if (!isValidFcmToken(fcmToken)) return { success: false, message: "Invalid token" };
  const total = Number(amount) || 0;
  const body = `Khách vừa đặt ${orderCode(orderId)} cho ${storeTitle || "cửa hàng của bạn"} (${total.toLocaleString("vi-VN")}đ).`;
  return sendPushNotification(fcmToken, "🛎️ Có đơn mới", body, {
    type: "vendor_order_new",
    orderId: String(orderId),
    storeTitle,
    amount: String(total),
  });
};

const sendVendorDriverClaimedNotification = async (fcmToken, orderId, driverName = "") => {
  if (!isValidFcmToken(fcmToken)) return { success: false, message: "Invalid token" };
  const body = `${driverName || "Một tài xế"} đã nhận đơn ${orderCode(orderId)} và đang di chuyển tới shop.`;
  return sendPushNotification(fcmToken, "🚚 Shipper đã nhận đơn", body, {
    type: "vendor_driver_claimed",
    orderId: String(orderId),
    driverName,
  });
};

const sendDriverAssignedNotification = async (fcmToken, orderId, storeTitle = "") => {
  if (!isValidFcmToken(fcmToken)) return { success: false, message: "Invalid token" };
  const body = `Bạn vừa được gán ${orderCode(orderId)} từ ${storeTitle || "một cửa hàng"}. Kiểm tra mục Đơn của tôi.`;
  return sendPushNotification(fcmToken, "📦 Có đơn mới", body, {
    type: "driver_assigned",
    orderId: String(orderId),
    storeTitle,
  });
};

const sendDriverPickupReadyNotification = async (fcmToken, orderId, storeTitle = "", pickupCode = "", expiresAt = null) => {
  if (!isValidFcmToken(fcmToken)) return { success: false, message: "Invalid token" };
  const body = `${storeTitle || "Shop"} báo đơn ${orderCode(orderId)} đã sẵn sàng${pickupCode ? `, mã: ${pickupCode}` : ""}.`;
  return sendPushNotification(fcmToken, "🏁 Hàng đã sẵn sàng", body, {
    type: "driver_pickup_ready",
    orderId: String(orderId),
    pickupCode: pickupCode || "",
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : "",
  });
};

const sendDriverOrderCancelledNotification = async (fcmToken, orderId, reason = "") => {
  if (!isValidFcmToken(fcmToken)) return { success: false, message: "Invalid token" };
  const body = `Đơn ${orderCode(orderId)} đã bị hủy${reason ? `: ${reason}` : ""}.`;
  return sendPushNotification(fcmToken, "❌ Đơn đã hủy", body, {
    type: "driver_order_cancelled",
    orderId: String(orderId),
    reason,
  });
};

const sendDriverDisputeResolutionNotification = async (fcmToken, orderId, resolutionNote = "") => {
  if (!isValidFcmToken(fcmToken)) return { success: false, message: "Invalid token" };
  const body = `Khiếu nại đơn ${orderCode(orderId)} đã có kết quả: ${resolutionNote || "Shop đã cập nhật"}.`;
  return sendPushNotification(fcmToken, "✅ Cập nhật khiếu nại", body, {
    type: "driver_dispute_resolution",
    orderId: String(orderId),
    note: resolutionNote,
  });
};

const sendDriverUnassignedNotification = async (fcmToken, orderId, storeTitle = "") => {
  if (!isValidFcmToken(fcmToken)) return { success: false, message: "Invalid token" };
  const body = `Bạn không còn phụ trách ${orderCode(orderId)} từ ${storeTitle || "shop này"}.`;
  return sendPushNotification(fcmToken, "ℹ️ Đơn đã chuyển", body, {
    type: "driver_unassigned",
    orderId: String(orderId),
    storeTitle,
  });
};

module.exports = {
  sendPushNotification,
  sendMulticastNotification,
  sendOrderStatusNotification,
  sendPaymentSuccessNotification,
  sendTopicNotification,
  isValidFcmToken,
  sendVendorNewOrderNotification,
  sendVendorDriverClaimedNotification,
  sendDriverAssignedNotification,
  sendDriverPickupReadyNotification,
  sendDriverOrderCancelledNotification,
  sendDriverDisputeResolutionNotification,
  sendDriverUnassignedNotification,
};

// Các helper bổ sung cho vòng đời đơn hàng & trả hàng
/** Gửi khi đơn hàng mới được tạo */
const sendOrderPlacedNotification = async (fcmToken, orderId, amount) => {
  if (!isValidFcmToken(fcmToken)) return { success: false, message: 'Invalid token' };
  const title = '🛒 Đặt hàng thành công';
  const body = `Đơn hàng #${orderId} đã được tạo. Tổng: ${amount.toLocaleString('vi-VN')}đ`;
  return sendPushNotification(fcmToken, title, body, {
    type: 'order_created',
    orderId: String(orderId),
    amount: String(amount),
  });
};

/** Gửi khi người dùng gửi yêu cầu trả hàng */
const sendReturnRequestedNotification = async (fcmToken, orderId, reason) => {
  if (!isValidFcmToken(fcmToken)) return { success: false, message: 'Invalid token' };
  const title = '↩️ Yêu cầu trả hàng';
  const body = `Bạn đã gửi yêu cầu trả hàng cho đơn #${orderId}` + (reason ? `: ${reason}` : '');
  return sendPushNotification(fcmToken, title, body, {
    type: 'return_requested',
    orderId: String(orderId),
    reason: reason || '',
  });
};

/** Gửi khi yêu cầu trả hàng được duyệt hoặc bị từ chối */
const sendReturnDecisionNotification = async (fcmToken, orderId, decision) => {
  if (!isValidFcmToken(fcmToken)) return { success: false, message: 'Invalid token' };
  const statusText = decision === 'approve' ? 'đã được chấp nhận' : 'đã bị từ chối';
  const title = '📤 Kết quả trả hàng';
  const body = `Yêu cầu trả hàng cho đơn #${orderId} ${statusText}`;
  return sendPushNotification(fcmToken, title, body, {
    type: 'return_decision',
    orderId: String(orderId),
    decision,
  });
};

/** Gửi khi hoàn tiền thành công */
const sendRefundProcessedNotification = async (fcmToken, orderId, amount) => {
  if (!isValidFcmToken(fcmToken)) return { success: false, message: 'Invalid token' };
  const title = '💰 Hoàn tiền';
  const body = `Hoàn tiền ${amount.toLocaleString('vi-VN')}đ cho đơn #${orderId}`;
  return sendPushNotification(fcmToken, title, body, {
    type: 'refund_processed',
    orderId: String(orderId),
    amount: String(amount),
  });
};

module.exports.sendOrderPlacedNotification = sendOrderPlacedNotification;
module.exports.sendReturnRequestedNotification = sendReturnRequestedNotification;
module.exports.sendReturnDecisionNotification = sendReturnDecisionNotification;
module.exports.sendRefundProcessedNotification = sendRefundProcessedNotification;
module.exports.sendVendorNewOrderNotification = sendVendorNewOrderNotification;
module.exports.sendVendorDriverClaimedNotification = sendVendorDriverClaimedNotification;
module.exports.sendDriverAssignedNotification = sendDriverAssignedNotification;
module.exports.sendDriverPickupReadyNotification = sendDriverPickupReadyNotification;
module.exports.sendDriverOrderCancelledNotification = sendDriverOrderCancelledNotification;
module.exports.sendDriverDisputeResolutionNotification = sendDriverDisputeResolutionNotification;
module.exports.sendDriverUnassignedNotification = sendDriverUnassignedNotification;

/**
 * Gửi khuyến mãi mạnh mẽ: nếu targetType = 'topic' dùng topic, nếu 'all' lấy toàn bộ token.
 * Có thể mở rộng phân khúc sau này (store/category/segment) bằng filter query User.
 */
const sendPromotionBlast = async (promotion) => {
  try {
    if (promotion.targetType === 'topic' && promotion.targetValue) {
      const resp = await sendTopicNotification(promotion.targetValue, promotion.title, promotion.body, {
        type: 'promotion',
        promotionId: String(promotion._id),
        deepLink: promotion.deepLink || '',
        imageUrl: promotion.imageUrl || '',
        ...promotion.data,
      });
      return { mode: 'topic', response: resp, successCount: resp.success ? 1 : 0, failureCount: resp.success ? 0 : 1 };
    }
    // segmentation filters
    const query = {};
    if (Array.isArray(promotion.userTypes) && promotion.userTypes.length) {
      query.userType = { $in: promotion.userTypes };
    }
    // categories filter placeholder (requires purchase history join in real system)
    const users = await User.find(query).select('fcm');
    const tokens = users.map(u => u.fcm).filter(t => isValidFcmToken(t));
    if (!tokens.length) return { mode: 'multicast', response: { success: false, message: 'No tokens' } };
    const multicast = await sendMulticastNotification(tokens, promotion.title, promotion.body, {
      type: 'promotion',
      promotionId: String(promotion._id),
      deepLink: promotion.deepLink || '',
      imageUrl: promotion.imageUrl || '',
      ...promotion.data,
    });
    return { mode: 'multicast', response: multicast, successCount: multicast.successCount || 0, failureCount: multicast.failureCount || 0 };
  } catch (e) {
    return { mode: 'error', error: e.message, successCount: 0, failureCount: 0 };
  }
};

module.exports.sendPromotionBlast = sendPromotionBlast;

// Export diagnostic helpers
module.exports.canUseAdmin = () => CAN_USE_ADMIN;
module.exports.getFcmEnvInfo = () => {
  const primaryId = (function () {
    try { if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) { return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON).project_id; } } catch (_) { }
    return process.env.FIREBASE_PROJECT_ID || null;
  })();
  const altId = (function () {
    try { if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON_ALT) { return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_ALT).project_id; } } catch (_) { }
    return null;
  })();
  return {
    initializedProjects: Object.keys(appRegistry),
    primaryProjectId: primaryId,
    altProjectId: altId,
    hasJson: !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    // Typo fixed: FIREBASE_SERVICE_ACCOUNT_JSON_ALT
    hasAltJson: !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON_ALT,
    hasLegacyServerKey: !!process.env.FIREBASE_SERVER_KEY,
    httpV1Available: !!getServiceAccountFromEnv(),
  };
};
