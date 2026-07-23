import './WorkOrderPrint.css';

const CO = {
    n1: 'PHOENIX SURVEILLANCE, LLC',
    n2: 'd.b.a: PHOENIX SECURITY & TECHNOLOGY',
    addr: ['4001 E. Broadway Rd., Ste. B15', 'Phoenix, Arizona 85040'],
    phone: 'P: (602) 248-8477',
};

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

/* A printable Work Order form for a work order. The header + line items are
   filled from the record; the rest (Technician Report, materials, times,
   checkboxes, signatures) print blank for the tech to complete on site.
   onClose closes the view; the toolbar's Print button opens Save-as-PDF. */
export default function WorkOrderPrint({ wo, onClose }) {
    const items = Array.isArray(wo.line_items) ? wo.line_items : [];
    const jobSite = wo.job_site || [wo.client_name, wo.client_site_address].filter(Boolean).join('\n') || '';
    const custNo = wo.customer_number || wo.client_customer_number || '';

    return (
        <div className="wo-overlay" onClick={onClose}>
            <div className="wo-toolbar no-print" onClick={e => e.stopPropagation()}>
                <button className="btn btn-primary" onClick={() => window.print()}>🖨 Print / Save as PDF</button>
                <button className="btn btn-ghost" onClick={onClose} style={{ color: '#fff' }}>Close</button>
            </div>

            <div className="wo-paper" onClick={e => e.stopPropagation()}>
                {/* ── Top ── */}
                <div className="wo-top">
                    <div className="wo-co">
                        <div className="n1">{CO.n1}</div>
                        <div className="n1">{CO.n2}</div>
                        <div>{CO.addr[0]}</div>
                        <div>{CO.addr[1]}</div>
                        <div>{CO.phone}</div>
                    </div>
                    <div className="wo-title">
                        <div className="t">Work Order</div>
                        <div className="call">Call (602) 248-8477</div>
                        <div className="call">Technician Check In / Out</div>
                    </div>
                    <div className="wo-billbox">
                        <div className="h">IN HOUSE BILLING</div>
                        <div className="r">Invoice #:</div>
                        <div className="r">Billed on:</div>
                        <div className="r">Lift Used:</div>
                    </div>
                </div>

                {/* ── Job site + meta ── */}
                <div className="wo-info">
                    <div className="wo-jobsite">
                        <div className="l">Job Site Information:</div>
                        <div className="b">{jobSite}</div>
                    </div>
                    <div>
                        <div className="wo-metabox">
                            <div className="row">
                                <div className="cell"><b>Work Order # :</b> {wo.wo_number || ''}</div>
                                <div className="cell"><b>Customer #:</b> {custNo}</div>
                            </div>
                            <div className="row">
                                <div className="cell"><b>Date:</b> {fmtDate(wo.wo_date || wo.created_at)}</div>
                                <div className="cell"><b>Scheduled:</b> {wo.scheduled || ''}</div>
                            </div>
                            <div className="row">
                                <div className="cell" style={{ gridColumn: '1 / 3', borderRight: 'none' }}><b>Tech On Site:</b> {wo.tech_on_site || ''}</div>
                            </div>
                        </div>
                        <div className="wo-contact">Contact / Phone: <span style={{ fontWeight: 400 }}>{wo.contact_phone || ''}</span></div>
                    </div>
                </div>

                {/* ── Line items (Item · Description · Qty) ── */}
                <table className="wo-table">
                    <thead>
                        <tr><th style={{ width: '22%' }}>Item</th><th>Description</th><th style={{ width: '9%' }}>Qty</th></tr>
                    </thead>
                    <tbody>
                        {items.map((li, i) => (
                            <tr key={i}>
                                <td className="item">{li.item || ''}</td>
                                <td>{li.description || ''}</td>
                                <td className="qty">{li.qty == null || li.qty === '' ? '' : li.qty}</td>
                            </tr>
                        ))}
                        <tr><td className="item pad" /><td className="pad" /><td className="qty pad" /></tr>
                    </tbody>
                </table>

                <div className="wo-notice">
                    ALL WORK ORDERS AND JOB PHOTOS MUST BE SENT IN WITHIN 24HRS OF COMPLETION<br />
                    TO SERVICE@PHXSURVEILLANCE.COM OR FAX 602.248.4459
                </div>

                {/* ── Technician Report ── */}
                <div className="wo-bar">Technician Report</div>
                <div className="wo-report">
                    <span className="lbl">Please provide detailed report of service performed:</span>
                    <span className="photos">Send in all photos to jobphotos@phxsurveillance.com</span>
                </div>

                {/* ── Add'l Materials ── */}
                <div className="wo-bar">Add'l Materials Used (not stated above):</div>
                <table className="wo-mat">
                    <thead>
                        <tr><th style={{ width: '18%' }}>Part #</th><th>Item Description</th><th style={{ width: '11%' }}>Qty</th><th style={{ width: '15%' }}>Total</th></tr>
                    </thead>
                    <tbody><tr><td /><td /><td /><td /></tr></tbody>
                </table>

                {/* ── Bottom fields (blank for on-site) ── */}
                <div className="wo-foot">
                    <div className="row" style={{ gridTemplateColumns: '1.6fr 0.8fr 0.8fr 1.2fr' }}>
                        <div className="cell">Technician(s):</div>
                        <div className="cell">IN:</div>
                        <div className="cell">OUT:</div>
                        <div className="cell">#techs x hours = (total hours)</div>
                    </div>
                    <div className="row" style={{ gridTemplateColumns: '1.2fr 1fr 1.2fr 1fr' }}>
                        <div className="cell">Return Trip Needed:</div>
                        <div className="cell">Warranty:</div>
                        <div className="cell">Emergency Service:</div>
                        <div className="cell gray">TOTAL:</div>
                    </div>
                </div>

                <div className="wo-checks">
                    <div className="qs">
                        <div className="q">Were you satisfied with today's service?<span className="box" /></div>
                        <div className="q">Is there any other service required at this time?<span className="box" /></div>
                        <div className="q">All systems have been reset and are fully operational?<span className="box" /></div>
                    </div>
                    <div className="sign">
                        <div className="bar">Manager On Duty Signature</div>
                        <div className="line" />
                    </div>
                </div>
            </div>
        </div>
    );
}
