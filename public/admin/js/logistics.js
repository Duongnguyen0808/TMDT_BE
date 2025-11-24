(function () {
    const API_BASE = location.origin;
    const token = localStorage.getItem('adminToken');
    function headers() { return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }; }

    async function fetchJSON(url, opts = {}) {
        const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), ...headers() } });
        if (!res.ok) throw new Error('HTTP ' + res.status); return res.json();
    }

    async function loadHubs() {
        try {
            const data = await fetchJSON(API_BASE + '/api/hubs');
            renderHubs(data.data || []);
        } catch (e) { console.error(e); }
    }
    async function loadShipments() {
        try {
            const data = await fetchJSON(API_BASE + '/api/shipments');
            renderShipments(data.data || []);
        } catch (e) { console.error(e); }
    }

    function renderHubs(hubs) {
        const el = document.getElementById('hubsTableBody');
        if (!el) return; el.innerHTML = hubs.map(h => `<tr><td>${h.code}</td><td>${h.name}</td><td>${h.type}</td><td>${h.latitude.toFixed(4)},${h.longitude.toFixed(4)}</td><td>${h.active ? '✔' : '✖'}</td></tr>`).join('');
    }
    function renderShipments(list) {
        const el = document.getElementById('shipmentsTableBody');
        if (!el) return; el.innerHTML = list.map(s => `<tr><td>${s.code}</td><td>${s.status}</td><td>${(s.originHub && s.originHub.code) || ''}</td><td>${(s.localHub && s.localHub.code) || ''}</td><td>${(s.orders || []).length}</td><td><button data-id='${s._id}' class='advanceBtn'>Cập nhật</button></td></tr>`).join('');
    }

    async function advanceShipment(id) {
        try {
            await fetchJSON(API_BASE + '/api/shipments/' + id + '/advance', { method: 'PATCH' });
            loadShipments();
        } catch (e) { alert('Không thể cập nhật tiến độ'); }
    }

    document.addEventListener('click', e => {
        const btn = e.target.closest('.advanceBtn');
        if (btn) { advanceShipment(btn.getAttribute('data-id')); }
    });

    function initSocket() {
        if (typeof io === 'undefined') return; const socket = io(API_BASE, { auth: { token } });
        socket.on('shipment:updated', payload => { console.log('shipment update', payload); loadShipments(); });
        socket.on('order:logistics', payload => { console.log('order logistics', payload); });
    }

    loadHubs();
    loadShipments();
    initSocket();
    setInterval(loadShipments, 30000);
})();
