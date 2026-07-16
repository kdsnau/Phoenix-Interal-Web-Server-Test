import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';

/* Login is imported eagerly — it's the first paint for a signed-out user, so
   splitting it would only add a round trip. Every other page is split out and
   fetched on first visit, which keeps the initial download small on mobile. */
const Dashboard    = lazy(() => import('./pages/Dashboard'));
const Tickets      = lazy(() => import('./pages/Tickets'));
const Financials   = lazy(() => import('./pages/Financials'));
const Snapshot     = lazy(() => import('./pages/Snapshot'));
const Timesheets   = lazy(() => import('./pages/Timesheets'));
const Admin        = lazy(() => import('./pages/Admin'));
const Fleet        = lazy(() => import('./pages/Fleet'));
const Alarms       = lazy(() => import('./pages/Alarms'));
const Inventory    = lazy(() => import('./pages/Inventory'));
const Licenses     = lazy(() => import('./pages/Licenses'));
const Projects     = lazy(() => import('./pages/Projects'));
const AI           = lazy(() => import('./pages/AI'));
const Feedback     = lazy(() => import('./pages/Feedback'));
const Messages     = lazy(() => import('./pages/Messages'));
const TeamCalendar = lazy(() => import('./pages/TeamCalendar'));
const Cameras      = lazy(() => import('./pages/Cameras'));
const TechNotes    = lazy(() => import('./pages/TechNotes'));
const Profile      = lazy(() => import('./pages/Profile'));
const Calls        = lazy(() => import('./pages/Calls'));
const Vault        = lazy(() => import('./pages/Vault'));

function PageLoading() {
    return (
        <div style={{
            minHeight: '60vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-dim)',
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
        }}>
            loading…
        </div>
    );
}

function PrivateRoute({ children, roles }) {
    const { user } = useAuth();
    if (!user) return <Navigate to="/login" replace />;
    if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
    return children;
}

function AppRoutes() {
    const { user } = useAuth();
    return (
        <Suspense fallback={<PageLoading />}>
            <Routes>
                <Route path="/login"      element={user ? <Navigate to="/dashboard" /> : <Login />} />
                <Route path="/dashboard"  element={<PrivateRoute><Dashboard /></PrivateRoute>} />
                <Route path="/tickets"    element={<PrivateRoute roles={['technician','admin']}><Tickets /></PrivateRoute>} />
                <Route path="/financials" element={<PrivateRoute roles={['accounting','admin']}><Financials /></PrivateRoute>} />
                <Route path="/snapshot"   element={<PrivateRoute roles={['accounting','admin']}><Snapshot /></PrivateRoute>} />
                <Route path="/timesheets" element={<PrivateRoute roles={['accounting','admin']}><Timesheets /></PrivateRoute>} />
                <Route path="/admin"      element={<PrivateRoute roles={['admin']}><Admin /></PrivateRoute>} />
                <Route path="/fleet"      element={<PrivateRoute><Fleet /></PrivateRoute>} />
                <Route path="/clients"    element={<PrivateRoute><Alarms /></PrivateRoute>} />
                {/* Legacy path — keep old bookmarks/links working */}
                <Route path="/alarms"     element={<Navigate to="/clients" replace />} />
                <Route path="/inventory"  element={<PrivateRoute><Inventory /></PrivateRoute>} />
                <Route path="/licenses"   element={<PrivateRoute><Licenses /></PrivateRoute>} />
                <Route path="/projects"   element={<PrivateRoute><Projects /></PrivateRoute>} />
                <Route path="/ai"         element={<PrivateRoute><AI /></PrivateRoute>} />
                <Route path="/feedback"   element={<PrivateRoute><Feedback /></PrivateRoute>} />
                <Route path="/messages"   element={<PrivateRoute><Messages /></PrivateRoute>} />
                {/* Old Google-calendar page retired — keep the path working */}
                <Route path="/calendar"   element={<Navigate to="/team-calendar" replace />} />
                <Route path="/team-calendar" element={<PrivateRoute><TeamCalendar /></PrivateRoute>} />
                <Route path="/cameras"    element={<PrivateRoute><Cameras /></PrivateRoute>} />
                <Route path="/tech-notes" element={<PrivateRoute><TechNotes /></PrivateRoute>} />
                <Route path="/profile"    element={<PrivateRoute><Profile /></PrivateRoute>} />
                <Route path="/calls"      element={<PrivateRoute><Calls /></PrivateRoute>} />
                <Route path="/vault"      element={<PrivateRoute roles={['admin']}><Vault /></PrivateRoute>} />
                <Route path="*"           element={<Navigate to={user ? '/dashboard' : '/login'} />} />
            </Routes>
        </Suspense>
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
