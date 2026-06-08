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
    throw err;
  }
}

const money = v => {
  const n = parseFloat(String(v).replace(/[$,]/g, ""));
  if (isNaN(n)) return "—";
  return n >= 1000000 ? `$${(n / 1000000).toFixed(2)}M` : `$${n.toLocaleString()}`;
};
const num = v => { const n = parseInt(v); return isNaN(n) ? 0 : n; };

// ── Pill chip ────────────────────────────────────────────────────────
const Chip = ({ label, value, sub, active, onClick, accent = C.teal }) => (
  <button
    onClick={onClick}
    style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      padding: "8px 16px", borderRadius: 999,
      background: active ? C.gray : C.white,
      color: active ? C.teal : C.gray,
      border: `1px solid ${active ? C.gray : "rgba(54,67,74,0.2)"}`,
      cursor: "pointer", fontSize: 12, fontFamily: FONT_BODY,
      transition: "all 0.15s",
      boxShadow: active ? "0 2px 6px rgba(54,67,74,0.15)" : "none",
    }}
  >
    <span style={{ width: 6, height: 6, borderRadius: 999, background: accent, display: "inline-block" }} />
    <span style={{ fontWeight: "bold", letterSpacing: "0.03em" }}>{label}</span>
    <span style={{ fontFamily: FONT_DISPLAY, fontSize: 15, color: active ? C.teal : C.gray }}>{value}</span>
    {sub && <span style={{ fontSize: 10, opacity: 0.75 }}>{sub}</span>}
  </button>
);

