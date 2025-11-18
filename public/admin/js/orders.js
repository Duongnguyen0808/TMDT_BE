// Orders Management
let currentOrdersPage = 1;
const ordersPerPage = 20;

async function loadOrders(page = 1) {
  const status = document.getElementById("order-status-filter").value;

  try {
    let url = `/api/admin/orders?page=${page}&limit=${ordersPerPage}`;
    if (status) url += `&orderStatus=${status}`;

    const data = await apiCall(url);

    if (data && data.status) {
      renderOrdersTable(data.data);
      renderOrdersPagination(data.pagination);
    }
  } catch (error) {
    console.error("Error loading orders:", error);
  }
}

function renderOrdersTable(orders) {
  const tbody = document.getElementById("orders-tbody");

  const html = orders
    .map((order) => {
      let statusBadge = "";
      if (order.orderStatus === "Delivered") {
        statusBadge = '<span class="badge badge-success">Đã giao</span>';
      } else if (order.orderStatus === "Preparing") {
        statusBadge = '<span class="badge badge-info">Đang chuẩn bị</span>';
      } else if (order.orderStatus === "Cancelled") {
        statusBadge = '<span class="badge badge-danger">Đã hủy</span>';
      } else {
        statusBadge = '<span class="badge badge-warning">Chờ xử lý</span>';
      }

      let paymentBadge = "";
      if (order.paymentStatus === "Completed") {
        paymentBadge = '<span class="badge badge-success">Đã thanh toán</span>';
      } else if (order.paymentStatus === "Failed") {
        paymentBadge = '<span class="badge badge-danger">Thất bại</span>';
      } else {
        paymentBadge =
          '<span class="badge badge-warning">Chờ thanh toán</span>';
      }

      return `
            <tr>
                <td>#${order._id.substring(0, 8)}</td>
                <td>${order.userId?.username || "N/A"}</td>
                <td>${order.storeId?.title || "N/A"}</td>
                <td>${formatCurrency(order.grandTotal)}</td>
                <td>${paymentBadge}</td>
                <td>${statusBadge}</td>
                <td>${formatDate(order.createdAt)}</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="viewOrder('${order._id
        }')">Chi tiết</button>
                </td>
            </tr>
        `;
    })
    .join("");

  tbody.innerHTML = html;
}

function renderOrdersPagination(pagination) {
  const container = document.getElementById("orders-pagination");
  const { page, totalPages } = pagination;

  let html = "";

  if (page > 1) {
    html += `<button onclick="loadOrders(${page - 1})">‹ Trước</button>`;
  }

  for (let i = 1; i <= totalPages; i++) {
    if (i === page) {
      html += `<button class="active">${i}</button>`;
    } else {
      html += `<button onclick="loadOrders(${i})">${i}</button>`;
    }
  }

  if (page < totalPages) {
    html += `<button onclick="loadOrders(${page + 1})">Sau ›</button>`;
  }

  container.innerHTML = html;
}

