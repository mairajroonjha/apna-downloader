const BACKEND_URL = "https://apna-downloader-backend.mirajroonjha.workers.dev";

const authSection = document.getElementById("auth-section");
const dashboardSection = document.getElementById("dashboard-section");
const authError = document.getElementById("auth-error");
const userDisplay = document.getElementById("user-display");
const userEmailHeader = document.getElementById("user-email-header");
const dashboardUserName = document.getElementById("dashboard-user-name");

const planTypeBadge = document.getElementById("plan-type-badge");
const statusBadge = document.getElementById("status-badge");
const deviceSlotsAllocated = document.getElementById("device-slots-allocated");
const expiryDateLabel = document.getElementById("expiry-date-label");
const devicesTableBody = document.getElementById("devices-table-body");

let token = localStorage.getItem("user_token");
let userCachedDetails = null;
let pricingData = [];

async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    
    // Save pending upgrade parameters if present
    const billing = urlParams.get("billing");
    const slots = urlParams.get("slots");
    if (billing && slots) {
        sessionStorage.setItem("pending_upgrade_billing", billing);
        sessionStorage.setItem("pending_upgrade_slots", slots);
    }
    
    const urlToken = urlParams.get("token");
    const urlEmail = urlParams.get("email");
    if (urlToken && urlEmail) {
        localStorage.setItem("user_token", urlToken);
        localStorage.setItem("user_email", urlEmail);
        token = urlToken;
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    const urlError = urlParams.get("error");
    if (urlError) {
        authError.innerText = urlError;
        authError.style.display = "block";
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    if (token) {
        await showDashboard();
        checkPendingUpgrade();
    } else {
        showAuth();
    }
}

function checkPendingUpgrade() {
    const billing = sessionStorage.getItem("pending_upgrade_billing");
    const slots = sessionStorage.getItem("pending_upgrade_slots");
    if (!billing || !slots) return;
    
    sessionStorage.removeItem("pending_upgrade_billing");
    sessionStorage.removeItem("pending_upgrade_slots");
    
    switchPortalTab('upgrade');
    
    const billingSelect = document.getElementById("upgrade-billing-term");
    if (billingSelect) {
        billingSelect.value = billing;
        loadUpgradePrices();
        
        setTimeout(() => {
            const radios = document.getElementsByName("upgrade-plan");
            for (let r of radios) {
                const plan = pricingData.find(p => p.id === parseInt(r.value, 10));
                if (plan && plan.pc_slots === parseInt(slots, 10)) {
                    r.click();
                    break;
                }
            }
        }, 150);
    }
}

function showAuth() {
    authSection.style.display = "block";
    dashboardSection.style.display = "none";
    userDisplay.style.display = "none";
}

async function showDashboard() {
    authSection.style.display = "none";
    dashboardSection.style.display = "block";
    userDisplay.style.display = "block";
    
    await loadSubscriptionData();
    await loadPricingConfigs();
    await loadClaimsList();
}

async function loadSubscriptionData() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/portal/subscription`, {
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            handleLogout();
            return;
        }
        
        const data = await response.json();
        if (data.success) {
            const profile = data.profile;
            userEmailHeader.innerText = profile.email;
            dashboardUserName.innerText = profile.email.split("@")[0];
            userCachedDetails = profile; // Cache profile details
            
            // Render sidebar stats
            planTypeBadge.innerText = profile.plan_type.toUpperCase();
            planTypeBadge.className = `badge ${profile.plan_type === 'trial' ? 'warning' : 'success'}`;
            
            statusBadge.innerText = profile.status.toUpperCase();
            statusBadge.className = `badge ${profile.status === 'active' ? 'success' : 'danger'}`;
            
            deviceSlotsAllocated.innerText = `${profile.pc_slots} PC(s)`;
            
            // Render license key display
            const licenseKeyDisplay = document.getElementById("license-key-display");
            if (licenseKeyDisplay) {
                licenseKeyDisplay.innerText = profile.license_key || "N/A (Trial)";
            }
            
            if (profile.plan_type === 'trial' && profile.trial_end) {
                expiryDateLabel.innerText = new Date(profile.trial_end).toLocaleDateString();
            } else if (profile.plan_type === 'trial') {
                expiryDateLabel.innerText = "Not Started";
            } else {
                expiryDateLabel.innerText = "Active License";
            }
            
            // Render devices table
            let devices = [];
            try { devices = JSON.parse(profile.active_devices || "[]"); } catch(e) {}
            
            devicesTableBody.innerHTML = "";
            if (devices.length === 0) {
                devicesTableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No registered devices found. Start your Electron client app to bind a device.</td></tr>`;
            } else {
                devices.forEach((devId, idx) => {
                    const row = document.createElement("tr");
                    row.innerHTML = `
                        <td>PC Slot ${idx + 1}</td>
                        <td style="font-family: monospace; color: var(--accent-color);">${devId}</td>
                        <td>
                            <button class="btn-unbind" onclick="unbindDevice('${devId}')">
                                <i class="fa-solid fa-link-slash"></i> Unbind Slot
                            </button>
                        </td>
                    `;
                    devicesTableBody.appendChild(row);
                });
            }
        }
    } catch(e) {
        console.error("Failed to load subscription details:", e);
    }
}

