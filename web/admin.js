const BACKEND_URL = "https://apna-downloader-backend.mirajroonjha.workers.dev";

const authSection = document.getElementById("auth-section");
const dashboardSection = document.getElementById("dashboard-section");
const authError = document.getElementById("auth-error");
const adminDisplay = document.getElementById("admin-display");

const statTotalUsers = document.getElementById("stat-total-users");
const statPaidUsers = document.getElementById("stat-paid-users");
const statActiveSlots = document.getElementById("stat-active-slots");

const usersTableBody = document.getElementById("users-table-body");
const pricingTableBody = document.getElementById("pricing-table-body");

const editUserModal = document.getElementById("edit-user-modal");
const editPricingModal = document.getElementById("edit-pricing-modal");

let adminKey = localStorage.getItem("admin_key");
let usersCached = [];
let pricingCached = [];
let adminPriceFilter = 'monthly';

async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get("token");
    const urlError = urlParams.get("error");
    
    if (urlError) {
        authError.innerText = urlError;
        authError.style.display = "block";
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    if (urlToken) {
        localStorage.setItem("admin_key", urlToken);
        adminKey = urlToken;
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (adminKey) {
        showDashboard();
    } else {
        showAuth();
    }
}

function showAuth() {
    authSection.style.display = "block";
    dashboardSection.style.display = "none";
    adminDisplay.style.display = "none";
}

async function showDashboard() {
    authSection.style.display = "none";
    dashboardSection.style.display = "block";
    adminDisplay.style.display = "block";
    
    await Promise.all([loadUsers(), loadPricing()]);
    calculateStats();
    switchAdminTab('users');
}

async function loadUsers() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/admin/users`, {
            headers: {
                "Authorization": `Bearer ${adminKey}`
            }
        });
        
        if (!response.ok) {
            handleLogout();
            authError.innerText = "Session expired or unauthorized admin access.";
            authError.style.display = "block";
            return;
        }
        
        const data = await response.json();
        if (data.success) {
            usersCached = data.users;
            renderUsers();
        }
    } catch(e) {
        console.error("Failed to load users:", e);
    }
}

async function loadPricing() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/pricing`);
        const data = await response.json();
        if (data.success) {
            pricingCached = data.pricing;
            renderPricing();
        }
    } catch(e) {
        console.error("Failed to load pricing configs:", e);
    }
}

function calculateStats() {
    statTotalUsers.innerText = usersCached.length;
    
    const paid = usersCached.filter(u => u.plan_type !== 'trial').length;
    statPaidUsers.innerText = paid;
    
    let totalSlots = 0;
    let boundSlots = 0;
    
    usersCached.forEach(u => {
        totalSlots += u.pc_slots;
        try {
            const arr = JSON.parse(u.active_devices || "[]");
            boundSlots += arr.length;
        } catch(e) {}
    });
    
    statActiveSlots.innerText = `${boundSlots} / ${totalSlots}`;
}

function renderUsers(usersList = usersCached) {
    usersTableBody.innerHTML = "";
    if (usersList.length === 0) {
        usersTableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted);">No accounts found.</td></tr>`;
        return;
    }
    
    usersList.forEach(u => {
        let devices = [];
        try { devices = JSON.parse(u.active_devices || "[]"); } catch(e) {}
        
        let expiry = 'N/A';
        let statusBadge = '';
        
        if (u.plan_type === 'trial') {
            if (!u.trial_end) {
                // Trial has not started yet
                statusBadge = `<span class="badge info" style="background: rgba(59, 130, 246, 0.15); color: var(--accent-color); border: 1px solid rgba(59, 130, 246, 0.3); padding: 4px 8px; border-radius: 4px; font-size: 11px;">NOT STARTED</span>`;
                expiry = '-';
            } else {
                // Trial has started
                const isTrialActive = new Date(u.trial_end) > new Date() && u.status === 'active';
                if (isTrialActive) {
                    statusBadge = `<span class="badge success">ACTIVE</span>`;
                    expiry = new Date(u.trial_end).toLocaleDateString();
                } else {
                    statusBadge = `<span class="badge danger">EXPIRED</span>`;
                    expiry = '-';
                }
            }
        } else {
            // Paid plans (monthly, yearly, lifetime)
            expiry = 'N/A';
            if (u.status === 'active') {
                statusBadge = `<span class="badge success">ACTIVE</span>`;
            } else {
                statusBadge = `<span class="badge danger">EXPIRED</span>`;
            }
        }
        
        const fullName = `${u.first_name || '-'} ${u.last_name || ''}`.trim();
        
        let accessCell = '';
        if (u.is_blacklisted === 1) {
            accessCell = `<span class="badge danger">BLACKLISTED</span>`;
        } else if (u.approval_status === 'pending') {
            accessCell = `<span class="badge warning">PENDING</span> <button class="action-btn" onclick="approveUserAccess('${u.id}')" style="background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.2); color: var(--success-color); padding: 4px 8px; font-size: 11px; margin-left: 5px;">Approve</button>`;
        } else {
            accessCell = `<span class="badge success">APPROVED</span>`;
        }
        
        const row = document.createElement("tr");
        row.innerHTML = `
            <td style="font-family: monospace; font-size: 11px; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${u.id}</td>
            <td style="font-weight: 600;">${fullName}</td>
            <td style="font-weight: 500; color: var(--text-muted);">${u.email}</td>
            <td><span class="badge ${u.plan_type === 'trial' ? 'warning' : 'success'}">${u.plan_type.toUpperCase()}</span></td>
            <td>${u.pc_slots} Slot(s)</td>
            <td>${statusBadge}</td>
            <td>${expiry}</td>
            <td>${accessCell}</td>
            <td style="white-space: nowrap;">
                <div style="display: flex; gap: 6px; align-items: center;">
                    <button class="action-btn" onclick="openUserModal('${u.id}')" style="margin: 0;">
                        <i class="fa-solid fa-pen-to-square"></i> Edit
                    </button>
                    <button class="action-btn danger" onclick="deleteUserAccount('${u.id}')" style="background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.2); color: var(--danger-color); margin: 0;">
                        <i class="fa-solid fa-trash-can"></i> Delete
                    </button>
                </div>
            </td>
        `;
        usersTableBody.appendChild(row);
    });
}

