import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Activity from './pages/Activity';
import Users from './pages/Users';
import UserDetail from './pages/UserDetail';
import Doors from './pages/Doors';
import Rules from './pages/Rules';
import Groups from './pages/Groups';

function Private({ children }) {
    const { user, loading } = useAuth();
    if (loading) return <div className="content">Loading…</div>;
    if (!user) return <Navigate to="/login" replace />;
    return <Layout>{children}</Layout>;
}

function AppRoutes() {
    const { user } = useAuth();
    return (
        <Routes>
            <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
            <Route path="/" element={<Private><Activity /></Private>} />
            <Route path="/users" element={<Private><Users /></Private>} />
            <Route path="/users/:id" element={<Private><UserDetail /></Private>} />
            <Route path="/doors" element={<Private><Doors /></Private>} />
            <Route path="/rules" element={<Private><Rules /></Private>} />
            <Route path="/groups" element={<Private><Groups /></Private>} />
            <Route path="*" element={<Navigate to="/" />} />
        </Routes>
    );
}

export default function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <AppRoutes />
            </BrowserRouter>
        </AuthProvider>
    );
}
