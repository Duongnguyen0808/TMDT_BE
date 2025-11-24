// Shippers (applications) management

async function loadShippers(status = 'pending') {
    try {
        const select = document.getElementById('shipper-status-filter');
        if (select) {
            select.value = status;
            select.onchange = () => loadShippers(select.value);
        }

        const res = await apiCall(`/api/shippers/applications?status=${encodeURIComponent(status)}`);
        if (!res || res.status === false) {
            showNotification(res?.message || 'Không tải được danh sách hồ sơ', 'error');
            return;
        }
        const list = res.data || [];
        const tbody = document.getElementById('shippers-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        const bulkApproveBtn = document.getElementById('bulk-approve-btn');
        const bulkRejectBtn = document.getElementById('bulk-reject-btn');
        if (bulkApproveBtn) bulkApproveBtn.disabled = status !== 'pending';
        if (bulkRejectBtn) bulkRejectBtn.disabled = status !== 'pending';
        const selectAll = document.getElementById('shipper-select-all');
        if (selectAll) selectAll.checked = false;

        list.forEach((app) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
        <td><input type="checkbox" class="shipper-select" value="${app._id}" ${app.approvalStatus !== 'pending' ? 'disabled' : ''}/></td>
        <td>${escapeHtml(app.fullName || app.user?.username || '')}<br/><small>${escapeHtml(app.user?.email || '')}</small></td>
        <td>${escapeHtml(app.phone || '')}</td>
        <td>${escapeHtml(app.vehicleType || '')}</td>
        <td>${escapeHtml(app.vehiclePlate || '')}</td>
        <td>${escapeHtml(app.approvalStatus || '')}</td>
        <td>${formatDate(app.createdAt)}</td>
        <td>
          <button class="btn btn-secondary btn-sm" data-action="view" data-id="${app._id}"><i class="fas fa-eye"></i></button>
          ${app.approvalStatus === 'pending' ? `
            <button class="btn btn-primary btn-sm" data-action="approve" data-id="${app._id}"><i class="fas fa-check"></i></button>
            <button class="btn btn-danger btn-sm" data-action="reject" data-id="${app._id}"><i class="fas fa-times"></i></button>
          ` : ''}
        </td>
      `;
            tbody.appendChild(tr);
        });

        // Row actions
        tbody.querySelectorAll('button[data-action]').forEach((btn) => {
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            btn.addEventListener('click', () => {
                if (action === 'view') return openShipperDetail(id);
                if (action === 'approve') return approveShipper(id);
                if (action === 'reject') return rejectShipper(id);
            });
        });

        // Select all
        if (selectAll) {
            selectAll.onchange = () => {
                tbody.querySelectorAll('input.shipper-select:not(:disabled)')
                    .forEach(cb => cb.checked = selectAll.checked);
            };
        }

        // Bulk actions
        if (bulkApproveBtn) {
            bulkApproveBtn.onclick = async () => {
                const ids = getSelectedShipperIds();
                if (!ids.length) return alert('Chưa chọn hồ sơ nào');
                if (!confirm(`Duyệt ${ids.length} hồ sơ?`)) return;
                const res = await apiCall('/api/shippers/applications/bulk-approve', {
                    method: 'PUT',
                    body: JSON.stringify({ ids })
                });
                if (res && res.status) {
                    showNotification(res.message || 'Đã duyệt các hồ sơ');
                    loadShippers(getCurrentShipperStatus());
                    // Refresh dashboard badge if function exists
                    if (typeof loadDashboard === 'function') {
                        loadDashboard();
                    } else {
                        // Fallback: decrement pending badge locally
                        const badge = document.getElementById('pending-shippers');
                        if (badge) {
                            const current = parseInt(badge.textContent || '0', 10);
                            const next = Math.max(0, current - ids.length);
                            badge.textContent = String(next);
                        }
                    }
                } else {
                    showNotification(res?.message || 'Không duyệt được hàng loạt', 'error');
                }
            };
        }
        if (bulkRejectBtn) {
            bulkRejectBtn.onclick = async () => {
                const ids = getSelectedShipperIds();
                if (!ids.length) return alert('Chưa chọn hồ sơ nào');
                const reason = prompt('Nhập lý do từ chối các hồ sơ đã chọn:');
                if (reason === null) return;
                const res = await apiCall('/api/shippers/applications/bulk-reject', {
                    method: 'PUT',
                    body: JSON.stringify({ ids, reason })
                });
                if (res && res.status) {
                    showNotification(res.message || 'Đã từ chối các hồ sơ');
                    loadShippers(getCurrentShipperStatus());
                    if (typeof loadDashboard === 'function') {
                        loadDashboard();
                    } else {
                        // Rejection also reduces pending count
                        const badge = document.getElementById('pending-shippers');
                        if (badge) {
                            const current = parseInt(badge.textContent || '0', 10);
                            const next = Math.max(0, current - ids.length);
                            badge.textContent = String(next);
                        }
                    }
                } else {
                    showNotification(res?.message || 'Không từ chối được hàng loạt', 'error');
                }
            };
        }
    } catch (e) {
        console.error(e);
        showNotification('Lỗi tải danh sách hồ sơ', 'error');
    }
}

async function openShipperDetail(id) {
    try {
        const res = await apiCall(`/api/shippers/applications/${id}`);
        if (!res || res.status === false) {
            showNotification(res?.message || 'Không tải được chi tiết hồ sơ', 'error');
            return;
        }
        const app = res.data;
        const modal = document.getElementById('shipperDetailModal');
        const content = document.getElementById('shipper-detail-content');
        if (!modal || !content) return;

        content.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;">
        <div>
          <p><strong>Họ tên:</strong> ${escapeHtml(app.fullName)}</p>
          <p><strong>Email:</strong> ${escapeHtml(app.user?.email || '')}</p>
          <p><strong>SĐT:</strong> ${escapeHtml(app.phone)}</p>
          <p><strong>Phương tiện:</strong> ${escapeHtml(app.vehicleType)} - ${escapeHtml(app.vehiclePlate)}</p>
          <p><strong>Trạng thái:</strong> ${escapeHtml(app.approvalStatus)}</p>
          ${app.rejectionReason ? `<p><strong>Lý do từ chối:</strong> ${escapeHtml(app.rejectionReason)}</p>` : ''}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          ${imageBox('CMND/CCCD trước', app.idFrontUrl)}
          ${imageBox('CMND/CCCD sau', app.idBackUrl)}
          ${imageBox('Bằng lái', app.driverLicenseUrl)}
          ${imageBox('Đăng ký xe', app.vehicleRegUrl)}
          ${imageBox('Selfie', app.selfieUrl)}
        </div>
      </div>
    `;

        modal.style.display = 'block';
        modal.classList.add('active');
    } catch (e) {
        console.error(e);
        showNotification('Lỗi mở chi tiết hồ sơ', 'error');
    }
}

function imageBox(label, url) {
    const safeUrl = typeof url === 'string' ? url : '';
    return `
    <div style="border:1px solid #eee;border-radius:8px;padding:8px;">
      <div style="font-size:12px;margin-bottom:6px;">${escapeHtml(label)}</div>
      ${safeUrl ? `<a href="${safeUrl}" target="_blank"><img src="${safeUrl}" alt="${escapeHtml(label)}" style="width:100%;height:150px;object-fit:cover;border-radius:6px;"/></a>` : '<em>Không có ảnh</em>'}
    </div>
  `;
}

async function approveShipper(id) {
    if (!confirm('Duyệt hồ sơ này và cấp quyền tài xế?')) return;
    const res = await apiCall(`/api/shippers/applications/${id}/approve`, { method: 'PUT' });
    if (res && res.status) {
        showNotification('Đã duyệt hồ sơ tài xế');
        loadShippers(getCurrentShipperStatus());
    } else {
        showNotification(res?.message || 'Không duyệt được hồ sơ', 'error');
    }
}

async function rejectShipper(id) {
    const reason = prompt('Nhập lý do từ chối:');
    if (reason === null) return;
    const res = await apiCall(`/api/shippers/applications/${id}/reject`, {
        method: 'PUT',
        body: JSON.stringify({ reason })
    });
    if (res && res.status) {
        showNotification('Đã từ chối hồ sơ');
        loadShippers(getCurrentShipperStatus());
    } else {
        showNotification(res?.message || 'Không từ chối được hồ sơ', 'error');
    }
}

function getCurrentShipperStatus() {
    const sel = document.getElementById('shipper-status-filter');
    return sel ? sel.value : 'pending';
}

function getSelectedShipperIds() {
    const tbody = document.getElementById('shippers-tbody');
    if (!tbody) return [];
    return Array.from(tbody.querySelectorAll('input.shipper-select:checked'))
        .map(cb => cb.value);
}

// Helpers
function escapeHtml(unsafe) {
    if (unsafe === undefined || unsafe === null) return '';
    return String(unsafe)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
