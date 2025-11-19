// Dashboard functionality
let ordersChart = null;

async function loadDashboard() {
  try {
    const data = await apiCall("/api/admin/dashboard/overview");
    console.log("Dashboard data:", data);

    if (data && data.status) {
      // Update stats
      document.getElementById("total-users").textContent =
        data.data.overview.totalUsers || 0;
      document.getElementById("total-stores").textContent =
        data.data.overview.totalStores || 0;
      document.getElementById("total-products").textContent =
        data.data.overview.totalProducts || 0;
      document.getElementById("total-orders").textContent =
        data.data.overview.totalOrders || 0;
      document.getElementById("total-revenue").textContent = formatCurrency(
        data.data.overview.totalRevenue || 0
      );
      document.getElementById("pending-stores").textContent =
        data.data.overview.pendingStores || 0;
      const psElem = document.getElementById("pending-shippers");
      if (psElem) psElem.textContent = data.data.overview.pendingShippers || 0;
      // Click card to navigate to Shippers page
      const shipperCard = document.getElementById("pending-shippers-card");
      if (shipperCard) {
        shipperCard.onclick = () => {
          const navItem = document.querySelector('.nav-item[data-page="shippers"]');
          if (navItem) navItem.click();
        };
      }

      // Load orders chart
      loadOrdersChart(data.data.orders);

      // Load top stores
      loadTopStores();
    }
  } catch (error) {
    console.error("Error loading dashboard:", error);
  }
}

function loadOrdersChart(ordersData) {
  const ctx = document.getElementById("ordersChart");
  if (!ctx) return;

  if (ordersChart) {
    ordersChart.destroy();
  }

  const pending = ordersData?.pending || 0;
  const preparing = ordersData?.preparing || 0;
  const completed = ordersData?.completed || 0;
  const cancelled = ordersData?.cancelled || 0;

  // Nếu không có data, hiển thị placeholder
  if (pending === 0 && preparing === 0 && completed === 0 && cancelled === 0) {
    ctx.parentElement.innerHTML =
      '<p style="text-align: center; padding: 40px; color: #999;">Chưa có đơn hàng nào</p>';
    return;
  }

  ordersChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Chờ xử lý", "Đang chuẩn bị", "Đã giao", "Đã hủy"],
      datasets: [
        {
          data: [pending, preparing, completed, cancelled],
          backgroundColor: ["#FF9800", "#2196F3", "#4CAF50", "#F44336"],
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            padding: 15,
            font: {
              size: 12,
            },
          },
        },
        tooltip: {
          callbacks: {
            label: function (context) {
              const label = context.label || "";
              const value = context.parsed || 0;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = ((value / total) * 100).toFixed(1);
              return `${label}: ${value} đơn (${percentage}%)`;
            },
          },
        },
      },
    },
  });
}

async function loadTopStores() {
  try {
    const data = await apiCall("/api/admin/dashboard/top-stores?limit=5");
    console.log("Top stores data:", data);

    const container = document.getElementById("top-stores-list");
    if (!container) return;

    if (data && data.status && data.data && data.data.length > 0) {
      const listHtml = data.data
        .map(
          (store, index) => `
                <div class="top-store-item">
                    <div class="store-rank">#${index + 1}</div>
                    <img src="${store.logoUrl ||
            store.imageUrl ||
            "https://via.placeholder.com/50"
            }" 
                         alt="${store.title}"
                         onerror="this.src='https://via.placeholder.com/50?text=Store'">
                    <div class="top-store-info">
                        <h4>${store.title}</h4>
                        <p class="store-stats">
                          <span>📦 ${store.orderCount || 0} đơn</span>
                        </p>
                    </div>
                    <div class="top-store-revenue">
                        ${formatCurrency(store.totalRevenue || 0)}
                    </div>
                </div>
            `
        )
        .join("");

      container.innerHTML = listHtml;
    } else {
      container.innerHTML =
        '<p style="text-align: center; padding: 40px; color: #999;">Chưa có dữ liệu doanh thu</p>';
    }
  } catch (error) {
    console.error("Error loading top stores:", error);
    const container = document.getElementById("top-stores-list");
    if (container) {
      container.innerHTML =
        '<p style="text-align: center; padding: 20px; color: #f44336;">Không thể tải dữ liệu</p>';
    }
  }
}
