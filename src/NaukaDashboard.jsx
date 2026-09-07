import React, { useEffect, useMemo, useState } from "react";

const SHEET_ID = import.meta.env.VITE_SHEET_ID;
const API_KEY = import.meta.env.VITE_SHEETS_API_KEY;

const C = {
  teal: "#88D1D1", tealInk: "#3E8F92", ink: "#36434A", paper: "#F5F3EA",
  red: "#B0574C", amber: "#C08A4E", green: "#1D9E75", slate: "#5B7C99", purple: "#8E6FA8",
  mute: "rgba(54,67,74,0.62)", faint: "rgba(54,67,74,0.42)", rule: "rgba(54,67,74,0.16)",
};
const F = { d: "'Larken', Georgia, serif", b: "'FreightSans Pro', 'Trebuchet MS', sans-serif" };

const TABS = [
  ["Weekly_KPIs", "kpis"], ["Pipeline", "pipeline"], ["Pending Transactions", "deals"],
  ["Prospect_Tours", "tours"], ["New_Leads", "leads"], ["Member_Arrivals", "arrivals"],
  ["Lost_Deals", "lostDeals"], ["New_Signed_OTPs", "signedOTPs"], ["New_Pending_OTPs", "pendingOTPs"],
  ["New Signed PSA", "signedPSAs"], ["YTD_PSAs", "ytdPSAs"], ["YTD_Resale_PSAs", "resalePSAs"],
  ["Funnel_AllTime", "funnelAllTime"], ["Funnel_ByYear", "funnelByYear"], ["Prospect_Calendar", "calendarRows"],
];

