const dotenv = require("dotenv");
// Load environment variables BEFORE requiring modules that use them
dotenv.config();

const express = require("express");
const http = require("http");
const https = require("https");
const fs = require("fs");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");
const path = require("path");
const i18n = require("i18n");
const CategoryRoute = require("./routes/category");
const StoreRoute = require("./routes/store");
const AppliancesRoute = require("./routes/appliances");
const RatingRoute = require("./routes/rating");
const AuthRoute = require("./routes/auth");
const UserRoute = require("./routes/user");
const AddressRoute = require("./routes/address");
const CartRoute = require("./routes/cart");
const OrderRoute = require("./routes/order");
const PaymentRoute = require("./routes/payment");
const VoucherRoute = require("./routes/voucher");
const UploadRoute = require("./routes/upload");
const FavoriteRoute = require("./routes/favorite");
const FeedbackRoute = require("./routes/feedback");
const AdminRoute = require("./routes/admin");
const ReservationRoute = require("./routes/reservation");
const ChatRoute = require("./routes/chat");
const DriverRoute = require("./routes/driver");
const ShipperRoute = require("./routes/shipper");
const FcmRoute = require("./routes/fcm");
const HubRoute = require("./routes/hub");
const ShipmentRoute = require("./routes/shipment");
const VendorWalletRoute = require("./routes/vendorWallet");
const ServiceTicketRoute = require("./routes/serviceTicket");
const RecommendationRoute = require("./routes/recommendation");
const AnalyticsRoute = require("./routes/analytics");
const BannerRoute = require("./routes/banner");
const startDeliveryWatchdog = require("./watchdogs/deliveryWatchdog");
const passwordService = require("./utils/passwordService");
// const PromotionRoute = require("./routes/promotion");
// Test FCM route (added for debugging) after dotenv loaded
const { sendPushNotification, canUseAdmin, getFcmEnvInfo } = require('./utils/notification_service');

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
  "http://127.0.0.1:3000",
];

const parseAllowedOrigins = () => {
  const raw = process.env.CORS_ORIGINS;
  if (raw && raw.trim().length) {
    return raw
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  }
  return DEFAULT_ALLOWED_ORIGINS;
};

const buildHttpsOptions = () => {
  if (process.env.HTTPS_ENABLED !== "true") {
    return null;
  }

  const keyPath = process.env.HTTPS_KEY_PATH;
  const certPath = process.env.HTTPS_CERT_PATH;
  if (!keyPath || !certPath) {
    console.warn("[HTTPS] HTTPS_ENABLED but HTTPS_KEY_PATH/HTTPS_CERT_PATH missing");
    return null;
  }

  try {
    const options = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
    if (process.env.HTTPS_PASSPHRASE) {
      options.passphrase = process.env.HTTPS_PASSPHRASE;
    }
    return options;
  } catch (error) {
    console.error(`[HTTPS] Failed to load certificates: ${error.message}`);
    return null;
  }
};

const app = express();
app.enable("trust proxy");

const allowedOrigins = parseAllowedOrigins();
const allowAllOrigins = process.env.CORS_ALLOW_ALL === "true";
console.log(
  `[CORS] Allowed origins: ${allowAllOrigins ? "ALL" : allowedOrigins.join(", ")}`
);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowAllOrigins || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.warn(`[CORS] Blocked origin: ${origin}`);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const rateLimitWindowMinutes = Math.max(
  parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES || "15", 10),
  1
);
const rateLimitWindowMs = rateLimitWindowMinutes * 60 * 1000;
const apiLimiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: parseInt(process.env.RATE_LIMIT_MAX || "400", 10),
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || "40", 10),
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", apiLimiter);
app.use("/payment", apiLimiter);
app.use(
  [
    "/login",
    "/register",
    "/register-admin",
    "/forgot-password",
    "/reset-password",
    "/change-password",
    "/send-phone-otp",
    "/verify-phone-otp",
  ],
  authLimiter
);

const httpsOptions = buildHttpsOptions();
const httpServer = http.createServer(app);
const httpsServer = httpsOptions ? https.createServer(httpsOptions, app) : null;
const primaryServer = httpsServer || httpServer;
const port = parseInt(process.env.PORT || "3000", 10);
const httpsPort = parseInt(process.env.HTTPS_PORT || "3443", 10);

const { Server } = require("socket.io");
const io = new Server(primaryServer, {
  cors: { origin: allowAllOrigins ? "*" : allowedOrigins, credentials: true },
});

// socket auth
const jwt = require("jsonwebtoken");
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next();
    const user = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = user;
    next();
  } catch (e) {
    next();
  }
});

io.on("connection", (socket) => {
  socket.on("join", ({ conversationId }) => {
    if (conversationId) {
      socket.join(`conv:${conversationId}`);
    }
  });
});

// attach io for controllers to emit
app.set("io", io);

// Configure i18n
i18n.configure({
  locales: ["vi", "en"],
  directory: path.join(__dirname, "locales"),
  defaultLocale: "vi",
  queryParameter: "lang",
  autoReload: true,
  updateFiles: false,
  syncFiles: true,
  objectNotation: true,
});

