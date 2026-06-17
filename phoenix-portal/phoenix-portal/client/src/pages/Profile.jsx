import { useEffect, useState } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';
import ProfileCard from '../components/ProfileCard';

export default function Profile() {
    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState('');

    useEffect(() => {
        api.get('/profile')
            .then(r => setData(r.data))
            .catch(e => setError(e.response?.data?.error || 'Could not load your profile.'))
            .finally(() => setLoading(false));
    }, []);

    return (
        <Layout>
            <div className="page-header">
                <h1 className="page-title">My Profile</h1>
            </div>
            {loading ? (
                <p style={{ color: 'var(--text-dim)' }}>Loading…</p>
            ) : error ? (
                <div className="error-msg">{error}</div>
            ) : (
                <ProfileCard data={data} editable />
            )}
        </Layout>
    );
}
