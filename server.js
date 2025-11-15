const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
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

dotenv.config();

const app = express();
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

app.listen(port, "0.0.0.0", () => {
  console.log(`Server listening at http://0.0.0.0:${port}`);
  console.log(`Admin Dashboard: http://localhost:${port}/admin\n`);
});
