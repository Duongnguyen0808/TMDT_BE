// Products Management
let currentProductsPage = 1;
const productsPerPage = 20;

function getNormalizedProductRating(value) {
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

function getProductStarMarkup(value) {
  if (typeof window.createStarRating === "function") {
    return window.createStarRating(value);
  }
  const normalized = getNormalizedProductRating(value);
  if (normalized === null) {
    return "";
  }
  return `<span>&#9733; ${normalized.toFixed(1)}</span>`;
}

function renderProductRating(rating, ratingCount) {
  const normalized = getNormalizedProductRating(rating);
  const totalRatings =
    typeof ratingCount === "number" && ratingCount >= 0 ? ratingCount : 0;

  if (normalized === null || totalRatings === 0) {
    return '<div style="width:100%;color:#9e9e9e;font-style:italic;margin-top:6px;">Chưa có đánh giá</div>';
  }

  return `
    <div style="display:flex;align-items:center;gap:6px;">
      ${getProductStarMarkup(normalized)}
      <div>
        <strong>${normalized.toFixed(1)}</strong>
        <small style="color:#666;">(${totalRatings})</small>
      </div>
    </div>
  `;
}

function renderProductStoreInfo(product) {
  const storeName =
    product && product.store && product.store.title
      ? product.store.title
      : "Không xác định";
  const storeCode =
    product && product.store && product.store.code ? product.store.code : "--";

  return `
    <p style="color:#444;font-size:13px;margin:2px 0;">
      Cửa hàng: <strong>${storeName}</strong>
      <span style="color:#999;">(${storeCode})</span>
    </p>
  `;
}

async function loadProducts(page = 1) {
  const search = document.getElementById("product-search").value;

  try {
    let url = `/api/admin/products?page=${page}&limit=${productsPerPage}`;
    if (search) url += `&keyword=${encodeURIComponent(search)}`;

    const data = await apiCall(url);

    if (data && data.status) {
      renderProductsGrid(data.data);
      renderProductsPagination(data.pagination);
    }
  } catch (error) {
    console.error("Error loading products:", error);
  }
}

function renderProductsGrid(products) {
  const grid = document.getElementById("products-grid");

  const html = products
    .map(
      (product) => `
        <div class="product-card">
            <img src="${product.imageUrl[0]}" alt="${product.title}">
            <div class="product-card-body">
                <h4>${product.title}</h4>
                <p style="color: #666; font-size: 14px; margin: 5px 0;">${product.category || "Chưa cập nhật"}</p>
                ${renderProductStoreInfo(product)}
                <div style="color:#666;font-size:13px;margin:2px 0;">
                    Đã bán: ${typeof product.soldCount === "number" ? product.soldCount : 0}
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; gap: 12px; flex-wrap: wrap;">
                    <span class="product-price">${formatCurrency(product.price)}</span>
                    ${renderProductRating(product.rating, product.ratingCount)}
                </div>
                <div style="margin-top: 10px;">
                    ${(typeof product.stock === 'number' ? product.stock > 0 : true) && product.isAvailable
          ? `<span class="badge badge-success">Còn hàng${typeof product.stock === 'number' ? ` (${product.stock})` : ''}</span>`
          : `<span class="badge badge-danger">Hết hàng</span>`
        }
                </div>
                <div style="margin-top: 10px;">
                    <button class="btn btn-danger btn-sm btn-block" onclick="deleteProduct('${product._id
        }')">Xóa</button>
                </div>
            </div>
        </div>
    `
    )
    .join("");

  grid.innerHTML = html;
}

function renderProductsPagination(pagination) {
  const container = document.getElementById("products-pagination");
  const { page, totalPages } = pagination;

  let html = "";

  if (page > 1) {
    html += `<button onclick="loadProducts(${page - 1})">‹ Trước</button>`;
  }

  for (let i = 1; i <= totalPages; i++) {
    if (i === page) {
      html += `<button class="active">${i}</button>`;
    } else {
      html += `<button onclick="loadProducts(${i})">${i}</button>`;
    }
  }

  if (page < totalPages) {
    html += `<button onclick="loadProducts(${page + 1})">Sau ›</button>`;
  }

  container.innerHTML = html;
}

async function deleteProduct(productId) {
  if (!confirm("Bạn có chắc muốn xóa sản phẩm này?")) return;

  try {
    const data = await apiCall(`/api/admin/products/${productId}`, {
      method: "DELETE",
    });

    if (data && data.status) {
      showNotification("Đã xóa sản phẩm thành công!");
      loadProducts(currentProductsPage);
    } else {
      showNotification("Xóa sản phẩm thất bại!", "error");
    }
  } catch (error) {
    console.error("Error deleting product:", error);
    showNotification("Có lỗi xảy ra!", "error");
  }
}

// Event listeners
document
  .getElementById("product-search")
  .addEventListener("input", () => loadProducts(1));
