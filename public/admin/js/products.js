// Products Management
let currentProductsPage = 1;
const productsPerPage = 20;

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
                <p style="color: #666; font-size: 14px; margin: 5px 0;">${product.category || "Chưa cập nhật"
        }</p>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
                    <span class="product-price">${formatCurrency(
          product.price
        )}</span>
                    <span style="color: #FF9800;">⭐ ${product.rating.toFixed(
          1
        )}</span>
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