function switchAdminPriceFilter(term) {
    adminPriceFilter = term;
    
    // Toggle active styles on buttons
    ['monthly', 'yearly', 'lifetime'].forEach(t => {
        const btn = document.getElementById(`admin-price-tab-${t}`);
        if (btn) {
            if (t === term) {
                btn.style.background = 'var(--accent-color)';
                btn.style.color = 'white';
                btn.style.borderColor = 'var(--accent-color)';
            } else {
                btn.style.background = 'rgba(255,255,255,0.05)';
                btn.style.color = 'var(--text-muted)';
                btn.style.borderColor = 'var(--border-color)';
            }
        }
    });
    
    renderPricing();
}

window.switchAdminPriceFilter = switchAdminPriceFilter;

function renderPricing() {
    pricingTableBody.innerHTML = "";
    if (pricingCached.length === 0) {
        pricingTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No pricing configurations found.</td></tr>`;
        return;
    }
    
    const filtered = pricingCached.filter(p => p.billing_option === adminPriceFilter);
    filtered.sort((a, b) => a.pc_slots - b.pc_slots);
    
    filtered.forEach(p => {
        const final = p.price - p.promo_discount;
        const discountBadge = p.promo_discount > 0 ? `<span style="color: var(--success-color); margin-left: 5px;">(-Rs. ${p.promo_discount.toFixed(2)})</span>` : '';
        
        let visibilityBadge = `<span class="badge danger">Disabled</span>`;
        if (p.is_enabled === 1) {
            visibilityBadge = `<span class="badge success">Enabled</span>`;
        } else if (p.is_enabled === 2) {
            visibilityBadge = `<span class="badge info" style="background: rgba(59, 130, 246, 0.15); color: var(--accent-color); border: 1px solid rgba(59, 130, 246, 0.3); padding: 2px 8px; border-radius: 4px; font-size: 11px;">Coming Soon</span>`;
        }
        
        const discountPercentage = p.price > 0 ? Math.round((p.promo_discount / p.price) * 100) : 0;
        let packageLabel = `${p.pc_slots} PC Plan`;
        if (discountPercentage > 0) {
            if (p.pc_slots === 1) packageLabel = `1 PC Plan (Save ~${discountPercentage}%)`;
            else if (p.pc_slots === 2) packageLabel = `2 PCs Pack (Save ~${discountPercentage}%)`;
            else if (p.pc_slots === 3) packageLabel = `3 PCs Pack (Save ~${discountPercentage}%)`;
        } else {
            if (p.pc_slots === 2) packageLabel = "2 PCs Pack (Save ~25%)";
            if (p.pc_slots === 3) packageLabel = "3 PCs Pack (Save ~33%)";
        }
        
        const row = document.createElement("tr");
        row.innerHTML = `
            <td style="font-weight: 600;">${packageLabel}</td>
            <td>Rs. ${p.price.toFixed(2)}</td>
            <td>Rs. ${p.promo_discount.toFixed(2)} ${discountBadge}</td>
            <td style="font-weight: 700; color: var(--success-color);">Rs. ${final.toFixed(2)}</td>
            <td>${visibilityBadge}</td>
            <td>
                <button class="action-btn" onclick="openPricingModal('${p.id}')">
                    <i class="fa-solid fa-tags"></i> Edit Config
                </button>
            </td>
        `;
        pricingTableBody.appendChild(row);
    });
}

function switchAdminTab(tabName) {
    const tabUsers = document.getElementById("admin-tab-users");
    const tabPricing = document.getElementById("admin-tab-pricing");
    const tabRoles = document.getElementById("admin-tab-roles");
    const tabClaims = document.getElementById("admin-tab-claims");
    const tabSupport = document.getElementById("admin-tab-support");
    const tabActivities = document.getElementById("admin-tab-activities");
    const tabReleases = document.getElementById("admin-tab-releases");
    const tabSettings = document.getElementById("admin-tab-settings");
    
    const pageUsers = document.getElementById("admin-page-users");
    const pagePricing = document.getElementById("admin-page-pricing");
    const pageRoles = document.getElementById("admin-page-roles");
    const pageClaims = document.getElementById("admin-page-claims");
    const pageSupport = document.getElementById("admin-page-support");
    const pageActivities = document.getElementById("admin-page-activities");
    const pageReleases = document.getElementById("admin-page-releases");
    const pageSettings = document.getElementById("admin-page-settings");
    
    // Sync mobile select dropdown if present
    const mobileSelect = document.getElementById("admin-mobile-tabs");
    if (mobileSelect) {
        mobileSelect.value = tabName;
    }
    
    // Reset active states
    [tabUsers, tabPricing, tabRoles, tabClaims, tabSupport, tabActivities, tabReleases, tabSettings].forEach(btn => btn?.classList.remove("active"));
    [pageUsers, pagePricing, pageRoles, pageClaims, pageSupport, pageActivities, pageReleases, pageSettings].forEach(page => {
        if (page) page.style.display = "none";
    });
    
    // Show charts row ONLY on users roster tab
    const chartsRow = document.querySelector(".charts-row");
    if (chartsRow) {
        chartsRow.style.display = (tabName === 'users') ? 'grid' : 'none';
    }
    
    if (tabName === 'users') {
        tabUsers?.classList.add("active");
        if (pageUsers) pageUsers.style.display = "block";
        loadAnalyticsCharts();
    } else if (tabName === 'pricing') {
        tabPricing?.classList.add("active");
        if (pagePricing) pagePricing.style.display = "block";
    } else if (tabName === 'roles') {
        tabRoles?.classList.add("active");
        if (pageRoles) pageRoles.style.display = "block";
        renderAdminRoles();
    } else if (tabName === 'claims') {
        tabClaims?.classList.add("active");
        if (pageClaims) pageClaims.style.display = "block";
        loadAdminClaims();
    } else if (tabName === 'support') {
        tabSupport?.classList.add("active");
        if (pageSupport) pageSupport.style.display = "block";
        loadSupportMessages();
    } else if (tabName === 'activities') {
        tabActivities?.classList.add("active");
        if (pageActivities) pageActivities.style.display = "block";
        loadActivities();
    } else if (tabName === 'releases') {
        tabReleases?.classList.add("active");
        if (pageReleases) pageReleases.style.display = "block";
        loadReleases();
    } else if (tabName === 'settings') {
        tabSettings?.classList.add("active");
        if (pageSettings) pageSettings.style.display = "block";
    }
}

function openUserModal(userId) {
    const user = usersCached.find(u => u.id === userId);
    if (!user) return;
    
    document.getElementById("edit-user-id").value = user.id;
    document.getElementById("edit-plan-type").value = user.plan_type;
    document.getElementById("edit-pc-slots").value = user.pc_slots;
    document.getElementById("edit-status").value = user.status;
    document.getElementById("edit-active-devices").value = user.active_devices || "[]";
    document.getElementById("edit-user-plain-password").value = user.password_plain || "N/A";
    document.getElementById("edit-user-new-password").value = "";
    document.getElementById("edit-is-blacklisted").checked = user.is_blacklisted === 1;
    document.getElementById("edit-custom-discount").value = user.custom_discount || 0;
    
    // Parse ISO timestamp and format for datetime-local picker input
    if (user.trial_end) {
        try {
            const d = new Date(user.trial_end);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const hh = String(d.getHours()).padStart(2, '0');
            const min = String(d.getMinutes()).padStart(2, '0');
            document.getElementById("edit-trial-end").value = `${yyyy}-${mm}-${dd}T${hh}:${min}`;
        } catch(e) {
            document.getElementById("edit-trial-end").value = "";
        }
    } else {
        document.getElementById("edit-trial-end").value = "";
    }
    
    editUserModal.style.display = "flex";
}

function closeUserModal() {
    editUserModal.style.display = "none";
}

function resetUserDevices() {
    document.getElementById("edit-active-devices").value = "[]";
}

function resetUserTrial() {
    const choice = confirm("Press OK to directly grant a new 15-day trial now.\nPress CANCEL to reset their trial status to 'Not Started' so they can activate it themselves from their dashboard.");
    if (choice) {
        const future = new Date();
        future.setDate(future.getDate() + 15);
        const yyyy = future.getFullYear();
        const mm = String(future.getMonth() + 1).padStart(2, '0');
        const dd = String(future.getDate()).padStart(2, '0');
        const hh = String(future.getHours()).padStart(2, '0');
        const min = String(future.getMinutes()).padStart(2, '0');
        document.getElementById("edit-trial-end").value = `${yyyy}-${mm}-${dd}T${hh}:${min}`;
        document.getElementById("edit-status").value = "active";
        document.getElementById("edit-plan-type").value = "trial";
    } else {
        document.getElementById("edit-trial-end").value = "";
        document.getElementById("edit-status").value = "expired";
        document.getElementById("edit-plan-type").value = "trial";
    }
}

function openPricingModal(pricingId) {
    const price = pricingCached.find(p => p.id === pricingId);
    if (!price) return;
    
    document.getElementById("edit-pricing-id").value = price.id;
    document.getElementById("edit-pricing-price").value = price.price;
    document.getElementById("edit-pricing-discount").value = price.promo_discount;
    document.getElementById("edit-pricing-enabled").value = String(price.is_enabled);
    
    if (price.price > 0) {
        const pct = Math.round((price.promo_discount / price.price) * 100);
        document.getElementById("edit-pricing-pct-discount").value = pct;
    } else {
        document.getElementById("edit-pricing-pct-discount").value = 0;
    }
    
    editPricingModal.style.display = "flex";
}

function closePricingModal() {
    editPricingModal.style.display = "none";
}

let currentAdminEmail = "";

async function handleSendOtpSubmit(event) {
    event.preventDefault();
    authError.style.display = "none";
    
    const email = document.getElementById("admin-email").value.trim();
    const password = document.getElementById("admin-password").value;
    if (!email || !password) return;
    
    const btn = document.getElementById("btn-send-otp");
    btn.disabled = true;
    btn.innerText = "Logging in...";
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/admin/auth/send-otp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        if (data.success) {
            if (data.token) {
                localStorage.setItem("admin_key", data.token);
                adminKey = data.token;
                showDashboard();
                switchAdminTab('users');
            } else {
                currentAdminEmail = email;
                document.getElementById("otp-step-1").style.display = "none";
                document.getElementById("otp-step-2").style.display = "block";
            }
        } else {
            authError.innerText = data.error || "Failed to login.";
            authError.style.display = "block";
        }
    } catch(e) {
        authError.innerText = "Connection error. Make sure your API is online.";
        authError.style.display = "block";
    } finally {
        btn.disabled = false;
        btn.innerText = "Login to Console";
    }
}

async function handleVerifyOtpSubmit(event) {
    event.preventDefault();
    authError.style.display = "none";
    
    const otp = document.getElementById("admin-otp").value.trim();
    if (!otp) return;
    
    const btn = document.getElementById("btn-verify-otp");
    btn.disabled = true;
    btn.innerText = "Verifying...";
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/admin/auth/verify-otp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: currentAdminEmail, otp })
        });
        
        const data = await response.json();
        if (data.success) {
            localStorage.setItem("admin_key", data.token);
            adminKey = data.token;
            showDashboard();
            switchAdminTab('users');
        } else {
            authError.innerText = data.error || "Verification failed.";
            authError.style.display = "block";
        }
    } catch(e) {
        authError.innerText = "Verification connection failed.";
        authError.style.display = "block";
    } finally {
        btn.disabled = false;
        btn.innerText = "Verify & Login";
    }
}

function backToStep1() {
    document.getElementById("otp-step-2").style.display = "none";
    document.getElementById("otp-step-1").style.display = "block";
    authError.style.display = "none";
}

window.handleSendOtpSubmit = handleSendOtpSubmit;
window.handleVerifyOtpSubmit = handleVerifyOtpSubmit;
window.backToStep1 = backToStep1;

async function handleUserUpdateSubmit(event) {
    event.preventDefault();
    
    const userId = document.getElementById("edit-user-id").value;
    const plan_type = document.getElementById("edit-plan-type").value;
    const pc_slots = parseInt(document.getElementById("edit-pc-slots").value);
    const status = document.getElementById("edit-status").value;
    
    const trialEndVal = document.getElementById("edit-trial-end").value;
    const trial_end = trialEndVal ? new Date(trialEndVal).toISOString() : null;
    const active_devices = document.getElementById("edit-active-devices").value;
    const password = document.getElementById("edit-user-new-password").value;
    const is_blacklisted = document.getElementById("edit-is-blacklisted").checked ? 1 : 0;
    const existingUser = usersCached.find(u => u.id === userId);
    const is_admin = existingUser ? existingUser.is_admin : 0;
    const custom_discount = parseInt(document.getElementById("edit-custom-discount").value) || 0;
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/admin/users/update`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminKey}`
            },
            body: JSON.stringify({
                userId, plan_type, pc_slots, status, trial_end, active_devices, password, is_blacklisted, custom_discount, is_admin
            })
        });
        
        const data = await response.json();
        if (data.success) {
            closeUserModal();
            await loadUsers();
            calculateStats();
        } else {
            alert(data.error || "Failed to update user.");
        }
    } catch(e) {
        alert("Failed to communicate with database server.");
    }
}

async function handlePricingUpdateSubmit(event) {
    event.preventDefault();
    
    const configId = document.getElementById("edit-pricing-id").value;
    const price = parseFloat(document.getElementById("edit-pricing-price").value);
    const promo_discount = parseFloat(document.getElementById("edit-pricing-discount").value);
    const is_enabled = parseInt(document.getElementById("edit-pricing-enabled").value);
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/admin/pricing/update`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminKey}`
            },
            body: JSON.stringify({
                configId, price, promo_discount, is_enabled
            })
        });
        
        const data = await response.json();
        if (data.success) {
            closePricingModal();
            await loadPricing();
            calculateStats();
        } else {
            alert(data.error || "Failed to update pricing.");
        }
    } catch(e) {
        alert("Failed to update pricing values.");
    }
}

async function approveUserAccess(userId) {
    if (confirm("Are you sure you want to approve dashboard access for this user?")) {
        try {
            const response = await fetch(`${BACKEND_URL}/api/admin/users/approve`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${adminKey}`
                },
                body: JSON.stringify({ userId })
            });
            const data = await response.json();
            if (data.success) {
                await loadUsers();
                calculateStats();
            } else {
                alert(data.error || "Failed to approve access.");
            }
        } catch(e) {
            alert("Failed to communicate with database server.");
        }
    }
}

