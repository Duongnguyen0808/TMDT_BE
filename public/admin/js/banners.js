let bannerState = {
    page: 1,
    limit: 10,
    totalPages: 1,
    status: "",
    keyword: "",
};
let bannerList = [];
let bannerSearchDebounce;
let currentBannerDetail = null;
let bannerProductSearchDebounce;
let bannerProductSearchResults = [];
let bannerProductSearchKeyword = "";
let bannerFormProducts = [];
let bannerFormProductSearchResults = [];
let bannerFormProductSearchKeyword = "";
let bannerFormProductSearchDebounce;
const MAX_BANNER_PRODUCTS = 10;

const getBannerFormElements = () => ({
    modal: document.getElementById("bannerModal"),
    form: document.getElementById("banner-form"),
    id: document.getElementById("banner-id"),
    title: document.getElementById("banner-title"),
    subtitle: document.getElementById("banner-subtitle"),
    description: document.getElementById("banner-description"),
    cta: document.getElementById("banner-cta"),
    category: document.getElementById("banner-category"),
    redirect: document.getElementById("banner-redirect"),
    start: document.getElementById("banner-start"),
    end: document.getElementById("banner-end"),
    imageUrl: document.getElementById("banner-image-url"),
    preview: document.getElementById("banner-preview"),
    selectBtn: document.getElementById("banner-select-image"),
    fileInput: document.getElementById("banner-file-input"),
    isActive: document.getElementById("banner-active"),
    modalTitle: document.getElementById("banner-modal-title"),
});

const bannerPlaceholderImage = "https://via.placeholder.com/600x200?text=Banner";
const bannerProductPlaceholderImage = "https://via.placeholder.com/80?text=SP";
const emptyProductsMarkup = `
    <i class="fas fa-box-open"></i>
    <p>Chưa chọn sản phẩm cho banner này</p>
`;
const productSearchPlaceholderMarkup = `
    <p class="search-placeholder">Nhập từ khóa để bắt đầu tìm kiếm</p>
`;

const getBannerDetailElements = () => ({
    modal: document.getElementById("bannerDetailModal"),
    image: document.getElementById("banner-detail-image"),
    title: document.getElementById("banner-detail-title"),
    description: document.getElementById("banner-detail-description"),
    status: document.getElementById("banner-detail-status"),
    schedule: document.getElementById("banner-detail-schedule"),
    linkedProducts: document.getElementById("banner-linked-products"),
    searchInput: document.getElementById("banner-product-search"),
    searchResults: document.getElementById("banner-product-results"),
    saveButton: document.getElementById("banner-detail-save-btn"),
});

const getBannerFormProductElements = () => ({
    container: document.getElementById("banner-form-products"),
    searchInput: document.getElementById("banner-form-product-search"),
    searchResults: document.getElementById("banner-form-product-results"),
});

async function loadBanners(page = 1) {
    const tableBody = document.getElementById("banners-tbody");
    if (!tableBody) return;

    bannerState.page = page;
    const params = new URLSearchParams({
        page: String(page),
        limit: String(bannerState.limit),
    });
    if (bannerState.keyword) params.append("keyword", bannerState.keyword);
    if (bannerState.status) params.append("status", bannerState.status);

    tableBody.innerHTML =
        '<tr><td colspan="7" style="text-align:center;padding:40px">Đang tải dữ liệu...</td></tr>';
    try {
        const response = await apiCall(`/api/banners/admin?${params.toString()}`);
        if (!response) return;
        if (!response.status) {
            tableBody.innerHTML =
                '<tr><td colspan="7">Không thể tải banner. ' +
                (response.message || "Vui lòng thử lại") +
                "</td></tr>";
            return;
        }
        bannerList = response.data || [];
        bannerState.totalPages = response.pagination?.totalPages || 1;
        renderBannerTable();
        renderBannerPagination();
    } catch (error) {
        console.error("[loadBanners]", error);
        tableBody.innerHTML =
            '<tr><td colspan="7" style="color:#f44336">' +
            (error.message || "Lỗi không xác định") +
            "</td></tr>";
    }
}

