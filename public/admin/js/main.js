// Main navigation and page management
document.addEventListener("DOMContentLoaded", () => {
  // Navigation
  const navItems = document.querySelectorAll(".nav-item");
  const pages = document.querySelectorAll(".page");

  navItems.forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();

      const targetPage = item.dataset.page;
      if (!targetPage) return;

      // Update active nav item
      navItems.forEach((nav) => nav.classList.remove("active"));
      item.classList.add("active");

      // Update active page
      pages.forEach((page) => page.classList.remove("active"));
      document.getElementById(`${targetPage}-page`).classList.add("active");

      // Update page title
      const pageTitle = item.textContent.trim();
      document.getElementById("page-title").textContent = pageTitle;

      // Load page data
      loadPageData(targetPage);
    });
  });

  // Close modals
  document.querySelectorAll(".modal .close").forEach((closeBtn) => {
    closeBtn.addEventListener("click", function () {
      const modal = this.closest(".modal");
      modal.style.display = "none";
      modal.classList.remove("active");
    });
  });

  // Close modal when clicking outside
  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", function (e) {
      if (e.target === this) {
        this.style.display = "none";
        this.classList.remove("active");
      }
    });
  });
});

function loadPageData(page) {
  switch (page) {
    case "dashboard":
      loadDashboard();
      break;
    case "users":
      loadUsers(1);
      break;
    case "shippers":
      loadShippers('pending');
      break;
    case "stores":
      loadStores(1);
      break;
    case "products":
      loadProducts(1);
      break;
    case "orders":
      loadOrders(1);
      break;
    case "feedback":
      loadFeedback(1);
      break;
    case "vouchers":
      loadVouchers(1);
      break;
  }
}
