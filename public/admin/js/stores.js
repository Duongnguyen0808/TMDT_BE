// Stores Management
let currentStoresPage = 1;
const storesPerPage = 20;

function getNormalizedStoreRating(value) {
  if (typeof window.normalizeRatingValue === "function") {
    return window.normalizeRatingValue(value);
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  if (value < 0) return 0;
  if (value > 5) return 5;
  return value;
}

function getStoreStarMarkup(value) {
  if (typeof window.createStarRating === "function") {
    return window.createStarRating(value);
  }
  const normalized = getNormalizedStoreRating(value);
  if (normalized === null) {
    return "";
  }
  return `<span>&#9733; ${normalized.toFixed(1)}</span>`;
}

function renderStoreRating(rating, ratingCount) {
  const normalized = getNormalizedStoreRating(rating);
  const totalRatings =
    typeof ratingCount === "number" && ratingCount >= 0 ? ratingCount : 0;

  if (normalized === null || totalRatings === 0) {
    return '<span style="color:#9e9e9e;font-style:italic;">Chưa có đánh giá</span>';
  }

  return `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      ${getStoreStarMarkup(normalized)}
      <div>
        <strong>${normalized.toFixed(1)}</strong>
        <small style="color:#666;">(${totalRatings})</small>
      </div>
    </div>
  `;
}

async function loadStores(page = 1) {
  const verification = document.getElementById(
    "store-verification-filter"
  ).value;

  try {
    let url = `/api/admin/stores?page=${page}&limit=${storesPerPage}`;
    if (verification)
      url += `&verification=${encodeURIComponent(verification)}`;

    const data = await apiCall(url);

    if (data && data.status) {
      renderStoresTable(data.data);
      renderStoresPagination(data.pagination);
    }
  } catch (error) {
    console.error("Error loading stores:", error);
  }
}

function renderStoresTable(stores) {
  const tbody = document.getElementById("stores-tbody");

  const html = stores
    .map((store) => {
      let verificationBadge = "";
      if (store.verification === "Đã xác minh") {
        verificationBadge = '<span class="badge badge-success">Đã duyệt</span>';
      } else if (store.verification === "Đang chờ duyệt") {
        verificationBadge =
          '<span class="badge badge-warning">Chờ duyệt</span>';
      } else {
        verificationBadge =
          '<span class="badge badge-danger">Bị từ chối</span>';
      }

      return `
            <tr>
                <td><img src="${store.logoUrl}" alt="${store.title
        }" class="store-logo"></td>
                <td>${store.title}</td>
                <td>${store.code}</td>
                <td>${renderStoreRating(store.rating, store.ratingCount)}</td>
                <td>
                    ${store.isAvailable
          ? '<span class="badge badge-success">Hoạt động</span>'
          : '<span class="badge badge-danger">Tạm ngưng</span>'
        }
                </td>
                <td>${verificationBadge}</td>
                <td>
                    ${store.verification === "Đang chờ duyệt"
          ? `<button class="btn btn-success btn-sm" onclick="openVerifyModal('${store._id}')">Duyệt</button>`
          : `<button class="btn btn-sm btn-primary" onclick="viewStore('${store._id}')">Xem</button>`
        }
                    <button class="btn btn-danger btn-sm" onclick="deleteStore('${store._id
        }')">Xóa</button>
                </td>
            </tr>
        `;
    })
    .join("");

  tbody.innerHTML = html;
}

function renderStoresPagination(pagination) {
  const container = document.getElementById("stores-pagination");
  const { page, totalPages } = pagination;

  let html = "";

  if (page > 1) {
    html += `<button onclick="loadStores(${page - 1})">‹ Trước</button>`;
  }

  for (let i = 1; i <= totalPages; i++) {
    if (i === page) {
      html += `<button class="active">${i}</button>`;
    } else {
      html += `<button onclick="loadStores(${i})">${i}</button>`;
    }
  }

  if (page < totalPages) {
    html += `<button onclick="loadStores(${page + 1})">Sau ›</button>`;
  }

  container.innerHTML = html;
}

function openVerifyModal(storeId) {
  document.getElementById("verify-store-id").value = storeId;
  document.getElementById("verifyModal").classList.add("active");
}

document.getElementById("verify-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const storeId = document.getElementById("verify-store-id").value;
  const verification = document.getElementById("verify-status").value;
  const verificationMessage = document.getElementById("verify-message").value;

  try {
    const data = await apiCall(`/api/admin/stores/${storeId}/verification`, {
      method: "PATCH",
      body: JSON.stringify({ verification, verificationMessage }),
    });

    if (data && data.status) {
      showNotification("Đã cập nhật trạng thái xác minh!");
      document.getElementById("verifyModal").classList.remove("active");
      loadStores(currentStoresPage);
    } else {
      showNotification("Cập nhật thất bại!", "error");
    }
  } catch (error) {
    console.error("Error verifying store:", error);
    showNotification("Có lỗi xảy ra!", "error");
  }
});

async function deleteStore(storeId) {
  if (!confirm("Bạn có chắc muốn xóa cửa hàng này?")) return;

  try {
    const data = await apiCall(`/api/admin/stores/${storeId}`, {
      method: "DELETE",
    });

    if (data && data.status) {
      showNotification("Đã xóa cửa hàng thành công!");
      loadStores(currentStoresPage);
    } else {
      showNotification("Xóa cửa hàng thất bại!", "error");
    }
  } catch (error) {
    console.error("Error deleting store:", error);
    showNotification("Có lỗi xảy ra!", "error");
  }
}

function viewStore(storeId) {
  window.open(`/api/store/byId/${storeId}`, "_blank");
}

// Event listeners
document
  .getElementById("store-verification-filter")
  .addEventListener("change", () => loadStores(1));

// Close modal
document.querySelectorAll(".close").forEach((btn) => {
  btn.addEventListener("click", function () {
    this.closest(".modal").classList.remove("active");
  });
});
