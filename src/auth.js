// Authentication renderer handler for Electron client login/signup

const BACKEND_URL = "https://apna-downloader-backend.mirajroonjha.workers.dev"; // Change this to your deployed Cloudflare Worker subdomain in production

let mode = "login"; // 'login' or 'register'

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const errorMsg = document.getElementById("error-msg");
const btnSubmit = document.getElementById("btn-submit");
const btnText = document.getElementById("btn-text");
const btnSpinner = document.getElementById("btn-spinner");
const toggleLink = document.getElementById("toggle-auth-mode");
const subtitle = document.getElementById("auth-subtitle");

const registerFields = document.getElementById("register-fields");
const firstNameInput = document.getElementById("first_name");
const lastNameInput = document.getElementById("last_name");

function toggleMode() {
    errorMsg.style.display = "none";
    if (mode === "login") {
        mode = "register";
        subtitle.innerText = "Create an account to start your 15-day free trial";
        btnText.innerText = "Register";
        toggleLink.innerHTML = "Already have an account? <span>Log In</span>";
        registerFields.style.display = "block";
        firstNameInput.required = true;
        lastNameInput.required = true;
    } else {
        mode = "login";
        subtitle.innerText = "Log in to verify your 15-day free trial";
        btnText.innerText = "Log In";
        toggleLink.innerHTML = "Don't have an account? <span>Register</span>";
        registerFields.style.display = "none";
        firstNameInput.required = false;
        lastNameInput.required = false;
    }
}

function showError(msg, isSuccess = false) {
    errorMsg.innerText = msg;
    errorMsg.style.display = "block";
    errorMsg.style.backgroundColor = isSuccess ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)";
    errorMsg.style.borderColor = isSuccess ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)";
    errorMsg.style.color = isSuccess ? "var(--success-color, #10b981)" : "var(--danger-color)";
}

async function handleAuthSubmit(event) {
    event.preventDefault();
    errorMsg.style.display = "none";

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const first_name = firstNameInput.value.trim();
    const last_name = lastNameInput.value.trim();

    if (!email || !password || (mode === "register" && (!first_name || !last_name))) {
        showError("Please fill out all required fields.");
        return;
    }

    // Toggle loading UI state
    btnSubmit.disabled = true;
    btnSpinner.style.display = "inline-block";

    const endpoint = mode === "register" ? "/api/auth/register" : "/api/auth/login";
    const bodyPayload = mode === "register" 
        ? { first_name, last_name, email, password } 
        : { email, password };

    try {
        const response = await fetch(`${BACKEND_URL}${endpoint}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(bodyPayload)
        });

        const data = await response.json();

        if (response.ok && data.success) {
            if (mode === "register") {
                // Show success banner and toggle back to login mode
                showError(data.message || "Registration completed successfully! You can now log in.", true);
                firstNameInput.value = "";
                lastNameInput.value = "";
                emailInput.value = "";
                passwordInput.value = "";
                setTimeout(() => {
                    toggleMode();
                }, 3000);
            } else {
                // Save token and load dashboard
                await window.api.saveAuthToken({ token: data.token, email: data.email });
            }
        } else {
            showError(data.error || "Authentication failed. Please check credentials.");
        }
    } catch (e) {
        console.error("Auth request failed:", e);
        showError("Could not connect to authentication server. Please check internet connection.");
    } finally {
        btnSubmit.disabled = false;
        btnSpinner.style.display = "none";
    }
}

const btnGoogle = document.getElementById("btn-google");
if (btnGoogle) {
    btnGoogle.addEventListener('click', async () => {
        errorMsg.style.display = "none";
        btnGoogle.disabled = true;
        
        try {
            const res = await window.api.startGoogleAuth();
            if (res && res.success) {
                if (res.isPending) {
                    showError(res.message || "Google account registered! Awaiting admin approval.", true);
                } else {
                    await window.api.saveAuthToken({ token: res.token, email: res.email });
                }
            } else {
                showError(res.error || "Google authentication failed.");
            }
        } catch(e) {
            console.error("Google Auth failed:", e);
            showError("Google Authentication encountered an error.");
        } finally {
            btnGoogle.disabled = false;
        }
    });
}