// ── Deal card ────────────────────────────────────────────────────────
const DealCard = ({ deal }) => {
  const days = num(deal["Days on Hold"]);
  const accent = days > 90 ? C.amber : (deal["Stage"] === "Signed OTP" && deal["DD Expiry"] ? C.amber : C.teal);
  return (
    <div style={{ background: C.white, borderRadius: 8, padding: "0.85rem 1rem", marginBottom: 8, border: `0.5px solid rgba(54,67,74,0.12)`, borderLeft: `3px solid ${accent}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY }}>{deal["Property / Buyer"]}</span>
        <span style={{ fontFamily: FONT_DISPLAY, fontSize: 18, color: C.gray }}>{money(deal["Amount ($)"])}</span>
      </div>
      <div style={{ fontSize: 11, color: "rgba(54,67,74,0.6)", marginBottom: 4, fontFamily: FONT_BODY }}>
        {[deal["Advisor"], deal["Source"], days ? `${days} days` : null, deal["DD Expiry"] ? `DD: ${deal["DD Expiry"]}` : null].filter(Boolean).join(" · ")}
      </div>
      {deal["Notes"] && <div style={{ fontSize: 11, color: "rgba(54,67,74,0.7)", lineHeight: 1.5, fontFamily: FONT_BODY }}>{deal["Notes"]}</div>}
    </div>
  );
};

// ── Tour card ────────────────────────────────────────────────────────
const TourCard = ({ tour }) => (
  <div style={{ background: C.white, borderRadius: 8, padding: "0.85rem 1rem", marginBottom: 8, border: `0.5px solid rgba(54,67,74,0.12)`, borderLeft: `3px solid ${C.teal}` }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
      <span style={{ fontSize: 13, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY }}>{tour["Prospect"]}</span>
      <span style={{ fontSize: 12, color: "rgba(54,67,74,0.7)", fontFamily: FONT_BODY }}>{tour["Date"]}</span>
    </div>
    <div style={{ fontSize: 11, color: "rgba(54,67,74,0.6)", marginBottom: 4, fontFamily: FONT_BODY }}>
      {[tour["Advisor"], tour["Source"]].filter(Boolean).join(" · ")}
    </div>
    {tour["Notes"] && <div style={{ fontSize: 11, color: "rgba(54,67,74,0.7)", lineHeight: 1.5, fontFamily: FONT_BODY }}>{tour["Notes"]}</div>}
  </div>
);

// ── Modal ────────────────────────────────────────────────────────────
const Modal = ({ title, onClose, children }) => (
  <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(54,67,74,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}>
    <div onClick={e => e.stopPropagation()} style={{ background: C.beige, borderRadius: 12, padding: "1.25rem", maxWidth: 720, width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.gray, fontStyle: "italic" }}>{title}</div>
        <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 24, cursor: "pointer", color: C.gray, lineHeight: 1, padding: 4 }} aria-label="Close">×</button>
      </div>
      {children}
    </div>
  </div>
);

// ── Main ─────────────────────────────────────────────────────────────
export default function NaukaDashboard() {
  const [view, setView]           = useState("weekly");
  const [kpis, setKpis]           = useState([]);
  const [pipeline, setPipeline]   = useState([]);
  const [deals, setDeals]         = useState([]);
  const [tours, setTours]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [lastUpdated, setLastUpdated] = useState("");
  const [openModal, setOpenModal] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const [k, p, d, t] = await Promise.all([
          fetchSheet("Weekly_KPIs"),
          fetchSheet("Pipeline"),
          fetchSheet("Deals"),
          fetchSheet("Prospect_Tours"),
        ]);
        setKpis(k); setPipeline(p); setDeals(d); setTours(t);
        setLastUpdated(new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }));
      } catch {
        setError("Could not load data. Check your Sheet ID and API key.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const latest = kpis[0] ?? {};
  const pipe = stage => pipeline.find(r => r["Stage"] === stage) ?? {};

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
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontStyle: "normal", color: C.teal, letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: 8 }}>Nauka</div>
        <div style={{ fontSize: 13, opacity: 0.6 }}>Loading dashboard…</div>
      </div>
    </div>
  );

  if (error) return (
    <div style={{ padding: "2rem", fontFamily: FONT_BODY, color: C.red, background: C.beige, borderRadius: 10, margin: "2rem" }}>
      <strong>Setup needed:</strong> {error}
    </div>
  );

  const weeklyChips = [
    { key: "New Leads",       label: "New Leads",        field: "New Leads",   accent: C.teal,  records: null },
    { key: "Tours",           label: "Tours",            field: "Tours",       accent: C.gray,  records: tours,                                          title: "Tours This Week" },
    { key: "New OTPs",        label: "New Pending OTPs", field: "New OTPs",    accent: C.teal,  records: deals.filter(d => d["Stage"] === "Pending OTP"), title: "New Pending OTPs" },
    { key: "Signed OTPs",     label: "New Signed OTPs",  field: "Signed OTPs", accent: C.teal,  records: deals.filter(d => d["Stage"] === "Signed OTP"),  title: "New Signed OTPs" },
    { key: "New PSAs",        label: "Signed PSAs",      field: "New PSAs",    accent: C.teal,  records: deals.filter(d => d["Stage"] === "Signed PSA"),  title: "Signed PSAs" },
    { key: "Arrivals",        label: "Member Arrivals",  field: "Arrivals",    accent: C.gray,  records: null },
    { key: "Lost Deals",      label: "Lost Deals",       field: "Lost Deals",  accent: C.red,   records: deals.filter(d => d["Stage"] === "Lost"),        title: "Lost Deals" },
  ];

  const activeChips = [
    { key: "Pending OTP",     label: "Pending OTP" },
    { key: "Signed OTP",      label: "Signed OTP" },
    { key: "Expired DD",      label: "Expired Due Diligence" },
    { key: "YTD Signed PSAs", label: "YTD Signed PSAs" },
    { key: "All-Time PSAs",   label: "All-Time PSAs" },
  ];

  const renderModal = () => {
    if (!openModal) return null;
    if (openModal.type === "weekly") {
      const chip = weeklyChips.find(c => c.key === openModal.key);
      if (!chip || !chip.records) return null;
      return (
        <Modal title={chip.title} onClose={() => setOpenModal(null)}>
          {chip.records.length === 0
            ? <div style={{ fontSize: 13, color: "rgba(54,67,74,0.5)", padding: "1rem 0", fontFamily: FONT_BODY }}>No records this week.</div>
            : chip.key === "Tours"
              ? chip.records.map((t, i) => <TourCard key={i} tour={t} />)
              : chip.records.map((d, i) => <DealCard key={i} deal={d} />)
          }
        </Modal>
      );
    }
    if (openModal.type === "active") {
      const stage = openModal.key;
      const info = pipe(stage);
      const stageDeals = deals.filter(d => d["Stage"] === stage);
      return (
        <Modal title={`${stage} — ${info["Count"] || stageDeals.length} · ${money(info["Value ($)"])}`} onClose={() => setOpenModal(null)}>
          {stageDeals.length === 0
            ? <div style={{ fontSize: 13, color: "rgba(54,67,74,0.5)", padding: "1rem 0", fontFamily: FONT_BODY }}>No deals to show.</div>
            : stageDeals.map((d, i) => <DealCard key={i} deal={d} />)
          }
        </Modal>
      );
    }
  };

  return (
    <div style={{ fontFamily: FONT_BODY, color: C.gray, padding: "1rem", maxWidth: 960, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ background: C.gray, padding: "1.25rem 1.5rem", borderRadius: 10, marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontStyle: "normal", color: C.white, letterSpacing: "0.25em", textTransform: "uppercase", fontWeight: 500 }}>Nauka</div>
          <div style={{ fontSize: 11, color: C.teal, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 3, fontFamily: FONT_BODY }}>Weekly Sales Snapshot</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", fontFamily: FONT_BODY }}>Updated {lastUpdated}</div>
        </div>
      </div>

      {/* Main tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: "1rem" }}>
        <button style={tabStyle(view === "weekly")} onClick={() => setView("weekly")}>Weekly Snapshot</button>
        <button style={tabStyle(view === "active")} onClick={() => setView("active")}>Active Transactions</button>
      </div>

      {/* Weekly view */}
      {view === "weekly" && (
        <div style={{ background: C.beige, borderRadius: 10, padding: "1rem 1.25rem", border: "0.5px solid rgba(54,67,74,0.12)" }}>
          <div style={{ fontSize: 10, color: C.gray, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "bold", opacity: 0.5, marginBottom: 14, fontFamily: FONT_BODY }}>
            This Week · Tap any chip for details
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {weeklyChips.map(chip => (
              <Chip
                key={chip.key}
                label={chip.label}
                value={latest[chip.field] || "—"}
                accent={chip.accent}
                active={openModal?.type === "weekly" && openModal.key === chip.key}
                onClick={() => chip.records ? setOpenModal({ type: "weekly", key: chip.key }) : null}
              />
            ))}
          </div>
        </div>
      )}

      {/* Active Transactions view */}
      {view === "active" && (
        <div style={{ background: C.beige, borderRadius: 10, padding: "1rem 1.25rem", border: "0.5px solid rgba(54,67,74,0.12)" }}>
          <div style={{ fontSize: 10, color: C.gray, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "bold", opacity: 0.5, marginBottom: 14, fontFamily: FONT_BODY }}>
            Active Transactions · Tap a stage to see deals
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {activeChips.map(chip => {
              const info = pipe(chip.key);
              return (
                <Chip
                  key={chip.key}
                  label={chip.label}
                  value={info["Count"] || "0"}
                  sub={money(info["Value ($)"])}
                  accent={C.teal}
                  active={openModal?.type === "active" && openModal.key === chip.key}
                  onClick={() => setOpenModal({ type: "active", key: chip.key })}
                />
              );
            })}
          </div>
        </div>
      )}

      {renderModal()}
    </div>
  );
}