async function viewOrder(orderId) {
  console.log("ViewOrder called with ID:", orderId);

  // Hiển thị modal ngay lập tức
  const modal = document.getElementById("orderDetailModal");
  const content = document.getElementById("order-detail-content");
  content.innerHTML =
    '<p style="text-align: center; padding: 40px;">Đang tải...</p>';
  // Ensure modal is visible even if previously closed via inline style
  modal.style.display = "block";
  modal.classList.add("active");

  try {
    // Lấy thông tin chi tiết đơn hàng
    const data = await apiCall(`/api/orders/${orderId}`);
    console.log("Order data received:", data);

    if (data && data.status) {
      const order = data.data;
      console.log("Order details:", order);

      // Tạo HTML chi tiết đơn hàng
      let statusBadge = "";
      if (order.orderStatus === "Delivered") {
        statusBadge = '<span class="badge badge-success">Đã giao</span>';
      } else if (order.orderStatus === "Preparing") {
        statusBadge = '<span class="badge badge-info">Đang chuẩn bị</span>';
      } else if (order.orderStatus === "Cancelled") {
        statusBadge = '<span class="badge badge-danger">Đã hủy</span>';
      } else {
        statusBadge = '<span class="badge badge-warning">Chờ xử lý</span>';
      }

      let paymentBadge = "";
      if (order.paymentStatus === "Completed") {
        paymentBadge = '<span class="badge badge-success">Đã thanh toán</span>';
      } else if (order.paymentStatus === "Failed") {
        paymentBadge = '<span class="badge badge-danger">Thất bại</span>';
      } else {
        paymentBadge =
          '<span class="badge badge-warning">Chờ thanh toán</span>';
      }

      const orderItemsHtml = order.orderItems
        .map(
          (item) => `
        <tr>
          <td>
            <div style="display: flex; align-items: center; gap: 10px;">
              <img src="${item.appliancesId?.imageUrl?.[0] || "/placeholder.png"
            }" 
                   style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px;">
              <span>${item.appliancesId?.title || "N/A"}</span>
            </div>
          </td>
          <td>${formatCurrency(item.price)}</td>
          <td>${item.quantity}</td>
          <td><strong>${formatCurrency(
              item.price * item.quantity
            )}</strong></td>
        </tr>
      `
        )
        .join("");

      const html = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
          <div>
            <h3 style="margin-bottom: 10px; color: #1e3c72;">Thông Tin Đơn Hàng</h3>
            <p><strong>Mã đơn:</strong> #${order._id.substring(0, 8)}</p>
            <p><strong>Ngày tạo:</strong> ${formatDate(order.createdAt)}</p>
            <p><strong>Trạng thái:</strong> ${statusBadge}</p>
            <p><strong>Thanh toán:</strong> ${paymentBadge}</p>
            
            <div style="margin-top: 15px; padding: 15px; background: #f5f5f5; border-radius: 8px;">
              <label style="display: block; margin-bottom: 8px; font-weight: bold; color: #1e3c72;">
                Cập Nhật Trạng Thái:
              </label>
              <select id="update-order-status" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 10px;">
                <option value="Pending" ${order.orderStatus === "Pending" ? "selected" : ""
        }>Chờ xử lý</option>
                <option value="Preparing" ${order.orderStatus === "Preparing" ? "selected" : ""
        }>Đang chuẩn bị</option>
                <option value="Delivered" ${order.orderStatus === "Delivered" ? "selected" : ""
        }>Đã giao</option>
                <option value="Cancelled" ${order.orderStatus === "Cancelled" ? "selected" : ""
        }>Đã hủy</option>
              </select>
              <button onclick="updateOrderStatus('${order._id
        }')" class="btn btn-primary btn-block">
                Cập Nhật Trạng Thái
              </button>
            </div>
          </div>
          <div>
            <h3 style="margin-bottom: 10px; color: #1e3c72;">Thông Tin Khách Hàng</h3>
            <p><strong>Tên:</strong> ${order.userId?.username || "N/A"}</p>
            <p><strong>Email:</strong> ${order.userId?.email || "N/A"}</p>
            <p><strong>SĐT:</strong> ${order.userId?.phone || "N/A"}</p>
            <p><strong>Địa chỉ:</strong> ${order.deliveryAddress?.addressLine || "N/A"
        }</p>
          </div>
        </div>

        <div style="margin-bottom: 20px;">
          <h3 style="margin-bottom: 10px; color: #1e3c72;">Cửa Hàng</h3>
          <p><strong>Tên:</strong> ${order.storeId?.title || "N/A"}</p>
          <p><strong>Địa chỉ:</strong> ${order.storeAddress || "N/A"}</p>
        </div>

        <div style="margin-bottom: 20px;">
          <h3 style="margin-bottom: 10px; color: #1e3c72;">Sản Phẩm</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #f5f5f5;">
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Sản phẩm</th>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Đơn giá</th>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Số lượng</th>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Thành tiền</th>
              </tr>
            </thead>
            <tbody>
              ${orderItemsHtml}
            </tbody>
          </table>
        </div>

        <div style="border-top: 2px solid #ddd; padding-top: 15px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
            <span>Tổng tiền hàng:</span>
            <strong>${formatCurrency(order.orderTotal)}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
            <span>Phí giao hàng:</span>
            <strong>${formatCurrency(order.deliveryFee)}</strong>
          </div>
          ${order.discount > 0
          ? `
          <div style="display: flex; justify-content: space-between; margin-bottom: 10px; color: #4CAF50;">
            <span>Giảm giá:</span>
            <strong>-${formatCurrency(order.discount)}</strong>
          </div>
          `
          : ""
        }
          <div style="display: flex; justify-content: space-between; font-size: 18px; color: #1e3c72; border-top: 2px solid #1e3c72; padding-top: 10px; margin-top: 10px;">
            <strong>Tổng cộng:</strong>
            <strong>${formatCurrency(order.grandTotal)}</strong>
          </div>
        </div>
      `;

      document.getElementById("order-detail-content").innerHTML = html;
      const m = document.getElementById("orderDetailModal");
      m.style.display = "block";
      m.classList.add("active");
    }
  } catch (error) {
    console.error("Error loading order details:", error);
    showNotification("Không thể tải chi tiết đơn hàng!");
  }
}

// Cập nhật trạng thái đơn hàng
async function updateOrderStatus(orderId) {
  const newStatus = document.getElementById("update-order-status").value;

  if (
    !confirm(
      `Bạn có chắc muốn cập nhật trạng thái đơn hàng thành "${newStatus}"?`
    )
  ) {
    return;
  }

  try {
    const data = await apiCall(`/api/orders/${orderId}`, {
      method: "PUT",
      body: JSON.stringify({ orderStatus: newStatus }),
    });

    if (data && data.status) {
      showNotification("Đã cập nhật trạng thái đơn hàng thành công!");
      document.getElementById("orderDetailModal").classList.remove("active");
      loadOrders(currentOrdersPage);
    } else {
      showNotification("Không thể cập nhật trạng thái!");
    }
  } catch (error) {
    console.error("Error updating order status:", error);
    showNotification("Lỗi khi cập nhật trạng thái!");
  }
}

// Event listeners
document
  .getElementById("order-status-filter")
  .addEventListener("change", () => loadOrders(1));