async function deleteUserAccount(userId) {
    const user = usersCached.find(u => u.id === userId);
    const emailStr = user ? ` (${user.email})` : "";
    if (confirm(`Are you absolutely sure you want to delete this user account${emailStr}?\nThis action cannot be undone and will delete all subscription data.`)) {
        try {
            const response = await fetch(`${BACKEND_URL}/api/admin/users/delete`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${adminKey}`
                },
                body: JSON.stringify({ userId })
            });
            const data = await response.json();
            if (data.success) {
                await loadUsers();
                calculateStats();
            } else {
                alert(data.error || "Failed to delete account.");
            }
        } catch(e) {
            alert("Failed to communicate with database server.");
        }
    }
}

window.approveUserAccess = approveUserAccess;
window.deleteUserAccount = deleteUserAccount;

function handleLogout() {
    localStorage.removeItem("admin_key");
    adminKey = null;
    showAuth();
}

function loginWithGoogle() {
    const clientId = "732595466975-kvoo3oio590k54bse7jhhu5pmctp7u1g.apps.googleusercontent.com";
    const state = encodeURIComponent(window.location.href.split('?')[0]);
    const redirectUri = encodeURIComponent("https://apna-downloader-backend.mirajroonjha.workers.dev/api/auth/google/callback");
    
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + 
        `client_id=${clientId}` +
        `&redirect_uri=${redirectUri}` +
        `&response_type=code` +
        `&scope=email%20profile` +
        `&prompt=select_account` +
        `&state=${state}`;
        
    window.location.href = googleAuthUrl;
}

window.loginWithGoogle = loginWithGoogle;
window.handleLogout = handleLogout;

function handleUserDateFilterChange() {
    const filter = document.getElementById("user-date-filter").value;
    const customContainer = document.getElementById("custom-date-container");
    if (filter === "custom") {
        customContainer.style.display = "flex";
    } else {
        customContainer.style.display = "none";
        document.getElementById("user-date-start").value = "";
        document.getElementById("user-date-end").value = "";
    }
    handleUserSearch();
}

function handleUserSearch() {
    const query = document.getElementById("user-search-input").value.toLowerCase().trim();
    const planFilter = document.getElementById("user-plan-filter").value;
    const dateFilter = document.getElementById("user-date-filter").value;
    
    // Start/End date bounds for date filtering
    let filterStart = null;
    let filterEnd = null;
    
    if (dateFilter === 'today') {
        filterStart = new Date();
        filterStart.setHours(0, 0, 0, 0);
    } else if (dateFilter === 'yesterday') {
        filterStart = new Date();
        filterStart.setDate(filterStart.getDate() - 1);
        filterStart.setHours(0, 0, 0, 0);
        
        filterEnd = new Date();
        filterEnd.setDate(filterEnd.getDate() - 1);
        filterEnd.setHours(23, 59, 59, 999);
    } else if (dateFilter === '15days') {
        filterStart = new Date();
        filterStart.setDate(filterStart.getDate() - 15);
        filterStart.setHours(0, 0, 0, 0);
    } else if (dateFilter === '1year') {
        filterStart = new Date();
        filterStart.setFullYear(filterStart.getFullYear() - 1);
        filterStart.setHours(0, 0, 0, 0);
    } else if (dateFilter === '3years') {
        filterStart = new Date();
        filterStart.setFullYear(filterStart.getFullYear() - 3);
        filterStart.setHours(0, 0, 0, 0);
    } else if (dateFilter === 'custom') {
        const startVal = document.getElementById("user-date-start").value;
        const endVal = document.getElementById("user-date-end").value;
        if (startVal) {
            filterStart = new Date(startVal);
            filterStart.setHours(0, 0, 0, 0);
        }
        if (endVal) {
            filterEnd = new Date(endVal);
            filterEnd.setHours(23, 59, 59, 999);
        }
    }
    
    const filtered = usersCached.filter(u => {
        // Plan & Slot filter matching
        if (planFilter !== 'all') {
            if (planFilter === 'trial') {
                if (u.plan_type !== 'trial') return false;
            } else {
                const parts = planFilter.split('-'); // e.g. ["monthly", "1"]
                const term = parts[0];
                const slots = parseInt(parts[1], 10);
                if (u.plan_type !== term || u.pc_slots !== slots) {
                    return false;
                }
            }
        }
        
        // Date filter matching
        if (filterStart || filterEnd) {
            if (!u.created_at) return false;
            const created = new Date(u.created_at.replace(" ", "T"));
            if (filterStart && created < filterStart) return false;
            if (filterEnd && created > filterEnd) return false;
        }
        
        // Search text matching
        if (query) {
            const fullName = `${u.first_name || ''} ${u.last_name || ''}`.toLowerCase();
            const email = (u.email || '').toLowerCase();
            const id = (u.id || '').toLowerCase();
            const plan = (u.plan_type || '').toLowerCase();
            
            return fullName.includes(query) || 
                   email.includes(query) || 
                   id.includes(query) || 
                   plan.includes(query);
        }
        
        return true;
    });
    
    renderUsers(filtered);
}

window.handleUserSearch = handleUserSearch;
window.handleUserDateFilterChange = handleUserDateFilterChange;

function renderAdminRoles() {
    const rolesTableBody = document.getElementById("roles-table-body");
    if (!rolesTableBody) return;
    
    rolesTableBody.innerHTML = "";
    const admins = usersCached.filter(u => u.is_admin === 1);
    
    if (admins.length === 0) {
        rolesTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No administrator accounts found.</td></tr>`;
        return;
    }
    
    admins.forEach(u => {
        const fullName = `${u.first_name || '-'} ${u.last_name || ''}`.trim();
        const isOwner = u.email === "mirajroonjha@gmail.com";
        const roleLabel = isOwner ? `<span class="badge success" style="background: rgba(16,185,129,0.15); color: var(--success-color); border: 1px solid rgba(16,185,129,0.3); padding: 4px 8px; border-radius: 4px; font-size: 11px;">OWNER / SUPER ADMIN</span>` : `<span class="badge info" style="background: rgba(59, 130, 246, 0.15); color: var(--accent-color); border: 1px solid rgba(59, 130, 246, 0.3); padding: 4px 8px; border-radius: 4px; font-size: 11px;">DELEGATED ADMIN</span>`;
        
        let actionBtn = "";
        if (isOwner) {
            actionBtn = `<span style="font-size: 11px; color: var(--text-muted); font-style: italic;">System Protected</span>`;
        } else {
            actionBtn = `
                <button class="action-btn danger" onclick="revokeAdminRole('${u.id}')" style="background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.2); color: var(--danger-color); margin: 0; padding: 4px 8px; font-size: 11px;">
                    <i class="fa-solid fa-user-slash"></i> Revoke Access
                </button>
            `;
        }
        
        const row = document.createElement("tr");
        row.innerHTML = `
            <td style="font-family: monospace; font-size: 11px; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${u.id}</td>
            <td style="font-weight: 600;">${fullName}</td>
            <td style="font-weight: 500; color: var(--text-muted);">${u.email}</td>
            <td>${roleLabel}</td>
            <td>${actionBtn}</td>
        `;
        rolesTableBody.appendChild(row);
    });
}

async function handleAddAdminSubmit(event) {
    event.preventDefault();
    const firstNameInput = document.getElementById("new-admin-first-name");
    const lastNameInput = document.getElementById("new-admin-last-name");
    const emailInput = document.getElementById("new-admin-email");
    const passwordInput = document.getElementById("new-admin-password");
    
    const first_name = firstNameInput.value.trim();
    const last_name = lastNameInput.value.trim();
    const email = emailInput.value.toLowerCase().trim();
    const password = passwordInput.value;
    
    if (!email || !password || !first_name || !last_name) return;
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/admin/roles/create`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminKey}`
            },
            body: JSON.stringify({ first_name, last_name, email, password })
        });
        
        const data = await response.json();
        if (data.success) {
            firstNameInput.value = "";
            lastNameInput.value = "";
            emailInput.value = "";
            passwordInput.value = "";
            alert("Administrator account has been successfully created/granted, and login details have been emailed!");
            await loadUsers();
            renderAdminRoles();
        } else {
            alert("Failed to create admin access: " + (data.error || "Unknown error"));
        }
    } catch(e) {
        alert("Failed to connect to the backend server.");
    }
}

