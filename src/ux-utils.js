/**
 * Apna Downloader - UX Performance & Accessibility Utilities (Electron Renderer)
 * Provides Client-Side Caching, Accessible Tooltips, and Graceful Error Boundaries.
 */

// ==========================================================================
// 1. ApiCache (Client-Side Caching with Stale-While-Revalidate)
// ==========================================================================
class ApiCacheStore {
    constructor() {
        this.memoryCache = new Map();
        this.prefix = "apna_cache_";
    }

    get(key) {
        const memoryItem = this.memoryCache.get(key);
        const now = Date.now();

        if (memoryItem) {
            if (memoryItem.expiry > now) {
                return { data: memoryItem.data, isStale: false };
            }
            return { data: memoryItem.data, isStale: true };
        }

        try {
            const lsRaw = localStorage.getItem(this.prefix + key);
            if (lsRaw) {
                const item = JSON.parse(lsRaw);
                if (item.expiry > now) {
                    this.memoryCache.set(key, item);
                    return { data: item.data, isStale: false };
                }
                return { data: item.data, isStale: true };
            }
        } catch (e) {}

        return null;
    }

    set(key, data, ttlMs = 120000, persistToLocalStorage = false) {
        const item = {
            data,
            timestamp: Date.now(),
            expiry: Date.now() + ttlMs
        };
        this.memoryCache.set(key, item);

        if (persistToLocalStorage) {
            try {
                localStorage.setItem(this.prefix + key, JSON.stringify(item));
            } catch (e) {}
        }
    }

    invalidate(keyPrefix) {
        for (const k of this.memoryCache.keys()) {
            if (k.startsWith(keyPrefix)) {
                this.memoryCache.delete(k);
            }
        }

        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith(this.prefix + keyPrefix)) {
                    localStorage.removeItem(k);
                }
            }
        } catch (e) {}
    }

    async fetchWithCache(key, fetcherFn, options = {}) {
        const { ttlMs = 120000, persist = false, forceRefresh = false } = options;

        if (!forceRefresh) {
            const cached = this.get(key);
            if (cached) {
                if (!cached.isStale) {
                    return cached.data;
                }
                fetcherFn()
                    .then(freshData => {
                        this.set(key, freshData, ttlMs, persist);
                    })
                    .catch(err => console.warn(`Background revalidation failed for ${key}:`, err));
                
                return cached.data;
            }
        }

        const freshData = await fetcherFn();
        this.set(key, freshData, ttlMs, persist);
        return freshData;
    }
}

export const ApiCache = new ApiCacheStore();
if (typeof window !== "undefined") {
    window.ApiCache = ApiCache;
}

// ==========================================================================
// 2. TooltipManager (Accessible Hover & Keyboard Tooltips)
// ==========================================================================
class AccessibleTooltipManager {
    constructor() {
        this.tooltipEl = null;
        this.activeTarget = null;
        this.init();
    }

    init() {
        if (typeof document === "undefined") return;
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => this.setupListeners());
        } else {
            this.setupListeners();
        }
    }

    setupListeners() {
        if (!this.tooltipEl) {
            this.tooltipEl = document.createElement("div");
            this.tooltipEl.className = "app-tooltip";
            this.tooltipEl.setAttribute("role", "tooltip");
            this.tooltipEl.setAttribute("aria-hidden", "true");
            document.body.appendChild(this.tooltipEl);
        }

        document.addEventListener("mouseover", (e) => this.handleEvent(e));
        document.addEventListener("mouseout", (e) => this.hideTooltip(e));
        document.addEventListener("focusin", (e) => this.handleEvent(e));
        document.addEventListener("focusout", (e) => this.hideTooltip(e));
        window.addEventListener("scroll", () => this.updatePosition(), true);
        window.addEventListener("resize", () => this.updatePosition());
    }

    handleEvent(e) {
        const target = e.target.closest("[data-tooltip]");
        if (!target) return;

        const text = target.getAttribute("data-tooltip");
        if (!text) return;

        this.activeTarget = target;
        this.tooltipEl.innerText = text;
        this.tooltipEl.classList.add("visible");
        this.tooltipEl.setAttribute("aria-hidden", "false");

        if (!target.getAttribute("aria-label") && !target.innerText.trim()) {
            target.setAttribute("aria-label", text);
        }

        this.updatePosition();
    }

    updatePosition() {
        if (!this.activeTarget || !this.tooltipEl) return;

        const rect = this.activeTarget.getBoundingClientRect();
        const tooltipRect = this.tooltipEl.getBoundingClientRect();
        const placement = this.activeTarget.getAttribute("data-tooltip-placement") || "top";

        let top = 0;
        let left = 0;

        if (placement === "bottom") {
            top = rect.bottom + 6;
            left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
        } else if (placement === "left") {
            top = rect.top + (rect.height / 2) - (tooltipRect.height / 2);
            left = rect.left - tooltipRect.width - 6;
        } else if (placement === "right") {
            top = rect.top + (rect.height / 2) - (tooltipRect.height / 2);
            left = rect.right + 6;
        } else {
            top = rect.top - tooltipRect.height - 6;
            left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
        }

        const margin = 8;
        if (left < margin) left = margin;
        if (left + tooltipRect.width > window.innerWidth - margin) {
            left = window.innerWidth - margin - tooltipRect.width;
        }
        if (top < margin) {
            top = rect.bottom + 6;
        }

        this.tooltipEl.style.top = `${Math.round(top)}px`;
        this.tooltipEl.style.left = `${Math.round(left)}px`;
    }

    hideTooltip(e) {
        if (!this.activeTarget) return;

        if (e && e.relatedTarget && this.activeTarget.contains(e.relatedTarget)) {
            return;
        }

        this.activeTarget = null;
        if (this.tooltipEl) {
            this.tooltipEl.classList.remove("visible");
            this.tooltipEl.setAttribute("aria-hidden", "true");
        }
    }
}

