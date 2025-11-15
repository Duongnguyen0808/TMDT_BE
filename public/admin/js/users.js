// Users Management
let currentUsersPage = 1;
const usersPerPage = 20;

async function loadUsers(page = 1) {
  const userType = document.getElementById("user-type-filter").value;
  const search = document.getElementById("user-search").value;

  try {
    let url = `/api/admin/users?page=${page}&limit=${usersPerPage}`;
    if (userType) url += `&userType=${userType}`;

    const data = await apiCall(url);

    if (data && data.status) {
      renderUsersTable(data.data);
      renderUsersPagination(data.pagination);
    }
  } catch (error) {
    console.error("Error loading users:", error);
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById("users-tbody");

  const html = users
    .map((user) => {
      // Determine badge class based on user type
      let userTypeBadge = "badge-client";
      let userTypeLabel = user.userType;

      if (user.userType === "Admin") {
        userTypeBadge = "badge-admin";
        userTypeLabel = "Quản trị viên";
      } else if (user.userType === "Vendor") {
        userTypeBadge = "badge-vendor";
        userTypeLabel = "Nhà cung cấp";
      } else if (user.userType === "Client") {
        userTypeLabel = "Khách hàng";
      } else if (user.userType === "Driver") {
        userTypeBadge = "badge-driver";
        userTypeLabel = "Tài xế";
      }

      return `
        <tr>
            <td><img src="${user.profile}" alt="${
        user.username
      }" class="user-avatar"></td>
            <td>${user.username}</td>
            <td>${user.email}</td>
            <td>${user.phone || "N/A"}</td>
            <td><span class="badge ${userTypeBadge}">${userTypeLabel}</span></td>
            <td>
                ${
                  user.verification
                    ? '<span class="badge badge-success">✓ Email</span>'
                    : '<span class="badge badge-warning">✗ Email</span>'
                }
                ${
                  user.phoneVerification
                    ? '<span class="badge badge-success">✓ Phone</span>'
                    : ""
                }
            </td>
            <td>${formatDate(user.createdAt)}</td>
            <td>
                <button class="btn btn-primary btn-sm" onclick="viewUser('${
                  user._id
                }')">Xem</button>
                <button class="btn btn-danger btn-sm" onclick="deleteUser('${
                  user._id
                }')">Xóa</button>
            </td>
        </tr>
      `;
    })
    .join("");

  tbody.innerHTML = html;
}

function renderUsersPagination(pagination) {
  const container = document.getElementById("users-pagination");
  const { page, totalPages } = pagination;

  let html = "";

  if (page > 1) {
    html += `<button onclick="loadUsers(${page - 1})">‹ Trước</button>`;
  }

  for (let i = 1; i <= totalPages; i++) {
    if (i === page) {
      html += `<button class="active">${i}</button>`;
    } else {
      html += `<button onclick="loadUsers(${i})">${i}</button>`;
    }
  }

  if (page < totalPages) {
    html += `<button onclick="loadUsers(${page + 1})">Sau ›</button>`;
  }

  container.innerHTML = html;
}

async function viewUser(userId) {
  try {
    const data = await apiCall(`/api/admin/users/${userId}`);

    if (data && data.status) {
      displayUserDetails(data.data);
    }
  } catch (error) {
    console.error("Error loading user details:", error);
    showNotification("Không thể tải thông tin người dùng!", "error");
  }
}

function displayUserDetails(userData) {
  const { user, orderStats, storeInfo } = userData;
  const modal = document.getElementById("userDetailModal");
  const content = document.getElementById("user-detail-content");

  // Determine user type badge class and Vietnamese label
  let userTypeBadge = "badge-client";
  let userTypeLabel = user.userType;
  if (user.userType === "Admin") {
    userTypeBadge = "badge-admin";
    userTypeLabel = "Quản trị viên";
  } else if (user.userType === "Vendor") {
    userTypeBadge = "badge-vendor";
    userTypeLabel = "Nhà cung cấp";
  } else if (user.userType === "Client") {
    userTypeLabel = "Khách hàng";
  } else if (user.userType === "Driver") {
    userTypeBadge = "badge-driver";
    userTypeLabel = "Tài xế";
  }

  let html = `
    <div class="detail-section">
      <div style="text-align: center; margin-bottom: 25px;">
        <img src="${user.profile}" alt="${user.username}" 
             style="width: 140px; height: 140px; border-radius: 50%; object-fit: cover; border: 4px solid ${
               user.userType === "Admin"
                 ? "#dc3545"
                 : user.userType === "Vendor"
                 ? "#0891b2"
                 : "#6c757d"
             }; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
        <h3 style="margin-top: 15px; color: #333;">${user.username}</h3>
        <span class="badge ${userTypeBadge}" style="font-size: 14px; padding: 6px 16px;">${userTypeLabel}</span>
      </div>
      
      <div class="detail-grid">
        <div class="detail-item">
          <strong>📧 Email</strong>
          <span>${user.email}</span>
        </div>
        <div class="detail-item">
          <strong>📱 Số điện thoại</strong>
          <span>${user.phone || "Chưa có"}</span>
        </div>
        <div class="detail-item">
          <strong>✉️ Xác minh Email</strong>
          <span>${
            user.verification
              ? '<span class="badge badge-success">✓ Đã xác minh</span>'
              : '<span class="badge badge-warning">✗ Chưa xác minh</span>'
          }</span>
        </div>
        <div class="detail-item">
          <strong>📞 Xác minh SĐT</strong>
          <span>${
            user.phoneVerification
              ? '<span class="badge badge-success">✓ Đã xác minh</span>'
              : '<span class="badge badge-warning">✗ Chưa xác minh</span>'
          }</span>
        </div>
        <div class="detail-item">
          <strong>📍 Địa chỉ</strong>
          <span>${user.address || "Chưa có"}</span>
        </div>
        <div class="detail-item">
          <strong>📅 Ngày tạo</strong>
          <span>${formatDate(user.createdAt)}</span>
        </div>
      </div>
    </div>
  `;

  // Thống kê đơn hàng cho Client
  if (orderStats) {
    html += `
      <div class="detail-section">
        <h3 style="color: #1e3c72; border-bottom: 2px solid #1e3c72; padding-bottom: 12px; margin-bottom: 20px; font-size: 18px;">📊 Thống Kê Đơn Hàng</h3>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 12px; text-align: center; color: white; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);">
            <div style="font-size: 32px; font-weight: bold;">${
              orderStats.totalOrders
            }</div>
            <div style="margin-top: 8px; opacity: 0.9;">Tổng đơn hàng</div>
          </div>
          <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 20px; border-radius: 12px; text-align: center; color: white; box-shadow: 0 4px 12px rgba(245, 87, 108, 0.3);">
            <div style="font-size: 32px; font-weight: bold;">${
              orderStats.completedOrders
            }</div>
            <div style="margin-top: 8px; opacity: 0.9;">Đã giao</div>
          </div>
          <div style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); padding: 20px; border-radius: 12px; text-align: center; color: white; box-shadow: 0 4px 12px rgba(79, 172, 254, 0.3);">
            <div style="font-size: 32px; font-weight: bold;">${
              orderStats.cancelledOrders
            }</div>
            <div style="margin-top: 8px; opacity: 0.9;">Đã hủy</div>
          </div>
          <div style="background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); padding: 20px; border-radius: 12px; text-align: center; color: white; box-shadow: 0 4px 12px rgba(67, 233, 123, 0.3);">
            <div style="font-size: 22px; font-weight: bold;">${formatCurrency(
              orderStats.totalSpent
            )}</div>
            <div style="margin-top: 8px; opacity: 0.9;">Tổng chi tiêu</div>
          </div>
        </div>
      </div>
    `;
  }

  // Thông tin cửa hàng cho Vendor
  if (storeInfo) {
    html += `
      <div class="detail-section">
        <h3 style="color: #0891b2; border-bottom: 2px solid #0891b2; padding-bottom: 12px; margin-bottom: 20px; font-size: 18px;">🏪 Thông Tin Cửa Hàng</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <strong>🏬 Tên cửa hàng</strong>
            <span>${storeInfo.title}</span>
          </div>
          <div class="detail-item">
            <strong>🔖 Mã cửa hàng</strong>
            <span>${storeInfo.code}</span>
          </div>
          <div class="detail-item">
            <strong>⭐ Đánh giá</strong>
            <span style="color: #ffc107; font-weight: bold;">${
              storeInfo.rating || 0
            } / 5</span>
          </div>
          <div class="detail-item">
            <strong>✅ Xác minh</strong>
            <span class="badge ${
              storeInfo.verification === "Đã xác minh"
                ? "badge-success"
                : storeInfo.verification === "Bị từ chối"
                ? "badge-danger"
                : "badge-warning"
            }">
              ${storeInfo.verification}
            </span>
          </div>
          <div class="detail-item">
            <strong>📍 Địa chỉ</strong>
            <span>${storeInfo.coords?.address || "Chưa có"}</span>
          </div>
        </div>
      </div>
    `;
  }

  content.innerHTML = html;
  modal.style.display = "block";
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
  }).format(amount);
}

async function deleteUser(userId) {
  if (!confirm("Bạn có chắc muốn xóa người dùng này?")) return;

  try {
    const data = await apiCall(`/api/admin/users/${userId}`, {
      method: "DELETE",
    });

    if (data && data.status) {
      showNotification("Đã xóa người dùng thành công!");
      loadUsers(currentUsersPage);
    } else {
      showNotification("Xóa user thất bại!", "error");
    }
  } catch (error) {
    console.error("Error deleting user:", error);
    showNotification("Có lỗi xảy ra!", "error");
  }
}

// Event listeners
document
  .getElementById("user-type-filter")
  .addEventListener("change", () => loadUsers(1));
document
  .getElementById("user-search")
  .addEventListener("input", () => loadUsers(1));