async function revokeAdminRole(userId) {
    const user = usersCached.find(u => u.id === userId);
    if (!user) return;
    
    if (user.email === "mirajroonjha@gmail.com") {
        alert("System Protected: Super Admin / Owner access privileges cannot be revoked.");
        return;
    }
    
    const confirmRevoke = confirm(`Are you sure you want to revoke all administrative access permissions for user: ${user.email}?`);
    if (!confirmRevoke) return;
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/admin/users/update`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminKey}`
            },
            body: JSON.stringify({
                userId: user.id,
                plan_type: user.plan_type,
                pc_slots: user.pc_slots,
                status: user.status,
                trial_end: user.trial_end,
                active_devices: user.active_devices,
                is_blacklisted: user.is_blacklisted,
                custom_discount: user.custom_discount || 0,
                is_admin: 0
            })
        });
        
        const data = await response.json();
        if (data.success) {
            alert("Administrator access has been successfully revoked.");
            await loadUsers();
            renderAdminRoles();
        } else {
            alert("Failed to revoke access: " + (data.error || "Unknown error"));
        }
    } catch(e) {
        alert("Failed to connect to the backend server.");
    }
}

function calculatePromoFromPct() {
    const price = parseFloat(document.getElementById("edit-pricing-price").value) || 0;
    const pct = parseFloat(document.getElementById("edit-pricing-pct-discount").value) || 0;
    
    const promo = (price * pct) / 100;
    document.getElementById("edit-pricing-discount").value = promo.toFixed(2);
}

