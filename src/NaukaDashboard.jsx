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
      {[deal["Advisor"], deal["Source"], deal["Loss Reason"]].filter(Boolean).join(" · ")}
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
  const [view, setView]           = useState("weekly");
  const [kpis, setKpis]           = useState([]);
  const [pipeline, setPipeline]   = useState([]);
  const [deals, setDeals]         = useState([]);
  const [tours, setTours]         = useState([]);
  const [leads, setLeads]         = useState([]);
  const [arrivals, setArrivals]   = useState([]);
  const [lostDeals, setLostDeals] = useState([]);
  const [signedOTPs, setSignedOTPs] = useState([]);
  const [signedPSAs, setSignedPSAs] = useState([]);
  const [ytdPSAs, setYtdPSAs]     = useState([]);
  const [funnel, setFunnel]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [lastUpdated, setLastUpdated] = useState("");
  const [openModal, setOpenModal] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const [k, p, d, t, l, a, ld, sotp, sp, ytd, fn] = await Promise.all([
          fetchSheet("Weekly_KPIs"),
          fetchSheet("Pipeline"),
          fetchSheet("Pending Transactions"),
          fetchSheet("Prospect_Tours"),
          fetchSheet("New_Leads"),
          fetchSheet("Member_Arrivals"),
          fetchSheet("Lost_Deals"),
          fetchSheet("New_Signed_OTPs"),
          fetchSheet("New Signed PSA"),
          fetchSheet("YTD_PSAs"),
          fetchSheet("Funnel_by_Source"),
        ]);
        setKpis(k); setPipeline(p); setDeals(d); setTours(t);
        setLeads(l); setArrivals(a); setLostDeals(ld);
        setSignedOTPs(sotp); setSignedPSAs(sp); setYtdPSAs(ytd); setFunnel(fn);
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
    return new Date(d["DD Expiry"]) < today;
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
    { key: "New OTPs",        label: "New Pending OTPs", field: "New Pending OTPs", accent: C.teal,  records: [],         title: "New Pending OTPs",      type: "deals" },
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

  // Funnel data
  const funnelRows  = funnel.filter(r => r["Source"] && r["Source"] !== "TOTAL");
  const funnelTotal = funnel.find(r => r["Source"] === "TOTAL") ?? {};

  return (
    <div style={{ fontFamily: FONT_BODY, color: C.gray, padding: "1rem", maxWidth: 960, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ background: C.gray, padding: "1.25rem 1.5rem", borderRadius: 10, marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 28, color: C.white, letterSpacing: "0.25em", textTransform: "uppercase", fontWeight: 500 }}>Nauka</div>
          <div style={{ fontSize: 11, color: C.teal, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 3, fontFamily: FONT_BODY }}>Weekly Sales Snapshot</div>
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
      {view === "weekly" && (
        <div style={{ background: C.beige, borderRadius: 10, padding: "1rem 1.25rem", border: "0.5px solid rgba(54,67,74,0.12)" }}>
          <div style={{ fontSize: 10, color: C.gray, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "bold", opacity: 0.5, marginBottom: 14, fontFamily: FONT_BODY }}>
            This Week · Tap any chip for details
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {weeklyChips.map(chip => (
              <Chip key={chip.key} label={chip.label} value={latest[chip.field] || "—"} accent={chip.accent}
                active={openModal?.type === "weekly" && openModal.key === chip.key}
                onClick={() => setOpenModal({ type: "weekly", key: chip.key })} />
            ))}
          </div>
        </div>
      )}

      {/* ── ACTIVE TRANSACTIONS ───────────────────────────────────── */}
      {view === "active" && (
        <div style={{ background: C.beige, borderRadius: 10, padding: "1rem 1.25rem", border: "0.5px solid rgba(54,67,74,0.12)" }}>
          <div style={{ fontSize: 10, color: C.gray, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "bold", opacity: 0.5, marginBottom: 14, fontFamily: FONT_BODY }}>
            Active Transactions · Tap a stage to see deals
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {activeChips.map(chip => {
              const info = pipe(chip.key);
              return (
                <Chip key={chip.key} label={chip.label}
                  value={info["Count"] || "0"} sub={money(info["Value ($)"])}
                  accent={chip.clickable ? C.teal : "rgba(54,67,74,0.3)"}
                  disabled={!chip.clickable}
                  active={openModal?.type === "active" && openModal.key === chip.key}
                  onClick={chip.clickable ? () => setOpenModal({ type: "active", key: chip.key }) : undefined} />
              );
            })}
          </div>
        </div>
      )}

      {/* ── CONVERSIONS VIEW ──────────────────────────────────────── */}
      {view === "conversions" && (
        <div style={{ background: C.beige, borderRadius: 10, padding: "1rem 1.25rem", border: "0.5px solid rgba(54,67,74,0.12)" }}>
          <div style={{ fontSize: 10, color: C.gray, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "bold", opacity: 0.5, marginBottom: 14, fontFamily: FONT_BODY }}>
            YTD Conversion Funnel · 2026
          </div>

          {/* KPI summary */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8, marginBottom: 14 }}>
            {[
              { label: "Leads",      value: funnelTotal["Leads"]  || "—", sub: `${funnelTotal["Lead→Tour %"] || "—"} → Tour` },
              { label: "Tours",      value: funnelTotal["Tours"]  || "—", sub: `${funnelTotal["Tour→OTP %"]  || "—"} → OTP`  },
              { label: "OTPs",       value: funnelTotal["OTPs"]   || "—", sub: `${funnelTotal["OTP→PSA %"]   || "—"} → PSA`  },
              { label: "PSA Volume", value: money(funnelTotal["PSA Volume ($)"]), sub: `${funnelTotal["PSAs"] || "—"} deals` },
            ].map(k => (
              <div key={k.label} style={{ background: C.white, borderRadius: 8, padding: "0.75rem 1rem", border: "0.5px solid rgba(54,67,74,0.1)", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "rgba(54,67,74,0.6)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4, fontFamily: FONT_BODY }}>{k.label}</div>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.gray }}>{k.value}</div>
                <div style={{ fontSize: 11, color: C.teal, marginTop: 3, fontWeight: "bold", fontFamily: FONT_BODY }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Table — mobile scrollable */}
          <div style={{ overflowX: "auto", background: C.white, borderRadius: 8, border: "0.5px solid rgba(54,67,74,0.1)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 480 }}>
              <thead>
                <tr>
                  {["Source","Leads","Tours","OTPs","PSAs","L→T","T→O","O→P","Volume"].map(h => (
                    <th key={h} style={{ fontSize: 10, color: "rgba(54,67,74,0.6)", textTransform: "uppercase", letterSpacing: "0.04em", padding: "8px 8px", textAlign: h === "Source" ? "left" : "right", borderBottom: "0.5px solid rgba(54,67,74,0.1)", fontWeight: "bold", background: C.beige, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {funnelRows.map((row, i) => (
                  <tr key={i} style={{ background: i%2===0 ? C.white : "rgba(245,243,234,0.5)" }}>
                    <td style={{ padding: "7px 8px", fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY, whiteSpace: "nowrap" }}>{row["Source"]}</td>
                    {["Leads","Tours","OTPs","PSAs"].map(col => (
                      <td key={col} style={{ padding: "7px 8px", textAlign: "right", color: C.gray, fontFamily: FONT_BODY }}>{row[col] || "—"}</td>
                    ))}
                    {["Lead→Tour %","Tour→OTP %","OTP→PSA %"].map(col => (
                      <td key={col} style={{ padding: "7px 8px", textAlign: "right", fontFamily: FONT_BODY, whiteSpace: "nowrap", ...rateColor(row[col]) }}>{row[col] || "—"}</td>
                    ))}
                    <td style={{ padding: "7px 8px", textAlign: "right", color: C.gray, fontFamily: FONT_BODY, whiteSpace: "nowrap" }}>{money(row["PSA Volume ($)"])}</td>
                  </tr>
                ))}
                <tr style={{ background: `rgba(136,209,209,0.1)`, borderTop: "0.5px solid rgba(54,67,74,0.15)" }}>
                  <td style={{ padding: "7px 8px", fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY }}>Total</td>
                  {["Leads","Tours","OTPs","PSAs"].map(col => (
                    <td key={col} style={{ padding: "7px 8px", textAlign: "right", fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY }}>{funnelTotal[col] || "—"}</td>
                  ))}
                  {["Lead→Tour %","Tour→OTP %","OTP→PSA %"].map(col => (
                    <td key={col} style={{ padding: "7px 8px", textAlign: "right", fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY }}>{funnelTotal[col] || "—"}</td>
                  ))}
                  <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY }}>{money(funnelTotal["PSA Volume ($)"])}</td>
                </tr>
              </tbody>
            </table>
            <div style={{ padding: "8px 10px", fontSize: 10, color: "rgba(54,67,74,0.4)", display: "flex", gap: 12, fontFamily: FONT_BODY }}>
              <span><span style={{ color: C.green, fontWeight: "bold" }}>■</span> ≥40%</span>
              <span><span style={{ color: C.amber, fontWeight: "bold" }}>■</span> 15–39%</span>
              <span><span style={{ color: C.red, fontWeight: "bold" }}>■</span> &lt;15%</span>
            </div>
          </div>
        </div>
      )}

      {renderModal()}
    </div>
  );
}
