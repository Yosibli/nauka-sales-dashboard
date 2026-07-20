import { useState, useEffect } from "react";

const SHEET_ID = "1hFqEicg5meAdf_VJoDQ3XCNCD6HOa_sSCeKSDRkLrYc";
const API_KEY  = "AIzaSyAcRftC0ZLiwFiBKFnBxnXV5CD1eob6BMU";
const BASE     = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values`;

const C = {
  teal:  "#88D1D1",
  gray:  "#36434A",
  beige: "#F5F3EA",
  white: "#FFFFFF",
  red:   "#C0665A",
  amber: "#D4935A",
  green: "#1D9E75",
};

const FONT_DISPLAY = "'Larken', Georgia, serif";
const FONT_BODY    = "'FreightSans Pro', 'Trebuchet MS', sans-serif";

async function fetchSheet(tab) {
  const url = `${BASE}/${encodeURIComponent(tab)}?key=${API_KEY}`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (!json.values || json.values.length < 2) return [];
    const [, headers, ...rows] = json.values;
    return rows.map(row =>
      Object.fromEntries(headers.map((h, i) => [h.trim(), row[i] ?? ""]))
    );
  } catch (err) {
    console.error(`[fetchSheet: ${tab}] error`, err);
    return [];
  }
}

const money = v => {
  const n = parseFloat(String(v).replace(/[$,]/g, ""));
  if (isNaN(n)) return "—";
  return n >= 1000000 ? `$${(n / 1000000).toFixed(2)}M` : `$${n.toLocaleString()}`;
};
const num = v => { const n = parseInt(v); return isNaN(n) ? 0 : n; };

const rateColor = v => {
  const n = parseFloat(String(v).replace("%",""));
  if (isNaN(n) || v === "—") return { color: "rgba(54,67,74,0.35)" };
  if (n >= 40) return { color: C.green, fontWeight: "bold" };
  if (n >= 15) return { color: C.amber, fontWeight: "bold" };
  return { color: C.red, fontWeight: "bold" };
};

// ── Chip ─────────────────────────────────────────────────────────────
const Chip = ({ label, value, sub, active, onClick, accent = C.teal, disabled }) => (
  <button onClick={disabled ? undefined : onClick} style={{
    display: "inline-flex", alignItems: "center", gap: 8,
    padding: "8px 16px", borderRadius: 999,
    background: active ? C.gray : C.white,
    color: active ? C.teal : C.gray,
    border: `1px solid ${active ? C.gray : "rgba(54,67,74,0.2)"}`,
    cursor: disabled ? "default" : "pointer",
    fontSize: 12, fontFamily: FONT_BODY,
    transition: "all 0.15s", opacity: disabled ? 0.55 : 1,
    boxShadow: active ? "0 2px 6px rgba(54,67,74,0.15)" : "none",
  }}>
    <span style={{ width: 6, height: 6, borderRadius: 999, background: accent, display: "inline-block" }} />
    <span style={{ fontWeight: "bold", letterSpacing: "0.03em" }}>{label}</span>
    <span style={{ fontFamily: FONT_DISPLAY, fontSize: 15, color: active ? C.teal : C.gray }}>{value}</span>
    {sub && <span style={{ fontSize: 10, opacity: 0.75 }}>{sub}</span>}
  </button>
);

// ── Deal Card ─────────────────────────────────────────────────────────
const DealCard = ({ deal }) => {
  const days = num(deal["Days on Hold"]);
  const accent = days > 90 ? C.amber : C.teal;
  return (
    <div style={{ background: C.white, borderRadius: 8, padding: "0.85rem 1rem", marginBottom: 8, border: `0.5px solid rgba(54,67,74,0.12)`, borderLeft: `3px solid ${accent}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY }}>{deal["Property / Buyer"] || deal["Deal Name"]}</span>
        <span style={{ fontFamily: FONT_DISPLAY, fontSize: 18, color: C.gray }}>{money(deal["Amount ($)"] || deal["Amount"])}</span>
      </div>
      <div style={{ fontSize: 11, color: "rgba(54,67,74,0.6)", marginBottom: 4, fontFamily: FONT_BODY }}>
        {[deal["Advisor"], deal["Source"], days ? `${days} days` : null, deal["DD Expiry"] ? `DD: ${deal["DD Expiry"]}` : null].filter(Boolean).join(" · ")}
      </div>
      {deal["Notes"] && <div style={{ fontSize: 11, color: "rgba(54,67,74,0.7)", lineHeight: 1.5, fontFamily: FONT_BODY }}>{deal["Notes"]}</div>}
    </div>
  );
};

