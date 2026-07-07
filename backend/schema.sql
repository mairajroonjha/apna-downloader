-- Profiles table: holds user accounts
CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY, -- UUID or unique string
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_plain TEXT,
    first_name TEXT,
    last_name TEXT,
    approval_status TEXT DEFAULT 'pending',
    is_blacklisted INTEGER DEFAULT 0,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Subscriptions and License statuses table
CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    plan_type TEXT CHECK(plan_type IN ('trial', 'monthly', 'yearly', 'lifetime')) DEFAULT 'trial',
    pc_slots INTEGER CHECK(pc_slots IN (1, 2, 3)) DEFAULT 1,
    status TEXT CHECK(status IN ('active', 'expired')) DEFAULT 'active',
    trial_start DATETIME DEFAULT CURRENT_TIMESTAMP,
    trial_end DATETIME,
    license_key TEXT UNIQUE,
    active_devices TEXT DEFAULT '[]', -- JSON string list of authorized machine hardware IDs
    custom_discount INTEGER DEFAULT 0
);

-- Pricing configurations and discount management
CREATE TABLE IF NOT EXISTS pricing_configs (
    id TEXT PRIMARY KEY, -- e.g., "1pc_monthly", "2pc_yearly", "3pc_lifetime"
    plan_name TEXT NOT NULL,
    pc_count INTEGER NOT NULL,
    term_type TEXT CHECK(term_type IN ('monthly', 'yearly', 'lifetime')) NOT NULL,
    price REAL NOT NULL,
    active_discount REAL DEFAULT 0.0, -- percentage discount e.g. 15.0 for 15% off
    is_enabled INTEGER DEFAULT 1
);

-- Seed initial pricing data
INSERT OR IGNORE INTO pricing_configs (id, plan_name, pc_count, term_type, price, active_discount, is_enabled) VALUES
('1pc_monthly', '1 PC Monthly', 1, 'monthly', 1.99, 0.0, 1),
('2pc_monthly', '2 PCs Monthly', 2, 'monthly', 2.99, 0.0, 1),
('3pc_monthly', '3 PCs Monthly', 3, 'monthly', 3.99, 0.0, 1),
('1pc_yearly', '1 PC Yearly', 1, 'yearly', 14.99, 0.0, 1),
('2pc_yearly', '2 PCs Yearly', 2, 'yearly', 22.99, 0.0, 1),
('3pc_yearly', '3 PCs Yearly', 3, 'yearly', 29.99, 0.0, 1),
('1pc_lifetime', '1 PC Lifetime', 1, 'lifetime', 24.99, 0.0, 1),
('2pc_lifetime', '2 PCs Lifetime', 2, 'lifetime', 39.99, 0.0, 1),
('3pc_lifetime', '3 PCs Lifetime', 3, 'lifetime', 49.99, 0.0, 1);

-- Seed test user profiles (password for all is "password123")
INSERT OR IGNORE INTO profiles (id, email, password_hash, password_plain, approval_status) VALUES
('u_trial_id', 'trial@example.com', '4ee3408ecc57e2a065e3087d3e55745f:5a4d22efa0d9985bcc786dbc7bd3b59134b119363596f81d312ceec0bb7bf700', 'password123', 'approved'),
('u_pro_id', 'pro@example.com', '4ee3408ecc57e2a065e3087d3e55745f:5a4d22efa0d9985bcc786dbc7bd3b59134b119363596f81d312ceec0bb7bf700', 'password123', 'approved'),
('u_expired_id', 'expired@example.com', '4ee3408ecc57e2a065e3087d3e55745f:5a4d22efa0d9985bcc786dbc7bd3b59134b119363596f81d312ceec0bb7bf700', 'password123', 'approved');

-- Seed test subscriptions corresponding to user profiles
INSERT OR IGNORE INTO subscriptions (user_id, plan_type, pc_slots, status, trial_end, active_devices) VALUES
('u_trial_id', 'trial', 1, 'active', '2028-12-31T00:00:00.000Z', '[]'),
('u_pro_id', 'lifetime', 3, 'active', NULL, '[]'),
('u_expired_id', 'trial', 1, 'expired', '2026-01-01T00:00:00.000Z', '[]');

-- Admin OTP verification storage
CREATE TABLE IF NOT EXISTS admin_otps (
    email TEXT PRIMARY KEY,
    otp TEXT NOT NULL,
    expires_at DATETIME NOT NULL
);

-- Manual Payment verification ledger
CREATE TABLE IF NOT EXISTS payment_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    pricing_id TEXT NOT NULL REFERENCES pricing_configs(id),
    amount REAL NOT NULL,
    transaction_id TEXT UNIQUE NOT NULL,
    status TEXT CHECK(status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
    receipt_image TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