async function handleLoginSubmit(event) {
    event.preventDefault();
    authError.style.display = "none";
    
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        if (response.ok && data.success) {
            localStorage.setItem("user_token", data.token);
            token = data.token;
            await showDashboard();
            checkPendingUpgrade();
        } else {
            authError.innerText = data.error || "Login failed. Check your password.";
            authError.style.display = "block";
        }
    } catch(e) {
        authError.innerText = "Server connection lost. Please check if edge service is active.";
        authError.style.display = "block";
    }
}

const authSuccess = document.getElementById("auth-success");

function showResetStep1(e) {
    if (e) e.preventDefault();
    authError.style.display = "none";
    authSuccess.style.display = "none";
    
    document.getElementById("auth-title").innerText = "Reset Password";
    document.getElementById("auth-subtitle").innerText = "Enter your email to request a secure 6-digit password reset verification code.";
    
    document.getElementById("login-container").style.display = "none";
    document.getElementById("reset-step-1-container").style.display = "block";
    document.getElementById("reset-step-2-container").style.display = "none";
}

function showLogin(e) {
    if (e) e.preventDefault();
    authError.style.display = "none";
    authSuccess.style.display = "none";
    
    document.getElementById("auth-title").innerText = "Customer Portal";
    document.getElementById("auth-subtitle").innerText = "Sign in to unbind hardware devices and view subscription statuses.";
    
    document.getElementById("login-container").style.display = "block";
    document.getElementById("reset-step-1-container").style.display = "none";
    document.getElementById("reset-step-2-container").style.display = "none";
}

let resetTargetEmail = "";

async function handleResetRequestSubmit(event) {
    event.preventDefault();
    authError.style.display = "none";
    authSuccess.style.display = "none";
    
    const email = document.getElementById("reset-email").value.trim();
    if (!email) return;
    
    const btn = document.getElementById("btn-send-reset-otp");
    btn.disabled = true;
    btn.innerText = "Requesting code...";
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/auth/reset-password/request`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email })
        });
        
        const data = await response.json();
        if (response.ok && data.success) {
            resetTargetEmail = email;
            document.getElementById("reset-step-1-container").style.display = "none";
            document.getElementById("reset-step-2-container").style.display = "block";
        } else {
            authError.innerText = data.error || "Failed to send reset code.";
            authError.style.display = "block";
        }
    } catch(e) {
        authError.innerText = "Connection error. Make sure your API is online.";
        authError.style.display = "block";
    } finally {
        btn.disabled = false;
        btn.innerText = "Send Reset Code";
    }
}

async function handleResetVerifySubmit(event) {
    event.preventDefault();
    authError.style.display = "none";
    authSuccess.style.display = "none";
    
    const code = document.getElementById("reset-code").value.trim();
    const newPassword = document.getElementById("reset-new-password").value;
    
    if (!code || !newPassword) return;
    
    const btn = document.getElementById("btn-confirm-reset");
    btn.disabled = true;
    btn.innerText = "Updating password...";
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/auth/reset-password/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: resetTargetEmail, code, newPassword })
        });
        
        const data = await response.json();
        if (response.ok && data.success) {
            showLogin();
            authSuccess.innerText = "Password reset successfully! Please sign in using your new password.";
            authSuccess.style.display = "block";
            document.getElementById("reset-code").value = "";
            document.getElementById("reset-new-password").value = "";
            document.getElementById("reset-email").value = "";
        } else {
            authError.innerText = data.error || "Verification failed.";
            authError.style.display = "block";
        }
    } catch(e) {
        authError.innerText = "Verification connection failed.";
        authError.style.display = "block";
    } finally {
        btn.disabled = false;
        btn.innerText = "Reset Password";
    }
}

window.showResetStep1 = showResetStep1;
window.showLogin = showLogin;
window.handleResetRequestSubmit = handleResetRequestSubmit;
window.handleResetVerifySubmit = handleResetVerifySubmit;

async function unbindDevice(deviceId) {
    if (!confirm("Are you sure you want to unbind this hardware slot? This will allow you to authorize a new computer in its place.")) return;
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/portal/device/unbind`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ deviceId })
        });
        
        const data = await response.json();
        if (data.success) {
            loadSubscriptionData();
        } else {
            alert(data.error || "Failed to unbind slot.");
        }
    } catch(e) {
        alert("Failed to reach server.");
    }
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