export const TooltipManager = new AccessibleTooltipManager();
if (typeof window !== "undefined") {
    window.TooltipManager = TooltipManager;
}

// ==========================================================================
// 3. ErrorBoundary (Section & Global Error Handling)
// ==========================================================================
export const ErrorBoundary = {
    render(container, options = {}) {
        if (!container) return;

        const {
            title = "Something went wrong",
            message = "We couldn't load this section. Please try again.",
            onRetry = null,
            icon = "fa-solid fa-triangle-exclamation"
        } = options;

        container.innerHTML = `
            <div class="error-boundary-box" role="alert" aria-live="assertive">
                <i class="${icon} error-boundary-icon" aria-hidden="true"></i>
                <div class="error-boundary-title">${title}</div>
                <div class="error-boundary-msg">${message}</div>
                ${onRetry ? `
                    <button class="btn-retry" type="button" aria-label="Retry loading this section">
                        <i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Retry
                    </button>
                ` : ''}
            </div>
        `;

        if (onRetry) {
            const retryBtn = container.querySelector(".btn-retry");
            if (retryBtn) {
                retryBtn.addEventListener("click", (e) => {
                    e.preventDefault();
                    onRetry();
                });
            }
        }
    },

    setupGlobalErrorHandler(showToastFn) {
        if (typeof window === "undefined") return;

        window.addEventListener("error", (event) => {
            console.error("Global UI Error caught:", event.error || event.message);
            if (showToastFn && typeof showToastFn === "function") {
                showToastFn("An unexpected UI error occurred.", "danger");
            }
        });

        window.addEventListener("unhandledrejection", (event) => {
            console.error("Unhandled Promise Rejection caught:", event.reason);
            if (showToastFn && typeof showToastFn === "function") {
                showToastFn("Network connection lost or request failed.", "warning");
            }
        });
    }
};

if (typeof window !== "undefined") {
    window.ErrorBoundary = ErrorBoundary;
}

// ==========================================================================
// 4. Floating Toast Notification System
// ==========================================================================
export function showToast(message, type = "info", durationMs = 3500) {
    if (typeof document === "undefined") return;
    let container = document.getElementById("app-toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "app-toast-container";
        container.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 10001;
            display: flex;
            flex-direction: column;
            gap: 10px;
            pointer-events: none;
        `;
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.style.cssText = `
        padding: 10px 16px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        color: #ffffff;
        background: ${type === 'danger' ? '#ef4444' : (type === 'success' ? '#10b981' : (type === 'warning' ? '#f59e0b' : '#3b82f6'))};
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
        pointer-events: auto;
        opacity: 0;
        transform: translateY(10px);
        transition: opacity 0.2s ease, transform 0.2s ease;
        display: flex;
        align-items: center;
        gap: 8px;
    `;

    const iconClass = type === 'danger' ? 'fa-circle-xmark' : (type === 'success' ? 'fa-circle-check' : (type === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-info'));
    toast.innerHTML = `<i class="fa-solid ${iconClass}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 200);
    }, durationMs);
}

if (typeof window !== "undefined") {
    window.showToast = showToast;
    ErrorBoundary.setupGlobalErrorHandler(showToast);
}
