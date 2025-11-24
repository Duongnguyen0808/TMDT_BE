// Feedback / Service Ticket Management
let currentFeedbackPage = 1;
const feedbackPerPage = 10;
const ticketCache = new Map();

const statusLabels = {
  Pending: "Chờ xử lý",
  "In Progress": "Đang xử lý",
  WaitingRequester: "Chờ phản hồi",
  Resolved: "Đã xử lý",
  Closed: "Đã đóng",
};

const priorityLabels = {
  Low: "Thấp",
  Normal: "Bình thường",
  High: "Cao",
  Urgent: "Khẩn",
};

const categoryLabels = {
  Order: "Đơn hàng",
  Payment: "Thanh toán",
  Account: "Tài khoản",
  Delivery: "Giao hàng",
  Store: "Cửa hàng",
  Driver: "Tài xế",
  Settlement: "Đối soát",
  Technical: "Kỹ thuật",
  Other: "Khác",
};

const translateStatus = (status) => statusLabels[status] || status || "--";
const translatePriority = (priority) => priorityLabels[priority] || priority || "--";
const translateCategory = (category) => categoryLabels[category] || category || "--";

function buildStatusBadge(status) {
  const label = translateStatus(status);
  let cls = "badge badge-warning";
  switch (status) {
    case "Resolved":
      cls = "badge badge-success";
      break;
    case "In Progress":
      cls = "badge badge-info";
      break;
    case "WaitingRequester":
      cls = "badge badge-warning";
      break;
    case "Closed":
      cls = "badge badge-secondary";
      break;
    default:
      cls = "badge badge-warning";
  }
  return `<span class="${cls}">${label}</span>`;
}

function buildPriorityBadge(priority) {
  const label = translatePriority(priority);
  let cls = "badge badge-secondary";
  switch (priority) {
    case "Urgent":
      cls = "badge badge-danger";
      break;
    case "High":
      cls = "badge badge-warning";
      break;
    case "Normal":
      cls = "badge badge-info";
      break;
    default:
      cls = "badge badge-secondary";
  }
  return `<span class="${cls}">${label}</span>`;
}

async function loadFeedback(page = 1) {
  currentFeedbackPage = page;
  ticketCache.clear();
  const status = document.getElementById("feedback-status-filter").value;
  const type = document.getElementById("feedback-type-filter").value;

  try {
    let url = `/api/service-center/admin/tickets?page=${page}&limit=${feedbackPerPage}`;
    if (status) url += `&status=${encodeURIComponent(status)}`;
    if (type) url += `&category=${encodeURIComponent(type)}`;

    const data = await apiCall(url);

    if (data && data.status) {
      const list = Array.isArray(data.data) ? data.data : [];
      list.forEach((ticket) => {
        if (ticket && ticket._id) {
          ticketCache.set(ticket._id, ticket);
        }
      });
      renderFeedbackList(list);
      renderFeedbackPagination(data.pagination);
    } else {
      renderFeedbackList([]);
      showFeedbackMessage(
        data?.message || "Không thể tải yêu cầu hỗ trợ. Vui lòng thử lại.",
        true
      );
    }
  } catch (error) {
    console.error("Error loading service tickets:", error);
    renderFeedbackList([]);
    showFeedbackMessage("Đã xảy ra lỗi khi tải yêu cầu hỗ trợ", true);
  }
}