function handleLogout() {
    localStorage.removeItem("user_token");
    localStorage.removeItem("user_email");
    token = null;
    showAuth();
}

window.loginWithGoogle = loginWithGoogle;
window.handleLogout = handleLogout;

function switchPortalTab(tabName) {
    const tabDevices = document.getElementById("portal-tab-devices");
    const tabUpgrade = document.getElementById("portal-tab-upgrade");
    const pageDevices = document.getElementById("portal-page-devices");
    const pageUpgrade = document.getElementById("portal-page-upgrade");
    
    if (!tabDevices || !tabUpgrade || !pageDevices || !pageUpgrade) return;
    
    tabDevices.classList.remove("active");
    tabUpgrade.classList.remove("active");
    pageDevices.style.display = "none";
    pageUpgrade.style.display = "none";
    
    if (tabName === 'devices') {
        tabDevices.classList.add("active");
        pageDevices.style.display = "grid";
    } else {
        tabUpgrade.classList.add("active");
        pageUpgrade.style.display = "block";
        loadUpgradePrices();
    }
}

async function loadPricingConfigs() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/pricing`);
        const data = await response.json();
        if (data.success) {
            pricingData = data.pricing;
        }
    } catch(e) {
        console.error("Failed to load pricing data:", e);
    }
}

function loadUpgradePrices() {
    const term = document.getElementById("upgrade-billing-term").value;
    const list = document.getElementById("upgrade-plans-list");
    if (!list) return;
    list.innerHTML = "";
    
    const filtered = pricingData.filter(p => p.billing_option === term && p.is_enabled !== 0);
    filtered.sort((a, b) => a.pc_slots - b.pc_slots);
    
    if (filtered.length === 0) {
        list.innerHTML = `<div style="font-size: 13px; color: var(--text-muted);">No active packages available.</div>`;
        return;
    }
    
    const userCustomDiscount = userCachedDetails?.custom_discount || 0;
    
    filtered.forEach((p, idx) => {
        const basePrice = p.price;
        const promoDiscount = p.promo_discount || 0;
        
        let promo = promoDiscount;
        if (userCustomDiscount > 0) {
            promo = (basePrice * userCustomDiscount) / 100;
        }
        
        const finalPrice = Math.max(0, basePrice - promo);
        const pct = basePrice > 0 ? Math.round((promo / basePrice) * 100) : 0;
        
        const isChecked = idx === 0 ? "checked" : "";
        
        const item = document.createElement("div");
        item.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 12px; background: rgba(0,0,0,0.15); border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer; user-select: none; margin-bottom: 8px;";
        item.onclick = () => {
            const rad = document.getElementById(`plan-radio-${p.id}`);
            if (rad) {
                rad.checked = true;
                updateSelectedPlanPrice(finalPrice);
            }
        };
        
        let tagText = "";
        if (pct > 0) {
            tagText = `<span style="background: rgba(16,185,129,0.15); color: var(--success-color); font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 700; margin-left: 6px;">${pct}% OFF</span>`;
        }
        
        item.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <input type="radio" name="upgrade-plan" id="plan-radio-${p.id}" value="${p.id}" data-price="${finalPrice}" ${isChecked} style="cursor: pointer; width: 16px; height: 16px;">
                <div>
                    <div style="font-size: 13px; font-weight: 700; display: flex; align-items: center;">${p.pc_slots} PC License ${tagText}</div>
                    <div style="font-size: 11px; color: var(--text-muted); text-transform: capitalize;">${p.billing_option}</div>
                </div>
            </div>
            <div style="text-align: right;">
                <div style="font-size: 14px; font-weight: 700; color: var(--success-color);">Rs. ${finalPrice.toFixed(2)}</div>
                ${pct > 0 ? `<div style="font-size: 10px; color: var(--text-muted); text-decoration: line-through;">Rs. ${basePrice.toFixed(2)}</div>` : ''}
            </div>
        `;
        list.appendChild(item);
        
        if (idx === 0) {
            updateSelectedPlanPrice(finalPrice);
        }
    });
    
    const banner = document.getElementById("portal-user-discount-banner");
    if (banner) {
        if (userCustomDiscount > 0) {
            banner.style.display = "block";
            banner.innerHTML = `<i class="fa-solid fa-gift"></i> Custom ${userCustomDiscount}% discount applied to your account!`;
        } else {
            banner.style.display = "none";
        }
    }
}

