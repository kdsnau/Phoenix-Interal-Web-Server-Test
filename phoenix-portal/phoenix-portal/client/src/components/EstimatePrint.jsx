import './EstimatePrint.css';

/* Static company header (matches the estimate PDF). */
const CO = {
    name1: 'PHOENIX SURVEILLANCE, LLC',
    name2: 'd.b.a: PHOENIX SECURITY & TECHNOLOGY',
    addr:  ['4001 E. Broadway Rd., Ste. B15', 'Phoenix, Arizona 85040'],
    phone: 'P: (602) 248-8477',
    fax:   'F: (602) 248-4459',
    web:   'www.phoenixsurveillance.com',
    roc:   'ROC# 223458',
    svc:   ['CCTV | Data | Voice', 'Access | Intrusion | Security'],
    email: 'sales@phxsurveillance.com',
};

const money = n => (n == null || isNaN(n) ? '' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtDate = (d) => {
    if (!d) return '';
    const s = String(d);
    /* Format a YYYY-MM-DD (date-only) value directly so it doesn't shift a day
       across timezones. Falls back to locale formatting for full timestamps. */
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
    const dt = new Date(d);
    return isNaN(dt) ? s : dt.toLocaleDateString('en-US');
};
/* Line total = rate × qty (qty defaults to 1); blank when the row has no rate. */
const lineTotal = li => (li.rate == null || li.rate === '' ? null : Number(li.rate) * (li.qty == null || li.qty === '' ? 1 : Number(li.qty)));

/* A printable "Estimate" for an RFQ (snapshot_entry). onClose closes the view;
   the toolbar's Print button opens the browser's Save-as-PDF. */
export default function EstimatePrint({ rfq, onClose }) {
    const items = Array.isArray(rfq.line_items) ? rfq.line_items : [];
    const grand = items.reduce((s, li) => s + (lineTotal(li) || 0), 0);
    const billName = rfq.customer || rfq.client_name || '';

    return (
        <div className="est-overlay" onClick={onClose}>
            <div className="est-toolbar no-print" onClick={e => e.stopPropagation()}>
                <button className="btn btn-primary" onClick={() => window.print()}>🖨 Print / Save as PDF</button>
                <button className="btn btn-ghost" onClick={onClose} style={{ color: '#fff' }}>Close</button>
            </div>

            <div className="est-paper" onClick={e => e.stopPropagation()}>
                {/* ── Header ── */}
                <div className="est-head">
                    <div>
                        <div className="est-co-name">{CO.name1}</div>
                        <div className="est-co-name">{CO.name2}</div>
                        <div className="est-co-sub">{CO.addr[0]}</div>
                        <div className="est-co-sub">{CO.addr[1]}</div>
                        <div className="est-co-sub">{CO.phone}</div>
                        <div className="est-co-sub">{CO.fax}</div>
                        <div className="est-co-sub">{CO.web}</div>
                    </div>
                    <div className="est-title-big">Estimate</div>
                    <div className="est-meta">
                        <div>Low Voltage Contractor</div>
                        <div className="roc">{CO.roc}</div>
                        <div>{CO.svc[0]}</div>
                        <div>{CO.svc[1]}</div>
                        <div>E-mail: {CO.email}</div>
                        <div className="est-meta-fields">
                            <div><strong>Estimate Date:</strong> {fmtDate(rfq.estimate_date || rfq.created_at)}</div>
                            {rfq.salesman && <div><strong>Salesman:</strong> {rfq.salesman}</div>}
                        </div>
                    </div>
                </div>

                {/* ── Billing / Project ── */}
                <div className="est-two-col">
                    <div>
                        <div className="est-block-label">Customer Billing Info:</div>
                        <div className="est-block-body">{[billName, rfq.billing_address].filter(Boolean).join('\n')}</div>
                    </div>
                    <div>
                        <div className="est-block-label">Project Location:</div>
                        <div className="est-block-body">{rfq.project_location || ''}</div>
                    </div>
                </div>

                {/* ── Job title + PO/RFQ ── */}
                <div className="est-jobtitle">
                    <div className="t">{rfq.title || rfq.customer || ''}</div>
                    {rfq.subtitle && <div className="s">{rfq.subtitle}</div>}
                    <div className="po">
                        <div>P.O. #: {rfq.po_number || 'NA'}</div>
                        <div>RFQ #: {rfq.rfq || ''}</div>
                    </div>
                </div>

                {/* ── Line items ── */}
                <table className="est-table">
                    <thead>
                        <tr><th style={{ width: '8%' }}>Item</th><th className="desc">Description</th><th style={{ width: '11%' }}>Rate</th><th style={{ width: '7%' }}>Qty</th><th style={{ width: '11%' }}>Total</th></tr>
                    </thead>
                    <tbody>
                        {items.length === 0 ? (
                            <tr><td className="item" /><td className="desc" style={{ color: '#888' }}>No line items.</td><td className="num" /><td className="num" /><td className="num" /></tr>
                        ) : items.map((li, i) => {
                            const lt = lineTotal(li);
                            const isSection = (li.rate == null || li.rate === '') && (li.qty == null || li.qty === '');
                            return (
                                <tr key={i} className={isSection ? 'section' : ''}>
                                    <td className="item">{li.item || ''}</td>
                                    <td className="desc">{li.description || ''}</td>
                                    <td className="num">{money(li.rate)}</td>
                                    <td className="num">{li.qty == null || li.qty === '' ? '' : li.qty}</td>
                                    <td className="num">{lt == null ? '' : money(lt)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                <div className="est-total-row">
                    <div className="est-total-box"><span>Total</span><span>${money(grand)}</span></div>
                </div>

                {/* ── Footer ── */}
                <div className="est-foot">
                    <div className="est-sign">
                        <div>Acceptance Signature:</div>
                        <div className="line" />
                        <div>Date:</div>
                        <div className="line" style={{ maxWidth: '1.4in' }} />
                    </div>
                    <div className="est-terms">
                        Upon signing, the customer agrees to proceed with the work herein and states that Phoenix Surveillance, LLC has secured the contracted work.
                    </div>
                </div>
            </div>
        </div>
    );
}