function calculatePctFromPromo() {
    const price = parseFloat(document.getElementById("edit-pricing-price").value) || 0;
    const promo = parseFloat(document.getElementById("edit-pricing-discount").value) || 0;
    
    if (price > 0) {
        const pct = Math.round((promo / price) * 100);
        document.getElementById("edit-pricing-pct-discount").value = pct;
    } else {
        document.getElementById("edit-pricing-pct-discount").value = 0;
    }
}

let claimsCached = [];

async function loadAdminClaims() {
    const tableBody = document.querySelector("#admin-page-claims #claims-table-body");
    if (!tableBody) return;
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/admin/payments/claims`, {
            headers: {
                "Authorization": `Bearer ${adminKey}`
            }
        });
        
        const data = await response.json();
        if (data.success) {
            claimsCached = data.claims;
            tableBody.innerHTML = "";
            
            if (claimsCached.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted);">No payment verification claims found.</td></tr>`;
                return;
            }
            
            claimsCached.forEach(c => {
                const dateStr = new Date(c.created_at).toLocaleDateString();
                const userName = `${c.first_name || '-'} ${c.last_name || ''}`.trim();
                
                const parts = c.pricing_id.split('_');
                const slots = parts[0].replace("pc", "");
                const term = parts[1];
                const packageTitle = `${slots} PC ${term.charAt(0).toUpperCase() + term.slice(1)}`;
                
                let statusBadgeClass = "warning";
                if (c.status === 'approved') statusBadgeClass = "success";
                if (c.status === 'rejected') statusBadgeClass = "danger";
                
                let receiptCol = `<span style="color: var(--text-muted); font-style: italic;">None</span>`;
                if (c.receipt_image) {
                    receiptCol = `
                        <button class="action-btn" onclick="viewReceiptImage(${c.id})" style="padding: 4px 8px; font-size: 11px; margin: 0;">
                            <i class="fa-solid fa-image"></i> View Receipt
                        </button>
                    `;
                }
                
                let actionsCol = "";
                if (c.status === 'pending') {
                    actionsCol = `
                        <div style="display: flex; gap: 6px;">
                            <button class="action-btn" onclick="approvePaymentClaim(${c.id})" style="background: rgba(16,185,129,0.1); border-color: rgba(16,185,129,0.2); color: var(--success-color); padding: 4px 8px; font-size: 11px; margin: 0;">
                                <i class="fa-solid fa-check"></i> Approve
                            </button>
                            <button class="action-btn danger" onclick="openRejectClaimModal(${c.id})" style="background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.2); color: var(--danger-color); padding: 4px 8px; font-size: 11px; margin: 0;">
                                <i class="fa-solid fa-ban"></i> Reject
                            </button>
                        </div>
                    `;
                } else {
                    actionsCol = `<span style="font-size: 11px; color: var(--text-muted); font-style: italic;">Processed</span>`;
                }
                
                const row = document.createElement("tr");
                row.innerHTML = `
                    <td>${dateStr}</td>
                    <td>
                        <div style="font-weight: 600;">${userName}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">${c.email}</div>
                    </td>
                    <td style="font-weight: 700;">${packageTitle}</td>
                    <td style="color: var(--success-color); font-weight: 600;">Rs. ${c.amount.toFixed(2)}</td>
                    <td style="font-family: monospace; font-size: 12px; font-weight: 600;">${c.transaction_id}</td>
                    <td>${receiptCol}</td>
                    <td><span class="badge ${statusBadgeClass}">${c.status.toUpperCase()}</span></td>
                    <td style="font-size: 11px; color: var(--text-muted); max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${c.notes || ''}">${c.notes || '-'}</td>
                    <td>${actionsCol}</td>
                `;
                tableBody.appendChild(row);
            });
        }
    } catch(e) {
        console.error("Failed to load claims roster:", e);
    }
}

