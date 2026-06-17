import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login      from './pages/Login';
import Dashboard  from './pages/Dashboard';
import Tickets    from './pages/Tickets';
import Financials from './pages/Financials';
import Admin      from './pages/Admin';
import Fleet      from './pages/Fleet';
import Alarms     from './pages/Alarms';
import Inventory  from './pages/Inventory';
import Projects   from './pages/Projects';
import AI        from './pages/AI';
import Feedback  from './pages/Feedback';
import Messages  from './pages/Messages';
import Calendar  from './pages/Calendar';
import Cameras   from './pages/Cameras';
import TechNotes  from './pages/TechNotes';
import Profile    from './pages/Profile';
import Calls      from './pages/Calls';
import Vault      from './pages/Vault';

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
            <Route path="/clients"    element={<PrivateRoute><Alarms /></PrivateRoute>} />
            {/* Legacy path — keep old bookmarks/links working */}
            <Route path="/alarms"     element={<Navigate to="/clients" replace />} />
            <Route path="/inventory"  element={<PrivateRoute><Inventory /></PrivateRoute>} />
            <Route path="/projects"   element={<PrivateRoute><Projects /></PrivateRoute>} />
            <Route path="/ai"         element={<PrivateRoute><AI /></PrivateRoute>} />
            <Route path="/feedback"   element={<PrivateRoute><Feedback /></PrivateRoute>} />
            <Route path="/messages"   element={<PrivateRoute><Messages /></PrivateRoute>} />
            <Route path="/calendar"   element={<PrivateRoute><Calendar /></PrivateRoute>} />
            <Route path="/cameras"    element={<PrivateRoute><Cameras /></PrivateRoute>} />
            <Route path="/tech-notes" element={<PrivateRoute><TechNotes /></PrivateRoute>} />
            <Route path="/profile"    element={<PrivateRoute><Profile /></PrivateRoute>} />
            <Route path="/calls"      element={<PrivateRoute><Calls /></PrivateRoute>} />
            <Route path="/vault"      element={<PrivateRoute roles={['admin']}><Vault /></PrivateRoute>} />
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
