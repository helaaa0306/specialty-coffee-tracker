/**
 * Shared Client Utilities for Specialty Coffee Tracker
 */

// Global API helper
async function apiRequest(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errorMsg = data.error || data.message || `Request failed with status ${res.status}`;
      const error = new Error(errorMsg);
      error.status = res.status;
      error.data = data;
      throw error;
    }

    return data;
  } catch (err) {
    throw err;
  }
}

// In-page alert message helper (No inline alert popups)
function showAlert(message, type = 'danger', containerId = 'alert-container') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const alert = document.createElement('div');
  alert.className = `alert alert-${type}`;
  alert.role = 'alert';
  alert.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button type="button" class="alert-close" aria-label="Close message" onclick="this.parentElement.remove()">×</button>
  `;

  // Auto-scroll to alert
  container.innerHTML = '';
  container.appendChild(alert);
  alert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Auto-dismiss after 8s for success
  if (type === 'success') {
    setTimeout(() => {
      if (alert && alert.parentElement) {
        alert.remove();
      }
    }, 8000);
  }
}

function clearAlert(containerId = 'alert-container') {
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = '';
}

// Escape HTML to prevent XSS
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Format numbers
function formatKg(val) {
  if (val === null || val === undefined) return '0.00 kg';
  return parseFloat(val).toFixed(2) + ' kg';
}

function formatScore(val) {
  if (val === null || val === undefined) return '—';
  return parseFloat(val).toFixed(2);
}

// Mobile navigation toggle
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      links.classList.toggle('show');
    });
  }

  // Highlight current page in nav
  const currentPath = window.location.pathname;
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href');
    if (href && (currentPath.endsWith(href) || (currentPath === '/' && href === 'index.html'))) {
      link.classList.add('active');
    }
  });
});