async function approvePaymentClaim(claimId) {
    const claim = claimsCached.find(c => c.id === claimId);
    if (!claim) return;
    
    const confirmApprove = confirm(`Confirm payment approval for user: ${claim.email}?\nPlan: ${claim.pricing_id}\nAmount: Rs. ${claim.amount.toFixed(2)}\nTID: ${claim.transaction_id}`);
    if (!confirmApprove) return;
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/admin/payments/claims/approve`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminKey}`
            },
            body: JSON.stringify({ claimId })
        });
        
        const data = await response.json();
        if (data.success) {
            alert(data.message);
            await loadAdminClaims();
        } else {
            alert(data.error || "Approval failed.");
        }
    } catch(e) {
        alert("Failed to connect to server.");
    }
}

function openRejectClaimModal(claimId) {
    document.getElementById("reject-claim-id").value = claimId;
    document.getElementById("reject-claim-reason").value = "";
    document.getElementById("reject-claim-modal").style.display = "flex";
}

function closeRejectClaimModal() {
    document.getElementById("reject-claim-modal").style.display = "none";
}

async function handleRejectClaimSubmit(event) {
    event.preventDefault();
    const claimId = parseInt(document.getElementById("reject-claim-id").value, 10);
    const notes = document.getElementById("reject-claim-reason").value.trim();
    
    if (!claimId || !notes) return;
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/admin/payments/claims/reject`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminKey}`
            },
            body: JSON.stringify({ claimId, notes })
        });
        
        const data = await response.json();
        if (data.success) {
            alert(data.message);
            closeRejectClaimModal();
            await loadAdminClaims();
        } else {
            alert(data.error || "Rejection failed.");
        }
    } catch(e) {
        alert("Failed to connect to server.");
    }
}

async function viewReceiptImage(claimId) {
    const claim = claimsCached.find(c => c.id === claimId);
    if (!claim || !claim.receipt_image) return;
    
    const modal = document.getElementById("view-receipt-modal");
    const img = document.getElementById("receipt-modal-img");
    if (!modal || !img) return;
    
    img.src = ""; // Reset previous image src
    img.alt = "Loading receipt image from Cloudflare R2 storage...";
    modal.style.display = "flex";
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/admin/payments/receipt?key=${encodeURIComponent(claim.receipt_image)}`, {
            headers: {
                "Authorization": `Bearer ${adminKey}`
            }
        });
        
        if (!response.ok) {
            img.alt = "Failed to load receipt image from R2.";
            return;
        }
        
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        img.src = objectUrl;
        img.alt = "Receipt Image";
    } catch(e) {
        console.error("Failed to load receipt image:", e);
        img.alt = "Network error loading receipt image.";
    }
}

function closeReceiptModal() {
    document.getElementById("view-receipt-modal").style.display = "none";
}

async function loadSupportMessages() {
    const tbody = document.getElementById("support-table-body");
    try {
        const response = await fetch(`${BACKEND_URL}/api/admin/support-messages`, {
            headers: { "Authorization": `Bearer ${adminKey}` }
        });
        const data = await response.json();
        if (data.success) {
            renderSupportMessages(data.messages);
        } else {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger-color);">Error: ${data.error}</td></tr>`;
        }
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger-color);">Failed to load messages.</td></tr>`;
    }
}