// ── Tour Card ─────────────────────────────────────────────────────────
const TourCard = ({ tour }) => (
  <div style={{ background: C.white, borderRadius: 8, padding: "0.85rem 1rem", marginBottom: 8, border: `0.5px solid rgba(54,67,74,0.12)`, borderLeft: `3px solid ${C.teal}` }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
      <span style={{ fontSize: 13, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY }}>{tour["Prospect / Member"] || tour["Prospect"]}</span>
      <span style={{ fontSize: 11, color: "rgba(54,67,74,0.6)", fontFamily: FONT_BODY }}>{tour["Date"] || ""}</span>
    </div>
    <div style={{ fontSize: 11, color: "rgba(54,67,74,0.6)", marginBottom: 4, fontFamily: FONT_BODY }}>
      {[tour["Type"], tour["Advisor"], tour["Lead Source"] || tour["Source"]].filter(Boolean).join(" · ")}
      {tour["Referral Source"] ? ` · via ${tour["Referral Source"]}` : ""}
    </div>
    {tour["Notes"] && <div style={{ fontSize: 11, color: "rgba(54,67,74,0.7)", lineHeight: 1.5, fontFamily: FONT_BODY }}>{tour["Notes"]}</div>}
  </div>
);

// ── Lead Card ─────────────────────────────────────────────────────────
const LeadCard = ({ lead }) => {
  const missingEmail = !lead["Email"] || lead["Email"] === "⚠️ MISSING";
  return (
    <div style={{ background: C.white, borderRadius: 8, padding: "0.85rem 1rem", marginBottom: 8, border: `0.5px solid rgba(54,67,74,0.12)`, borderLeft: `3px solid ${missingEmail ? C.red : C.teal}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY }}>{lead["Name"]}</span>
        {missingEmail && <span style={{ fontSize: 10, background: "rgba(192,102,90,0.12)", color: C.red, padding: "2px 8px", borderRadius: 10, fontWeight: "bold" }}>⚠️ No email</span>}
      </div>
      <div style={{ fontSize: 11, color: "rgba(54,67,74,0.6)", fontFamily: FONT_BODY }}>
        {[lead["Lead Source"], lead["Referral Source"] ? `via ${lead["Referral Source"]}` : null, lead["Advisor"]].filter(Boolean).join(" · ")}
      </div>
      <div style={{ fontSize: 11, color: "rgba(54,67,74,0.5)", marginTop: 2, fontFamily: FONT_BODY }}>
        {[lead["Lifecycle Stage"], lead["Lead Status"]].filter(Boolean).join(" · ")}
      </div>
    </div>
  );
};

// ── Arrival Card ──────────────────────────────────────────────────────
const ArrivalCard = ({ arrival }) => (
  <div style={{ background: C.white, borderRadius: 8, padding: "0.75rem 1rem", marginBottom: 8, border: `0.5px solid rgba(54,67,74,0.12)`, borderLeft: `3px solid ${C.gray}` }}>
    <div style={{ fontSize: 13, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY }}>{arrival["Member"]}</div>
    <div style={{ fontSize: 11, color: C.teal, marginTop: 2, fontFamily: FONT_BODY, fontWeight: "bold", letterSpacing: "0.04em" }}>{arrival["Property"]}</div>
  </div>
);

// ── Lost Card ─────────────────────────────────────────────────────────
const LostCard = ({ deal }) => (
  <div style={{ background: C.white, borderRadius: 8, padding: "0.85rem 1rem", marginBottom: 8, border: `0.5px solid rgba(54,67,74,0.12)`, borderLeft: `3px solid ${C.red}` }}>
    <div style={{ fontSize: 13, fontWeight: "bold", color: C.gray, marginBottom: 4, fontFamily: FONT_BODY }}>{deal["Deal Name"]}</div>
    <div style={{ fontSize: 11, color: "rgba(54,67,74,0.6)", marginBottom: 4, fontFamily: FONT_BODY }}>
      {[deal["Advisor"], deal["Source"], deal["Loss Reason"], deal["Days on Hold"] ? `${deal["Days on Hold"]} days on hold` : null].filter(Boolean).join(" · ")}
    </div>
    {deal["Notes"] && <div style={{ fontSize: 11, color: "rgba(54,67,74,0.7)", lineHeight: 1.5, fontFamily: FONT_BODY }}>{deal["Notes"]}</div>}
  </div>
);

// ── PSA Card ──────────────────────────────────────────────────────────
const PSACard = ({ deal }) => {
  const days = deal["Total Days on Hold"] || deal["Days on Hold"];
  const psaDate = deal["PSA Date Signed"];
  return (
    <div style={{ background: C.white, borderRadius: 8, padding: "0.85rem 1rem", marginBottom: 8, border: `0.5px solid rgba(54,67,74,0.12)`, borderLeft: `3px solid ${C.teal}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY }}>{deal["Deal Name"]}</span>
        <span style={{ fontFamily: FONT_DISPLAY, fontSize: 18, color: C.gray }}>{money(deal["Amount ($)"])}</span>
      </div>
      <div style={{ fontSize: 11, color: "rgba(54,67,74,0.6)", fontFamily: FONT_BODY }}>
        {[deal["Advisor"], deal["Source"], psaDate ? `PSA: ${psaDate}` : null, days ? `${days} days on hold` : null].filter(Boolean).join(" · ")}
      </div>
    </div>
  );
};

// ── Modal ─────────────────────────────────────────────────────────────
const Modal = ({ title, subtitle, onClose, children }) => (
  <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(54,67,74,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}>
    <div onClick={e => e.stopPropagation()} style={{ background: C.beige, borderRadius: 12, padding: "1.25rem", maxWidth: 720, width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.gray, fontStyle: "italic" }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: "rgba(54,67,74,0.6)", marginTop: 3, fontFamily: FONT_BODY }}>{subtitle}</div>}
        </div>
        <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 24, cursor: "pointer", color: C.gray, lineHeight: 1, padding: 4 }}>×</button>
      </div>
      {children}
    </div>
  </div>
);

