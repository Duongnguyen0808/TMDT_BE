// Voucher Management
let currentVouchersPage = 1;
const vouchersPerPage = 20;
let editingVoucherId = null;

async function loadVouchers(page = 1) {
  const search = document.getElementById("voucher-search").value;

  try {
    let url = `/api/admin/vouchers?page=${page}&limit=${vouchersPerPage}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    const data = await apiCall(url);

    if (data && data.status) {
      renderVouchersTable(data.data);
      renderVouchersPagination(data.pagination);
    }
  } catch (error) {
    console.error("Error loading vouchers:", error);
  }
}

function renderVouchersTable(vouchers) {
  const tbody = document.getElementById("vouchers-tbody");

  const html = vouchers
    .map((voucher) => {
      const typeLabel = voucher.type === "percentage" ? "Phần trăm" : "Cố định";
      const valueDisplay =
        voucher.type === "percentage"
          ? `${voucher.value}%`
          : formatCurrency(voucher.value);

      const validFrom = voucher.validFrom
        ? new Date(voucher.validFrom).toLocaleDateString("vi-VN")
        : "Không giới hạn";
      const validUntil = voucher.validUntil
        ? new Date(voucher.validUntil).toLocaleDateString("vi-VN")
        : "Không giới hạn";

      const usageDisplay = `${voucher.usedCount || 0}/${voucher.usageLimit || "∞"
        }`;

      const statusBadge = voucher.isActive
        ? '<span class="badge badge-success">Hoạt động</span>'
        : '<span class="badge badge-danger">Tắt</span>';

      return `
        <tr>
          <td><strong>${voucher.code}</strong></td>
          <td>${voucher.title || "Chưa có"}</td>
          <td><span class="badge badge-info">${typeLabel}</span></td>
          <td>${valueDisplay}</td>
          <td>${validFrom}</td>
          <td>${validUntil}</td>
          <td>${usageDisplay}</td>
          <td>${statusBadge}</td>
          <td>
            <button class="btn btn-primary btn-sm" onclick="editVoucher('${voucher._id
        }')">
              <i class="fas fa-edit"></i> Sửa
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteVoucher('${voucher._id
        }')">
              <i class="fas fa-trash"></i> Xóa
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.innerHTML = html;
}

function renderVouchersPagination(pagination) {
  const container = document.getElementById("vouchers-pagination");
  const { page, totalPages } = pagination;

  let html = "";

  if (page > 1) {
    html += `<button onclick="loadVouchers(${page - 1})">‹ Trước</button>`;
  }

  for (let i = 1; i <= totalPages; i++) {
    if (i === page) {
      html += `<button class="active">${i}</button>`;
    } else {
      html += `<button onclick="loadVouchers(${i})">${i}</button>`;
    }
  }

  if (page < totalPages) {
    html += `<button onclick="loadVouchers(${page + 1})">Sau ›</button>`;
  }

  container.innerHTML = html;
}

function openVoucherModal(voucherId = null) {
  editingVoucherId = voucherId;
  const modal = document.getElementById("voucherModal");
  const form = document.getElementById("voucher-form");
  const title = document.getElementById("voucher-modal-title");

  // Reset form
  form.reset();

  if (voucherId) {
    title.textContent = "Chỉnh sửa mã giảm giá";
    loadVoucherData(voucherId);
  } else {
    title.textContent = "Tạo mã giảm giá mới";
  }

  modal.style.display = "block";
}