function renderSupportMessages(messages) {
    const tbody = document.getElementById("support-table-body");
    tbody.innerHTML = "";
    if (!messages || messages.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No support inquiries received yet.</td></tr>`;
        return;
    }

    messages.forEach(m => {
        const dateStr = new Date(m.created_at || Date.now()).toLocaleString();
        
        let statusBadge = '';
        let actionButtons = '';
        
        if (m.status === 'resolved') {
            statusBadge = `<span class="badge success">RESOLVED</span>`;
            actionButtons = `
                <button class="action-btn danger" onclick="deleteSupportMessage(${m.id})" style="margin: 0; background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.2); color: var(--danger-color);">
                    <i class="fa-solid fa-trash-can"></i> Delete
                </button>
            `;
        } else {
            statusBadge = `<span class="badge warning">PENDING</span>`;
            actionButtons = `
                <button class="action-btn" onclick="resolveSupportMessage(${m.id})" style="margin: 0; background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.2); color: var(--success-color);">
                    <i class="fa-solid fa-check"></i> Mark Resolved
                </button>
                <button class="action-btn danger" onclick="deleteSupportMessage(${m.id})" style="margin: 0; background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.2); color: var(--danger-color);">
                    <i class="fa-solid fa-trash-can"></i> Delete
                </button>
            `;
        }

        const row = document.createElement("tr");
        row.innerHTML = `
            <td style="color: var(--text-muted); font-size: 11px; white-space: nowrap;">${dateStr}</td>
            <td style="font-weight: 600;">${m.name}</td>
            <td>
                <a href="mailto:${m.email}?subject=Re: ${encodeURIComponent(m.subject)}" style="color: var(--accent-color); font-weight: 500; display: inline-flex; align-items: center; gap: 4px;">
                    <i class="fa-solid fa-reply"></i> ${m.email}
                </a>
            </td>
            <td style="font-weight: 600; color: var(--text-main); font-size: 12px;">${m.subject}</td>
            <td style="max-width: 250px; overflow-wrap: break-word; color: var(--text-muted); font-size: 12px; line-height: 1.4;">${m.message}</td>
            <td>${statusBadge}</td>
            <td style="white-space: nowrap;">
                <div style="display: flex; gap: 6px; align-items: center;">
                    ${actionButtons}
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function resolveSupportMessage(id) {
    if (!confirm("Are you sure you want to mark this message as resolved?")) return;
    try {
        const response = await fetch(`${BACKEND_URL}/api/admin/support-messages/resolve`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${adminKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ id })
        });
        const data = await response.json();
        if (data.success) {
            loadSupportMessages();
        } else {
            alert("Error: " + data.error);
        }
    } catch (e) {
        alert("Failed to resolve message.");
    }
}

async function deleteSupportMessage(id) {
    if (!confirm("Are you sure you want to permanently delete this support message?")) return;
    try {
        const response = await fetch(`${BACKEND_URL}/api/admin/support-messages/delete`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${adminKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ id })
        });
        const data = await response.json();
        if (data.success) {
            loadSupportMessages();
        } else {
            alert("Error: " + data.error);
        }
    } catch (e) {
        alert("Failed to delete message.");
    }
}

async function handleAdminChangePasswordSubmit(event) {
    event.preventDefault();
    const toast = document.getElementById("settings-success-toast");
    toast.style.display = "none";
    
    const newPassword = document.getElementById("settings-new-password").value;
    const confirmPassword = document.getElementById("settings-confirm-password").value;
    
    if (newPassword !== confirmPassword) {
        toast.style.display = "block";
        toast.style.background = "rgba(239,68,68,0.12)";
        toast.style.color = "var(--danger-color)";
        toast.style.borderColor = "rgba(239,68,68,0.25)";
        toast.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Error: Passwords do not match.`;
        return;
    }
    
    const btn = event.target.querySelector("button[type='submit']");
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Updating...`;
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/admin/change-password`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${adminKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ password: newPassword })
        });
        const data = await response.json();
        if (data.success) {
            toast.style.display = "block";
            toast.style.background = "rgba(16,185,129,0.12)";
            toast.style.color = "var(--success-color)";
            toast.style.borderColor = "rgba(16,185,129,0.25)";
            toast.innerHTML = `<i class="fa-solid fa-circle-check"></i> Admin password updated successfully in the database.`;
            document.getElementById("settings-new-password").value = "";
            document.getElementById("settings-confirm-password").value = "";
        } else {
            throw new Error(data.error || "Failed to update password");
        }
    } catch(e) {
        toast.style.display = "block";
        toast.style.background = "rgba(239,68,68,0.12)";
        toast.style.color = "var(--danger-color)";
        toast.style.borderColor = "rgba(239,68,68,0.25)";
        toast.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Error: ${e.message}`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-key"></i> Update Admin Password`;
    }
}

window.renderAdminRoles = renderAdminRoles;
window.handleAddAdminSubmit = handleAddAdminSubmit;
window.revokeAdminRole = revokeAdminRole;
window.calculatePromoFromPct = calculatePromoFromPct;
window.calculatePctFromPromo = calculatePctFromPromo;
window.loadAdminClaims = loadAdminClaims;
window.approvePaymentClaim = approvePaymentClaim;
window.openRejectClaimModal = openRejectClaimModal;
window.closeRejectClaimModal = closeRejectClaimModal;
window.handleRejectClaimSubmit = handleRejectClaimSubmit;
window.viewReceiptImage = viewReceiptImage;
window.closeReceiptModal = closeReceiptModal;
window.loadSupportMessages = loadSupportMessages;
window.resolveSupportMessage = resolveSupportMessage;
window.deleteSupportMessage = deleteSupportMessage;
window.handleAdminChangePasswordSubmit = handleAdminChangePasswordSubmit;

