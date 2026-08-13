import { createContext, useState, useContext, useEffect } from 'react';
import { apiRequest } from '../services/api';
import { socketService } from '../services/socket';

const AuthContext = createContext();
const HEARTBEAT_INTERVAL_MS = Number(import.meta.env?.VITE_AUTH_HEARTBEAT_INTERVAL_MS || 60000);
const LEGACY_AGENT_PLACEHOLDER = ['sandbox', 'agent'].join(' ');
const normalizeUser = (value) => {
    if (!value || typeof value !== 'object') return value;
    const rawName = value.name === undefined || value.name === null ? '' : String(value.name).trim();
    const name = !rawName || rawName.toLowerCase() === LEGACY_AGENT_PLACEHOLDER ? null : rawName;
    return { ...value, name };
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(() => {
        const saved = localStorage.getItem('user');
        try {
            return saved ? normalizeUser(JSON.parse(saved)) : null;
        } catch {
            return null;
        }
    });

    const login = (userData, userToken) => {
        const normalized = normalizeUser(userData);
        setUser(normalized);
        localStorage.setItem('user', JSON.stringify(normalized));
        localStorage.setItem('token', userToken);
    };

    const updateUser = (partial) => {
        setUser((prev) => {
            if (!prev) return prev;
            const next = normalizeUser({ ...prev, ...(partial || {}) });
            localStorage.setItem('user', JSON.stringify(next));
            return next;
        });
    };

    const logout = async () => {
        try {
            await apiRequest('/auth/logout', { method: 'POST' });
        } catch (_) {}
        socketService.disconnect();
        setUser(null);
        localStorage.removeItem('user');
        localStorage.removeItem('token');
        localStorage.removeItem('selectedTenant');
        window.location.href = '/login';
    };


    useEffect(() => {
        if (!user) return;

        let consecutiveErrors = 0;
        let isMounted = true;
        const maxErrors = 3;

        const beat = setInterval(async () => {
            if (!isMounted) return;

            try {
                const res = await apiRequest('/auth/heartbeat');
                if (res && res.ok) {
                    const data = await res.json();
                    if (data?.user) {
                        const normalized = normalizeUser(data.user);
                        setUser(normalized);
                        localStorage.setItem('user', JSON.stringify(normalized));
                    }
                }
                consecutiveErrors = 0;
            } catch (error) {
                consecutiveErrors++;
                if (consecutiveErrors >= maxErrors) {
                    console.warn('Heartbeat falhou múltiplas vezes, parando tentativas');
                    clearInterval(beat);
                }
            }
        }, Math.max(HEARTBEAT_INTERVAL_MS, 30000));

        return () => {
            isMounted = false;
            clearInterval(beat);
        };
    }, [user?.id]);

    return (
        <AuthContext.Provider value={{ user, login, logout, updateUser }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error("useAuth deve ser usado dentro de um AuthProvider");
    return context;
};
