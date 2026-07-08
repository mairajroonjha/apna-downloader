// Serverless Cloudflare Workers API for Apna Downloader SaaS

const JWT_SECRET = "apna-downloader-super-secret-key-12345";
const ADMIN_MASTER_KEY = "apnadl-admin-master-key-12345"; // Admin Master Token

// PBKDF2 Password Hashing using Web Crypto API
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const passwordKey = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits", "deriveKey"]
    );
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const pbkdf2Params = {
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256"
    };
    const key = await crypto.subtle.deriveKey(
        pbkdf2Params,
        passwordKey,
        { name: "HMAC", hash: "SHA-256", length: 256 },
        true,
        ["sign", "verify"]
    );
    const derivedKey = await crypto.subtle.exportKey("raw", key);
    
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
    const keyHex = Array.from(new Uint8Array(derivedKey)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${saltHex}:${keyHex}`;
}

async function verifyPassword(password, storedHash) {
    try {
        const [saltHex, keyHex] = storedHash.split(':');
        const salt = new Uint8Array(saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        const encoder = new TextEncoder();
        const passwordKey = await crypto.subtle.importKey(
            "raw",
            encoder.encode(password),
            { name: "PBKDF2" },
            false,
            ["deriveBits", "deriveKey"]
        );
        const pbkdf2Params = {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256"
        };
        const key = await crypto.subtle.deriveKey(
            pbkdf2Params,
            passwordKey,
            { name: "HMAC", hash: "SHA-256", length: 256 },
            true,
            ["sign", "verify"]
        );
        const derivedKey = await crypto.subtle.exportKey("raw", key);
        const keyHexCheck = Array.from(new Uint8Array(derivedKey)).map(b => b.toString(16).padStart(2, '0')).join('');
        return keyHex === keyHexCheck;
    } catch(e) {
        return false;
    }
}

// Simple JWT utilities using HMAC-SHA256 and Web Crypto API
async function getJwtSecretKey(secret) {
    const encoder = new TextEncoder();
    return await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"]
    );
}

async function signJwt(payload, secret) {
    const key = await getJwtSecretKey(secret);
    const header = { alg: "HS256", typ: "JWT" };
    
    const base64Header = btoa(JSON.stringify(header)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const base64Payload = btoa(JSON.stringify(payload)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    
    const tokenInput = `${base64Header}.${base64Payload}`;
    const encoder = new TextEncoder();
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(tokenInput));
    const base64Signature = btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
        
    return `${tokenInput}.${base64Signature}`;
}

async function verifyJwt(token, secret) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        
        const [headerB64, payloadB64, signatureB64] = parts;
        const key = await getJwtSecretKey(secret);
        const encoder = new TextEncoder();
        
        const tokenInput = `${headerB64}.${payloadB64}`;
        
        const sigString = atob(signatureB64.replace(/-/g, "+").replace(/_/g, "/"));
        const sigBuffer = new Uint8Array(sigString.length);
        for (let i = 0; i < sigString.length; i++) {
            sigBuffer[i] = sigString.charCodeAt(i);
        }
        
        const isValid = await crypto.subtle.verify("HMAC", key, sigBuffer, encoder.encode(tokenInput));
        if (!isValid) return null;
        
        const payloadString = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
        return JSON.parse(payloadString);
    } catch (e) {
        return null;
    }
}

async function isAdminAuthorized(authHeader, db, secret, masterKey) {
    if (!authHeader) return false;
    if (authHeader === `Bearer ${masterKey}`) {
        return true;
    }
    if (authHeader.startsWith("Bearer ")) {
        const token = authHeader.substring(7);
        try {
            const decoded = await verifyJwt(token, secret);
            if (decoded && decoded.admin === true) {
                if (decoded.email === "mirajroonjha@gmail.com") {
                    return true;
                }
                if (db) {
                    const checkAdmin = await db.prepare("SELECT is_admin FROM profiles WHERE email = ?").bind(decoded.email).first();
                    if (checkAdmin && checkAdmin.is_admin === 1) {
                        return true;
                    }
                }
            }
        } catch(e) {}
    }
    return false;
}

// Helper to parse base64 and write to R2
async function uploadBase64ToR2(base64Data, bucket) {
    if (!base64Data || !base64Data.includes(",")) return null;
    
    try {
        const parts = base64Data.split(",");
        const header = parts[0];
        const rawBase64 = parts[1];
        
        const mimeMatch = header.match(/data:(.*?);/);
        const contentType = mimeMatch ? mimeMatch[1] : "application/octet-stream";
        
        let ext = "png";
        if (contentType === "image/jpeg" || contentType === "image/jpg") ext = "jpg";
        else if (contentType === "image/gif") ext = "gif";
        else if (contentType === "image/webp") ext = "webp";
        
        // Convert base64 string to Uint8Array/ArrayBuffer
        const binaryString = atob(rawBase64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        const fileKey = `receipts/${crypto.randomUUID()}.${ext}`;
        
        // Put object in R2 bucket
        await bucket.put(fileKey, bytes.buffer, {
            httpMetadata: { contentType }
        });
        
        return fileKey;
    } catch (e) {
        console.error("R2 Upload failed:", e);
        return null;
    }
}

// Router Logic
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        // CORS headers configuration
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            // ==================== AUTH PATHS ====================

            // 1. SIGNUP ROUTE
            if (path === "/api/auth/register" && request.method === "POST") {
                const { first_name, last_name, email, password } = await request.json();
                if (!email || !password || !first_name || !last_name) {
                    return new Response(JSON.stringify({ success: false, error: "First name, last name, email and password are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                // Check duplicate email
                const existing = await env.DB.prepare("SELECT id FROM profiles WHERE email = ?").bind(email).first();
                if (existing) {
                    return new Response(JSON.stringify({ success: false, error: "Email is already registered" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const userId = crypto.randomUUID();
                const passHash = await hashPassword(password);

                // Insert profile (auto-approved) & inactive trial subscription
                await env.DB.batch([
                    env.DB.prepare("INSERT INTO profiles (id, email, password_hash, password_plain, first_name, last_name, approval_status) VALUES (?, ?, ?, ?, ?, ?, 'approved')").bind(userId, email, passHash, password, first_name, last_name),
                    env.DB.prepare("INSERT INTO subscriptions (user_id, plan_type, status, trial_end) VALUES (?, 'trial', 'expired', NULL)").bind(userId)
                ]);

                return new Response(JSON.stringify({ success: true, message: "Registration completed successfully! You can now log in." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            // 2. LOGIN ROUTE
            if (path === "/api/auth/login" && request.method === "POST") {
                const { email, password } = await request.json();
                if (!email || !password) {
                    return new Response(JSON.stringify({ success: false, error: "Email and password are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const user = await env.DB.prepare("SELECT id, password_hash, approval_status, is_blacklisted FROM profiles WHERE email = ?").bind(email).first();
                if (!user) {
                    return new Response(JSON.stringify({ success: false, error: "Invalid email or password" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                if (user.is_blacklisted === 1) {
                    return new Response(JSON.stringify({ success: false, error: "Your account has been suspended/blacklisted by the administrator." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const isValid = await verifyPassword(password, user.password_hash);
                if (!isValid) {
                    return new Response(JSON.stringify({ success: false, error: "Invalid email or password" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                if (user.approval_status === 'pending') {
                    return new Response(JSON.stringify({ success: false, error: "Your access request is pending admin approval. Please check back later." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const token = await signJwt({ userId: user.id, email }, JWT_SECRET);
                return new Response(JSON.stringify({ success: true, token, email }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            // 2b. REQUEST PASSWORD RESET
            if (path === "/api/auth/reset-password/request" && request.method === "POST") {
                const { email } = await request.json();
                if (!email) {
                    return new Response(JSON.stringify({ success: false, error: "Email address is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const emailClean = email.toLowerCase().trim();
                const user = await env.DB.prepare("SELECT id FROM profiles WHERE email = ?").bind(emailClean).first();
                if (!user) {
                    return new Response(JSON.stringify({ success: true, message: "If this email is registered, a password reset code has been sent." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                // Cooldown check (60 seconds)
                const record = await env.DB.prepare("SELECT expires_at FROM admin_otps WHERE email = ?").bind(emailClean).first();
                if (record) {
                    const timeLeft = new Date(record.expires_at).getTime() - Date.now();
                    if (timeLeft > 4 * 60 * 1000) {
                        return new Response(JSON.stringify({ success: false, error: "Please wait 60 seconds before requesting another code." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                    }
                }

                const code = Math.floor(100000 + Math.random() * 900000).toString();
                const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

                await env.DB.prepare("INSERT OR REPLACE INTO admin_otps (email, otp, expires_at) VALUES (?, ?, ?)").bind(emailClean, code, expiresAt).run();

                const resendApiKey = env.RESEND_API_KEY;
                let emailSent = false;
                if (resendApiKey) {
                    try {
                        const resendRes = await fetch("https://api.resend.com/emails", {
                            method: "POST",
                            headers: {
                                "Authorization": `Bearer ${resendApiKey}`,
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify({
                                from: "Apna Downloader <security@resend.dev>",
                                to: emailClean,
                                subject: "Apna Downloader - Password Reset Verification Code",
                                html: `<p>Hello,</p><p>You requested a password reset. Your 6-digit verification code is: <strong style="font-size: 20px; color: #ea4335; letter-spacing: 2px;">${code}</strong></p><p>This code is valid for 10 minutes.</p>`
                            })
                        });
                        emailSent = resendRes.ok;
                    } catch (e) {
                        console.error("Resend API error:", e);
                    }
                }

                console.log(`[PASSWORD RESET OTP] Generated reset code for ${emailClean}: ${code}`);

                return new Response(JSON.stringify({ success: true, message: "Verification code sent successfully!" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            // 2c. VERIFY PASSWORD RESET
            if (path === "/api/auth/reset-password/verify" && request.method === "POST") {
                const { email, code, newPassword } = await request.json();
                if (!email || !code || !newPassword) {
                    return new Response(JSON.stringify({ success: false, error: "Email, code, and new password are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const emailClean = email.toLowerCase().trim();
                const record = await env.DB.prepare("SELECT otp, expires_at FROM admin_otps WHERE email = ?").bind(emailClean).first();
                if (!record) {
                    return new Response(JSON.stringify({ success: false, error: "No active verification request found. Please request a new code." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                if (new Date(record.expires_at) < new Date()) {
                    return new Response(JSON.stringify({ success: false, error: "Verification code has expired. Please request a new one." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                if (record.otp !== code.trim()) {
                    return new Response(JSON.stringify({ success: false, error: "Invalid verification code. Please try again." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                await env.DB.prepare("DELETE FROM admin_otps WHERE email = ?").bind(emailClean).run();

                const passHash = await hashPassword(newPassword);
                await env.DB.prepare("UPDATE profiles SET password_hash = ?, password_plain = ? WHERE email = ?").bind(passHash, newPassword, emailClean).run();

                return new Response(JSON.stringify({ success: true, message: "Password updated successfully! You can now log in." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            // ==================== APP LICENSE PATHS ====================

            // 3. LICENSE & DEVICE VERIFICATION ROUTE
            if (path === "/api/license/verify" && request.method === "POST") {
                const authHeader = request.headers.get("Authorization");
                const { deviceId } = await request.json();

                if (!authHeader || !authHeader.startsWith("Bearer ") || !deviceId) {
                    return new Response(JSON.stringify({ success: false, error: "Token and device ID are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const token = authHeader.substring(7);
                const decoded = await verifyJwt(token, JWT_SECRET);
                if (!decoded) {
                    return new Response(JSON.stringify({ success: false, error: "Invalid or expired auth token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const profile = await env.DB.prepare("SELECT is_blacklisted FROM profiles WHERE id = ?").bind(decoded.userId).first();
                if (!profile || profile.is_blacklisted === 1) {
                    return new Response(JSON.stringify({
                        success: false,
                        status: "blacklisted",
                        message: "Your account has been blacklisted/suspended by the administrator."
                    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const sub = await env.DB.prepare("SELECT plan_type, pc_slots, status, trial_end, active_devices FROM subscriptions WHERE user_id = ?").bind(decoded.userId).first();
                if (!sub) {
                    return new Response(JSON.stringify({ success: false, error: "No subscription record found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                // Check Trial Expiration
                let currentStatus = sub.status;
                let trialDaysLeft = 0;

                if (sub.plan_type === 'trial') {
                    if (!sub.trial_end) {
                        return new Response(JSON.stringify({
                            success: false,
                            status: "trial_not_started",
                            message: "You have not activated your free trial yet. Start your trial to begin downloading."
                        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                    }
                    const now = new Date();
                    const end = new Date(sub.trial_end);
                    if (now > end) {
                        currentStatus = 'expired';
                        await env.DB.prepare("UPDATE subscriptions SET status = 'expired' WHERE user_id = ?").bind(decoded.userId).run();
                    } else {
                        trialDaysLeft = Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));
                    }
                }

                if (currentStatus === 'expired') {
                    return new Response(JSON.stringify({
                        success: false,
                        status: "expired",
                        message: "Your trial period or subscription has expired. Please buy a license to continue downloading."
                    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                // Verify PC Device slots limit
                let devices = [];
                try { devices = JSON.parse(sub.active_devices || "[]"); } catch(e) {}

                if (!devices.includes(deviceId)) {
                    if (devices.length >= sub.pc_slots) {
                        return new Response(JSON.stringify({
                            success: false,
                            status: "device_limit_reached",
                            message: `License slot limit reached. This plan only supports up to ${sub.pc_slots} active PC(s). Please manage active slots in the web portal.`
                        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                    }
                    devices.push(deviceId);
                    await env.DB.prepare("UPDATE subscriptions SET active_devices = ? WHERE user_id = ?").bind(JSON.stringify(devices), decoded.userId).run();
                }

                // Define client speed & connection limits based on license status
                const isTrial = sub.plan_type === 'trial';
                const maxSegments = isTrial ? 16 : 32;
                const maxSpeedBytes = isTrial ? 10485760 : 0; // 10 MB/s limit for trial users, uncapped for Pro

                return new Response(JSON.stringify({
                    success: true,
                    status: isTrial ? "trial" : "active",
                    plan_type: sub.plan_type,
                    pc_slots: sub.pc_slots,
                    trial_days_left: trialDaysLeft,
                    limits: {
                        maxSegments,
                        maxSpeedBytes
                    }
                }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            // ==================== USER PORTAL PATHS ====================

            // 4. USER PORTAL SUBSCRIPTION DETAILS GET
            if (path === "/api/portal/subscription" && request.method === "GET") {
                const authHeader = request.headers.get("Authorization");
                if (!authHeader || !authHeader.startsWith("Bearer ")) {
                    return new Response(JSON.stringify({ success: false, error: "Token is required" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const token = authHeader.substring(7);
                const decoded = await verifyJwt(token, JWT_SECRET);
                if (!decoded) {
                    return new Response(JSON.stringify({ success: false, error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const info = await env.DB.prepare(
                    "SELECT p.email, p.first_name, p.last_name, p.is_blacklisted, s.plan_type, s.pc_slots, s.status, s.trial_end, s.active_devices, s.custom_discount FROM profiles p JOIN subscriptions s ON p.id = s.user_id WHERE p.id = ?"
                ).bind(decoded.userId).first();

                if (!info) {
                    return new Response(JSON.stringify({ success: false, error: "Profile not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                if (info.is_blacklisted === 1) {
                    return new Response(JSON.stringify({ success: false, error: "Your account has been blacklisted/suspended by the administrator." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                return new Response(JSON.stringify({ success: true, profile: info }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            // 5. USER PORTAL DEVICE UNBIND POST
            if (path === "/api/portal/device/unbind" && request.method === "POST") {
                const authHeader = request.headers.get("Authorization");
                const { deviceId } = await request.json();

                if (!authHeader || !authHeader.startsWith("Bearer ") || !deviceId) {
                    return new Response(JSON.stringify({ success: false, error: "Missing required parameters" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const token = authHeader.substring(7);
                const decoded = await verifyJwt(token, JWT_SECRET);
                if (!decoded) {
                    return new Response(JSON.stringify({ success: false, error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const sub = await env.DB.prepare("SELECT active_devices FROM subscriptions WHERE user_id = ?").bind(decoded.userId).first();
                if (!sub) {
                    return new Response(JSON.stringify({ success: false, error: "No subscription found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                let devices = [];
                try { devices = JSON.parse(sub.active_devices || "[]"); } catch(e) {}

                const newDevices = devices.filter(d => d !== deviceId);
                await env.DB.prepare("UPDATE subscriptions SET active_devices = ? WHERE user_id = ?").bind(JSON.stringify(newDevices), decoded.userId).run();

                return new Response(JSON.stringify({ success: true, active_devices: newDevices }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            // ==================== ADMIN PANEL PATHS ====================

            // 6. PUBLIC PRICING DETAILS (Landing page access)
            if (path === "/api/pricing" && request.method === "GET") {
                const authHeader = request.headers.get("Authorization");
                let discountPercent = 0;

                if (authHeader && authHeader.startsWith("Bearer ")) {
                    const token = authHeader.substring(7);
                    try {
                        const decoded = await verifyJwt(token, JWT_SECRET);
                        if (decoded) {
                            const sub = await env.DB.prepare("SELECT custom_discount FROM subscriptions WHERE user_id = ?").bind(decoded.userId).first();
                            if (sub) {
                                discountPercent = sub.custom_discount || 0;
                            }
                        }
                    } catch(e) {}
                }

                const prices = await env.DB.prepare("SELECT id, pc_count AS pc_slots, term_type AS billing_option, price, active_discount AS promo_discount, is_enabled FROM pricing_configs").all();
                
                const modifiedPrices = prices.results.map(p => {
                    let promo = p.promo_discount;
                    if (discountPercent > 0) {
                        const calculatedDiscount = p.price * (discountPercent / 100);
                        if (calculatedDiscount > p.promo_discount) {
                            promo = calculatedDiscount;
                        }
                    }
                    return {
                        id: p.id,
                        pc_slots: p.pc_slots,
                        billing_option: p.billing_option,
                        price: p.price,
                        promo_discount: promo,
                        is_enabled: p.is_enabled,
                        user_custom_discount: discountPercent
                    };
                });

                return new Response(JSON.stringify({ success: true, pricing: modifiedPrices }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            // 6b. ADMIN AUTHENTICATION - REQUEST OTP
            if (path === "/api/admin/auth/send-otp" && request.method === "POST") {
                const { email, password } = await request.json();
                if (!email || !password) {
                    return new Response(JSON.stringify({ success: false, error: "Email and password are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const emailClean = email.toLowerCase().trim();
                const TARGET_ADMIN_EMAIL = "mirajroonjha@gmail.com";
                let isAllowed = false;
                if (emailClean === TARGET_ADMIN_EMAIL) {
                    isAllowed = true;
                } else {
                    const checkAdmin = await env.DB.prepare("SELECT is_admin FROM profiles WHERE email = ?").bind(emailClean).first();
                    if (checkAdmin && checkAdmin.is_admin === 1) {
                        isAllowed = true;
                    }
                }

                if (!isAllowed) {
                    return new Response(JSON.stringify({ success: false, error: "Email is not authorized for administrator access." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const adminPassword = env.ADMIN_PASSWORD || ADMIN_MASTER_KEY;
                if (password !== adminPassword) {
                    return new Response(JSON.stringify({ success: false, error: "Invalid administrator password." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                // Cooldown check (60 seconds)
                const record = await env.DB.prepare("SELECT expires_at FROM admin_otps WHERE email = ?").bind(emailClean).first();
                if (record) {
                    const timeLeft = new Date(record.expires_at).getTime() - Date.now();
                    if (timeLeft > 4 * 60 * 1000) {
                        return new Response(JSON.stringify({ success: false, error: "Please wait 60 seconds before requesting another code." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                    }
                }

                // Generate 6-digit code
                const code = Math.floor(100000 + Math.random() * 900000).toString();
                const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // Valid for 5 minutes

                // Save in admin_otps database
                await env.DB.prepare(
                    "INSERT OR REPLACE INTO admin_otps (email, otp, expires_at) VALUES (?, ?, ?)"
                ).bind(emailClean, code, expiresAt).run();

                // Send email using Resend API if key exists
                const resendApiKey = env.RESEND_API_KEY;
                let emailSent = false;
                if (resendApiKey) {
                    try {
                        const resendRes = await fetch("https://api.resend.com/emails", {
                            method: "POST",
                            headers: {
                                "Authorization": `Bearer ${resendApiKey}`,
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify({
                                from: "Apna Downloader <security@resend.dev>",
                                to: emailClean,
                                subject: "Apna Downloader - Admin Verification Code",
                                html: `<p>Hello Admin,</p><p>Your 6-digit verification code is: <strong style="font-size: 20px; color: #3b82f6; letter-spacing: 2px;">${code}</strong></p><p>This code is valid for 5 minutes.</p>`
                            })
                        });
                        emailSent = resendRes.ok;
                    } catch (e) {
                        console.error("Resend API error:", e);
                    }
                }

                // Log to console for local backup lookup
                console.log(`[ADMIN AUTH OTP] Generated code for ${emailClean}: ${code}`);

                return new Response(JSON.stringify({ success: true, emailSent }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            // 6c. ADMIN AUTHENTICATION - VERIFY OTP
            if (path === "/api/admin/auth/verify-otp" && request.method === "POST") {
                const { email, otp } = await request.json();
                if (!email || !otp) {
                    return new Response(JSON.stringify({ success: false, error: "Email and verification code are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const emailClean = email.toLowerCase().trim();
                const TARGET_ADMIN_EMAIL = "mirajroonjha@gmail.com";
                let isAllowed = false;
                if (emailClean === TARGET_ADMIN_EMAIL) {
                    isAllowed = true;
                } else {
                    const checkAdmin = await env.DB.prepare("SELECT is_admin FROM profiles WHERE email = ?").bind(emailClean).first();
                    if (checkAdmin && checkAdmin.is_admin === 1) {
                        isAllowed = true;
                    }
                }

                if (!isAllowed) {
                    return new Response(JSON.stringify({ success: false, error: "Email is not authorized." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const record = await env.DB.prepare(
                    "SELECT otp, expires_at FROM admin_otps WHERE email = ?"
                ).bind(emailClean).first();

                if (!record) {
                    return new Response(JSON.stringify({ success: false, error: "No active verification request found. Please request a new code." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                if (new Date(record.expires_at) < new Date()) {
                    return new Response(JSON.stringify({ success: false, error: "Verification code has expired. Please request a new one." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                if (record.otp !== otp.trim()) {
                    return new Response(JSON.stringify({ success: false, error: "Invalid verification code. Please try again." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                // Consume code
                await env.DB.prepare("DELETE FROM admin_otps WHERE email = ?").bind(emailClean).run();

                // Sign JWT Admin token
                const token = await signJwt({ admin: true, email: emailClean }, JWT_SECRET);

                return new Response(JSON.stringify({ success: true, token }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            // 7. ADMIN GET ALL USERS & SUBSCRIPTIONS
            if (path === "/api/admin/users" && request.method === "GET") {
                const authHeader = request.headers.get("Authorization");
                if (!(await isAdminAuthorized(authHeader, env.DB, JWT_SECRET, ADMIN_MASTER_KEY))) {
                    return new Response(JSON.stringify({ success: false, error: "Unauthorized admin access" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const list = await env.DB.prepare(
                    "SELECT p.id, p.email, p.password_plain, p.first_name, p.last_name, p.approval_status, p.is_blacklisted, p.is_admin, s.plan_type, s.pc_slots, s.status, s.trial_end, s.active_devices, s.custom_discount FROM profiles p JOIN subscriptions s ON p.id = s.user_id"
                ).all();

                return new Response(JSON.stringify({ success: true, users: list.results }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            // 8. ADMIN UPDATE USER SUBSCRIPTION (Upgrade / override billing manually)
            if (path === "/api/admin/users/update" && request.method === "POST") {
                const authHeader = request.headers.get("Authorization");
                if (!(await isAdminAuthorized(authHeader, env.DB, JWT_SECRET, ADMIN_MASTER_KEY))) {
                    return new Response(JSON.stringify({ success: false, error: "Unauthorized admin access" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const { userId, plan_type, pc_slots, status, trial_end, active_devices, password, is_blacklisted, custom_discount, is_admin } = await request.json();

                await env.DB.prepare(
                    "UPDATE subscriptions SET plan_type = ?, pc_slots = ?, status = ?, trial_end = ?, active_devices = ?, custom_discount = ? WHERE user_id = ?"
                ).bind(plan_type, pc_slots, status, trial_end || null, active_devices || "[]", custom_discount || 0, userId).run();

                await env.DB.prepare("UPDATE profiles SET is_blacklisted = ?, is_admin = ? WHERE id = ?").bind(is_blacklisted ? 1 : 0, is_admin ? 1 : 0, userId).run();

                if (password && password.trim().length > 0) {
                    const passHash = await hashPassword(password);
                    await env.DB.prepare(
                        "UPDATE profiles SET password_hash = ?, password_plain = ? WHERE id = ?"
                    ).bind(passHash, password, userId).run();
                }

                return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            // 8b. ADMIN APPROVE USER REGISTRATION ACCESS
            if (path === "/api/admin/users/approve" && request.method === "POST") {
                const authHeader = request.headers.get("Authorization");
                if (!(await isAdminAuthorized(authHeader, env.DB, JWT_SECRET, ADMIN_MASTER_KEY))) {
                    return new Response(JSON.stringify({ success: false, error: "Unauthorized admin access" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const { userId } = await request.json();
                await env.DB.prepare("UPDATE profiles SET approval_status = 'approved' WHERE id = ?").bind(userId).run();

                return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            // 8c. ADMIN DELETE USER ACCOUNT
            if (path === "/api/admin/users/delete" && request.method === "POST") {
                const authHeader = request.headers.get("Authorization");
                if (!(await isAdminAuthorized(authHeader, env.DB, JWT_SECRET, ADMIN_MASTER_KEY))) {
                    return new Response(JSON.stringify({ success: false, error: "Unauthorized admin access" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const { userId } = await request.json();
                
                // Delete user profile (ON DELETE CASCADE handles subscriptions table automatically)
                await env.DB.prepare("DELETE FROM profiles WHERE id = ?").bind(userId).run();

                return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            // 9. ADMIN UPDATE PRICING AND CAMPAIGN DISCOUNTS
            if (path === "/api/admin/pricing/update" && request.method === "POST") {
                const authHeader = request.headers.get("Authorization");
                if (!(await isAdminAuthorized(authHeader, env.DB, JWT_SECRET, ADMIN_MASTER_KEY))) {
                    return new Response(JSON.stringify({ success: false, error: "Unauthorized admin access" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const { configId, price, promo_discount, is_enabled } = await request.json();

                await env.DB.prepare(
                    "UPDATE pricing_configs SET price = ?, active_discount = ?, is_enabled = ? WHERE id = ?"
                ).bind(price, promo_discount, is_enabled, configId).run();

                return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            // 10. ACTIVATE FREE 15-DAY TRIAL (CALLED BY LOGGED IN USER)
            if (path === "/api/portal/start-trial" && request.method === "POST") {
                const authHeader = request.headers.get("Authorization");
                if (!authHeader || !authHeader.startsWith("Bearer ")) {
                    return new Response(JSON.stringify({ success: false, error: "Unauthorized access" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const token = authHeader.substring(7);
                const decoded = await verifyJwt(token, JWT_SECRET);
                if (!decoded) {
                    return new Response(JSON.stringify({ success: false, error: "Invalid auth token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const sub = await env.DB.prepare("SELECT trial_end FROM subscriptions WHERE user_id = ?").bind(decoded.userId).first();
                if (!sub) {
                    return new Response(JSON.stringify({ success: false, error: "Subscription record missing" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                if (sub.trial_end) {
                    return new Response(JSON.stringify({ success: false, error: "You have already activated your free trial." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const trialEndDate = new Date();
                trialEndDate.setDate(trialEndDate.getDate() + 15);

                await env.DB.prepare("UPDATE subscriptions SET plan_type = 'trial', status = 'active', trial_end = ? WHERE user_id = ?")
                    .bind(trialEndDate.toISOString(), decoded.userId).run();

                return new Response(JSON.stringify({ success: true, message: "Free trial activated successfully!" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            // 11. GOOGLE SIGNIN / REGISTRATION ENDPOINT
            if (path === "/api/auth/google" && request.method === "POST") {
                const { code } = await request.json();
                if (!code) {
                    return new Response(JSON.stringify({ success: false, error: "Authorization code is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const client_id = (env.GOOGLE_CLIENT_ID || "732595466975-kvoo3oio590k54bse7jhhu5pmctp7u1g.apps.googleusercontent.com").trim();
                const client_secret = (env.GOOGLE_CLIENT_SECRET || "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").trim();

                // 1. Exchange auth code for Google Tokens
                const tokenExchangeRes = await fetch("https://oauth2.googleapis.com/token", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                        code: code,
                        client_id: client_id,
                        client_secret: client_secret,
                        redirect_uri: "http://127.0.0.1:48329/oauth/callback",
                        grant_type: "authorization_code"
                    })
                });

                if (!tokenExchangeRes.ok) {
                    const errorText = await tokenExchangeRes.text();
                    return new Response(JSON.stringify({ success: false, error: `Google auth exchange failed: ${errorText}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const tokens = await tokenExchangeRes.json();
                const idToken = tokens.id_token;

                // 2. Verify ID token and extract user details
                const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
                if (!verifyRes.ok) {
                    return new Response(JSON.stringify({ success: false, error: "Failed to verify Google ID token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const googleUser = await verifyRes.json();
                const email = googleUser.email;
                const firstName = googleUser.given_name || "GoogleUser";
                const lastName = googleUser.family_name || "";

                if (!email) {
                    return new Response(JSON.stringify({ success: false, error: "Google account does not provide email access" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                // 3. Check if user already exists
                const user = await env.DB.prepare("SELECT id, password_hash, approval_status, is_blacklisted FROM profiles WHERE email = ?").bind(email).first();

                if (user) {
                    if (user.is_blacklisted === 1) {
                        return new Response(JSON.stringify({ success: false, error: "Your account has been suspended/blacklisted by the administrator." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                    }
                    if (user.approval_status === 'pending') {
                        return new Response(JSON.stringify({ success: false, isPending: true, error: "Your access request is pending admin approval. Please check back later." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                    }

                    // Approved -> generate token
                    const token = await signJwt({ userId: user.id, email }, JWT_SECRET);
                    return new Response(JSON.stringify({ success: true, token, email }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                } else {
                    // New Google user -> auto-approve and log in immediately
                    const userId = crypto.randomUUID();
                    const passHash = await hashPassword(crypto.randomUUID());

                    await env.DB.batch([
                        env.DB.prepare("INSERT INTO profiles (id, email, password_hash, password_plain, first_name, last_name, approval_status) VALUES (?, ?, ?, 'Signed in via Google', ?, ?, 'approved')").bind(userId, email, passHash, firstName, lastName),
                        env.DB.prepare("INSERT INTO subscriptions (user_id, plan_type, status, trial_end) VALUES (?, 'trial', 'expired', NULL)").bind(userId)
                    ]);

                    const token = await signJwt({ userId, email }, JWT_SECRET);
                    return new Response(JSON.stringify({ success: true, token, email }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }
            }

            // 11b. GOOGLE CALLBACK FOR WEB REDIRECT
            if (path === "/api/auth/google/callback" && request.method === "GET") {
                const urlObj = new URL(request.url);
                const code = urlObj.searchParams.get("code");
                const state = urlObj.searchParams.get("state") || ""; // Redirect target portal URL
                
                if (!code) {
                    return new Response("Missing authorization code", { status: 400 });
                }

                const client_id = (env.GOOGLE_CLIENT_ID || "732595466975-kvoo3oio590k54bse7jhhu5pmctp7u1g.apps.googleusercontent.com").trim();
                const client_secret = (env.GOOGLE_CLIENT_SECRET || "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").trim();

                // 1. Exchange auth code for Google Tokens
                const tokenExchangeRes = await fetch("https://oauth2.googleapis.com/token", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                        code: code,
                        client_id: client_id,
                        client_secret: client_secret,
                        redirect_uri: "https://apna-downloader-backend.mirajroonjha.workers.dev/api/auth/google/callback",
                        grant_type: "authorization_code"
                    })
                });

                if (!tokenExchangeRes.ok) {
                    const errText = await tokenExchangeRes.text();
                    return new Response(`Token exchange failed: ${errText}`, { status: 400 });
                }

                const tokens = await tokenExchangeRes.json();
                const idToken = tokens.id_token;

                // 2. Verify ID token and extract user details
                const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
                if (!verifyRes.ok) {
                    return new Response("Failed to verify Google ID token", { status: 400 });
                }

                const googleUser = await verifyRes.json();
                const email = googleUser.email;
                const firstName = googleUser.given_name || "GoogleUser";
                const lastName = googleUser.family_name || "";

                if (!email) {
                    return new Response("Google account does not provide email access", { status: 400 });
                }

                // Check if redirect target is the admin panel
                const isAdminTarget = state && decodeURIComponent(state).includes("admin.html");

                if (isAdminTarget) {
                    const TARGET_ADMIN_EMAIL = "mirajroonjha@gmail.com";
                    let isAllowed = false;
                    const emailClean = email.toLowerCase().trim();
                    if (emailClean === TARGET_ADMIN_EMAIL) {
                        isAllowed = true;
                    } else {
                        const checkAdmin = await env.DB.prepare("SELECT is_admin FROM profiles WHERE email = ?").bind(emailClean).first();
                        if (checkAdmin && checkAdmin.is_admin === 1) {
                            isAllowed = true;
                        }
                    }

                    if (!isAllowed) {
                        const redirectUrl = `${decodeURIComponent(state)}?error=${encodeURIComponent("This Google account is not authorized as an administrator.")}`;
                        return new Response(null, {
                            status: 302,
                            headers: {
                                "Location": redirectUrl
                            }
                        });
                    }

                    // Generate admin session token
                    const sessionToken = await signJwt({ admin: true, email: emailClean }, JWT_SECRET);
                    const redirectUrl = `${decodeURIComponent(state)}?token=${sessionToken}&email=${emailClean}`;
                    return new Response(null, {
                        status: 302,
                        headers: {
                            "Location": redirectUrl
                        }
                    });
                }

                // 3. Check if user already exists
                let user = await env.DB.prepare("SELECT id, approval_status, is_blacklisted FROM profiles WHERE email = ?").bind(email).first();
                let userId = user ? user.id : null;

                if (!user) {
                    const redirectUrl = state ? `${decodeURIComponent(state)}?error=${encodeURIComponent("This Google account is not registered. Please register first inside the Apna Downloader app.")}` : `https://apna-downloader-backend.mirajroonjha.workers.dev?error=NotRegistered`;
                    return new Response(null, {
                        status: 302,
                        headers: {
                            "Location": redirectUrl
                        }
                    });
                } else {
                    if (user.is_blacklisted === 1) {
                        return new Response("Your account has been suspended/blacklisted by the administrator.", { status: 403 });
                    }
                }

                // Generate session JWT
                const sessionToken = await signJwt({ userId, email }, JWT_SECRET);

                // Redirect user back to portal.html with token details
                const redirectUrl = state ? `${decodeURIComponent(state)}?token=${sessionToken}&email=${email}` : `https://apna-downloader-backend.mirajroonjha.workers.dev?token=${sessionToken}&email=${email}`;
                
                return new Response(null, {
                    status: 302,
                    headers: {
                        "Location": redirectUrl
                    }
                });
            }

            // ==================== MANUAL PAYMENTS PATHS ====================

            if (path === "/api/payments/claim" && request.method === "POST") {
                const authHeader = request.headers.get("Authorization");
                if (!authHeader || !authHeader.startsWith("Bearer ")) {
                    return new Response(JSON.stringify({ success: false, error: "Unauthorized access" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }
                const token = authHeader.substring(7);
                const decoded = await verifyJwt(token, JWT_SECRET);
                if (!decoded) {
                    return new Response(JSON.stringify({ success: false, error: "Invalid session token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const { pricing_id, amount, transaction_id, receipt_image } = await request.json();
                if (!pricing_id || !amount || !transaction_id) {
                    return new Response(JSON.stringify({ success: false, error: "Pricing ID, amount, and transaction ID are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                // Check for duplicate Transaction ID
                const duplicate = await env.DB.prepare("SELECT id FROM payment_claims WHERE transaction_id = ?").bind(transaction_id.trim()).first();
                if (duplicate) {
                    return new Response(JSON.stringify({ success: false, error: "This Transaction ID has already been submitted or verified." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                // Verify pricing_id exists in pricing_configs
                const pricingRecord = await env.DB.prepare("SELECT id FROM pricing_configs WHERE id = ?").bind(pricing_id).first();
                if (!pricingRecord) {
                    return new Response(JSON.stringify({ success: false, error: "Invalid package pricing selection" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                // Upload receipt image to Cloudflare R2 bucket if present
                const fileKey = await uploadBase64ToR2(receipt_image, env.RECEIPTS_BUCKET);

                // Insert claim
                await env.DB.prepare(
                    "INSERT INTO payment_claims (user_id, email, pricing_id, amount, transaction_id, receipt_image, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')"
                ).bind(decoded.userId, decoded.email, pricing_id, parseFloat(amount), transaction_id.trim(), fileKey).run();

                return new Response(JSON.stringify({ success: true, message: "Payment verification claim submitted successfully! Admin will review within 1-2 hours." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            if (path === "/api/payments/claims" && request.method === "GET") {
                const authHeader = request.headers.get("Authorization");
                if (!authHeader || !authHeader.startsWith("Bearer ")) {
                    return new Response(JSON.stringify({ success: false, error: "Unauthorized access" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }
                const token = authHeader.substring(7);
                const decoded = await verifyJwt(token, JWT_SECRET);
                if (!decoded) {
                    return new Response(JSON.stringify({ success: false, error: "Invalid session token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const claims = await env.DB.prepare(
                    "SELECT id, pricing_id, amount, transaction_id, status, notes, created_at FROM payment_claims WHERE user_id = ? ORDER BY created_at DESC"
                ).bind(decoded.userId).all();

                return new Response(JSON.stringify({ success: true, claims: claims.results }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            if (path === "/api/admin/payments/claims" && request.method === "GET") {
                const authHeader = request.headers.get("Authorization");
                const authorized = await isAdminAuthorized(authHeader, env.DB, JWT_SECRET, ADMIN_MASTER_KEY);
                if (!authorized) {
                    return new Response(JSON.stringify({ success: false, error: "Forbidden: Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const claims = await env.DB.prepare(
                    `SELECT c.id, c.user_id, c.email, c.pricing_id, c.amount, c.transaction_id, c.status, c.receipt_image, c.notes, c.created_at, p.first_name, p.last_name 
                     FROM payment_claims c 
                     JOIN profiles p ON c.user_id = p.id 
                     ORDER BY c.created_at DESC`
                ).all();

                return new Response(JSON.stringify({ success: true, claims: claims.results }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            if (path === "/api/admin/payments/claims/approve" && request.method === "POST") {
                const authHeader = request.headers.get("Authorization");
                const authorized = await isAdminAuthorized(authHeader, env.DB, JWT_SECRET, ADMIN_MASTER_KEY);
                if (!authorized) {
                    return new Response(JSON.stringify({ success: false, error: "Forbidden: Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const { claimId } = await request.json();
                if (!claimId) {
                    return new Response(JSON.stringify({ success: false, error: "Claim ID is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                // Fetch claim details
                const claim = await env.DB.prepare("SELECT * FROM payment_claims WHERE id = ?").bind(claimId).first();
                if (!claim) {
                    return new Response(JSON.stringify({ success: false, error: "Claim record not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                if (claim.status !== 'pending') {
                    return new Response(JSON.stringify({ success: false, error: "Claim has already been processed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                // Parse pricing_id to determine plan_type and pc_slots
                // e.g. "2pc_monthly" -> term is "monthly", slots is 2
                const parts = claim.pricing_id.split('_');
                const slotsStr = parts[0]; // e.g. "2pc"
                const plan_type = parts[1]; // e.g. "monthly"
                const pc_slots = parseInt(slotsStr.replace("pc", ""), 10) || 1;

                // Generate premium license key
                const rawKey = crypto.randomUUID().replace(/-/g, "").toUpperCase();
                const licenseKey = `APNADL-${rawKey.substring(0, 4)}-${rawKey.substring(4, 8)}-${rawKey.substring(8, 12)}`;

                // Update user subscription & update claim status in batch
                await env.DB.batch([
                    env.DB.prepare(
                        `UPDATE subscriptions 
                         SET plan_type = ?, pc_slots = ?, status = 'active', trial_end = NULL, license_key = ?, active_devices = '[]' 
                         WHERE user_id = ?`
                    ).bind(plan_type, pc_slots, licenseKey, claim.user_id),
                    env.DB.prepare(
                        "UPDATE payment_claims SET status = 'approved', notes = ? WHERE id = ?"
                    ).bind(`Approved by Admin. License key: ${licenseKey}`, claimId)
                ]);

                return new Response(JSON.stringify({ success: true, message: "Claim approved and license activated successfully!" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            if (path === "/api/admin/payments/claims/reject" && request.method === "POST") {
                const authHeader = request.headers.get("Authorization");
                const authorized = await isAdminAuthorized(authHeader, env.DB, JWT_SECRET, ADMIN_MASTER_KEY);
                if (!authorized) {
                    return new Response(JSON.stringify({ success: false, error: "Forbidden: Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const { claimId, notes } = await request.json();
                if (!claimId || !notes) {
                    return new Response(JSON.stringify({ success: false, error: "Claim ID and rejection reason notes are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const claim = await env.DB.prepare("SELECT status FROM payment_claims WHERE id = ?").bind(claimId).first();
                if (!claim) {
                    return new Response(JSON.stringify({ success: false, error: "Claim record not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                if (claim.status !== 'pending') {
                    return new Response(JSON.stringify({ success: false, error: "Claim has already been processed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                await env.DB.prepare(
                    "UPDATE payment_claims SET status = 'rejected', notes = ? WHERE id = ?"
                ).bind(notes.trim(), claimId).run();

                return new Response(JSON.stringify({ success: true, message: "Claim has been successfully rejected." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            if (path === "/api/admin/payments/receipt" && request.method === "GET") {
                const authHeader = request.headers.get("Authorization");
                const authorized = await isAdminAuthorized(authHeader, env.DB, JWT_SECRET, ADMIN_MASTER_KEY);
                if (!authorized) {
                    return new Response(JSON.stringify({ success: false, error: "Forbidden: Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const key = url.searchParams.get("key");
                if (!key || !key.startsWith("receipts/")) {
                    return new Response(JSON.stringify({ success: false, error: "Invalid receipt key" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const object = await env.RECEIPTS_BUCKET.get(key);
                if (!object) {
                    return new Response(JSON.stringify({ success: false, error: "Receipt image file not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const headers = new Headers();
                object.writeHttpMetadata(headers);
                // Ensure CORS headers and custom content type are set
                headers.set("Access-Control-Allow-Origin", "*");
                headers.set("Access-Control-Allow-Headers", "Authorization");
                headers.set("Access-Control-Allow-Methods", "GET");

                return new Response(object.body, { headers });
            }

            // ==================== SUPPORT INBOX PATHS ====================

            // 1. PUBLIC SUBMIT MESSAGE
            if (path === "/api/support" && request.method === "POST") {
                const { name, email, subject, message } = await request.json();
                if (!name || !email || !subject || !message) {
                    return new Response(JSON.stringify({ success: false, error: "Name, email, subject, and message are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                await env.DB.prepare(
                    "INSERT INTO support_messages (name, email, subject, message) VALUES (?, ?, ?, ?)"
                ).bind(name.trim(), email.trim(), subject.trim(), message.trim()).run();

                return new Response(JSON.stringify({ success: true, message: "Your message has been submitted. Our team will review it." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            // 2. ADMIN: GET ALL MESSAGES
            if (path === "/api/admin/support-messages" && request.method === "GET") {
                const authHeader = request.headers.get("Authorization");
                const authorized = await isAdminAuthorized(authHeader, env.DB, JWT_SECRET, ADMIN_MASTER_KEY);
                if (!authorized) {
                    return new Response(JSON.stringify({ success: false, error: "Forbidden: Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const { results } = await env.DB.prepare(
                    "SELECT * FROM support_messages ORDER BY created_at DESC"
                ).all();

                return new Response(JSON.stringify({ success: true, messages: results }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            // 3. ADMIN: RESOLVE MESSAGE
            if (path === "/api/admin/support-messages/resolve" && request.method === "POST") {
                const authHeader = request.headers.get("Authorization");
                const authorized = await isAdminAuthorized(authHeader, env.DB, JWT_SECRET, ADMIN_MASTER_KEY);
                if (!authorized) {
                    return new Response(JSON.stringify({ success: false, error: "Forbidden: Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const { id } = await request.json();
                if (!id) {
                    return new Response(JSON.stringify({ success: false, error: "Message ID is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                await env.DB.prepare(
                    "UPDATE support_messages SET status = 'resolved' WHERE id = ?"
                ).bind(id).run();

                return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            // 4. ADMIN: DELETE MESSAGE
            if (path === "/api/admin/support-messages/delete" && request.method === "POST") {
                const authHeader = request.headers.get("Authorization");
                const authorized = await isAdminAuthorized(authHeader, env.DB, JWT_SECRET, ADMIN_MASTER_KEY);
                if (!authorized) {
                    return new Response(JSON.stringify({ success: false, error: "Forbidden: Administrator access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                const { id } = await request.json();
                if (!id) {
                    return new Response(JSON.stringify({ success: false, error: "Message ID is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
                }

                await env.DB.prepare(
                    "DELETE FROM support_messages WHERE id = ?"
                ).bind(id).run();

                return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            return new Response(JSON.stringify({ success: false, error: "Not Found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

        } catch (err) {
            return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
    }
};