// Analytics, Audit Logs, and Release Manager Modules
async function loadAnalyticsCharts() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/admin/analytics`, {
            headers: { "Authorization": `Bearer ${adminKey}` }
        });
        const data = await response.json();
        if (!data.success) return;

        // 1. Render User Signups Chart
        const signupLabels = (data.signups || []).map(item => item.date);
        const signupCounts = (data.signups || []).map(item => item.count);

        const ctxSignups = document.getElementById("signupsChart").getContext("2d");
        if (signupChartInstance) signupChartInstance.destroy();

        signupChartInstance = new Chart(ctxSignups, {
            type: "line",
            data: {
                labels: signupLabels.length ? signupLabels : ["No Data"],
                datasets: [{
                    label: "Signups",
                    data: signupCounts.length ? signupCounts : [0],
                    borderColor: "#3b82f6",
                    backgroundColor: "rgba(59, 130, 246, 0.15)",
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: "#3b82f6"
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        grid: { color: "rgba(255, 255, 255, 0.05)" },
                        ticks: { color: "rgba(255, 255, 255, 0.5)", font: { size: 10 } }
                    },
                    y: {
                        grid: { color: "rgba(255, 255, 255, 0.05)" },
                        ticks: { color: "rgba(255, 255, 255, 0.5)", font: { size: 10 } },
                        beginAtZero: true
                    }
                }
            }
        });

        // 2. Render Plans Distribution Chart
        const planTypes = (data.plans || []).map(item => item.plan_type.toUpperCase());
        const planCounts = (data.plans || []).map(item => item.count);

        const colorPalette = {
            "TRIAL": "#64748b",
            "MONTHLY": "#3b82f6",
            "YEARLY": "#10b981",
            "LIFETIME": "#8b5cf6"
        };
        const planColors = (data.plans || []).map(item => colorPalette[item.plan_type.toUpperCase()] || "#475569");

        const ctxPlans = document.getElementById("plansChart").getContext("2d");
        if (planChartInstance) planChartInstance.destroy();

        planChartInstance = new Chart(ctxPlans, {
            type: "doughnut",
            data: {
                labels: planTypes.length ? planTypes : ["No Subscriptions"],
                datasets: [{
                    data: planCounts.length ? planCounts : [1],
                    backgroundColor: planColors.length ? planColors : ["rgba(255,255,255,0.05)"],
                    borderWidth: 1,
                    borderColor: "rgba(0,0,0,0.15)"
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "right",
                        labels: { color: "rgba(255, 255, 255, 0.75)", font: { size: 10 } }
                    }
                }
            }
        });

    } catch (e) {
        console.error("Failed to load analytics charts:", e);
    }
}

async function loadActivities() {
    const tableBody = document.getElementById("activities-table-body");
    try {
        const response = await fetch(`${BACKEND_URL}/api/admin/activities`, {
            headers: { "Authorization": `Bearer ${adminKey}` }
        });
        const data = await response.json();
        if (!data.success) {
            tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--danger-color);">${data.error || "Failed to load"}</td></tr>`;
            return;
        }

        if (!data.logs || data.logs.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No activity logs recorded yet.</td></tr>`;
            return;
        }

        tableBody.innerHTML = "";
        data.logs.forEach(log => {
            const tr = document.createElement("tr");
            const localDate = new Date(log.created_at.replace(" ", "T") + "Z").toLocaleString();
            
            let badgeClass = "badge success";
            if (log.action.includes("DELETE") || log.action.includes("REJECT")) badgeClass = "badge danger";
            if (log.action.includes("UPDATE")) badgeClass = "badge warning";
            
            tr.innerHTML = `
                <td style="white-space: nowrap; color: var(--text-muted); font-size: 11px;">${localDate}</td>
                <td><strong>${log.admin_email}</strong></td>
                <td><span class="${badgeClass}">${log.action}</span></td>
                <td style="color: var(--text-main); font-size: 12px;">${log.details}</td>
            `;
            tableBody.appendChild(tr);
        });
    } catch (e) {
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--danger-color);">Error connecting to backend</td></tr>`;
    }
}

async function loadReleases() {
    const tableBody = document.getElementById("releases-table-body");
    try {
        const response = await fetch(`${BACKEND_URL}/api/admin/releases`, {
            headers: { "Authorization": `Bearer ${adminKey}` }
        });
        const data = await response.json();
        if (!data.success) {
            tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--danger-color);">${data.error || "Failed to load"}</td></tr>`;
            return;
        }

        if (!data.releases || data.releases.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No software releases published yet.</td></tr>`;
            return;
        }

        tableBody.innerHTML = "";
        data.releases.forEach(rel => {
            const tr = document.createElement("tr");
            const localDate = new Date(rel.created_at.replace(" ", "T") + "Z").toLocaleDateString();
            
            const isMandatory = rel.is_mandatory === 1;
            const statusBadge = isMandatory 
                ? `<span class="badge danger"><i class="fa-solid fa-triangle-exclamation"></i> Mandatory</span>`
                : `<span class="badge success">Optional Update</span>`;

            tr.innerHTML = `
                <td style="white-space: nowrap; color: var(--text-muted); font-size: 11px;">${localDate}</td>
                <td><code style="background: rgba(59,130,246,0.15); padding: 3px 6px; border-radius: 4px; color: var(--accent-color); font-weight: 700;">v${rel.version}</code></td>
                <td><a href="${rel.download_url}" target="_blank" style="color: var(--accent-color); text-decoration: underline; font-size: 11px; word-break: break-all;">${rel.download_url}</a></td>
                <td style="color: var(--text-main); font-size: 12px;">${rel.changelog || "-"}</td>
                <td>${statusBadge}</td>
            `;
            tableBody.appendChild(tr);
        });
    } catch (e) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--danger-color);">Error connecting to backend</td></tr>`;
    }
}

async function handlePublishReleaseSubmit(event) {
    event.preventDefault();
    const versionInput = document.getElementById("release-version");
    const downloadInput = document.getElementById("release-download-url");
    const changelogInput = document.getElementById("release-changelog");
    const mandatoryInput = document.getElementById("release-mandatory");
    
    const version = versionInput.value.trim();
    const download_url = downloadInput.value.trim();
    const changelog = changelogInput.value.trim();
    const is_mandatory = mandatoryInput.checked;
    
    if (!version || !download_url) return;
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/admin/releases/create`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminKey}`
            },
            body: JSON.stringify({ version, download_url, changelog, is_mandatory })
        });
        const data = await response.json();
        if (data.success) {
            alert("App release successfully published!");
            versionInput.value = "";
            downloadInput.value = "";
            changelogInput.value = "";
            mandatoryInput.checked = false;
            loadReleases();
        } else {
            alert("Failed to publish release: " + (data.error || "Unknown error"));
        }
    } catch (e) {
        alert("Failed to connect to backend server.");
    }
}

window.loadAnalyticsCharts = loadAnalyticsCharts;
window.loadActivities = loadActivities;
window.loadReleases = loadReleases;
window.handlePublishReleaseSubmit = handlePublishReleaseSubmit;
window.addEventListener("DOMContentLoaded", init);

