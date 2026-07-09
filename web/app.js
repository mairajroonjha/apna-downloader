const BACKEND_URL = "https://apna-downloader-backend.mirajroonjha.workers.dev";

let activeOption = 'monthly';
let pricingData = [];

async function loadPricing() {
    try {
        const headers = {};
        const token = localStorage.getItem("user_token");
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }
        
        const res = await fetch(`${BACKEND_URL}/api/pricing`, { headers });
        const data = await res.json();
        if (data.success) {
            pricingData = data.pricing;
            renderPricing();
        }
    } catch (e) {
        console.error("Failed to load prices from backend:", e);
        // Fallback default prices if backend is offline/seeding
        pricingData = [
            { id: 1, pc_slots: 1, billing_option: 'monthly', price: 299, promo_discount: 0 },
            { id: 2, pc_slots: 2, billing_option: 'monthly', price: 449, promo_discount: 0 },
            { id: 3, pc_slots: 3, billing_option: 'monthly', price: 599, promo_discount: 0 },
            { id: 4, pc_slots: 1, billing_option: 'yearly', price: 2499, promo_discount: 0 },
            { id: 5, pc_slots: 2, billing_option: 'yearly', price: 3749, promo_discount: 0 },
            { id: 6, pc_slots: 3, billing_option: 'yearly', price: 4999, promo_discount: 0 },
            { id: 7, pc_slots: 1, billing_option: 'lifetime', price: 3999, promo_discount: 0 },
            { id: 8, pc_slots: 2, billing_option: 'lifetime', price: 5999, promo_discount: 0 },
            { id: 9, pc_slots: 3, billing_option: 'lifetime', price: 7999, promo_discount: 0 },
        ];
        renderPricing();
    }
}

function switchBilling(option) {
    activeOption = option;
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.innerText.toLowerCase().includes(option)) {
            btn.classList.add('active');
        }
    });
    renderPricing();
}

function renderPricing() {
    const container = document.getElementById("pricing-grid-container");
    if (!container) return;
    
    container.innerHTML = "";
    const filtered = pricingData.filter(p => p.billing_option === activeOption && p.is_enabled !== 0);
    
    // Sort by device slots
    filtered.sort((a,b) => a.pc_slots - b.pc_slots);
    
    filtered.forEach(p => {
        const hasDiscount = p.promo_discount > 0;
        const finalPrice = hasDiscount ? (p.price - p.promo_discount) : p.price;
        const discountPercentage = hasDiscount ? Math.round((p.promo_discount / p.price) * 100) : 0;
        
        let title = `${p.pc_slots} PC Plan`;
        if (discountPercentage > 0) {
            if (p.pc_slots === 1) title = `1 PC Plan (Save ~${discountPercentage}%)`;
            else if (p.pc_slots === 2) title = `2 PCs Pack (Save ~${discountPercentage}%)`;
            else if (p.pc_slots === 3) title = `3 PCs Pack (Save ~${discountPercentage}%)`;
        } else {
            if (p.pc_slots === 2) title = "2 PCs Pack (Save ~25%)";
            if (p.pc_slots === 3) title = "3 PCs Pack (Save ~33%)";
        }
        
        let sub = `Perfect for individual downloaders`;
        if (p.pc_slots === 2) sub = `Great for home computers & laptops`;
        if (p.pc_slots === 3) sub = `Best value pack for small families`;
        
        const card = document.createElement("div");
        card.className = `pricing-card-3d ${p.pc_slots === 2 ? 'popular' : ''}`;
        
        const isComingSoon = p.is_enabled === 2;
        
        card.innerHTML = `
            ${isComingSoon ? '<div class="pricing-badge" style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);">Coming Soon</div>' : (p.pc_slots === 2 ? '<div class="pricing-badge">Best Value</div>' : '')}
            <div>
                <div class="pricing-header">
                    <h3>${title}</h3>
                    <p>${sub}</p>
                </div>
                <div class="pricing-price">
                    ${isComingSoon ? '' : (hasDiscount ? `<span class="original-price">Rs. ${p.price.toFixed(2)}</span>` : '')}
                    ${isComingSoon ? 'TBA' : `Rs. ${finalPrice.toFixed(2)}`}
                    <span>${isComingSoon ? '' : `/ ${p.billing_option}`}</span>
                </div>
                ${!isComingSoon && hasDiscount ? (
                    p.user_custom_discount > 0 ?
                    `<div style="color: var(--accent-color); font-size: 12px; font-weight: 700; margin-bottom: 15px;"><i class="fa-solid fa-gift"></i> Personalized Account Discount: ${discountPercentage}% OFF applied!</div>` :
                    `<div style="color: var(--success-color); font-size: 12px; font-weight: 700; margin-bottom: 15px;"><i class="fa-solid fa-tags"></i> SALE: ${discountPercentage}% OFF applied!</div>`
                ) : ''}
                <ul class="pricing-features">
                    <li><i class="fa-solid fa-check"></i> ${p.pc_slots} Active Device Slot(s)</li>
                    <li><i class="fa-solid fa-check"></i> Max connections segment caps (32 segments)</li>
                    <li><i class="fa-solid fa-check"></i> Uncapped maximum download speed</li>
                    <li><i class="fa-solid fa-check"></i> Free lifetime updates</li>
                </ul>
            </div>
            ${isComingSoon ? 
                `<button class="pricing-btn-3d" style="background: rgba(255,255,255,0.05) !important; border-bottom: 4px solid rgba(255,255,255,0.1) !important; color: var(--text-muted) !important; cursor: not-allowed;" disabled>Coming Soon</button>` : 
                `<button class="pricing-btn-3d" onclick="buyPlan('${p.id}')">Get Started</button>`
            }
        `;
        container.appendChild(card);
    });
}

function buyPlan(planId) {
    const plan = pricingData.find(p => p.id === planId);
    if (!plan) {
        window.location.href = "portal.html";
        return;
    }
    window.location.href = `portal.html?billing=${plan.billing_option}&slots=${plan.pc_slots}`;
}

// Initial load
window.buyPlan = buyPlan;
window.switchBilling = switchBilling;
window.addEventListener("DOMContentLoaded", loadPricing);
