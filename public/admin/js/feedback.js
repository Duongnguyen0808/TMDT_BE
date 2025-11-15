// Feedback Management
let currentFeedbackPage = 1;
const feedbackPerPage = 10;

async function loadFeedback(page = 1) {
  const status = document.getElementById("feedback-status-filter").value;
  const type = document.getElementById("feedback-type-filter").value;

  try {
    let url = `/api/feedback/admin/all?page=${page}&limit=${feedbackPerPage}`;
    if (status) url += `&status=${status}`;
    if (type) url += `&type=${type}`;

    const data = await apiCall(url);

    if (data && data.status) {
      renderFeedbackList(data.data);
      renderFeedbackPagination(data.pagination);
    }
  } catch (error) {
    console.error("Error loading feedback:", error);
  }
}

function renderFeedbackList(feedbacks) {
  const container = document.getElementById("feedback-list");

  const html = feedbacks
    .map((feedback) => {
      let statusBadge = "";
      if (feedback.status === "Resolved") {
        statusBadge = '<span class="badge badge-success">Resolved</span>';
      } else if (feedback.status === "In Progress") {
        statusBadge = '<span class="badge badge-info">In Progress</span>';
      } else if (feedback.status === "Closed") {
        statusBadge = '<span class="badge badge-secondary">Closed</span>';
      } else {
        statusBadge = '<span class="badge badge-warning">Pending</span>';
      }

      let priorityBadge = "";
      if (feedback.priority === "Urgent") {
        priorityBadge = '<span class="badge badge-danger">Urgent</span>';
      } else if (feedback.priority === "High") {
        priorityBadge = '<span class="badge badge-warning">High</span>';
      } else if (feedback.priority === "Medium") {
        priorityBadge = '<span class="badge badge-info">Medium</span>';
      } else {
        priorityBadge = '<span class="badge badge-secondary">Low</span>';
      }

      return `
            <div class="feedback-item">
                <div class="feedback-header">
                    <div>
                        <span class="feedback-subject">${
                          feedback.subject
                        }</span>
                        <span class="badge badge-info" style="margin-left: 10px;">${
                          feedback.type
                        }</span>
                    </div>
                    <div>
                        ${priorityBadge}
                        ${statusBadge}
                    </div>
                </div>
                <div class="feedback-message">${feedback.message}</div>
                ${
                  feedback.adminResponse
                    ? `
                    <div style="background: #f0f0f0; padding: 10px; border-radius: 5px; margin-top: 10px;">
                        <strong>Phản hồi Admin:</strong> ${feedback.adminResponse}
                    </div>
                `
                    : ""
                }
                <div class="feedback-footer">
                    <div class="feedback-user">
                        <i class="fas fa-user"></i> ${
                          feedback.userId?.username || "N/A"
                        } 
                        <span style="color: #999; margin-left: 10px;">${formatDate(
                          feedback.createdAt
                        )}</span>
                    </div>
                    <button class="btn btn-primary btn-sm" onclick="openFeedbackModal('${
                      feedback._id
                    }', '${feedback.status}', '${feedback.priority}', '${
        feedback.adminResponse || ""
      }')">
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

function openFeedbackModal(feedbackId, status, priority, adminResponse) {
  document.getElementById("feedback-id").value = feedbackId;
  document.getElementById("feedback-response-status").value = status;
  document.getElementById("feedback-priority").value = priority;
  document.getElementById("admin-response").value = adminResponse;
  document.getElementById("feedbackModal").classList.add("active");
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
      const data = await apiCall(`/api/feedback/admin/${feedbackId}`, {
        method: "PATCH",
        body: JSON.stringify({ status, priority, adminResponse }),
      });

      if (data && data.status) {
        showNotification("Cập nhật feedback thành công!");
        document.getElementById("feedbackModal").classList.remove("active");
        loadFeedback(currentFeedbackPage);
      } else {
        showNotification("Cập nhật thất bại!", "error");
      }
    } catch (error) {
      console.error("Error updating feedback:", error);
      showNotification("Có lỗi xảy ra!", "error");
    }
  });

// Event listeners
document
  .getElementById("feedback-status-filter")
  .addEventListener("change", () => loadFeedback(1));
document
  .getElementById("feedback-type-filter")
  .addEventListener("change", () => loadFeedback(1));