function renderBannerTable() {
    const tableBody = document.getElementById("banners-tbody");
    if (!tableBody) return;

    if (!bannerList.length) {
        tableBody.innerHTML =
            '<tr><td colspan="7" style="text-align:center;padding:32px">Chưa có banner nào. Nhấn "Thêm banner" để tạo mới.</td></tr>';
        return;
    }

    tableBody.innerHTML = bannerList
        .map((banner) => {
            const destination = banner.category
                ? `Danh mục: ${banner.category}`
                : banner.redirectUrl
                    ? `<a href="${banner.redirectUrl}" target="_blank">${banner.redirectUrl}</a>`
                    : banner.actionValue || "-";
            const schedule = formatBannerSchedule(banner.startAt, banner.endAt);
            return `
        <tr>
          <td style="width:80px">
            <input type="number" class="banner-order-input" data-id="${banner._id}" value="${banner.sortOrder || 0}" />
          </td>
          <td>
            <div class="banner-row">
              <img src="${banner.imageUrl}" alt="${banner.title}" onerror="this.src='https://via.placeholder.com/120x60?text=Banner'" />
              <div>
                <strong>${banner.title}</strong>
                <p>${banner.subtitle || ""}</p>
              </div>
            </div>
          </td>
          <td>${banner.ctaText || "-"}</td>
          <td>${destination}</td>
          <td>
            <span class="status-pill ${banner.isActive ? "status-success" : "status-warning"}">
              ${banner.isActive ? "Đang hiển thị" : "Đang ẩn"}
            </span>
          </td>
          <td>${schedule}</td>
          <td>
                        <button class="btn btn-outline btn-sm" onclick="openBannerDetail('${banner._id}')">
                            Chi tiết
                        </button>
            <button class="btn btn-secondary btn-sm" onclick="toggleBannerStatus('${banner._id}', ${banner.isActive})">
              ${banner.isActive ? "Ẩn" : "Hiện"}
            </button>
            <button class="btn btn-primary btn-sm" onclick="editBanner('${banner._id}')">
              Sửa
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteBanner('${banner._id}')">
              Xoá
            </button>
          </td>
        </tr>`;
        })
        .join("");
}

function formatBannerSchedule(startAt, endAt) {
    if (!startAt && !endAt) return "Luôn hiển thị";
    const startText = startAt ? formatDate(startAt) : "Ngay lập tức";
    const endText = endAt ? formatDate(endAt) : "Không giới hạn";
    return `${startText} → ${endText}`;
}

function renderBannerPagination() {
    const pagination = document.getElementById("banners-pagination");
    if (!pagination) return;
    const { page, totalPages } = bannerState;
    if (totalPages <= 1) {
        pagination.innerHTML = "";
        return;
    }
    let buttons = "";
    for (let i = 1; i <= totalPages; i += 1) {
        buttons += `<button class="pagination-btn ${i === page ? "active" : ""}" data-page="${i}">${i}</button>`;
    }
    pagination.innerHTML = buttons;
    pagination.querySelectorAll(".pagination-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const targetPage = Number(btn.dataset.page);
            if (targetPage !== bannerState.page) {
                loadBanners(targetPage);
            }
        });
    });
}

function openBannerModal(banner = null) {
    const formEls = getBannerFormElements();
    if (!formEls.form) return;

    formEls.form.reset();
    formEls.id.value = banner?._id || "";
    formEls.title.value = banner?.title || "";
    formEls.subtitle.value = banner?.subtitle || "";
    formEls.description.value = banner?.description || "";
    formEls.cta.value = banner?.ctaText || "";
    formEls.category.value = banner?.category || "";
    formEls.redirect.value = banner?.redirectUrl || "";
    formEls.start.value = banner?.startAt ? formatInputDate(banner.startAt) : "";
    formEls.end.value = banner?.endAt ? formatInputDate(banner.endAt) : "";
    formEls.imageUrl.value = banner?.imageUrl || "";
    formEls.preview.src = banner?.imageUrl || "https://via.placeholder.com/600x200?text=Banner";
    formEls.isActive.checked = banner?.isActive !== false;
    formEls.modalTitle.textContent = banner ? "Chỉnh sửa banner" : "Thêm banner mới";

    if (banner?.linkedProducts?.length) {
        resetBannerFormProductState(banner.linkedProducts);
    } else if (banner?.productIds?.length) {
        resetBannerFormProductState(banner.productIds);
    } else {
        resetBannerFormProductState();
    }

    formEls.modal.style.display = "block";
    formEls.modal.classList.add("active");
}