async function fetchSheet(tab) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tab)}?key=${API_KEY}`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (!json.values || json.values.length < 2) return [];
    const [, headers, ...rows] = json.values;
    return rows.map((row) => Object.fromEntries(headers.map((h, i) => [String(h).trim(), row[i] ?? ""])));
  } catch {
    return [];
  }
}

const money = (v) => {
  const n = parseFloat(String(v).replace(/[$,]/g, ""));
  if (isNaN(n)) return "";
  return n >= 1000000 ? `$${(n / 1000000).toFixed(2)}M` : `$${n.toLocaleString()}`;
};
const num = (v) => { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; };
/** Sheets sometimes hands back "3.0" — show counts as plain integers. */
const count = (v) => {
  if (v === undefined || v === null || v === "") return "0";
  const n = Number(String(v).replace(/,/g, ""));
  return isNaN(n) ? String(v) : String(Math.round(n));
};
const sumAmount = (recs) => (recs || []).reduce((s, r) => {
  const n = parseFloat(String(r["Amount ($)"] ?? r["Amount"] ?? "").replace(/[$,]/g, ""));
  return s + (isNaN(n) ? 0 : n);
}, 0);
/** Same as sumAmount but skips RCRR deals — use for anything counting toward the sales goal. */
const sumGoalAmount = (recs) => sumAmount((recs || []).filter((r) => !isRCRR(r["Deal Name"])));
const splitName = (name) => {
  if (!name) return { property: "", buyer: null };
  const [p, ...rest] = String(name).split("|");
  return { property: p.trim(), buyer: rest.length ? rest.join("|").trim() : null };
};
/** RCRR (rental/reservation contract) deals are tracked separately and don't
 *  count toward the sales goal. They're the same deals highlighted yellow in
 *  the sheet — Sheets API values.get can't see cell color, but every one of
 *  those rows has "RCRR" in the deal name, so we match on that instead. */
const SALES_GOAL = 270000000;
const isRCRR = (name) => /RCRR/i.test(String(name || ""));
const eyebrow = (color) => ({
  fontFamily: F.b, fontSize: 12, fontWeight: 500, letterSpacing: "0.16em",
  textTransform: "uppercase", color: color || C.tealInk,
});
function trendParts(text) {
  if (!text) return { main: "", title: undefined, style: {} };
  const t = String(text).trim();
  const m = t.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const main = m ? m[1].trim() : t;
  const detail = m ? m[2].replace(/^prev:\s*/i, "") : null;
  const color = main.startsWith("▲") ? C.green : main.startsWith("▼") ? C.red : C.faint;
  return {
    main, title: detail ? `Previous period: ${detail}` : undefined,
    style: { fontSize: 11, letterSpacing: "0.08em", color, fontFamily: F.b, fontWeight: 500 },
  };
}
function rateStyle(v) {
  const n = parseFloat(String(v).replace("%", ""));
  const base = { fontFamily: F.d, fontSize: 34, fontWeight: 500, lineHeight: 1 };
  if (isNaN(n) || v === "—") return { ...base, color: C.faint };
  return { ...base, color: n >= 40 ? C.green : n >= 15 ? C.amber : C.red };
}

/* ── calendar helpers ───────────────────────────────────── */
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const inRange = (d, s, e) => d.getTime() >= s.getTime() && d.getTime() <= e.getTime();

function parseCalendarSheet(rows) {
  const parseDate = (s) => {
    if (!s) return null;
    const [m, d, y] = String(s).split("/").map((n) => parseInt(n, 10));
    if (!m || !d || !y) return null;
    return new Date(y, m - 1, d);
  };
  const parseNotes = (s) => {
    if (!s || !String(s).trim()) return [];
    return String(s).split("||").map((chunk) => {
      const c = chunk.trim();
      const m = c.match(/^([A-Za-z]+ \d{1,2}):\s*(.*)$/);
      return m ? { date: m[1], text: m[2] } : { date: null, text: c };
    });
  };
  return rows.map((r) => ({
    name: r["Name"], arrival: parseDate(r["Arrival Date"]), departure: parseDate(r["Departure Date"]),
    stage: r["Stage"], coveredBy: r["Covered By"] || null, owner: r["Owner"] || null,
    source: r["Source"] || null, referral: r["Referral Source"] || null, email: r["Email"] || null,
    lifecycle: r["Lifecycle Stage"] || null, leadStatus: r["Lead Status"] || null,
    guests: r["Guests"] || null, chargeNote: r["Charge Note"] || null, notes: parseNotes(r["Notes"]),
  })).filter((r) => r.name && r.arrival && r.departure);
}
const statusColor = (s) => ({ completed: C.slate, canceled: C.red, scheduled: C.amber, inprogress: C.green, dayvisit: C.purple }[s]);
const statusLabel = (s) => ({ completed: "Departed From Property", canceled: "Cancelled", scheduled: "Scheduled", inprogress: "Arrived On Property", dayvisit: "Day Visit" }[s]);
function calStatus(r, today) {
  if (r.stage === "Canceled") return "canceled";
  const day = sameDay(r.arrival, r.departure);
  if (r.stage === "Departed from Property") return day ? "dayvisit" : "completed";
  if (r.stage === "Arrived On Property") return r.arrival > today ? "scheduled" : day ? "dayvisit" : "inprogress";
  return "scheduled";
}
function calIssues(r) {
  const out = [];
  if (r.stage !== "Canceled" && !r.coveredBy) out.push({ label: "No advisor / “Covered By” assigned", level: "red" });
  if (!r.email) out.push({ label: "No email captured", level: "amber" });
  return out;
}
function buildMonthGrid(year, month) {
  const start = new Date(year, month, 1).getDay();
  const dim = new Date(year, month + 1, 0).getDate();
  const prev = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = start - 1; i >= 0; i--) cells.push({ date: new Date(year, month - 1, prev - i), outside: true });
  for (let d = 1; d <= dim; d++) cells.push({ date: new Date(year, month, d), outside: false });
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    const nx = new Date(last); nx.setDate(nx.getDate() + 1);
    cells.push({ date: nx, outside: true });
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
/** Rolling window: previous month through next month, based on today. */
function calendarMonths(today) {
  const out = [];
  for (let off = -1; off <= 1; off++) {
    const d = new Date(today.getFullYear(), today.getMonth() + off, 1);
    out.push({ y: d.getFullYear(), m: d.getMonth(), label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }) });
  }
  return out;
}

function itemsFor(type, records) {
  const j = (a) => a.filter(Boolean).join(" · ");
  return (records || []).map((r) => {
    if (type === "tours") return {
      title: r["Prospect / Member"] || r["Prospect"] || "", sub: j([r["Type"], r["Advisor"]]),
      meta: j([r["Lead Source"] || r["Source"], r["Referral Source"] ? `via ${r["Referral Source"]}` : null]),
      right: r["Date"] || "", notes: r["Notes"] || "",
    };
    if (type === "leads") {
      const missing = !r["Email"] || r["Email"] === "⚠️ MISSING";
      return {
        title: r["Name"] || "", sub: j([r["Lifecycle Stage"], r["Lead Status"]]),
        meta: j([r["Lead Source"], r["Referral Source"] ? `via ${r["Referral Source"]}` : null, r["Advisor"]]),
        right: missing ? "No email" : "", notes: "",
      };
    }
    if (type === "arrivals") return { title: r["Staying"] || "", sub: r["Names"] || "", meta: "", right: r["Arrival Date"] || "", notes: "" };
    if (type === "lost") {
      const s = splitName(r["Deal Name"]);
      return {
        title: s.property, sub: s.buyer || "",
        meta: j([r["Advisor"], r["Source"], r["Loss Reason"], r["Days on Hold"] ? `${r["Days on Hold"]} days on hold` : null]),
        right: money(r["Amount ($)"] || r["Amount"]), notes: r["Notes"] || "",
      };
    }
    if (type === "psas") {
      const s = splitName(r["Deal Name"]);
      const excluded = isRCRR(r["Deal Name"]);
      const advisor = r["Advisor"] || r["Deal owner"];
      const source = r["Source"] || r["Lead Source (NKN)"] || r["Lead Source"];
      return {
        title: s.property, sub: s.buyer || "",
        meta: j([advisor, source, r["Referral Source"] ? `via ${r["Referral Source"]}` : null,
          r["PSA Date Signed"] ? `PSA ${r["PSA Date Signed"]}` : null,
          (r["Total Days on Hold"] || r["Days on Hold"]) ? `${r["Total Days on Hold"] || r["Days on Hold"]} days on hold` : null]),
        right: money(r["Amount ($)"] || r["Amount"]), notes: "",
        tag: excluded ? "Not counted toward goal" : null,
      };
    }
    const s = splitName(r["Property / Buyer"] || r["Deal Name"]);
    const days = num(r["Days on Hold"]);
    return {
      title: s.property, sub: s.buyer || "",
      meta: j([r["Advisor"], r["Source"], days ? `${days} days` : null, r["DD Expiry"] ? `DD ${r["DD Expiry"]}` : null]),
      right: money(r["Amount ($)"] || r["Amount"]), notes: r["Notes"] || "",
    };
  });
}

const ROW = (dense) => ({
  display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 40, alignItems: "end",
  padding: dense ? "16px 0" : "26px 0", borderTop: `1px solid ${C.rule}`, cursor: "pointer",
});
const SRC_COLS = "1.6fr 0.7fr 0.7fr 0.7fr 0.7fr 0.8fr";

export default function NaukaDashboard({ dense = false, showMethodology = true }) {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState("");
  const [view, setView] = useState("weekly");
  const [convTab, setConvTab] = useState("alltime");
  const [year, setYear] = useState(null);
  const [monthIdx, setMonthIdx] = useState(1);
  const [modal, setModal] = useState(null);
  const [calSel, setCalSel] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const results = await Promise.all(TABS.map(([t]) => fetchSheet(t)));
      if (!alive) return;
      const next = {};
      TABS.forEach(([, key], i) => { next[key] = results[i]; });
      const yrs = [...new Set((next.funnelByYear || []).map((x) => x["Year"]).filter(Boolean))].sort((a, b) => b - a);
      setData(next);
      setYear(yrs.length ? yrs[0] : null);
      setLastUpdated(new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const S = {
    kpis: [], pipeline: [], deals: [], tours: [], leads: [], arrivals: [], lostDeals: [],
    signedOTPs: [], pendingOTPs: [], signedPSAs: [], ytdPSAs: [], resalePSAs: [],
    funnelAllTime: [], funnelByYear: [], calendarRows: [], ...data,
  };
  const latest = S.kpis[0] ?? {};
  const pipe = (stage) => S.pipeline.find((r) => r["Stage"] === stage) ?? {};

  const weeklyDefs = [
    { key: "New Leads", label: "New Leads", desc: "Fresh inbound interest captured this week.", records: S.leads, type: "leads", field: "New Leads", trend: "New Leads Trend" },
    { key: "Tours", label: "Tours", desc: "Property tours by advisors.", records: S.tours, type: "tours", field: "Tours", trend: "Tours Trend" },
    { key: "New OTPs", label: "New Pending OTPs", desc: "Offers to purchase awaiting signature.", records: S.pendingOTPs, type: "deals", field: "New Pending OTPs", trend: "New Pending OTPs Trend", amt: true },
    { key: "Signed OTPs", label: "New Signed OTPs", desc: "Offers signed and moved into due diligence.", records: S.signedOTPs, type: "deals", field: "New Signed OTPs", trend: "New Signed OTPs Trend", trend2: "New Signed OTPs $ Trend", amt: true },
    { key: "New PSAs", label: "Signed PSAs", desc: "Purchase and sale agreements executed.", records: S.signedPSAs, type: "psas", field: "New Signed PSAs", trend: "New Signed PSAs Trend", amt: true },
    { key: "Arrivals", label: "Member Arrivals", desc: "Members arrived to the property last week.", records: S.arrivals, type: "arrivals", field: "Member Arrivals" },
    { key: "Lost Deals", label: "Lost Deals", desc: "Deals lost this week.", records: S.lostDeals, type: "lost", field: "Lost Deals", trend: "Lost Deals Trend", amt: true, red: true },
  ];

  const activeDefs = [
    { key: "Pending OTP", label: "Pending OTP", desc: "Deals in decision, inventory assigned and on hold awaiting buyer signature.", clickable: true },
    { key: "Signed OTP", label: "Signed OTP", desc: "In due diligence.", clickable: true },
    { key: "Expired DD", label: "Expired Due Diligence", desc: "Past the due diligence date and still open.", clickable: true },
    { key: "YTD Signed PSAs", label: "YTD Signed PSAs", desc: "Executed year to date.", clickable: true },
    { key: "Resale PSAs", label: "Resale PSAs", desc: "Tracked separately from primary developer inventory.", clickable: true },
    { key: "All-Time PSAs", label: "All-Time PSAs", desc: "Every agreement executed since launch.", clickable: false },
  ];

  const salesPSAs = useMemo(() => S.ytdPSAs.filter((r) => !isRCRR(r["Deal Name"])), [S.ytdPSAs]);
  const rcrrPSAs = useMemo(() => S.ytdPSAs.filter((r) => isRCRR(r["Deal Name"])), [S.ytdPSAs]);
  const goalProgress = sumGoalAmount(S.ytdPSAs);
  const goalPct = Math.min(100, (goalProgress / SALES_GOAL) * 100);

  const expiredDeals = useMemo(() => {
    const today = new Date();
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return S.deals.filter((d) => {
      const raw = String(d["DD Expiry"] ?? "").trim();
      if (!raw) return false;
      let exp = new Date(raw);
      if (isNaN(exp) && !/\d{4}\s*$/.test(raw)) exp = new Date(`${raw}, ${today.getFullYear()}`);
      return !isNaN(exp) && exp < t0;
    });
  }, [S.deals]);

  /* conversions */
  const isAllTime = convTab === "alltime";
  const allRows = S.funnelAllTime.filter((r) => r["Source"] && r["Source"] !== "TOTAL");
  const allTotal = S.funnelAllTime.find((r) => r["Source"] === "TOTAL") ?? {};
  const years = [...new Set(S.funnelByYear.map((r) => r["Year"]).filter(Boolean))].sort((a, b) => b - a);
  const yrAll = S.funnelByYear.filter((r) => String(r["Year"]) === String(year));
  const rows = isAllTime ? allRows : yrAll.filter((r) => r["Source"] && r["Source"] !== "TOTAL");
  const totalRow = isAllTime ? allTotal : yrAll.find((r) => r["Source"] === "TOTAL") ?? {};
  const L = num(totalRow["Leads"]), T = num(totalRow["Toured"]), O = num(totalRow["OTPs"]), P = num(totalRow["PSAs"]);
  const maxV = Math.max(L, T, O, P, 1);

  /* calendar */
  const today = new Date();
  const months = useMemo(() => calendarMonths(today), [today.getMonth()]);
  const records = S.calendarRows.length ? parseCalendarSheet(S.calendarRows) : [];
  const month = months[Math.min(monthIdx, months.length - 1)];
  const weeks = buildMonthGrid(month.y, month.m);
  const monthStart = new Date(month.y, month.m, 1);
  const monthEnd = new Date(month.y, month.m + 1, 0);
  const monthHasEvents = records.some((r) => r.arrival <= monthEnd && r.departure >= monthStart);

  /* modal content */
  let modalContent = null;
  if (modal?.type === "weekly") {
    const d = weeklyDefs.find((x) => x.key === modal.key);
    if (d) {
      const amt = d.amt ? sumAmount(d.records) : 0;
      modalContent = {
        title: d.label,
        subtitle: d.key === "Lost Deals" && amt > 0 ? `Total lost this week ${money(amt)}` : amt > 0 ? `${money(amt)} in total value` : "This week",
        items: itemsFor(d.type, d.records),
      };
    }
  } else if (modal?.type === "active") {
    const stage = modal.key, info = pipe(stage);
    let recs = [], type = "deals", subtitle = "";
    if (stage === "Pending OTP") recs = S.deals.filter((d) => d["Stage"] === "Decision" || d["Stage"] === "Pending OTP");
    else if (stage === "Signed OTP") recs = S.deals.filter((d) => d["Stage"] === "Signed OTP");
    else if (stage === "Expired DD") recs = expiredDeals;
    else if (stage === "YTD Signed PSAs") {
      recs = S.ytdPSAs; type = "psas";
      const days = S.ytdPSAs.map((r) => parseInt(r["Days on Hold"], 10)).filter((x) => !isNaN(x));
      const avg = days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null;
      subtitle = `${money(goalProgress)} toward ${money(SALES_GOAL)} goal (${goalPct.toFixed(0)}%)${avg ? ` · avg ${avg} days on hold` : ""}`;
    } else if (stage === "Resale PSAs") { recs = S.resalePSAs; type = "psas"; subtitle = "Tracked separately from primary developer inventory"; }
    modalContent = {
      title: stage,
      subtitle: subtitle || `${info["Count"] || recs.length} deals · ${money(info["Value ($)"]) || "—"}`,
      items: itemsFor(type, recs),
    };
  }

  const tabStyle = (key) => ({
    background: "none", border: "none", padding: "13px 0", cursor: "pointer",
    flex: "0 0 auto", whiteSpace: "nowrap", fontFamily: F.b, fontSize: 12.5,
    letterSpacing: "0.14em", textTransform: "uppercase",
    color: view === key ? C.ink : C.faint, fontWeight: view === key ? 500 : 400,
    borderBottom: `1px solid ${view === key ? C.ink : "transparent"}`,
  });
  const arrow = (disabled) => ({
    background: "none", border: "none", cursor: disabled ? "default" : "pointer",
    fontFamily: F.d, fontSize: 26, lineHeight: 1, color: disabled ? "rgba(54,67,74,0.18)" : C.ink, padding: "0 6px",
  });

  const renderWeeklyRow = (d) => {
    const amount = d.amt ? sumAmount(d.records) : 0;
    const color = d.red && num(latest[d.field]) > 0 ? C.red : C.ink;
    const t1 = trendParts(latest[d.trend]);
    const t2 = trendParts(d.trend2 ? latest[d.trend2] : "");
    return (
      <div key={d.key} style={ROW(dense)} onClick={() => setModal({ type: "weekly", key: d.key })}>
        <div style={{ maxWidth: 420 }}>
          <div style={eyebrow(d.red ? C.red : C.tealInk)}>{d.label}</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.7, color: C.mute, marginTop: 10 }}>{d.desc}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 18, justifyContent: "flex-end" }}>
            <span style={{ fontFamily: F.d, fontSize: 22, fontWeight: 500, color: d.red ? C.red : C.tealInk, letterSpacing: "0.01em" }}>
              {amount > 0 ? money(amount) : ""}
            </span>
            <span style={{ fontFamily: F.d, fontSize: 52, fontWeight: 300, lineHeight: 0.85, color, letterSpacing: "-0.01em" }}>
              {count(latest[d.field])}
            </span>
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 14, justifyContent: "flex-end" }}>
            <span style={t1.style} title={t1.title}>{t1.main}</span>
            <span style={t2.style} title={t2.title}>{t2.main}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ background: C.paper, color: C.ink, fontFamily: F.b, minHeight: "100vh", paddingBottom: 72 }}>
      <div style={{ background: C.ink, padding: "clamp(28px,7vw,52px) 0 clamp(26px,6vw,46px)" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 clamp(18px,5vw,40px)", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 40, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "clamp(14px,4vw,22px)" }}>
              <img src="/assets/Nauka_Bird_OnDark.svg" alt="" style={{ height: "clamp(58px,14vw,80px)", width: "auto", display: "block" }} />
              <div style={{ fontFamily: F.d, fontSize: "clamp(30px,8vw,46px)", fontWeight: 400, letterSpacing: "0.06em", color: "#FFFFFF", lineHeight: 1 }}>NAUKA</div>
            </div>
            <div style={{ fontFamily: F.b, fontSize: 11.5, letterSpacing: "0.28em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)", marginTop: 18 }}>
              Weekly Sales Snapshot
            </div>
          </div>
          <div style={{ fontFamily: F.b, fontSize: 11.5, letterSpacing: "0.14em", color: "rgba(255,255,255,0.45)", paddingBottom: 4 }}>
            Updated {lastUpdated}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 clamp(18px,5vw,40px)" }}>
        <div style={{ display: "flex", gap: "clamp(20px,5vw,44px)", flexWrap: "nowrap", overflowX: "auto", WebkitOverflowScrolling: "touch", scrollbarWidth: "none", padding: "clamp(14px,3vw,22px) 0 0", borderBottom: `1px solid ${C.rule}`, marginBottom: 14 }}>
          {[["weekly", "Weekly Snapshot"], ["calendar", "Prospect Calendar"], ["active", "Active Transactions"], ["conversions", "Conversions"]].map(([key, label]) => (
            <button key={key} onClick={() => setView(key)} style={tabStyle(key)}>{label}</button>
          ))}
        </div>

        {loading && (
          <div style={{ fontFamily: F.b, fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: C.faint, padding: "80px 0" }}>Loading</div>
        )}

        {!loading && view === "weekly" && (
          <div>
            {weeklyDefs.map(renderWeeklyRow)}
            <div style={{ borderTop: `1px solid ${C.rule}` }} />
          </div>
        )}

        {!loading && view === "active" && (
          <div>
            <div style={{ padding: "34px 0 26px", maxWidth: 520 }}>
              <div style={{ fontFamily: F.d, fontSize: "clamp(25px,6.5vw,34px)", fontWeight: 300, letterSpacing: "0.02em", color: C.tealInk, lineHeight: 1.15 }}>Pipeline in Motion</div>
              <div style={{ fontSize: 14.5, lineHeight: 1.75, color: C.mute, marginTop: 14 }}>Deals currently advancing through the sales pipeline, by stage.</div>
            </div>

            <div style={{ padding: "8px 0 38px", borderBottom: `1px solid ${C.rule}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12 }}>
                <span style={eyebrow(C.tealInk)}>YTD Sales Goal</span>
                <span style={{ fontFamily: F.b, fontSize: 12.5, color: C.mute }}>
                  {money(goalProgress)} of {money(SALES_GOAL)} · {goalPct.toFixed(0)}%
                </span>
              </div>
              <div style={{ height: 8, background: "rgba(54,67,74,0.1)", marginTop: 14, borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.max(goalPct, goalPct > 0 ? 2 : 0)}%`, background: C.teal, transition: "width .6s ease", borderRadius: 4 }} />
              </div>
              {rcrrPSAs.length > 0 && (
                <div style={{ fontSize: 12, color: C.faint, marginTop: 12, letterSpacing: "0.02em" }}>
                  Excludes {rcrrPSAs.length} RCRR {rcrrPSAs.length === 1 ? "deal" : "deals"} tracked separately from the sales goal.
                </div>
              )}
            </div>

            {activeDefs.map((d) => {
              const info = pipe(d.key);
              return (
                <div
                  key={d.key}
                  onClick={d.clickable ? () => setModal({ type: "active", key: d.key }) : undefined}
                  style={{ ...ROW(dense), cursor: d.clickable ? "pointer" : "default", opacity: d.clickable ? 1 : 0.55 }}
                >
                  <div style={{ maxWidth: 440 }}>
                    <div style={eyebrow(d.clickable ? C.tealInk : C.faint)}>{d.label}</div>
                    <div style={{ fontSize: 13.5, lineHeight: 1.7, color: C.mute, marginTop: 10 }}>{d.desc}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
                    <span style={{ fontFamily: F.d, fontSize: 22, fontWeight: 500, color: C.tealInk }}>{money(info["Value ($)"])}</span>
                    <span style={{ fontFamily: F.d, fontSize: 52, fontWeight: 300, lineHeight: 0.85, color: C.ink }}>{count(info["Count"])}</span>
                  </div>
                </div>
              );
            })}
            <div style={{ borderTop: `1px solid ${C.rule}` }} />
          </div>
        )}

        {!loading && view === "conversions" && (
          <div style={{ paddingTop: 30 }}>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 16, borderBottom: `1px solid ${C.rule}`, paddingBottom: 2 }}>
              <div style={{ display: "flex" }}>
                {[["alltime", "All-Time Analysis"], ["byyear", "By Year"]].map(([k, label]) => (
                  <button
                    key={k} onClick={() => setConvTab(k)}
                    style={{ background: "none", border: "none", padding: "0 0 6px", marginRight: 26, cursor: "pointer", fontFamily: F.b, fontSize: 11.5, letterSpacing: "0.14em", textTransform: "uppercase", color: convTab === k ? C.ink : C.faint, borderBottom: `1px solid ${convTab === k ? C.tealInk : "transparent"}` }}
                  >{label}</button>
                ))}
              </div>
              {!isAllTime && years.length > 0 && (
                <div style={{ display: "flex", paddingBottom: 6 }}>
                  {years.map((y) => (
                    <button
                      key={y} onClick={() => setYear(y)}
                      style={{ background: "none", border: "none", padding: "0 0 4px", marginLeft: 18, cursor: "pointer", fontFamily: F.b, fontSize: 11.5, letterSpacing: "0.1em", color: String(year) === String(y) ? C.ink : C.faint, borderBottom: `1px solid ${String(year) === String(y) ? C.tealInk : "transparent"}` }}
                    >{count(y)}</button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ fontFamily: F.d, fontSize: "clamp(25px,6.5vw,34px)", fontWeight: 300, color: C.tealInk, margin: "34px 0 0" }}>
              {isAllTime ? "All-Time Lead Conversion" : `Lead Conversion · ${year ? count(year) : "—"} Group`}
            </div>

            {showMethodology && (
              <div style={{ maxWidth: 640, fontSize: 13, lineHeight: 1.8, color: C.mute, marginTop: 16, borderLeft: "2px solid rgba(136,209,209,0.7)", paddingLeft: 20 }}>
                Each lead is assigned to the year it was created in HubSpot and stays in that group for its entire journey — a lead created in 2022 that signs a PSA in 2025 still counts toward 2022. Leads that skip a stage are counted at the highest stage reached. Recent year groups will show lower rates simply because they have had less time to mature.
              </div>
            )}

            {L + T + O + P === 0 ? (
              <div style={{ fontSize: 13.5, color: C.faint, padding: "40px 0" }}>No funnel data available.</div>
            ) : (
              <div style={{ paddingTop: 34 }}>
                {[["Total Leads", L], ["Toured Leads", T], ["Signed OTP", O], ["Signed PSA", P]].map(([label, v]) => (
                  <div key={label} style={{ marginBottom: 26 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                      <span style={eyebrow(C.ink)}>{label}</span>
                      <span style={{ fontFamily: F.d, fontSize: 30, fontWeight: 400, color: C.ink }}>{v}</span>
                    </div>
                    <div style={{ height: 2, background: "rgba(54,67,74,0.12)" }}>
                      <div style={{ height: 2, background: C.ink, width: `${Math.max((v / maxV) * 100, v > 0 ? 2 : 0)}%`, transition: "width .6s ease" }} />
                    </div>
                  </div>
                ))}

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 1, background: C.rule, borderTop: `1px solid ${C.rule}`, borderBottom: `1px solid ${C.rule}`, marginTop: 44 }}>
                  {[["Lead → Tour", totalRow["L→T%"]], ["Tour → OTP", totalRow["T→O%"]], ["OTP → PSA", totalRow["O→P%"]]].map(([label, pct]) => (
                    <div key={label} style={{ background: C.paper, padding: "26px 4px 26px 0" }}>
                      <div style={rateStyle(pct || "—")}>{pct || "—"}</div>
                      <div style={{ ...eyebrow(C.faint), marginTop: 12 }}>{label}</div>
                    </div>
                  ))}
                </div>

                {rows.length > 0 && (
                  <div style={{ marginTop: 48, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                    <div style={{ fontFamily: F.b, fontSize: 11.5, letterSpacing: "0.16em", textTransform: "uppercase", color: C.faint, marginBottom: 14 }}>By Source</div>
                    <div style={{ minWidth: 560, display: "grid", gridTemplateColumns: SRC_COLS, padding: "0 0 10px", borderBottom: `1px solid ${C.rule}`, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint }}>
                      <span>Source</span>
                      <span style={{ textAlign: "right" }}>Leads</span>
                      <span style={{ textAlign: "right" }}>Toured</span>
                      <span style={{ textAlign: "right" }}>OTPs</span>
                      <span style={{ textAlign: "right" }}>PSAs</span>
                      <span style={{ textAlign: "right" }}>OTP → PSA</span>
                    </div>
                    {rows.map((r, i) => (
                      <div key={i} style={{ minWidth: 560, display: "grid", gridTemplateColumns: SRC_COLS, padding: "16px 0", borderBottom: "1px solid rgba(54,67,74,0.08)", fontSize: 13.5, alignItems: "baseline", color: C.ink }}>
                        <span style={{ letterSpacing: "0.02em" }}>{r["Source"]}</span>
                        <span style={{ textAlign: "right", color: C.mute }}>{r["Leads"] ? count(r["Leads"]) : "—"}</span>
                        <span style={{ textAlign: "right", color: C.mute }}>{r["Toured"] ? count(r["Toured"]) : "—"}</span>
                        <span style={{ textAlign: "right", color: C.mute }}>{r["OTPs"] ? count(r["OTPs"]) : "—"}</span>
                        <span style={{ textAlign: "right", fontFamily: F.d, fontSize: 19 }}>{r["PSAs"] ? count(r["PSAs"]) : "—"}</span>
                        <span style={{ ...rateStyle(r["O→P%"] || "—"), fontSize: 15, fontFamily: F.b, fontWeight: 500, textAlign: "right" }}>{r["O→P%"] || "—"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!loading && view === "calendar" && (
          <div style={{ paddingTop: 34 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, paddingBottom: 22 }}>
              <button onClick={() => setMonthIdx((i) => Math.max(0, i - 1))} style={arrow(monthIdx === 0)} aria-label="Previous month">‹</button>
              <div style={{ fontFamily: F.d, fontSize: "clamp(22px,6vw,32px)", fontWeight: 300, letterSpacing: "0.04em", color: C.ink }}>{month.label}</div>
              <button onClick={() => setMonthIdx((i) => Math.min(months.length - 1, i + 1))} style={arrow(monthIdx === months.length - 1)} aria-label="Next month">›</button>
            </div>

            <div style={{ display: "flex", gap: 26, flexWrap: "wrap", justifyContent: "center", paddingBottom: 26 }}>
              {["inprogress", "dayvisit", "completed", "canceled", "scheduled"].map((s) => (
                <div key={s} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: C.mute }}>
                  <span style={{ width: 18, height: 2, background: statusColor(s), display: "inline-block" }} />
                  {statusLabel(s)}
                </div>
              ))}
            </div>

            <div style={{ borderTop: `1px solid ${C.rule}` }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", borderBottom: `1px solid ${C.rule}` }}>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint, padding: "10px 8px" }}>{d}</div>
                ))}
              </div>

              {weeks.map((week, wi) => {
                const events = records.map((r) => {
                  let s = -1, e = -1;
                  week.forEach((c, i) => { if (inRange(c.date, r.arrival, r.departure)) { if (s === -1) s = i; e = i; } });
                  if (s === -1) return null;
                  return { r, s, span: e - s + 1 };
                }).filter(Boolean);
                return (
                  <div key={wi} style={{ borderBottom: "1px solid rgba(54,67,74,0.08)", minHeight: 92, paddingBottom: 8 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
                      {week.map((cell, ci) => {
                        const isToday = sameDay(cell.date, today);
                        return (
                          <div key={ci} style={{ borderRight: ci < 6 ? "1px solid rgba(54,67,74,0.08)" : "none", padding: "8px 8px 4px" }}>
                            <span style={{ fontFamily: F.b, fontSize: 11, letterSpacing: "0.04em", color: cell.outside ? "rgba(54,67,74,0.22)" : isToday ? C.ink : C.mute, fontWeight: isToday ? 600 : 400, borderBottom: isToday ? `1px solid ${C.tealInk}` : "none", display: "inline-block", paddingBottom: 1 }}>
                              {cell.date.getDate()}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, paddingTop: 6 }}>
                      {events.map(({ r, s, span }) => {
                        const st = calStatus(r, today);
                        return (
                          <div key={r.name} style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
                            <div
                              onClick={() => setCalSel(r)} title={`${r.name} — ${statusLabel(st)}`}
                              style={{ gridColumn: `${s + 1} / span ${span}`, borderLeft: `2px solid ${statusColor(st)}`, background: "rgba(54,67,74,0.035)", color: C.ink, fontFamily: F.b, fontSize: 11, letterSpacing: "0.04em", padding: "5px 8px", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                            >{r.name}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {!monthHasEvents && (
              <div style={{ fontSize: 13.5, color: C.faint, padding: "26px 0" }}>No tours scheduled yet for {month.label}.</div>
            )}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 26, paddingTop: "clamp(44px,10vw,72px)" }}>
          <div style={{ flex: 1, height: 1, background: C.rule }} />
          <img src="/assets/Nauka_Bird_OnLight.svg" alt="Nauka" style={{ height: 56, width: "auto", display: "block" }} />
          <div style={{ flex: 1, height: 1, background: C.rule }} />
        </div>
      </div>

      {modalContent && (
        <div onClick={() => setModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(54,67,74,0.6)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh clamp(12px,4vw,24px)", zIndex: 900 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.paper, maxWidth: 760, width: "100%", maxHeight: "88vh", overflowY: "auto", padding: "clamp(24px,6vw,44px) clamp(20px,6vw,48px) clamp(24px,6vw,40px)", boxShadow: "0 30px 80px rgba(54,67,74,0.35)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, borderBottom: `1px solid ${C.rule}`, paddingBottom: 22 }}>
              <div>
                <div style={{ fontFamily: F.d, fontSize: "clamp(26px,7vw,36px)", fontWeight: 300, color: C.ink, lineHeight: 1.1 }}>{modalContent.title}</div>
                <div style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: C.tealInk, marginTop: 12 }}>{modalContent.subtitle}</div>
              </div>
              <button onClick={() => setModal(null)} style={{ background: "none", border: "none", fontFamily: F.d, fontSize: 30, lineHeight: 1, color: C.ink, cursor: "pointer", padding: 0 }}>×</button>
            </div>
            {modalContent.items.map((it, i) => (
              <div key={i} style={{ padding: "24px 0", borderBottom: "1px solid rgba(54,67,74,0.08)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.16em", textTransform: "uppercase", color: C.tealInk }}>{it.title}</div>
                  <div style={{ fontFamily: F.d, fontSize: 24, color: C.ink, whiteSpace: "nowrap" }}>{it.right}</div>
                </div>
                {it.tag && (
                  <div style={{ fontFamily: F.b, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.amber, marginTop: 8 }}>{it.tag}</div>
                )}
                {it.sub && <div style={{ fontSize: 14, color: C.ink, marginTop: 8, letterSpacing: "0.01em" }}>{it.sub}</div>}
                {it.meta && <div style={{ fontSize: 12.5, color: C.mute, marginTop: 8, letterSpacing: "0.03em" }}>{it.meta}</div>}
                {it.notes && <div style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(54,67,74,0.78)", marginTop: 12, whiteSpace: "pre-line" }}>{it.notes}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {calSel && (() => {
        const st = calStatus(calSel, today);
        const issues = calIssues(calSel);
        const fmt = (d) => d.toLocaleDateString("en-US", { day: "2-digit", month: "short" });
        return (
          <div onClick={() => setCalSel(null)} style={{ position: "fixed", inset: 0, background: "rgba(54,67,74,0.6)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh clamp(12px,4vw,24px)", zIndex: 900 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: C.paper, maxWidth: 720, width: "100%", maxHeight: "88vh", overflowY: "auto", padding: "clamp(24px,6vw,44px) clamp(20px,6vw,48px) clamp(24px,6vw,40px)", boxShadow: "0 30px 80px rgba(54,67,74,0.35)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, borderBottom: `1px solid ${C.rule}`, paddingBottom: 22 }}>
                <div>
                  <div style={{ fontFamily: F.d, fontSize: "clamp(26px,7vw,36px)", fontWeight: 300, color: C.ink, lineHeight: 1.1 }}>{calSel.name}</div>
                  <div style={{ ...eyebrow(statusColor(st)), fontSize: 11, marginTop: 12 }}>{calSel.stage}</div>
                </div>
                <button onClick={() => setCalSel(null)} style={{ background: "none", border: "none", fontFamily: F.d, fontSize: 30, lineHeight: 1, color: C.ink, cursor: "pointer", padding: 0 }}>×</button>
              </div>
              <div style={{ fontSize: 13, color: C.mute, paddingTop: 20, letterSpacing: "0.03em" }}>
                Arrival {fmt(calSel.arrival)} · Departure {fmt(calSel.departure)}{calSel.coveredBy ? ` · Covered by ${calSel.coveredBy}` : ""}
              </div>
              <div style={{ fontSize: 13, color: C.mute, marginTop: 6, letterSpacing: "0.03em" }}>
                {[calSel.source ? `${calSel.source}${calSel.referral ? ` (ref: ${calSel.referral})` : ""}` : null, calSel.lifecycle, calSel.leadStatus].filter(Boolean).join(" · ")}
              </div>
              {calSel.email && <div style={{ fontSize: 13, color: C.mute, marginTop: 6 }}>{calSel.email}</div>}

              <div style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 7 }}>
                {(issues.length ? issues : [{ label: "No open items", level: "ok" }]).map((x, i) => (
                  <div key={i} style={{ fontFamily: F.b, fontSize: 12.5, color: x.level === "red" ? C.red : x.level === "amber" ? C.amber : C.green }}>{x.label}</div>
                ))}
              </div>

              {calSel.guests && (
                <div style={{ marginTop: 30, borderTop: `1px solid ${C.rule}`, paddingTop: 22 }}>
                  <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: C.faint }}>Guests</div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.75, color: C.ink, marginTop: 8 }}>{calSel.guests}</div>
                </div>
              )}
              {calSel.chargeNote && (
                <div style={{ marginTop: 24, borderTop: "1px solid rgba(54,67,74,0.08)", paddingTop: 22 }}>
                  <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: C.faint }}>Charge Notes</div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.75, color: C.ink, marginTop: 8 }}>{calSel.chargeNote}</div>
                </div>
              )}
              {calSel.notes?.length > 0 && (
                <div style={{ marginTop: 24, borderTop: "1px solid rgba(54,67,74,0.08)", paddingTop: 22 }}>
                  <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: C.faint }}>Notes</div>
                  {calSel.notes.map((n, i) => (
                    <div key={i} style={{ marginTop: 14 }}>
                      {n.date && <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint }}>Note added {n.date}</div>}
                      <div style={{ fontSize: 13.5, lineHeight: 1.75, color: C.ink, marginTop: 5 }}>{n.text}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