async function loadVoucherData(voucherId) {
  try {
    const data = await apiCall(`/api/admin/vouchers?page=1&limit=1000`);
    const voucher = data.data.find((v) => v._id === voucherId);

    if (voucher) {
      document.getElementById("voucher-id").value = voucher._id;
      document.getElementById("voucher-code").value = voucher.code;
      document.getElementById("voucher-title").value = voucher.title || "";
      document.getElementById("voucher-description").value =
        voucher.description || "";
      document.getElementById("voucher-type").value = voucher.type;
      document.getElementById("voucher-value").value = voucher.value;
      document.getElementById("voucher-max-discount").value =
        voucher.maxDiscount || "";
      document.getElementById("voucher-min-order").value =
        voucher.minOrderTotal || 0;

      if (voucher.validFrom) {
        const from = new Date(voucher.validFrom);
        document.getElementById("voucher-valid-from").value = from
          .toISOString()
          .slice(0, 16);
      }

      if (voucher.validUntil) {
        const until = new Date(voucher.validUntil);
        document.getElementById("voucher-valid-until").value = until
          .toISOString()
          .slice(0, 16);
      }

      document.getElementById("voucher-usage-limit").value =
        voucher.usageLimit || "";
      document.getElementById("voucher-is-active").checked = voucher.isActive;
    }
  } catch (error) {
    console.error("Error loading voucher:", error);
  }
}

async function editVoucher(voucherId) {
  openVoucherModal(voucherId);
}

async function deleteVoucher(voucherId) {
  if (!confirm("Bạn có chắc muốn xóa mã giảm giá này?")) return;

  try {
    const data = await apiCall(`/api/admin/vouchers/${voucherId}`, {
      method: "DELETE",
    });

    if (data && data.status) {
      showNotification("Đã xóa mã giảm giá thành công!");
      loadVouchers(currentVouchersPage);
    } else {
      showNotification(data.message || "Xóa mã giảm giá thất bại!", "error");
    }
  } catch (error) {
    console.error("Error deleting voucher:", error);
    showNotification("Có lỗi xảy ra khi xóa mã giảm giá!", "error");
  }
}

// Handle voucher form submission
document.addEventListener("DOMContentLoaded", () => {
  const voucherForm = document.getElementById("voucher-form");
  if (voucherForm) {
    voucherForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const voucherId = document.getElementById("voucher-id").value;
      const formData = {
        code: document.getElementById("voucher-code").value.toUpperCase(),
        title: document.getElementById("voucher-title").value,
        description: document.getElementById("voucher-description").value,
        type: document.getElementById("voucher-type").value,
        value: parseFloat(document.getElementById("voucher-value").value),
        maxDiscount: document.getElementById("voucher-max-discount").value
          ? parseFloat(document.getElementById("voucher-max-discount").value)
          : undefined,
        minOrderTotal: parseFloat(
          document.getElementById("voucher-min-order").value || 0
        ),
        validFrom: document.getElementById("voucher-valid-from").value || null,
        validUntil:
          document.getElementById("voucher-valid-until").value || null,
        usageLimit: document.getElementById("voucher-usage-limit").value
          ? parseInt(document.getElementById("voucher-usage-limit").value)
          : undefined,
        isActive: document.getElementById("voucher-is-active").checked,
      };

      try {
        let data;
        if (voucherId) {
          // Update
          data = await apiCall(`/api/admin/vouchers/${voucherId}`, {
            method: "PUT",
            body: JSON.stringify(formData),
          });
        } else {
          // Create
          data = await apiCall("/api/admin/vouchers", {
            method: "POST",
            body: JSON.stringify(formData),
          });
        }

        if (data && data.status) {
          showNotification(
            voucherId
              ? "Cập nhật mã giảm giá thành công!"
              : "Tạo mã giảm giá thành công!"
          );
          document.getElementById("voucherModal").style.display = "none";
          loadVouchers(currentVouchersPage);
        } else {
          showNotification(data.message || "Lưu mã giảm giá thất bại!", "error");
        }
      } catch (error) {
        console.error("Error saving voucher:", error);
        showNotification("Có lỗi xảy ra khi lưu mã giảm giá!", "error");
      }
    });
  }

  // Search vouchers
  const searchInput = document.getElementById("voucher-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      loadVouchers(1);
    });
  }
});

function formatCurrency(amount) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
  }).format(amount);
}