function closeBannerModal() {
    const { modal } = getBannerFormElements();
    if (modal) {
        modal.style.display = "none";
        modal.classList.remove("active");
    }
}

async function submitBannerForm(event) {
    event.preventDefault();
    const formEls = getBannerFormElements();
    if (!formEls.form) return;

    const title = formEls.title.value.trim();
    const imageUrl = formEls.imageUrl.value.trim();
    if (!title || !imageUrl) {
        showNotification("Vui lòng nhập đủ tiêu đề và ảnh", "error");
        return;
    }

    const payload = {
        title,
        subtitle: formEls.subtitle.value.trim() || undefined,
        description: formEls.description.value.trim() || undefined,
        ctaText: formEls.cta.value.trim() || undefined,
        category: formEls.category.value.trim() || undefined,
        redirectUrl: formEls.redirect.value.trim() || undefined,
        imageUrl,
        isActive: formEls.isActive.checked,
    };

    const selectedProductIds = getBannerFormProductIds();
    payload.productIds = selectedProductIds;

    if (formEls.start.value) {
        payload.startAt = new Date(formEls.start.value).toISOString();
    }
    if (formEls.end.value) {
        payload.endAt = new Date(formEls.end.value).toISOString();
    }

    const bannerId = formEls.id.value;
    const endpoint = bannerId ? `/api/banners/${bannerId}` : `/api/banners`;
    const method = bannerId ? "PUT" : "POST";

    const response = await apiCall(endpoint, {
        method,
        body: JSON.stringify(payload),
    });

    if (!response) return;

    if (!response.status) {
        showNotification(response.message || "Không thể lưu banner", "error");
        return;
    }

    showNotification(
        bannerId ? "Cập nhật banner thành công" : "Tạo banner thành công"
    );
    closeBannerModal();
    loadBanners(bannerState.page);
}

async function deleteBanner(id) {
    if (!confirm("Bạn có chắc chắn muốn xoá banner này?")) return;
    const response = await apiCall(`/api/banners/${id}`, { method: "DELETE" });
    if (!response) return;
    if (!response.status) {
        showNotification(response.message || "Không thể xoá", "error");
        return;
    }
    showNotification("Đã xoá banner");
    loadBanners(bannerState.page);
}

async function toggleBannerStatus(id, currentStatus) {
    const response = await apiCall(`/api/banners/${id}`, {
        method: "PUT",
        body: JSON.stringify({ isActive: !currentStatus }),
    });
    if (!response) return;
    if (!response.status) {
        showNotification(response.message || "Không thể cập nhật", "error");
        return;
    }
    showNotification("Đã cập nhật trạng thái banner");
    loadBanners(bannerState.page);
}

async function editBanner(id) {
    if (!id) return;
    try {
        const response = await apiCall(`/api/banners/${id}`);
        if (!response) return;
        if (!response.status || !response.data) {
            showNotification(response.message || "Không thể tải chi tiết banner", "error");
            return;
        }
        openBannerModal(response.data);
    } catch (error) {
        console.error("[editBanner]", error);
        showNotification(error.message || "Không thể tải chi tiết banner", "error");
    }
}

async function handleSaveBannerOrders() {
    const inputs = document.querySelectorAll(".banner-order-input");
    if (!inputs.length) {
        showNotification("Không có dữ liệu để cập nhật", "error");
        return;
    }
    const items = Array.from(inputs)
        .map((input) => ({
            id: input.dataset.id,
            sortOrder: Number(input.value) || 0,
        }))
        .filter((item) => item.id);

    if (!items.length) {
        showNotification("Hãy nhập thứ tự hợp lệ", "error");
        return;
    }

    const response = await apiCall("/api/banners/reorder", {
        method: "PATCH",
        body: JSON.stringify({ items }),
    });
    if (!response) return;
    if (!response.status) {
        showNotification(response.message || "Không thể cập nhật", "error");
        return;
    }
    showNotification("Đã lưu thứ tự banner");
    loadBanners(bannerState.page);
}

function formatInputDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const offset = date.getTimezoneOffset();
    const local = new Date(date.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
}

async function handleBannerFileChange(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
        showNotification("Vui lòng chọn ảnh nhỏ hơn 2MB", "error");
        event.target.value = "";
        return;
    }
    await uploadBannerImage(file);
    event.target.value = "";
}