function updateSelectedPlanPrice(price) {
    const disp = document.getElementById("claim-display-amount");
    if (disp) {
        disp.value = `Rs. ${price.toFixed(2)}`;
    }
}

function handleReceiptFileChange(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById("claim-receipt-base64").value = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function handleClaimSubmit(event) {
    event.preventDefault();
    
    const selectedRadio = document.querySelector('input[name="upgrade-plan"]:checked');
    if (!selectedRadio) {
        alert("Please select a premium plan option first.");
        return;
    }
    
    const pricing_id = selectedRadio.value;
    const amount = parseFloat(selectedRadio.getAttribute("data-price"));
    const transaction_id = document.getElementById("claim-trx-id").value.trim();
    const receipt_image = document.getElementById("claim-receipt-base64").value || null;
    
    if (!transaction_id) {
        alert("Transaction ID is required to verify your payment transfer.");
        return;
    }
    
    const submitBtn = event.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    const oldText = submitBtn.innerHTML;
    submitBtn.innerHTML = "Submitting claim...";
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/payments/claim`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ pricing_id, amount, transaction_id, receipt_image })
        });
        
        const data = await response.json();
        if (data.success) {
            alert(data.message);
            document.getElementById("payment-claim-form").reset();
            document.getElementById("claim-receipt-base64").value = "";
            await loadClaimsList();
        } else {
            alert(data.error || "Submission failed. Please check inputs.");
        }
    } catch(e) {
        alert("Connection lost to servers.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = oldText;
    }
}

async function loadClaimsList() {
    const tableBody = document.getElementById("claims-table-body");
    if (!tableBody) return;
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/payments/claims`, {
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        if (data.success) {
            const claims = data.claims;
            tableBody.innerHTML = "";
            
            if (claims.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No payment claims submitted yet.</td></tr>`;
                return;
            }
            
            claims.forEach(c => {
                const dateStr = new Date(c.created_at).toLocaleDateString();
                
                let statusBadgeClass = "warning";
                if (c.status === 'approved') statusBadgeClass = "success";
                if (c.status === 'rejected') statusBadgeClass = "danger";
                
                const parts = c.pricing_id.split('_');
                const slots = parts[0].replace("pc", "");
                const term = parts[1];
                const packageTitle = `${slots} PC ${term.charAt(0).toUpperCase() + term.slice(1)}`;
                
                const row = document.createElement("tr");
                row.innerHTML = `
                    <td>${dateStr}</td>
                    <td style="font-weight: 700;">${packageTitle}</td>
                    <td style="color: var(--success-color); font-weight: 600;">Rs. ${c.amount.toFixed(2)}</td>
                    <td style="font-family: monospace;">${c.transaction_id}</td>
                    <td><span class="badge ${statusBadgeClass}">${c.status.toUpperCase()}</span></td>
                    <td style="color: var(--text-muted); font-size: 11px;">${c.notes || 'Awaiting administrator verification...'}</td>
                `;
                tableBody.appendChild(row);
            });
        }
    } catch(e) {
        console.error("Failed to load claims history:", e);
    }
}

function openQRModal(provider) {
    const modal = document.getElementById("view-qr-modal");
    const title = document.getElementById("qr-modal-title");
    const subtitle = document.getElementById("qr-modal-subtitle");
    const img = document.getElementById("qr-modal-img");
    
    if (!modal || !title || !subtitle || !img) return;
    
    if (provider === 'easypaisa') {
        title.innerText = "EasyPaisa Account QR Code";
        subtitle.innerText = "Scan this QR code in your EasyPaisa app to transfer funds to Miraj Ahmed (03332876228) instantly.";
        img.src = "easypaisa_qr.jpg";
    } else {
        title.innerText = "NayaPay / Raast QR Code";
        subtitle.innerText = "Scan this QR code in your NayaPay / banking app to transfer funds to Mairaj Ahmed (Raast ID: PK71NAYA1234503332876228) instantly.";
        img.src = "nayapay_qr.jpg";
    }
    
    modal.style.display = "flex";
}

function closeQRModal() {
    const modal = document.getElementById("view-qr-modal");
    if (modal) {
        modal.style.display = "none";
    }
}

window.switchPortalTab = switchPortalTab;
window.loadPricingConfigs = loadPricingConfigs;
window.loadUpgradePrices = loadUpgradePrices;
window.updateSelectedPlanPrice = updateSelectedPlanPrice;
window.handleReceiptFileChange = handleReceiptFileChange;
window.handleClaimSubmit = handleClaimSubmit;
window.loadClaimsList = loadClaimsList;
window.openQRModal = openQRModal;
window.closeQRModal = closeQRModal;
window.addEventListener("DOMContentLoaded", init);
