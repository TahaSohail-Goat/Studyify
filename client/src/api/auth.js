export const API_URL = "http://localhost:5000";

// Build the public URL for a stored avatar filename (or null if none).
export function avatarUrl(filename) {
  return filename ? `${API_URL}/avatars/${filename}` : null;
}

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Something went wrong.");
  return data;
}

// Step 1 — send OTP to email.
export function sendOtpApi(email) {
  return request("/api/auth/send-otp", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

// Step 2 — verify OTP, get back a short-lived verifiedToken.
export function verifyOtpApi(email, code) {
  return request("/api/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

// Step 3 — complete signup with name + password.
export function completeSignupApi(verifiedToken, name, password) {
  return request("/api/auth/complete-signup", {
    method: "POST",
    body: JSON.stringify({ verifiedToken, name, password }),
  });
}

// Resend a fresh code.
export function resendOtpApi(email) {
  return request("/api/auth/resend-otp", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function changePasswordApi(currentPassword, newPassword) {
  const token = localStorage.getItem("token");
  return request("/api/auth/change-password", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export function loginApi(email, password) {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function getMeApi(token) {
  const data = await request("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data.user;
}

function authHeader() {
  return { Authorization: `Bearer ${localStorage.getItem("token")}` };
}

export function updateProfileApi(fields) {
  return request("/api/auth/update-profile", {
    method: "PUT",
    headers: authHeader(),
    body: JSON.stringify(fields),
  });
}

export function requestEmailChangeApi(newEmail) {
  return request("/api/auth/request-email-change", {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({ newEmail }),
  });
}

export function confirmEmailChangeApi(newEmail, code) {
  return request("/api/auth/confirm-email-change", {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({ newEmail, code }),
  });
}

export function deleteAccountApi() {
  return request("/api/auth/delete-account", {
    method: "DELETE",
    headers: authHeader(),
  });
}

// Profile photo upload — FormData, so no Content-Type (browser sets the boundary).
export async function uploadAvatarApi(file) {
  const formData = new FormData();
  formData.append("avatar", file);

  const res = await fetch(`${API_URL}/api/auth/avatar`, {
    method: "POST",
    headers: authHeader(),
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Could not upload photo.");
  return data;
}

export function removeAvatarApi() {
  return request("/api/auth/avatar", {
    method: "DELETE",
    headers: authHeader(),
  });
}

// Invalidate every login token (this device included).
export function logoutAllApi() {
  return request("/api/auth/logout-all", {
    method: "POST",
    headers: authHeader(),
  });
}

// Download a JSON snapshot of the account + notes as a file.
export async function exportDataApi() {
  const res = await fetch(`${API_URL}/api/auth/export`, {
    headers: authHeader(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Could not export data.");

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "studify-data.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