function renderFeedbackList(feedbacks) {
  const container = document.getElementById("feedback-list");

  if (!Array.isArray(feedbacks) || feedbacks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-comments"></i>
        <p>Chưa có yêu cầu nào hoặc không tìm thấy kết quả phù hợp.</p>
      </div>
    `;
    document.getElementById("feedback-pagination").innerHTML = "";
    return;
  }

  const html = feedbacks
    .map((ticket) => {
      const requesterName =
        ticket.requester?.name || ticket.requester?.email || "Không xác định";
      const requesterType = ticket.requester?.type || "Không rõ";
      const lastActivity = ticket.lastMessageAt || ticket.updatedAt || ticket.createdAt;
      const recentMessage =
        ticket.messages && ticket.messages.length
          ? ticket.messages[ticket.messages.length - 1]
          : null;

      return `
            <div class="feedback-item">
                <div class="feedback-header">
                    <div>
                        <span class="feedback-subject">${ticket.subject}</span>
                        <span class="badge badge-info" style="margin-left: 10px;">${translateCategory(
        ticket.category
      )}</span>
                        <span class="badge badge-secondary" style="margin-left: 5px;">${ticket.code || "--"}
                        </span>
                    </div>
                    <div>
                        ${buildPriorityBadge(ticket.priority)}
                        ${buildStatusBadge(ticket.status)}
                    </div>
                </div>
                <div class="feedback-message">${ticket.description || "(Không có mô tả)"}</div>
                ${ticket.resolutionNote
          ? `
                    <div style="background: #f0f0f0; padding: 10px; border-radius: 5px; margin-top: 10px;">
                        <strong>Ghi chú xử lý:</strong> ${ticket.resolutionNote}
                    </div>
                `
          : ""
        }
                ${recentMessage
          ? `
                    <div class="ticket-last-message">
                        <strong>${recentMessage.authorName || recentMessage.authorType || "Hệ thống"}:</strong>
                        <span>${recentMessage.body || "(Không có nội dung)"}</span>
                    </div>
                `
          : ""
        }
                <div class="feedback-footer">
                    <div class="feedback-user">
                        <i class="fas fa-user"></i> ${requesterName}
                        <span style="color: #999; margin-left: 8px;">${requesterType}</span>
                        <span style="color: #999; margin-left: 10px;">${formatDate(
          lastActivity
        )}</span>
                    </div>
                    <button class="btn btn-primary btn-sm" onclick="openFeedbackModal('${ticket._id}')">
                        Phản hồi
                    </button>
                </div>
            </div>
        `;
    })
    .join("");

  container.innerHTML = html;
}

function renderFeedbackPagination(pagination) {
  const container = document.getElementById("feedback-pagination");
  if (!pagination) {
    container.innerHTML = "";
    return;
  }

  const { page, totalPages } = pagination;

  let html = "";

  if (page > 1) {
    html += `<button onclick="loadFeedback(${page - 1})">‹ Trước</button>`;
  }

  for (let i = 1; i <= totalPages; i++) {
    if (i === page) {
      html += `<button class="active">${i}</button>`;
    } else {
      html += `<button onclick="loadFeedback(${i})">${i}</button>`;
    }
  }

  if (page < totalPages) {
    html += `<button onclick="loadFeedback(${page + 1})">Sau ›</button>`;
  }

  container.innerHTML = html;
}

function showFeedbackMessage(message, isError = false) {
  const container = document.getElementById("feedback-list");
  container.innerHTML = `
    <div class="empty-state ${isError ? "error" : ""}">
      <i class="fas ${isError ? "fa-exclamation-triangle" : "fa-comments"}"></i>
      <p>${message}</p>
    </div>
  `;
}

function openFeedbackModal(feedbackId) {
  const ticket = ticketCache.get(feedbackId);
  if (!ticket) {
    showNotification("Không tìm thấy dữ liệu yêu cầu", "error");
    return;
  }

  document.getElementById("feedback-id").value = feedbackId;
  const statusSelect = document.getElementById("feedback-response-status");
  statusSelect.value = ticket.status;
  if (statusSelect.value !== ticket.status) {
    statusSelect.value = "Pending";
  }

  const prioritySelect = document.getElementById("feedback-priority");
  prioritySelect.value = ticket.priority;
  if (prioritySelect.value !== ticket.priority) {
    prioritySelect.value = "Normal";
  }

  document.getElementById("admin-response").value = ticket.resolutionNote || "";
  const modal = document.getElementById("feedbackModal");
  modal.style.display = "flex";
  modal.classList.add("active");
}

document
  .getElementById("feedback-response-form")
  .addEventListener("submit", async (e) => {
    e.preventDefault();

    const feedbackId = document.getElementById("feedback-id").value;
    const status = document.getElementById("feedback-response-status").value;
    const priority = document.getElementById("feedback-priority").value;
    const adminResponse = document.getElementById("admin-response").value;

    try {
      const payload = { status, priority };
      if (adminResponse.trim()) {
        payload.resolutionNote = adminResponse.trim();
      }

      const updateResp = await apiCall(
        `/api/service-center/admin/tickets/${feedbackId}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        }
      );

      if (!updateResp || !updateResp.status) {
        throw new Error(updateResp?.message || "Cập nhật thất bại");
      }

      if (adminResponse.trim()) {
        await apiCall(
          `/api/service-center/admin/tickets/${feedbackId}/reply`,
          {
            method: "POST",
            body: JSON.stringify({ message: adminResponse.trim() }),
          }
        );
      }

      showNotification("Cập nhật yêu cầu thành công!");
      document.getElementById("feedbackModal").classList.remove("active");
      loadFeedback(currentFeedbackPage);
    } catch (error) {
      console.error("Error updating ticket:", error);
      showNotification(error.message || "Có lỗi xảy ra!", "error");
    }
  });

// Event listeners
document
  .getElementById("feedback-status-filter")
  .addEventListener("change", () => loadFeedback(1));
document
  .getElementById("feedback-type-filter")
  .addEventListener("change", () => loadFeedback(1));

// Auto-load when the script is evaluated (e.g. first time opening tab)
document.addEventListener("DOMContentLoaded", () => {
  const feedbackNav = document.querySelector('[data-page="feedback"]');
  if (feedbackNav && feedbackNav.classList.contains("active")) {
    loadFeedback(1);
  }
});