async function uploadBannerImage(file) {
    const { imageUrl, preview, selectBtn } = getBannerFormElements();
    if (!imageUrl || !preview) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder", "tmdt/banners");

    try {
        if (selectBtn) {
            selectBtn.disabled = true;
            selectBtn.textContent = "Đang tải...";
        }
        const response = await fetch(`${API_BASE_URL}/api/upload/image`, {
            method: "POST",
            headers: {
                Authorization: authToken ? `Bearer ${authToken}` : "",
            },
            body: formData,
        });
        if (response.status === 401 || response.status === 403) {
            logout();
            return;
        }
        const data = await response.json();
        if (!data?.status) {
            showNotification(data?.message || "Không thể tải ảnh", "error");
            return;
        }
        imageUrl.value = data.secure_url;
        preview.src = data.secure_url;
        showNotification("Tải ảnh thành công");
    } catch (error) {
        console.error("[uploadBannerImage]", error);
        showNotification(error.message || "Lỗi tải ảnh", "error");
    } finally {
        if (selectBtn) {
            selectBtn.disabled = false;
            selectBtn.textContent = "Chọn ảnh";
        }
    }
}

const normalizeId = (value) => {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (typeof value === "object" && value !== null) {
        if (value._id) return value._id.toString();
        if (typeof value.toString === "function") return value.toString();
    }
    return String(value);
};

const formatBannerProductPrice = (value) => {
    const amount = Number(value || 0);
    if (Number.isNaN(amount)) return "0đ";
    return `${amount.toLocaleString("vi-VN")}đ`;
};

const showBannerDetailModal = () => {
    const { modal } = getBannerDetailElements();
    if (!modal) return;
    modal.style.display = "block";
    modal.classList.add("active");
};

const renderBannerDetailMeta = (banner) => {
    const { image, title, description, status, schedule } = getBannerDetailElements();
    if (!image || !title) return;
    image.src = banner?.imageUrl || bannerPlaceholderImage;
    image.onerror = (event) => {
        event.target.onerror = null;
        event.target.src = bannerPlaceholderImage;
    };
    title.textContent = banner?.title || "Banner";
    description.textContent =
        banner?.description || banner?.subtitle || "Banner này chưa có mô tả";
    if (schedule) {
        schedule.textContent = formatBannerSchedule(banner?.startAt, banner?.endAt);
    }
    if (status) {
        status.textContent = banner?.isActive ? "Đang hiển thị" : "Đang ẩn";
        status.classList.remove("status-success", "status-warning");
        status.classList.add(banner?.isActive ? "status-success" : "status-warning");
    }
};

const renderBannerLinkedProducts = (products = []) => {
    const { linkedProducts } = getBannerDetailElements();
    if (!linkedProducts) return;
    if (!products.length) {
        linkedProducts.classList.add("empty-state");
        linkedProducts.innerHTML = emptyProductsMarkup;
        return;
    }

    linkedProducts.classList.remove("empty-state");
    linkedProducts.innerHTML = products
        .map((product) => {
            const productId = normalizeId(product._id);
            return `
                <div class="banner-product-card">
                    <div class="product-info">
                        <img src="${product.imageUrl || bannerProductPlaceholderImage}" alt="${product.title || "Sản phẩm"
                }" onerror="this.src='${bannerProductPlaceholderImage}'" />
                        <div>
                            <p class="product-name">${product.title || "Sản phẩm"}</p>
                            <span class="product-price">${formatBannerProductPrice(product.price)}</span>
                            <small>Kho: ${product.stock ?? 0}</small>
                        </div>
                    </div>
                    <button class="btn btn-danger btn-sm" data-action="remove-product" data-id="${productId}">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
        })
        .join("");
};

const renderBannerFormProducts = (products = bannerFormProducts) => {
    const { container } = getBannerFormProductElements();
    if (!container) return;
    if (!products.length) {
        container.classList.add("empty-state");
        container.innerHTML = emptyProductsMarkup;
        return;
    }

    container.classList.remove("empty-state");
    container.innerHTML = products
        .map((product) => {
            const productId = normalizeId(product._id);
            return `
                <div class="banner-product-card">
                    <div class="product-info">
                        <img src="${product.imageUrl || bannerProductPlaceholderImage}" alt="${product.title || "Sản phẩm"
                }" onerror="this.src='${bannerProductPlaceholderImage}'" />
                        <div>
                            <p class="product-name">${product.title || "Sản phẩm"}</p>
                            <span class="product-price">${formatBannerProductPrice(product.price)}</span>
                            <small>Kho: ${product.stock ?? 0}</small>
                        </div>
                    </div>
                    <button class="btn btn-danger btn-sm" data-action="remove-form-product" data-id="${productId}">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
        })
        .join("");
};

