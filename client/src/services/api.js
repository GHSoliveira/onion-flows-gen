
// Sempre incluir /api na URL base
const isLocalHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const DEFAULT_API_BASE = isLocalHost ? 'http://localhost:3001' : 'https://flows-api.onionws.com';
export const API_BASE = import.meta.env.VITE_API_URL || DEFAULT_API_BASE;
const BASE_URL = `${API_BASE}/api`;

const getTenantId = () => {
    try {
        const savedTenant = localStorage.getItem('selectedTenant');
        if (savedTenant) {
            const parsed = JSON.parse(savedTenant);
            if (parsed.id && parsed.id !== 'super_admin') {
                return parsed.id;
            }
        }
    } catch (e) {
        console.error('Erro ao ler tenant do localStorage:', e);
    }
    return null;
};


export const apiRequest = async (endpoint, options = {}) => {
    const token = localStorage.getItem('token');
    const method = String(options.method || 'GET').toUpperCase();
    const hasExplicitContentType = Object.keys(options.headers || {}).some(
        (key) => key.toLowerCase() === 'content-type'
    );

    const headers = {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...((method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && !hasExplicitContentType)
            ? { 'Content-Type': 'application/json' }
            : {}),
        ...options.headers,
    };

    // Garantir que endpoint começa com /
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    let url = `${BASE_URL}${normalizedEndpoint}`;


    const isLoginEndpoint = normalizedEndpoint.includes('/auth/login');


    if (!isLoginEndpoint) {
        const tenantId = getTenantId();
        const hasTenantParam = /[?&]tenantId=/.test(normalizedEndpoint);
        if (tenantId && !hasTenantParam) {
            const separator = normalizedEndpoint.includes('?') ? '&' : '?';
            url = `${url}${separator}tenantId=${tenantId}`;
        }
    }

    try {
        const response = await fetch(url, {
            ...options,
            headers,
        });

        if (response.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            if (!window.location.pathname.includes('/login')) {
                window.location.href = '/login';
            }
            return null;
        }

        // TOTP enrollment obrigatório (SUPER_ADMIN sem 2FA cadastrado).
        // Backend responde 412 + code='totp_enrollment_required'. Levamos o
        // usuário direto para a aba TOTP. Cloneamos a response antes de ler
        // o body para não consumir o stream em chamadas que não esperam isso.
        if (response.status === 412) {
            try {
                const cloned = response.clone();
                const payload = await cloned.json();
                if (payload?.code === 'totp_enrollment_required') {
                    if (!window.location.pathname.includes('/security')) {
                        window.sessionStorage.setItem('totp_enrollment_required', '1');
                        window.location.href = '/security';
                    }
                }
            } catch (_) {
                // body não era JSON — ignorar
            }
        }

        return response;
    } catch (error) {
        console.error("Erro API:", error.message);
        throw error;
    }
};

export const postJSON = async (endpoint, body) => {
    const res = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(body)
    });

    if (!res) return null;
    if (!res.ok) {
        let payload = null;
        try { payload = await res.json(); } catch (_) {}
        throw new Error(payload?.error || payload?.message || `Erro HTTP ${res.status}`);
    }
    return res.json();
};



export const getJSON = async (endpoint) => {
    const res = await apiRequest(endpoint);
    if (!res) return null;
    if (!res.ok) {
        let payload = null;
        try { payload = await res.json(); } catch (_) {}
        throw new Error(payload?.error || payload?.message || `Erro HTTP ${res.status}`);
    }
    return res.json();
};



export const putJSON = async (endpoint, body) => {
    const res = await apiRequest(endpoint, {
        method: 'PUT',
        body: JSON.stringify(body)
    });
    if (!res) return null;
    if (!res.ok) {
        let payload = null;
        try { payload = await res.json(); } catch (_) {}
        const details = Array.isArray(payload?.violations) && payload.violations.length
            ? ` ${payload.violations.map((item) => item.reason || item.nodeId).filter(Boolean).join('; ')}`
            : '';
        throw new Error(`${payload?.error || payload?.message || `Erro HTTP ${res.status}`}${details}`);
    }
    return res.json();
};

export const deleteJSON = async (endpoint, body) => {
    const res = await apiRequest(endpoint, {
        method: 'DELETE',
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    if (!res) return null;
    if (!res.ok) {
        let payload = null;
        try { payload = await res.json(); } catch (_) {}
        throw new Error(payload?.error || payload?.message || `Erro HTTP ${res.status}`);
    }
    return res.json();
};
