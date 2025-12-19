// Authentication
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;

  try {
    const response = await fetch(`${API_BASE_URL}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    const payload = await response.json();
    const token = payload.userToken;
    const user = payload.data || payload;

    if (token && user?.userType === "Admin") {
      authToken = token;
      adminUser = user;
      localStorage.setItem("adminToken", authToken);
      localStorage.setItem("adminUser", JSON.stringify(user));

      document.getElementById("loginModal").classList.remove("active");
      document.getElementById("admin-name").textContent = user.username;

      // Load dashboard
      loadDashboard();
      showNotification("Đăng nhập thành công!");
    } else {
      showNotification("Bạn không có quyền truy cập Admin!", "error");
    }
  } catch (error) {
    console.error("Login error:", error);
    showNotification("Đăng nhập thất bại!", "error");
  }
});

// Logout
function logout() {
  localStorage.removeItem("adminToken");
  localStorage.removeItem("adminUser");
  authToken = "";
  adminUser = null;
  document.getElementById("loginModal").classList.add("active");
  showNotification("Đã đăng xuất!");
}

// Check auth on load
window.addEventListener("DOMContentLoaded", () => {
  if (authToken && adminUser) {
    document.getElementById("loginModal").classList.remove("active");
    document.getElementById("admin-name").textContent = adminUser.username;
    loadDashboard();
  }
});
