// API Configuration
const API_BASE_URL = window.location.origin; // Tự động lấy URL của server
const API_URL = `${API_BASE_URL}/api/admin`;

// Store auth token
let authToken = localStorage.getItem("adminToken") || "";
let adminUser = JSON.parse(localStorage.getItem("adminUser") || "null");

// API Helper
async function apiCall(endpoint, options = {}) {
  const defaultOptions = {
    headers: {
      "Content-Type": "application/json",
      Authorization: authToken ? `Bearer ${authToken}` : "",
    },
  };

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...options.headers,
    },
  });

  if (response.status === 401 || response.status === 403) {
    // Unauthorized - redirect to login
    logout();
    return null;
  }

  const data = await response.json();
  return data;
}

// Format currency
function formatCurrency(amount) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
  }).format(amount);
}

// Format date
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString("vi-VN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Show notification
function showNotification(message, type = "success") {
  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 25px;
        background: ${type === "success" ? "#4CAF50" : "#F44336"};
        color: white;
        border-radius: 5px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 3000;
        animation: slideIn 0.3s ease-in-out;
    `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// Rating helpers reused across admin modules
function normalizeRatingValue(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  if (value < 0) return 0;
  if (value > 5) return 5;
  return value;
}

function createStarRating(value) {
  const normalized = normalizeRatingValue(value);
  if (normalized === null) {
    return "";
  }

  let fullStars = Math.floor(normalized);
  const fraction = normalized - fullStars;
  let showHalfStar = false;

  if (fraction >= 0.75) {
    fullStars = Math.min(5, fullStars + 1);
  } else if (fraction >= 0.25) {
    showHalfStar = true;
  }

  let starsHtml =
    '<span class="rating-stars" style="display:inline-flex;gap:2px;color:#f7b500;">';

  for (let i = 0; i < 5; i += 1) {
    if (i < fullStars) {
      starsHtml += '<i class="fas fa-star"></i>';
    } else if (showHalfStar) {
      starsHtml += '<i class="fas fa-star-half-alt"></i>';
      showHalfStar = false;
    } else {
      starsHtml += '<i class="far fa-star"></i>';
    }
  }

  starsHtml += "</span>";
  return starsHtml;
}
