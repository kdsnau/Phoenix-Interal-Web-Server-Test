import { useState } from 'react';
import Layout from '../components/Layout';

const TABS = ['DW Spectrum', 'DMP Setup Parameters', 'ENS'];

/* External link (opens in a new tab). */
function A({ href, children }) {
    return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{children}</a>;
}

/* Key / value reference row. */
function Row({ label, children, mono }) {
    return (
        <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 15, color: 'var(--text-hi)', fontFamily: mono ? 'var(--font-mono)' : 'inherit' }}>{children}</div>
        </div>
    );
}

export default function TechNotes() {
    const [tab, setTab] = useState('DW Spectrum');

    return (
        <Layout>
            <div className="page-header">
                <h1 className="page-title">Technician&apos;s Notes</h1>
            </div>

            <div className="alarm-service-tabs" style={{ marginBottom: 20 }}>
                {TABS.map(t => (
                    <button key={t} className={`alarm-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
                ))}
            </div>

            <div className="table-card" style={{ padding: 24, lineHeight: 1.7, maxWidth: 760 }}>
                {tab === 'DW Spectrum' && (
                    <div>
                        <Row label="Installation Procedures">
                            <A href="https://sites.google.com/view/dwipcam/dw-cloud-site?authuser=0">DW Spectrum Installation Procedures</A>
                        </Row>
                        <Row label="DW Support Phone" mono>813-888-9555</Row>
                        <Row label="Tech Support Authorization #" mono>12336</Row>
                        <Row label="Default Install Password">
                            For all DVR / DW Spectrum installs use <code style={{ background: 'var(--bg-3)', padding: '2px 6px', borderRadius: 3, fontFamily: 'var(--font-mono)' }}>Phx12345!</code> as the default password.
                        </Row>
                    </div>
                )}

                {tab === 'DMP Setup Parameters' && (
                    <div>
                        <Row label="Setup Parameters">
                            <A href="http://leradmin.securecomwireless.com">DMP Setup Parameters (leradmin.securecomwireless.com)</A>
                        </Row>
                        <Row label="DMP Support" mono>1-888-436-7832</Row>
                        <Row label="App Key" mono>04609DF2</Row>
                        <Row label="Receiver 1 — 1st IP" mono>216.9.200.67</Row>
                        <Row label="Receiver 1 — 2nd IP" mono>64.208.83.126</Row>
                        <Row label="Dealer Admin Guide">
                            <A href="https://drive.google.com/file/d/1PH6gGBV5PK4JmZjuGz_fHIq_4irER1cQ/view?usp=sharing">Dealer Admin DMP Guide</A>
                        </Row>
                    </div>
                )}

                {tab === 'ENS' && (
                    <div>
                        <Row label="Mobile / Remote View">
                            <A href="https://docs.google.com/document/d/1BrkBue0ckTM31aOYt3kMZvUKJCT9mYPPObFM8r3CP1Y/edit?usp=sharing">ENS Security Mobile-Remote View Setup Guide</A>
                        </Row>
                        <Row label="NVR Quick Reference">
                            <A href="https://docs.google.com/document/d/1oerRxnmJmbCwmgxB4a0D_N7BVMs_GotIWGYX7llBLC8/edit?usp=sharing">ENS Security Titanium NVR Quick Reference Guide</A>
                        </Row>
                    </div>
                )}
            </div>
        </Layout>
    );
}