// ── Main ──────────────────────────────────────────────────────────────
export default function NaukaDashboard() {
  const [view, setView]               = useState("weekly");
  const [funnelTab, setFunnelTab]     = useState("ytd");
  const [kpis, setKpis]           = useState([]);
  const [pipeline, setPipeline]   = useState([]);
  const [deals, setDeals]         = useState([]);
  const [tours, setTours]         = useState([]);
  const [leads, setLeads]         = useState([]);
  const [arrivals, setArrivals]   = useState([]);
  const [lostDeals, setLostDeals] = useState([]);
  const [signedOTPs, setSignedOTPs] = useState([]);
  const [pendingOTPs, setPendingOTPs] = useState([]);
  const [signedPSAs, setSignedPSAs] = useState([]);
  const [ytdPSAs, setYtdPSAs]     = useState([]);
  const [funnel, setFunnel]           = useState([]);
  const [funnelAllTime, setFunnelAllTime] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [lastUpdated, setLastUpdated] = useState("");
  const [openModal, setOpenModal] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const [k, p, d, t, l, a, ld, sotp, notp, sp, ytd, fn, fa] = await Promise.all([
          fetchSheet("Weekly_KPIs"),
          fetchSheet("Pipeline"),
          fetchSheet("Pending Transactions"),
          fetchSheet("Prospect_Tours"),
          fetchSheet("New_Leads"),
          fetchSheet("Member_Arrivals"),
          fetchSheet("Lost_Deals"),
          fetchSheet("New_Signed_OTPs"),
          fetchSheet("New_Pending_OTPs"),
          fetchSheet("New Signed PSA"),
          fetchSheet("YTD_PSAs"),
          fetchSheet("Funnel_2026"),
          fetchSheet("Funnel_AllTime"),
        ]);
        setKpis(k); setPipeline(p); setDeals(d); setTours(t);
        setLeads(l); setArrivals(a); setLostDeals(ld);
        setSignedOTPs(sotp); setPendingOTPs(notp); setSignedPSAs(sp); setYtdPSAs(ytd);
        setFunnel(fn); setFunnelAllTime(fa);
        setLastUpdated(new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }));
      } catch { setError("Could not load data."); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const latest = kpis[0] ?? {};
  const pipe = stage => pipeline.find(r => r["Stage"] === stage) ?? {};

  const today = new Date();
  const expiredDeals = deals.filter(d => {
    if (!d["DD Expiry"]) return false;
    const dateStr = d["DD Expiry"].includes(",") ? d["DD Expiry"] : `${d["DD Expiry"]}, 2026`;
    const exp = new Date(dateStr);
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return !isNaN(exp) && exp < todayStart;
  });

  const tabStyle = active => ({
    padding: "6px 16px", fontSize: 12, borderRadius: 20, cursor: "pointer",
    background: active ? C.gray : "rgba(54,67,74,0.07)",
    color: active ? C.teal : C.gray,
    border: `0.5px solid ${active ? C.gray : "rgba(54,67,74,0.2)"}`,
    transition: "all 0.15s", fontFamily: FONT_BODY,
  });

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: FONT_BODY, color: C.gray }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 28, color: C.teal, letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: 8 }}>Nauka</div>
        <div style={{ fontSize: 13, opacity: 0.6 }}>Loading dashboard…</div>
      </div>
    </div>
  );

  if (error) return (
    <div style={{ padding: "2rem", fontFamily: FONT_BODY, color: C.red, background: C.beige, borderRadius: 10, margin: "2rem" }}>
      <strong>Error:</strong> {error}
    </div>
  );

  const weeklyChips = [
    { key: "New Leads",       label: "New Leads",        field: "New Leads",        accent: C.teal,  records: leads,      title: "New Leads This Week",   type: "leads" },
    { key: "Tours",           label: "Tours",            field: "Tours",            accent: C.gray,  records: tours,      title: "Tours This Week",       type: "tours" },
    { key: "New OTPs",        label: "New Pending OTPs", field: "New Pending OTPs", accent: C.teal,  records: pendingOTPs, title: "New Pending OTPs",      type: "deals" },
    { key: "Signed OTPs",     label: "New Signed OTPs",  field: "New Signed OTPs",  accent: C.teal,  records: signedOTPs, title: "New Signed OTPs",       type: "deals" },
    { key: "New PSAs",        label: "Signed PSAs",      field: "New Signed PSAs",  accent: C.teal,  records: signedPSAs, title: "Signed PSAs This Week", type: "psas" },
    { key: "Arrivals",        label: "Member Arrivals",  field: "Member Arrivals",  accent: C.gray,  records: arrivals,   title: "Member Arrivals",       type: "arrivals" },
    { key: "Lost Deals",      label: "Lost Deals",       field: "Lost Deals",       accent: C.red,   records: lostDeals,  title: "Lost Deals",            type: "lost" },
  ];

  const activeChips = [
    { key: "Pending OTP",     label: "Pending OTP",           clickable: true },
    { key: "Signed OTP",      label: "Signed OTP",            clickable: true },
    { key: "Expired DD",      label: "Expired Due Diligence", clickable: true },
    { key: "YTD Signed PSAs", label: "YTD Signed PSAs",       clickable: true },
    { key: "All-Time PSAs",   label: "All-Time PSAs",         clickable: false },
  ];

  const renderModalContent = (records, type, extra) => {
    if (!records || records.length === 0)
      return <div style={{ fontSize: 13, color: "rgba(54,67,74,0.5)", padding: "1rem 0", fontFamily: FONT_BODY }}>No records this week.</div>;
    switch (type) {
      case "tours":    return records.map((t, i) => <TourCard key={i} tour={t} />);
      case "leads":    return records.map((l, i) => <LeadCard key={i} lead={l} />);
      case "arrivals": return records.map((a, i) => <ArrivalCard key={i} arrival={a} />);
      case "lost":     return records.map((d, i) => <LostCard key={i} deal={d} />);
      case "psas":     return (<>
        {records.map((d, i) => <PSACard key={i} deal={d} />)}
        {extra && <div style={{ textAlign: "center", padding: "0.75rem", background: C.teal, borderRadius: 8, fontSize: 12, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY, marginTop: 4 }}>{extra}</div>}
      </>);
      default:         return records.map((d, i) => <DealCard key={i} deal={d} />);
    }
  };

  // YTD avg days
  const avgDays = (() => {
    const days = ytdPSAs.map(r => parseInt(r["Days on Hold"])).filter(d => !isNaN(d) && d > 0);
    return days.length ? Math.round(days.reduce((a,b) => a+b, 0) / days.length) : null;
  })();

  const renderModal = () => {
    if (!openModal) return null;
    if (openModal.type === "weekly") {
      const chip = weeklyChips.find(c => c.key === openModal.key);
      if (!chip) return null;
      const extra = chip.key === "New PSAs" && avgDays ? null : null;
      return <Modal title={chip.title} onClose={() => setOpenModal(null)}>{renderModalContent(chip.records, chip.type, extra)}</Modal>;
    }
    if (openModal.type === "active") {
      const stage = openModal.key;
      const info = pipe(stage);
      let records = [], subtitle = null;
      if (stage === "Pending OTP") records = deals.filter(d => d["Stage"] === "Decision" || d["Stage"] === "Pending OTP");
      else if (stage === "Signed OTP") records = deals.filter(d => d["Stage"] === "Signed OTP");
      else if (stage === "Expired DD") records = expiredDeals;
      else if (stage === "YTD Signed PSAs") {
        records = ytdPSAs;
        subtitle = avgDays ? `YTD Average Days on Hold: ${avgDays} days` : null;
      }
      return (
        <Modal title={`${stage}`} subtitle={subtitle} onClose={() => setOpenModal(null)}>
          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            <div style={{ background: C.gray, borderRadius: 8, padding: "0.5rem 1rem", fontFamily: FONT_DISPLAY, fontSize: 20, color: C.teal }}>{info["Count"] || records.length}</div>
            <div style={{ background: C.gray, borderRadius: 8, padding: "0.5rem 1rem", fontFamily: FONT_DISPLAY, fontSize: 20, color: C.white }}>{money(info["Value ($)"])}</div>
          </div>
          {records.length === 0
            ? <div style={{ fontSize: 13, color: "rgba(54,67,74,0.5)", padding: "1rem 0", fontFamily: FONT_BODY }}>No deals to show.</div>
            : records.map((d, i) => stage === "YTD Signed PSAs" ? <PSACard key={i} deal={d} /> : <DealCard key={i} deal={d} />)
          }
          {subtitle && <div style={{ textAlign: "center", padding: "0.75rem", background: C.teal, borderRadius: 8, fontSize: 12, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY, marginTop: 8 }}>{subtitle}</div>}
        </Modal>
      );
    }
  };

  // Funnel data — YTD cohort and All-Time from separate sheets
  const cohortRows      = funnel.filter(r => r["Source"] && r["Source"] !== "TOTAL");
  const cohortTotalRow  = funnel.find(r => r["Source"] === "TOTAL") ?? {};
  const allTimeRows     = funnelAllTime.filter(r => r["Source"] && r["Source"] !== "TOTAL");
  const allTimeTotalRow = funnelAllTime.find(r => r["Source"] === "TOTAL") ?? {};

  return (
    <div style={{ fontFamily: FONT_BODY, color: C.gray, padding: "1rem", maxWidth: 960, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ background: C.gray, padding: "1.25rem 1.5rem", borderRadius: 10, marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
        <div>
          <img src="/Nauka_Horizontal_Logo.png" alt="Nauka" style={{ height: 56, width: "auto", display: "block" }} />
          <div style={{ fontSize: 11, color: C.teal, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 10, fontFamily: FONT_BODY }}>Weekly Sales Snapshot</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", fontFamily: FONT_BODY }}>Updated {lastUpdated}</div>
        </div>
      </div>

      {/* Main tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: "1rem", flexWrap: "wrap" }}>
        <button style={tabStyle(view === "weekly")} onClick={() => setView("weekly")}>Weekly Snapshot</button>
        <button style={tabStyle(view === "active")} onClick={() => setView("active")}>Active Transactions</button>
        <button style={tabStyle(view === "conversions")} onClick={() => setView("conversions")}>Conversions</button>
      </div>

      {/* ── WEEKLY VIEW ───────────────────────────────────────────── */}
      {view === "weekly" && (() => {
        const heroChip = weeklyChips[0];
        const gridChips = weeklyChips.slice(1, 5);
        const otherChips = weeklyChips.slice(5);
        return (
          <div>
            <div style={{ fontSize: 10, color: C.gray, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "bold", opacity: 0.5, marginBottom: 14, fontFamily: FONT_BODY }}>
              This Week · Tap any card for details
            </div>

            {/* Hero: New Leads */}
            <div onClick={() => setOpenModal({ type: "weekly", key: heroChip.key })} style={{ cursor: "pointer", background: C.white, border: "0.5px solid rgba(54,67,74,0.08)", borderRadius: 8, padding: "24px 26px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: heroChip.accent, display: "inline-block" }} />
                  <span style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", fontWeight: "bold", color: "rgba(54,67,74,0.6)", fontFamily: FONT_BODY }}>{heroChip.label}</span>
                </div>
                <div style={{ fontSize: 13, color: "rgba(54,67,74,0.5)", marginTop: 10, maxWidth: 220, lineHeight: 1.5, fontFamily: FONT_BODY }}>Fresh inbound interest captured this week</div>
              </div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 68, lineHeight: 0.9, color: C.gray }}>{latest[heroChip.field] || "0"}</div>
            </div>

            {/* Funnel grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 22 }}>
              {gridChips.map(chip => (
                <div key={chip.key} onClick={() => setOpenModal({ type: "weekly", key: chip.key })} style={{ cursor: "pointer", background: C.white, border: "0.5px solid rgba(54,67,74,0.08)", borderRadius: 8, padding: "20px 22px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: chip.accent, display: "inline-block", flexShrink: 0 }} />
                    <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: "bold", color: "rgba(54,67,74,0.62)", lineHeight: 1.3, fontFamily: FONT_BODY }}>{chip.label}</span>
                  </div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 42, lineHeight: 1, color: C.gray, marginTop: 14 }}>{latest[chip.field] || "0"}</div>
                </div>
              ))}
            </div>

            {/* Also this week */}
            <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", fontWeight: "bold", color: "rgba(54,67,74,0.55)", marginBottom: 12, fontFamily: FONT_BODY }}>Also This Week</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {otherChips.map(chip => (
                <div key={chip.key} onClick={() => setOpenModal({ type: "weekly", key: chip.key })} style={{ cursor: "pointer", background: chip.key === "Arrivals" ? "#E7F6F6" : C.white, border: chip.key === "Arrivals" ? "none" : "0.5px solid rgba(54,67,74,0.08)", borderRadius: 8, padding: "20px 22px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: "bold", color: chip.key === "Arrivals" ? C.gray : "rgba(54,67,74,0.6)", fontFamily: FONT_BODY, lineHeight: 1.3 }}>{chip.label}</span>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 40, color: chip.key === "Lost Deals" && num(latest[chip.field]) > 0 ? C.red : C.gray }}>{latest[chip.field] || "0"}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── ACTIVE TRANSACTIONS ───────────────────────────────────── */}
      {view === "active" && (
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", fontWeight: "bold", color: C.gray, marginBottom: 6, fontFamily: FONT_BODY }}>Pipeline In Motion</div>
          <div style={{ fontSize: 13, color: "rgba(54,67,74,0.55)", lineHeight: 1.55, marginBottom: 20, fontFamily: FONT_BODY }}>Deals currently advancing through the sales pipeline, by stage.</div>

          {activeChips.map(chip => {
            const info = pipe(chip.key);
            return (
              <div key={chip.key} onClick={chip.clickable ? () => setOpenModal({ type: "active", key: chip.key }) : undefined}
                style={{ cursor: chip.clickable ? "pointer" : "default", opacity: chip.clickable ? 1 : 0.6, background: C.white, border: "0.5px solid rgba(54,67,74,0.08)", borderRadius: 8, padding: "18px 22px", marginBottom: 12, display: "flex", alignItems: "center", gap: 18 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 34, color: C.gray, minWidth: 42 }}>{info["Count"] || "0"}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY }}>{chip.label}</div>
                  <div style={{ fontSize: 12, color: "rgba(54,67,74,0.5)", marginTop: 4, fontFamily: FONT_BODY }}>{money(info["Value ($)"])}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── CONVERSIONS VIEW · YTD COHORT FUNNEL ──────────────────── */}
      {view === "conversions" && (() => {
        const rows     = funnelTab === "ytd" ? cohortRows : allTimeRows;
        const totalRow = funnelTab === "ytd" ? cohortTotalRow : allTimeTotalRow;
        const L = num(totalRow["Leads"]), T = num(totalRow["Tours"]), O = num(totalRow["OTPs"]), P = num(totalRow["PSAs"]);
        const maxV = Math.max(L, T, O, P, 1);
        const stages = [
          { label: "Leads",       value: L },
          { label: "Tours",       value: T },
          { label: "OTPs",        value: O },
          { label: "Signed PSAs", value: P },
        ];
        const rates = [
          { label: "Lead → Tour", pct: totalRow["Lead→Tour %"] || "—" },
          { label: "Tour → OTP",  pct: totalRow["Tour→OTP %"]  || "—" },
          { label: "OTP → PSA",   pct: totalRow["OTP→PSA %"]   || "—" },
        ];
        const volume = money(totalRow["PSA Volume ($)"] || 0);
        const hasData = L + T + O + P > 0;

        return (
          <div style={{ background: C.beige, borderRadius: 10, padding: "1rem 1.25rem", border: "0.5px solid rgba(54,67,74,0.12)" }}>
            {/* Header + cohort toggle */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
              <div style={{ fontSize: 10, color: C.gray, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "bold", opacity: 0.5, fontFamily: FONT_BODY }}>
                Conversion Funnel · {funnelTab === "ytd" ? "2026 Cohort" : "All-Time"}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={tabStyle(funnelTab === "ytd")} onClick={() => setFunnelTab("ytd")}>2026 Cohort</button>
                <button style={tabStyle(funnelTab === "all")} onClick={() => setFunnelTab("all")}>All-Time</button>
              </div>
            </div>

            {!hasData ? (
              <div style={{ fontSize: 13, color: "rgba(54,67,74,0.5)", padding: "1rem 0", fontFamily: FONT_BODY }}>No funnel data available.</div>
            ) : (
              <>
                {/* Funnel bars */}
                {stages.map((s, i) => (
                  <div key={i} style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                      <span style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY }}>{s.label}</span>
                      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.gray }}>{s.value}</span>
                    </div>
                    <div style={{ height: 12, borderRadius: 6, background: "rgba(54,67,74,0.07)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.max((s.value / maxV) * 100, s.value > 0 ? 5 : 0)}%`, background: C.teal, borderRadius: 6, transition: "width 0.5s ease" }} />
                    </div>
                  </div>
                ))}

                {/* Conversion rate cards */}
                <div style={{ fontSize: 10, color: C.gray, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "bold", opacity: 0.5, margin: "24px 0 10px", fontFamily: FONT_BODY }}>Conversion Rates</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
                  {rates.map((r, i) => (
                    <div key={i} style={{ background: C.white, borderRadius: 8, padding: "14px 16px", border: "0.5px solid rgba(54,67,74,0.12)" }}>
                      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 26, ...rateColor(r.pct) }}>{r.pct}</div>
                      <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: "bold", color: "rgba(54,67,74,0.55)", marginTop: 6, fontFamily: FONT_BODY }}>{r.label}</div>
                    </div>
                  ))}
                  <div style={{ background: C.gray, borderRadius: 8, padding: "14px 16px" }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 26, color: C.teal }}>{volume}</div>
                    <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: "bold", color: "rgba(255,255,255,0.7)", marginTop: 6, fontFamily: FONT_BODY }}>PSA Volume</div>
                  </div>
                </div>

                {/* By-source breakdown */}
                {rows.length > 0 && (
                  <>
                    <div style={{ fontSize: 10, color: C.gray, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "bold", opacity: 0.5, margin: "24px 0 10px", fontFamily: FONT_BODY }}>By Source</div>
                    <div style={{ background: C.white, borderRadius: 8, border: "0.5px solid rgba(54,67,74,0.12)", overflow: "hidden" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1fr 1fr", padding: "10px 14px", background: "rgba(54,67,74,0.04)", fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: "bold", color: "rgba(54,67,74,0.6)", fontFamily: FONT_BODY }}>
                        <span>Source</span>
                        <span style={{ textAlign: "right" }}>Leads</span>
                        <span style={{ textAlign: "right" }}>Tours</span>
                        <span style={{ textAlign: "right" }}>OTPs</span>
                        <span style={{ textAlign: "right" }}>PSAs</span>
                      </div>
                      {rows.map((r, i) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1fr 1fr", padding: "11px 14px", borderTop: "0.5px solid rgba(54,67,74,0.08)", fontSize: 12, color: C.gray, fontFamily: FONT_BODY, alignItems: "baseline" }}>
                          <span style={{ fontWeight: "bold" }}>{r["Source"]}</span>
                          <span style={{ textAlign: "right" }}>{r["Leads"] || "—"}</span>
                          <span style={{ textAlign: "right" }}>{r["Tours"] || "—"}</span>
                          <span style={{ textAlign: "right" }}>{r["OTPs"] || "—"}</span>
                          <span style={{ textAlign: "right", fontFamily: FONT_DISPLAY, fontSize: 15 }}>{r["PSAs"] || "—"}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        );
      })()}

      {renderModal()}

      {/* Footer mark */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "1.75rem 0 0.5rem" }}>
        <div style={{ flex: 1, height: 1, background: "rgba(54,67,74,0.12)" }} />
        <img src="/Nauka_Icon_Primary_HEX.png" alt="Nauka" style={{ height: 38, width: "auto", display: "block", opacity: 0.85 }} />
        <div style={{ flex: 1, height: 1, background: "rgba(54,67,74,0.12)" }} />
      </div>
    </div>
  );
}