const resetBannerFormProductSearchUI = () => {
    const { searchInput, searchResults } = getBannerFormProductElements();
    bannerFormProductSearchKeyword = "";
    bannerFormProductSearchResults = [];
    if (searchInput) searchInput.value = "";
    if (searchResults) searchResults.innerHTML = productSearchPlaceholderMarkup;
};

const resetBannerFormProductState = (products = []) => {
    bannerFormProducts = (products || [])
        .map((product) => {
            if (typeof product === "string") {
                return { _id: product };
            }
            const normalizedId = normalizeId(product?._id || product?.id);
            if (!normalizedId) return null;
            return { ...product, _id: normalizedId };
        })
        .filter(Boolean)
        .slice(0, MAX_BANNER_PRODUCTS);
    renderBannerFormProducts(bannerFormProducts);
    resetBannerFormProductSearchUI();
};

const getBannerFormProductIds = () =>
    bannerFormProducts.map((product) => normalizeId(product._id)).filter(Boolean);

const isFormProductSelected = (productId) => {
    const normalizedId = normalizeId(productId);
    return bannerFormProducts.some((product) => normalizeId(product._id) === normalizedId);
};

const renderBannerFormProductResults = (results, keyword) => {
    const { searchResults } = getBannerFormProductElements();
    if (!searchResults) return;

    if (Array.isArray(results)) {
        bannerFormProductSearchResults = results;
    }
    const effectiveKeyword = keyword ?? bannerFormProductSearchKeyword;
    if (!effectiveKeyword || effectiveKeyword.length < 2) {
        searchResults.innerHTML = productSearchPlaceholderMarkup;
        return;
    }

    if (!bannerFormProductSearchResults.length) {
        searchResults.innerHTML =
            '<p class="search-placeholder">Không tìm thấy sản phẩm phù hợp</p>';
        return;
    }

    searchResults.innerHTML = bannerFormProductSearchResults
        .map((product) => {
            const productId = normalizeId(product._id);
            const selected = isFormProductSelected(productId);
            return `
                <div class="banner-product-result">
                    <div class="product-info">
                        <img src="${product.imageUrl || bannerProductPlaceholderImage}" alt="${product.title || "Sản phẩm"
                }" onerror="this.src='${bannerProductPlaceholderImage}'" />
                        <div>
                            <p class="product-name">${product.title || "Sản phẩm"}</p>
                            <span class="product-price">${formatBannerProductPrice(product.price)}</span>
                            <small>Kho: ${product.stock ?? 0}</small>
                        </div>
                    </div>
                    <button class="btn ${selected ? "btn-secondary" : "btn-outline"} btn-sm" data-action="add-form-product" data-id="${productId}" ${selected ? "disabled" : ""
                }>
                        ${selected ? "Đã thêm" : "Thêm"}
                    </button>
                </div>
            `;
        })
        .join("");
};

const handleBannerFormSearchInput = (event) => {
    const keyword = event.target.value.trim();
    bannerFormProductSearchKeyword = keyword;
    clearTimeout(bannerFormProductSearchDebounce);

    if (keyword.length < 2) {
        renderBannerFormProductResults([], keyword);
        return;
    }

    const { searchResults } = getBannerFormProductElements();
    if (searchResults) {
        searchResults.innerHTML =
            '<p class="search-placeholder"><i class="fas fa-spinner fa-spin"></i> Đang tìm kiếm...</p>';
    }

    bannerFormProductSearchDebounce = setTimeout(
        () => performBannerFormProductSearch(keyword),
        350
    );
};

