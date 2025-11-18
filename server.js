const dotenv = require("dotenv");
// Load environment variables BEFORE requiring modules that use them
dotenv.config();

const express = require("express");
const http = require("http");
const cors = require("cors");
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
const FcmRoute = require("./routes/fcm");
// const PromotionRoute = require("./routes/promotion");
// Test FCM route (added for debugging) after dotenv loaded
const { sendPushNotification, canUseAdmin, getFcmEnvInfo } = require('./utils/notification_service');

const app = express();
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
  cors: { origin: "*" },
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
const port = process.env.PORT || 3000;

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

// Enable CORS for web clients (Flutter web)
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
app.use("/api/fcm", FcmRoute);
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
const CryptoJS = require("crypto-js");

mongoose.connection.once("open", async () => {
  try {
    const adminExists = await User.findOne({ userType: "Admin" });
    if (!adminExists) {
      const defaultAdmin = new User({
        username: "Admin",
        email: "admin@tmdt.com",
        password: CryptoJS.AES.encrypt(
          "admin123",
          process.env.SECRET
        ).toString(),
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

server.listen(port, "0.0.0.0", () => {
  console.log(`Server listening at http://0.0.0.0:${port}`);
  console.log(`Admin Dashboard: http://localhost:${port}/admin\n`);
});

// Promotions feature disabled: routes and scheduler removed
