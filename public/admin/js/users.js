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
            <td><img src="${user.profile}" alt="${user.username
        }" class="user-avatar"></td>
            <td>${user.username}</td>
            <td>${user.email}</td>
            <td>${user.phone || "Chưa có"}</td>
            <td><span class="badge ${userTypeBadge}">${userTypeLabel}</span></td>
            <td>
                ${user.verification
          ? '<span class="badge badge-success">✓ Email</span>'
          : '<span class="badge badge-warning">✗ Email</span>'
        }
                ${user.phoneVerification
          ? '<span class="badge badge-success">✓ SĐT</span>'
          : ""
        }
            </td>
            <td>${formatDate(user.createdAt)}</td>
            <td>
                <button class="btn btn-primary btn-sm" onclick="viewUser('${user._id
        }')">Xem</button>
                <button class="btn btn-danger btn-sm" onclick="deleteUser('${user._id
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
  const { user, orderStats, storeInfo, driverStats, shipperProfile } = userData;
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
             style="width: 140px; height: 140px; border-radius: 50%; object-fit: cover; border: 4px solid ${user.userType === "Admin"
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
          <span>${user.verification
      ? '<span class="badge badge-success">✓ Đã xác minh</span>'
      : '<span class="badge badge-warning">✗ Chưa xác minh</span>'
    }</span>
        </div>
        <div class="detail-item">
          <strong>📞 Xác minh SĐT</strong>
          <span>${user.phoneVerification
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
        <div class="detail-item">
          <strong>⭐ Điểm đánh giá</strong>
          <span>${formatRatingDisplay(user.rating, user.ratingCount)}</span>
        </div>
        <div class="detail-item">
          <strong>🧾 Lượt đánh giá</strong>
          <span>${formatNumber(user.ratingCount)}</span>
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
            <div style="font-size: 32px; font-weight: bold;">${orderStats.totalOrders
      }</div>
            <div style="margin-top: 8px; opacity: 0.9;">Tổng đơn hàng</div>
          </div>
          <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 20px; border-radius: 12px; text-align: center; color: white; box-shadow: 0 4px 12px rgba(245, 87, 108, 0.3);">
            <div style="font-size: 32px; font-weight: bold;">${orderStats.completedOrders
      }</div>
            <div style="margin-top: 8px; opacity: 0.9;">Đã giao</div>
          </div>
          <div style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); padding: 20px; border-radius: 12px; text-align: center; color: white; box-shadow: 0 4px 12px rgba(79, 172, 254, 0.3);">
            <div style="font-size: 32px; font-weight: bold;">${orderStats.cancelledOrders
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
            <span style="color: #ffc107; font-weight: bold;">${formatRatingDisplay(
      storeInfo.rating,
      storeInfo.ratingCount
    )}</span>
          </div>
          <div class="detail-item">
            <strong>✅ Xác minh</strong>
            <span class="badge ${storeInfo.verification === "Đã xác minh"
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
          <div class="detail-item">
            <strong>📌 Tọa độ</strong>
            <span>${formatCoords(storeInfo.coords)}</span>
          </div>
          <div class="detail-item">
            <strong>🕒 Giờ hoạt động</strong>
            <span>${storeInfo.time || "Chưa cập nhật"}</span>
          </div>
          <div class="detail-item">
            <strong>⚙️ Trạng thái</strong>
            <span>${storeInfo.isAvailable ? "Đang hoạt động" : "Tạm đóng"}</span>
          </div>
          <div class="detail-item">
            <strong>🚚 Dịch vụ</strong>
            <span>${[
        storeInfo.delivery ? "Giao hàng" : null,
        storeInfo.pickup ? "Nhận tại quán" : null,
      ]
        .filter(Boolean)
        .join(" • ") || "Chưa cấu hình"}</span>
          </div>
        </div>
        ${storeInfo.metrics
        ? `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-top: 18px;">
          <div style="background: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%); padding: 16px; border-radius: 12px; color: #fff; text-align: center;">
            <div style="font-size: 28px; font-weight: 700;">${formatNumber(storeInfo.metrics.totalOrders)}</div>
            <div style="opacity: 0.85; margin-top: 6px;">Tổng đơn</div>
          </div>
          <div style="background: linear-gradient(135deg, #34d399 0%, #059669 100%); padding: 16px; border-radius: 12px; color: #fff; text-align: center;">
            <div style="font-size: 28px; font-weight: 700;">${formatNumber(storeInfo.metrics.completedOrders)}</div>
            <div style="opacity: 0.85; margin-top: 6px;">Đã giao</div>
          </div>
          <div style="background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%); padding: 16px; border-radius: 12px; color: #fff; text-align: center;">
            <div style="font-size: 28px; font-weight: 700;">${formatNumber(storeInfo.metrics.activeOrders)}</div>
            <div style="opacity: 0.85; margin-top: 6px;">Đang xử lý</div>
          </div>
          <div style="background: linear-gradient(135deg, #f87171 0%, #ef4444 100%); padding: 16px; border-radius: 12px; color: #fff; text-align: center;">
            <div style="font-size: 28px; font-weight: 700;">${formatNumber(storeInfo.metrics.cancelledOrders)}</div>
            <div style="opacity: 0.85; margin-top: 6px;">Đã hủy</div>
          </div>
          <div style="background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%); padding: 16px; border-radius: 12px; color: #fff; text-align: center;">
            <div style="font-size: 22px; font-weight: 700;">${formatCurrency(storeInfo.metrics.totalRevenue)}</div>
            <div style="opacity: 0.85; margin-top: 6px;">Doanh thu</div>
          </div>
        </div>`
        : "<p style=\"margin-top:12px;color:#6b7280;\">Chưa có thống kê đơn hàng cho cửa hàng này.</p>"}
      </div>
    `;
  }

  if (driverStats) {
    html += `
      <div class="detail-section">
        <h3 style="color: #1d4ed8; border-bottom: 2px solid #1d4ed8; padding-bottom: 12px; margin-bottom: 20px; font-size: 18px;">🚚 Hiệu Suất Tài Xế</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px;">
          <div style="background: linear-gradient(135deg, #60a5fa 0%, #2563eb 100%); padding: 16px; border-radius: 12px; color: #fff; text-align: center;">
            <div style="font-size: 28px; font-weight: 700;">${formatNumber(driverStats.totalOrders)}</div>
            <div style="opacity: 0.85; margin-top: 6px;">Tổng đơn nhận</div>
          </div>
          <div style="background: linear-gradient(135deg, #34d399 0%, #059669 100%); padding: 16px; border-radius: 12px; color: #fff; text-align: center;">
            <div style="font-size: 28px; font-weight: 700;">${formatNumber(driverStats.completedOrders)}</div>
            <div style="opacity: 0.85; margin-top: 6px;">Đã giao</div>
          </div>
          <div style="background: linear-gradient(135deg, #fbbf24 0%, #f97316 100%); padding: 16px; border-radius: 12px; color: #fff; text-align: center;">
            <div style="font-size: 28px; font-weight: 700;">${formatNumber(driverStats.activeOrders)}</div>
            <div style="opacity: 0.85; margin-top: 6px;">Đang giao</div>
          </div>
          <div style="background: linear-gradient(135deg, #f87171 0%, #ef4444 100%); padding: 16px; border-radius: 12px; color: #fff; text-align: center;">
            <div style="font-size: 28px; font-weight: 700;">${formatNumber(driverStats.cancelledOrders)}</div>
            <div style="opacity: 0.85; margin-top: 6px;">Bị hủy</div>
          </div>
          <div style="background: linear-gradient(135deg, #c084fc 0%, #a855f7 100%); padding: 16px; border-radius: 12px; color: #fff; text-align: center;">
            <div style="font-size: 22px; font-weight: 700;">${formatCurrency(driverStats.totalPayout)}</div>
            <div style="opacity: 0.85; margin-top: 6px;">Đã thanh toán</div>
          </div>
          <div style="background: linear-gradient(135deg, #f472b6 0%, #ec4899 100%); padding: 16px; border-radius: 12px; color: #fff; text-align: center;">
            <div style="font-size: 22px; font-weight: 700;">${formatCurrency(driverStats.totalCommission)}</div>
            <div style="opacity: 0.85; margin-top: 6px;">Hoa hồng</div>
          </div>
          <div style="background: linear-gradient(135deg, #fde68a 0%, #f59e0b 100%); padding: 16px; border-radius: 12px; color: #92400e; text-align: center;">
            <div style="font-size: 24px; font-weight: 700;">${formatRatingDisplay(driverStats.rating, driverStats.ratingCount)}</div>
            <div style="opacity: 0.85; margin-top: 6px;">Điểm trung bình</div>
          </div>
        </div>
      </div>
    `;
  }

  if (shipperProfile) {
    html += `
      <div class="detail-section">
        <h3 style="color: #0d9488; border-bottom: 2px solid #0d9488; padding-bottom: 12px; margin-bottom: 20px; font-size: 18px;">🪪 Hồ Sơ Shipper</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <strong>👤 Họ tên</strong>
            <span>${shipperProfile.fullName}</span>
          </div>
          <div class="detail-item">
            <strong>📱 Số điện thoại</strong>
            <span>${shipperProfile.phone}</span>
          </div>
          <div class="detail-item">
            <strong>🚗 Loại phương tiện</strong>
            <span>${formatVehicleType(shipperProfile.vehicleType)}</span>
          </div>
          <div class="detail-item">
            <strong>🆔 Biển số</strong>
            <span>${shipperProfile.vehiclePlate || "Chưa cập nhật"}</span>
          </div>
          <div class="detail-item">
            <strong>📄 Trạng thái duyệt</strong>
            <span class="badge ${shipperProfile.approvalStatus === "approved"
        ? "badge-success"
        : shipperProfile.approvalStatus === "rejected"
          ? "badge-danger"
          : "badge-warning"
      }">${shipperProfile.approvalStatus.toUpperCase()}</span>
          </div>
          <div class="detail-item">
            <strong>🕒 Cập nhật</strong>
            <span>${formatDate(shipperProfile.updatedAt)}</span>
          </div>
        </div>
        <div class="detail-grid" style="margin-top: 16px;">
          <div class="detail-item">
            <strong>📑 CMND/CCCD</strong>
            <span>${renderDocumentLink(shipperProfile.idFrontUrl, "Mặt trước")}</span>
          </div>
          <div class="detail-item">
            <strong></strong>
            <span>${renderDocumentLink(shipperProfile.idBackUrl, "Mặt sau")}</span>
          </div>
          <div class="detail-item">
            <strong>🚘 Bằng lái</strong>
            <span>${renderDocumentLink(shipperProfile.driverLicenseUrl, "Xem ảnh")}</span>
          </div>
          <div class="detail-item">
            <strong>🧾 Đăng kiểm</strong>
            <span>${renderDocumentLink(shipperProfile.vehicleRegUrl, "Xem ảnh")}</span>
          </div>
          <div class="detail-item">
            <strong>🤳 Chân dung</strong>
            <span>${renderDocumentLink(shipperProfile.selfieUrl, "Xem ảnh")}</span>
          </div>
        </div>
        ${shipperProfile.rejectionReason
        ? `<p style="margin-top:12px;color:#dc2626;"><strong>Lý do từ chối:</strong> ${shipperProfile.rejectionReason}</p>`
        : ""}
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

function formatNumber(value) {
  return new Intl.NumberFormat("vi-VN").format(value || 0);
}

function formatRatingDisplay(rating, count) {
  const safeRating = Number(rating || 0).toFixed(1);
  const safeCount = Number(count || 0);
  return `${safeRating} / 5 (${safeCount} lượt)`;
}

function formatVehicleType(type) {
  switch (type) {
    case "motorbike":
      return "Xe máy";
    case "car":
      return "Ô tô";
    case "light_truck":
      return "Xe tải nhẹ";
    case "heavy_truck":
      return "Xe tải nặng";
    default:
      return "Khác";
  }
}

function renderDocumentLink(url, label) {
  if (!url) {
    return `<span style="color:#9ca3af;">${label}: Chưa có</span>`;
  }
  return `<a href="${url}" target="_blank" rel="noopener" style="color:#2563eb; font-weight:600;">${label}</a>`;
}

function formatCoords(coords) {
  if (!coords || typeof coords.latitude !== "number" || typeof coords.longitude !== "number") {
    return "Chưa có";
  }
  return `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
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
      showNotification("Xóa người dùng thất bại!", "error");
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