const performBannerFormProductSearch = async (keyword) => {
    const requestKeyword = keyword;
    try {
        const params = new URLSearchParams({
            keyword,
            limit: "8",
            sortBy: "rating",
            sortOrder: "desc",
        });
        const response = await apiCall(`/api/appliances/advanced/search?${params.toString()}`);
        if (!response) return;
        if (bannerFormProductSearchKeyword !== requestKeyword) return;
        if (!response.status) {
            showNotification(response.message || "Không thể tìm sản phẩm", "error");
            renderBannerFormProductResults([], keyword);
            return;
        }
        renderBannerFormProductResults(response.data || [], keyword);
    } catch (error) {
        console.error("[performBannerFormProductSearch]", error);
        if (bannerFormProductSearchKeyword === requestKeyword) {
            showNotification(error.message || "Không thể tìm sản phẩm", "error");
            renderBannerFormProductResults([], keyword);
        }
    }
};

const addProductToBannerForm = (product) => {
    if (!product) return;
    if (bannerFormProducts.length >= MAX_BANNER_PRODUCTS) {
        showNotification(`Chỉ thêm tối đa ${MAX_BANNER_PRODUCTS} sản phẩm cho mỗi banner`, "error");
        return;
    }
    const productId = normalizeId(product._id);
    if (!productId || isFormProductSelected(productId)) return;
    bannerFormProducts = [...bannerFormProducts, { ...product, _id: productId }];
    renderBannerFormProducts(bannerFormProducts);
    renderBannerFormProductResults();
};

const removeProductFromBannerForm = (productId) => {
    const normalizedId = normalizeId(productId);
    if (!normalizedId) return;
    bannerFormProducts = bannerFormProducts.filter(
        (product) => normalizeId(product._id) !== normalizedId
    );
    renderBannerFormProducts(bannerFormProducts);
    renderBannerFormProductResults();
};

const handleBannerFormSearchResultClick = (event) => {
    const target = event.target.closest("[data-action='add-form-product']");
    if (!target) return;
    const product = bannerFormProductSearchResults.find(
        (item) => normalizeId(item._id) === target.dataset.id
    );
    if (!product) return;
    addProductToBannerForm(product);
};

const handleBannerFormProductsClick = (event) => {
    const target = event.target.closest("[data-action='remove-form-product']");
    if (!target) return;
    removeProductFromBannerForm(target.dataset.id);
};

const isProductSelected = (productId) => {
    const normalizedId = normalizeId(productId);
    return (currentBannerDetail?.linkedProducts || []).some(
        (product) => normalizeId(product._id) === normalizedId
    );
};

const renderBannerProductResults = (results, keyword) => {
    const { searchResults } = getBannerDetailElements();
    if (!searchResults) return;

    if (Array.isArray(results)) {
        bannerProductSearchResults = results;
    }
    const effectiveKeyword = keyword ?? bannerProductSearchKeyword;
    if (!effectiveKeyword || effectiveKeyword.length < 2) {
        searchResults.innerHTML = productSearchPlaceholderMarkup;
        return;
    }

    if (!bannerProductSearchResults.length) {
        searchResults.innerHTML =
            '<p class="search-placeholder">Không tìm thấy sản phẩm phù hợp</p>';
        return;
    }

    searchResults.innerHTML = bannerProductSearchResults
        .map((product) => {
            const productId = normalizeId(product._id);
            const selected = isProductSelected(productId);
            return `
                <div class="banner-product-result">
                    <div class="product-info">
                        <img src="${product.imageUrl || bannerProductPlaceholderImage}" alt="${product.title || "Sản phẩm"
                }" onerror="this.src='${bannerProductPlaceholderImage}'" />
                        <div>
                            <p class="product-name">${product.title || "Sản phẩm"}</p>
                            <span class="product-price">${formatBannerProductPrice(product.price)}</span>
                            <small>Kho: ${product.stock ?? 0}</small>
                        </div>
                    </div>
                    <button class="btn ${selected ? "btn-secondary" : "btn-outline"} btn-sm" data-action="add-product" data-id="${productId}" ${selected ? "disabled" : ""
                }>
                        ${selected ? "Đã thêm" : "Thêm"}
                    </button>
                </div>
            `;
        })
        .join("");
};

const resetBannerProductSearchUI = () => {
    const { searchInput, searchResults } = getBannerDetailElements();
    bannerProductSearchKeyword = "";
    bannerProductSearchResults = [];
    if (searchInput) searchInput.value = "";
    if (searchResults) searchResults.innerHTML = productSearchPlaceholderMarkup;
};

const resetBannerDetailModalState = () => {
    currentBannerDetail = null;
    resetBannerProductSearchUI();
    renderBannerLinkedProducts([]);
};

