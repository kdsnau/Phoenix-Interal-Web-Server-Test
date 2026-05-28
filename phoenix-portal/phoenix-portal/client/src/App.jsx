import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login      from './pages/Login';
import Dashboard  from './pages/Dashboard';
import Tickets    from './pages/Tickets';
import Financials from './pages/Financials';
import Admin      from './pages/Admin';
import Fleet      from './pages/Fleet';

function PrivateRoute({ children, roles }) {
    const { user } = useAuth();
    if (!user) return <Navigate to="/login" replace />;
    if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
    return children;
}

function AppRoutes() {
    const { user } = useAuth();
    return (
        <Routes>
            <Route path="/login"      element={user ? <Navigate to="/dashboard" /> : <Login />} />
            <Route path="/dashboard"  element={<PrivateRoute><Dashboard /></PrivateRoute>} />
            <Route path="/tickets"    element={<PrivateRoute roles={['technician','admin']}><Tickets /></PrivateRoute>} />
            <Route path="/financials" element={<PrivateRoute roles={['accounting','admin']}><Financials /></PrivateRoute>} />
            <Route path="/admin"      element={<PrivateRoute roles={['admin']}><Admin /></PrivateRoute>} />
            <Route path="/fleet"      element={<PrivateRoute><Fleet /></PrivateRoute>} />
            <Route path="*"           element={<Navigate to={user ? '/dashboard' : '/login'} />} />
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