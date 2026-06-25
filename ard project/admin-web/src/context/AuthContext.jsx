import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken, clearToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!getToken()) { setLoading(false); return; }
        api('GET', '/api/auth/me')
            .then(setUser)
            .catch(() => clearToken())
            .finally(() => setLoading(false));
    }, []);

    async function login(email, password) {
        const { token, user } = await api('POST', '/api/auth/login', { email, password });
        if (user.role !== 'admin') {
            throw new Error('This dashboard is for admins only.');
        }
        setToken(token);
        setUser(user);
    }

    function logout() {
        clearToken();
        setUser(null);
    }

    return (
        <AuthContext.Provider value={{ user, loading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