const handleBannerProductSearchInput = (event) => {
    const keyword = event.target.value.trim();
    bannerProductSearchKeyword = keyword;
    clearTimeout(bannerProductSearchDebounce);

    if (keyword.length < 2) {
        renderBannerProductResults([], keyword);
        return;
    }

    const { searchResults } = getBannerDetailElements();
    if (searchResults) {
        searchResults.innerHTML =
            '<p class="search-placeholder"><i class="fas fa-spinner fa-spin"></i> Đang tìm kiếm...</p>';
    }

    bannerProductSearchDebounce = setTimeout(() => performBannerProductSearch(keyword), 350);
};

const performBannerProductSearch = async (keyword) => {
    const requestKeyword = keyword;
    try {
        const params = new URLSearchParams({
            keyword,
            limit: "8",
            sortBy: "rating",
            sortOrder: "desc",
        });
        const response = await apiCall(`/api/appliances/advanced/search?${params.toString()}`);
        if (!response) return;
        if (bannerProductSearchKeyword !== requestKeyword) return;
        if (!response.status) {
            showNotification(response.message || "Không thể tìm sản phẩm", "error");
            renderBannerProductResults([], keyword);
            return;
        }
        renderBannerProductResults(response.data || [], keyword);
    } catch (error) {
        console.error("[performBannerProductSearch]", error);
        if (bannerProductSearchKeyword === requestKeyword) {
            showNotification(error.message || "Không thể tìm sản phẩm", "error");
            renderBannerProductResults([], keyword);
        }
    }
};

const addProductToBanner = (product) => {
    if (!currentBannerDetail || !product) return;
    const productId = normalizeId(product._id);
    if (isProductSelected(productId)) return;
    const normalizedProduct = { ...product, _id: productId };
    const products = [...(currentBannerDetail.linkedProducts || []), normalizedProduct];
    currentBannerDetail.linkedProducts = products;
    currentBannerDetail.productIds = products.map((item) => normalizeId(item._id));
    renderBannerLinkedProducts(products);
};

const removeProductFromBanner = (productId) => {
    if (!currentBannerDetail) return;
    const normalizedId = normalizeId(productId);
    const products = (currentBannerDetail.linkedProducts || []).filter(
        (item) => normalizeId(item._id) !== normalizedId
    );
    currentBannerDetail.linkedProducts = products;
    currentBannerDetail.productIds = products.map((item) => normalizeId(item._id));
    renderBannerLinkedProducts(products);
    renderBannerProductResults();
};

const handleBannerSearchResultClick = (event) => {
    const target = event.target.closest("[data-action='add-product']");
    if (!target) return;
    const productId = target.dataset.id;
    const product = bannerProductSearchResults.find(
        (item) => normalizeId(item._id) === productId
    );
    if (!product) return;
    addProductToBanner(product);
    renderBannerProductResults();
};

const handleBannerLinkedProductClick = (event) => {
    const target = event.target.closest("[data-action='remove-product']");
    if (!target) return;
    removeProductFromBanner(target.dataset.id);
};

const closeBannerDetailModal = () => {
    const { modal } = getBannerDetailElements();
    if (!modal) return;
    modal.style.display = "none";
    modal.classList.remove("active");
    resetBannerDetailModalState();
};

const getCurrentBannerProductIds = () =>
    (currentBannerDetail?.linkedProducts || []).map((item) => normalizeId(item._id)).filter(Boolean);

const handleSaveBannerProducts = async () => {
    if (!currentBannerDetail) {
        showNotification("Chưa chọn banner để lưu", "error");
        return;
    }

    const { saveButton } = getBannerDetailElements();
    const payload = { productIds: getCurrentBannerProductIds() };
    const originalLabel = saveButton?.innerHTML;

    try {
        if (saveButton) {
            saveButton.disabled = true;
            saveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang lưu...';
        }
        const response = await apiCall(`/api/banners/${currentBannerDetail._id}/products`, {
            method: "PUT",
            body: JSON.stringify(payload),
        });
        if (!response) return;
        if (!response.status) {
            showNotification(response.message || "Không thể lưu sản phẩm", "error");
            return;
        }
        currentBannerDetail.productIds = response.data?.productIds || payload.productIds;
        const updatedProducts = Array.isArray(response.data?.linkedProducts)
            ? response.data.linkedProducts
            : currentBannerDetail.linkedProducts || [];
        currentBannerDetail.linkedProducts = updatedProducts;
        renderBannerLinkedProducts(updatedProducts);
        renderBannerProductResults();
        showNotification("Đã lưu danh sách sản phẩm cho banner");
    } catch (error) {
        console.error("[handleSaveBannerProducts]", error);
        showNotification(error.message || "Không thể lưu sản phẩm", "error");
    } finally {
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.innerHTML = originalLabel;
        }
    }
};