// Kết nối MongoDB
mongoose
  .connect(process.env.MONGO_URL)
  .then(() => console.log("Database Connected"))
  .catch((err) => console.log(" DB connection error:", err));

// Request logging for shipper & upload public endpoints
app.use((req, res, next) => {
  if (req.path.startsWith('/api/shippers') || req.path.startsWith('/api/upload/public/shipper-doc')) {
    const start = Date.now();
    const bodyPreview = (() => {
      try { return JSON.stringify(req.body).slice(0, 500); } catch { return '[unserializable]'; }
    })();
    console.log(`[REQ] ${req.method} ${req.path} ip=${req.ip} body=${bodyPreview}`);
    res.on('finish', () => {
      console.log(`[RES] ${req.method} ${req.path} status=${res.statusCode} dur=${Date.now() - start}ms`);
    });
  }
  next();
});

// Initialize i18n middleware
app.use(i18n.init);

// Serve static files for Admin Dashboard
app.use("/admin", express.static(path.join(__dirname, "public/admin")));

// API Routes
app.use("/", AuthRoute);
app.use("/api/users", UserRoute);
app.use("/api/category", CategoryRoute);
app.use("/api/store", StoreRoute);
app.use("/api/appliances", AppliancesRoute);
app.use("/api/rating", RatingRoute);
app.use("/api/address", AddressRoute);
app.use("/api/cart", CartRoute);
app.use("/api/orders", OrderRoute);
app.use("/api/voucher", VoucherRoute);
app.use("/payment", PaymentRoute);
app.use("/api/upload", UploadRoute);
app.use("/api/favorites", FavoriteRoute);
app.use("/api/feedback", FeedbackRoute);
app.use("/api/admin", AdminRoute);
app.use("/api/reservation", ReservationRoute);
app.use("/api/chat", ChatRoute);
app.use("/api/drivers", DriverRoute);
app.use("/api/shippers", ShipperRoute);
app.use("/api/fcm", FcmRoute);
app.use("/api/hubs", HubRoute);
app.use("/api/shipments", ShipmentRoute);
app.use("/api/vendor-wallet", VendorWalletRoute);
app.use("/api/service-center", ServiceTicketRoute);
app.use("/api/recommendations", RecommendationRoute);
app.use("/api/analytics", AnalyticsRoute);
app.use("/api/banners", BannerRoute);
// app.use("/api/promotions", PromotionRoute);

// Simple FCM test endpoint
app.post('/api/test-fcm', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Missing token' });
    const resp = await sendPushNotification(token, 'Test Notification', 'This is a test push');
    return res.json(resp);
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// FCM diagnostics route
app.get('/api/fcm-status', (req, res) => {
  try {
    const info = getFcmEnvInfo();
    res.json({
      canUseAdmin: canUseAdmin(),
      env: info,
      note: 'SenderId mismatch usually means token belongs to a different Firebase project than these credentials.'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Auto-create default admin if not exists
const User = require("./models/User");

mongoose.connection.once("open", async () => {
  try {
    const adminExists = await User.findOne({ userType: "Admin" });
    if (!adminExists) {
      const hashedPassword = await passwordService.hashPassword("admin123");
      const defaultAdmin = new User({
        username: "Admin",
        email: "admin@tmdt.com",
        password: hashedPassword,
        passwordVersion: 2,
        passwordMigratedAt: new Date(),
        userType: "Admin",
        verification: true,
        phoneVerification: true,
        phone: "0123456789",
        profile:
          "https://ui-avatars.com/api/?name=Admin&background=1e3c72&color=fff",
      });
      await defaultAdmin.save();
      console.log("Đã tạo tài khoản Admin (admin@tmdt.com / admin123)");
    }
  } catch (error) {
    console.error("Lỗi khi tạo admin:", error.message);
  }
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`HTTP server listening at http://0.0.0.0:${port}`);
  console.log(`Admin Dashboard: http://localhost:${port}/admin`);
});

if (httpsServer) {
  httpsServer.listen(httpsPort, "0.0.0.0", () => {
    console.log(`HTTPS server listening at https://0.0.0.0:${httpsPort}`);
    console.log(`Admin Dashboard (secure): https://localhost:${httpsPort}/admin`);
  });
}

startDeliveryWatchdog(io);

// Simple scheduler to auto-advance shipments demo (every 90s try advance Creating/Consolidating only)
const Shipment = require("./models/Shipment");
setInterval(async () => {
  try {
    const pending = await Shipment.find({ status: { $in: ["Creating", "Consolidating"] } }).limit(10);
    for (const sh of pending) {
      const flow = ["Creating", "Consolidating", "DepartOrigin", "ArriveOrigin", "DepartLocal", "ArriveLocal", "ReadyPickup", "Completed"];
      const idx = flow.indexOf(sh.status);
      if (idx >= 0 && idx < flow.length - 1) {
        sh.status = flow[idx + 1];
        const stampKey = `${sh.status}At`;
        if (sh.timeline && stampKey in sh.timeline) sh.timeline[stampKey] = new Date();
        await sh.save();
        try { io.emit("shipment:updated", { shipmentId: String(sh._id), status: sh.status }); } catch (_) { }
      }
    }
  } catch (e) { }
}, 90000);

// Promotions feature disabled: routes and scheduler removed