const setupBannerDetailEvents = () => {
    const { searchInput, searchResults, linkedProducts, modal, saveButton } =
        getBannerDetailElements();
    searchInput?.addEventListener("input", handleBannerProductSearchInput);
    searchResults?.addEventListener("click", handleBannerSearchResultClick);
    linkedProducts?.addEventListener("click", handleBannerLinkedProductClick);
    saveButton?.addEventListener("click", handleSaveBannerProducts);

    if (modal) {
        const closeBtn = modal.querySelector(".close");
        const cleanup = () => resetBannerDetailModalState();
        closeBtn?.addEventListener("click", cleanup);
        modal.addEventListener("click", (event) => {
            if (event.target === modal) {
                cleanup();
            }
        });
    }

    resetBannerDetailModalState();
};

const setupBannerFormProductEvents = () => {
    const { searchInput, searchResults, container } = getBannerFormProductElements();
    searchInput?.addEventListener("input", handleBannerFormSearchInput);
    searchResults?.addEventListener("click", handleBannerFormSearchResultClick);
    container?.addEventListener("click", handleBannerFormProductsClick);
    resetBannerFormProductState();
};

const openBannerDetail = async (bannerId) => {
    if (!bannerId) {
        showNotification("Không xác định được banner", "error");
        return;
    }

    const { linkedProducts } = getBannerDetailElements();
    currentBannerDetail = null;
    showBannerDetailModal();

    if (linkedProducts) {
        linkedProducts.classList.remove("empty-state");
        linkedProducts.innerHTML =
            '<p class="search-placeholder"><i class="fas fa-spinner fa-spin"></i> Đang tải chi tiết banner...</p>';
    }

    try {
        const response = await apiCall(`/api/banners/${bannerId}`);
        if (!response) {
            closeBannerDetailModal();
            return;
        }
        if (!response.status || !response.data) {
            showNotification(response.message || "Không thể tải chi tiết banner", "error");
            closeBannerDetailModal();
            return;
        }
        currentBannerDetail = response.data;
        renderBannerDetailMeta(currentBannerDetail);
        renderBannerLinkedProducts(currentBannerDetail.linkedProducts || []);
        resetBannerProductSearchUI();
    } catch (error) {
        console.error("[openBannerDetail]", error);
        showNotification(error.message || "Không thể tải chi tiết banner", "error");
        closeBannerDetailModal();
    }
};

function setupBannerEvents() {
    const searchInput = document.getElementById("banner-search");
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            clearTimeout(bannerSearchDebounce);
            bannerSearchDebounce = setTimeout(() => {
                bannerState.keyword = searchInput.value.trim();
                loadBanners(1);
            }, 400);
        });
    }

    const statusFilter = document.getElementById("banner-status-filter");
    statusFilter?.addEventListener("change", () => {
        bannerState.status = statusFilter.value;
        loadBanners(1);
    });

    document.getElementById("banner-create-btn")?.addEventListener("click", () =>
        openBannerModal()
    );
    document
        .getElementById("banner-refresh-btn")
        ?.addEventListener("click", () => loadBanners(bannerState.page));
    document
        .getElementById("banner-save-order-btn")
        ?.addEventListener("click", handleSaveBannerOrders);

    setupBannerFormProductEvents();
    setupBannerDetailEvents();

    const { form, selectBtn, fileInput } = getBannerFormElements();
    form?.addEventListener("submit", submitBannerForm);
    selectBtn?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", handleBannerFileChange);
}

document.addEventListener("DOMContentLoaded", () => {
    setupBannerEvents();
});

window.loadBanners = loadBanners;
window.openBannerModal = openBannerModal;
window.editBanner = editBanner;
window.deleteBanner = deleteBanner;
window.toggleBannerStatus = toggleBannerStatus;
window.openBannerDetail = openBannerDetail;
