import { useState, useEffect, useCallback, useRef } from "react";

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
  slate: "#5B7C99",  // calendar: completed / departed visits
  purple:"#8E6FA8",  // calendar: same-day visits
};

const FONT_DISPLAY = "'Larken', Georgia, serif";
const FONT_BODY    = "'FreightSans Pro', 'Trebuchet MS', sans-serif";

// ── Sales Team YTD goal ───────────────────────────────────────
// The "YTD Signed PSAs" pipeline stat includes related-party / insider
// sales (deals to owners, owner family, or their referrals) that don't
// count toward the sales team's annual production goal. This list is a
// manually maintained set of exact "Deal Name" values (as they appear in
// the YTD_PSAs sheet tab) to exclude from that goal figure. Deals marked
// Related Party = Yes in Master_Deals (shown in YTD_PSAs' "Related Party"
// column) are excluded too, so new ones only need flagging in the sheet.
const SALES_TEAM_GOAL_EXCLUSIONS = [
  "RCRR 5201/5203 | Alejandro Aboumrad",
  "RCRR 5102/5104 | Alfredo Miguel",
  "RCRR 5301/5303 | Brent Handler",
  "SIari RCRR 6201/6203 | COSE Servicios",
  "RCRR 5202/5204 | Jaime Ysita",
  "SIari RCRR 6202/6204 | Vertiente SA",
];
// Qualifying re-sale inventory PSAs (from the YTD_Resale_PSAs tab) DO count
// toward the sales team goal, in addition to primary-inventory YTD PSAs.
const SALES_TEAM_GOAL_AMOUNT = 270000000; // $270M full-year 2026 target

async function fetchSheet(tab) {
  const url = `${BASE}/${encodeURIComponent(tab)}?key=${API_KEY}`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (!json.values || json.values.length < 2) return [];
    const [, headers, ...rows] = json.values;
    return rows
      .filter(row => row.some(v => String(v ?? "").trim() !== ""))
      .map(row =>
        Object.fromEntries(headers.map((h, i) => [h.trim(), row[i] ?? ""]))
      );
  } catch (err) {
    console.error(`[fetchSheet: ${tab}] error`, err);
    return [];
  }
}

// Fetches a tab as a raw 2D grid (array of row arrays), with no header-row
// mapping. Used for the Inventory tabs ("Built Product" / "Homesites"),
// which are laid out as several side-by-side mini-tables per sheet rather
// than one clean header + rows block, so fetchSheet's header-zip approach
// doesn't apply.
async function fetchRawSheet(tab) {
  const url = `${BASE}/${encodeURIComponent(tab)}?key=${API_KEY}`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    return json.values || [];
  } catch (err) {
    console.error(`[fetchRawSheet: ${tab}] error`, err);
    return [];
  }
}

const money = v => {
  const n = parseFloat(String(v).replace(/[$,]/g, ""));
  if (isNaN(n)) return "—";
  return n >= 1000000 ? `$${(n / 1000000).toFixed(2)}M` : `$${n.toLocaleString()}`;
};
const num = v => { const n = parseInt(v); return isNaN(n) ? 0 : n; };
const sumAmount = records => (records || []).reduce((sum, r) => {
  const n = parseFloat(String(r["Amount ($)"] ?? r["Amount"] ?? "").replace(/[$,]/g, ""));
  return sum + (isNaN(n) ? 0 : n);
}, 0);

// ══════════════════════════════════════════════════════════════════════
// ── INVENTORY (Built Product / Homesites) ───────────────────────────
// Parsed from raw sheet grids rather than fetchSheet's header-zip helper,
// since each tab lays out several mini-tables side by side per row
// (grouped by building or estate) instead of one flat table.
// ══════════════════════════════════════════════════════════════════════

const INV_STATUS_COLOR = {
  available: C.green,
  sold: "rgba(54,67,74,0.45)",
  hold: C.amber,
  pending: C.amber,
  pending_otp: C.amber,
  signed_otp: C.slate,
  off_market: C.red,
  unknown: "rgba(54,67,74,0.3)",
};
const INV_STATUS_LABEL = {
  available: "Available",
  sold: "Sold",
  hold: "On Hold",
  pending: "Pending",
  pending_otp: "Pending OTP",
  signed_otp: "Signed OTP",
  off_market: "Off Market",
  unknown: "Unlisted",
};

// Strips a trailing "(...)" note off a name, e.g. "Jorge Fernandez (On Hold)"
// → { clean: "Jorge Fernandez", note: "On Hold" }.
function invSplitNote(raw) {
  const s = raw != null ? String(raw).trim() : "";
  const m = s.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  return m ? { clean: m[1].trim(), note: m[2].trim() } : { clean: s, note: null };
}

// For a "sold" entry, shortens a single personal name down to its family
// name for a quick scan (e.g. "Andres Conesa" → "Conesa"). Leaves company
// names, joint/multi-party owners, and anything already short as-is.
function invFamilyName(raw) {
  if (!raw) return raw;
  const isEntity = /(SA de CV|LLC|Corp\.?|Inc\.?|Servicios|Empresariales|Ownership)/i.test(raw);
  const isMulti = /[/&]|\band\b/i.test(raw);
  if (isEntity || isMulti) return raw;
  const parts = raw.split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : raw;
}

const INV_PLACEHOLDER_RE = /^(on hold|off market|unavailable|pending)$/i;

// The Sheets API's default render mode returns numeric cells as formatted
// strings (e.g. "20,000,000"), not JS numbers — these two helpers let the
// row-detection logic below treat either shape as numeric.
function invIsNumericCell(v) {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") return /^-?[\d,]+(\.\d+)?$/.test(v.trim()) && v.trim() !== "";
  return false;
}
function invNumericValue(v) {
  return typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
}

// Classifies a single (owner, status) cell pair — the recurring shape used
// throughout both sheets — into a normalized inventory-unit status. A
// number is read as an asking price (available); "Sold" / "Hold" /
// "Pending" text in either cell sets that status; text placeholders
// ("OFF MARKET", "ON HOLD", "Unavailable") stand in for an owner name
// when a lot isn't sellable. For sheet regions with a single combined
// value cell instead of separate owner/status columns (the Beach and
// Cliff Residences floor-plan matrices), pass that value as statusRaw
// with ownerRaw set to null — a plain name there is read as sold.
function invClassify(ownerRaw, statusRaw) {
  const { clean: ownerClean, note: ownerNote } = invSplitNote(ownerRaw);
  const statusStr = statusRaw != null ? String(statusRaw).trim() : "";
  const statusNum = typeof statusRaw === "number"
    ? statusRaw
    : (statusStr && /^[\d$,.]+$/.test(statusStr) ? parseFloat(statusStr.replace(/[$,]/g, "")) : null);

  if (INV_PLACEHOLDER_RE.test(ownerClean)) {
    const low = ownerClean.toLowerCase();
    return { status: low.includes("off") || low.includes("unavail") ? "off_market" : "hold", buyer: null, price: statusNum };
  }
  if (ownerNote && /on hold/i.test(ownerNote)) {
    return { status: "hold", buyer: ownerClean, price: statusNum };
  }
  if (/^(sold|signed psa|psa signed)$/i.test(statusStr)) return { status: "sold", buyer: ownerClean || null, price: null };
  // Deal stages typed into the Status cell (same words as Master_Deals Stage)
  if (/^(signed otp|otp signed)$/i.test(statusStr)) return { status: "signed_otp", buyer: ownerClean || null, price: null };
  if (/^(pending otp|otp pending|otp sent)$/i.test(statusStr)) return { status: "pending_otp", buyer: ownerClean || null, price: statusNum };
  if (/^hold$/i.test(statusStr)) return { status: "hold", buyer: ownerClean || null, price: statusNum };
  if (/^pending$/i.test(statusStr)) return { status: "pending", buyer: ownerClean || null, price: statusNum };
  if (INV_PLACEHOLDER_RE.test(statusStr)) {
    const low = statusStr.toLowerCase();
    return { status: low.includes("off") || low.includes("unavail") ? "off_market" : "hold", buyer: ownerClean || null, price: null };
  }
  if (statusNum != null && statusNum >= 100000) {
    return { status: "available", buyer: ownerClean || null, price: statusNum };
  }
  // Single combined-value cell (matrix layouts): a leftover plain-text
  // value that isn't a recognized keyword is a name, meaning sold.
  if (statusStr) return { status: "sold", buyer: ownerClean || statusStr, price: null };
  if (ownerClean) return { status: "sold", buyer: ownerClean, price: null };
  return { status: "unknown", buyer: null, price: null };
}

// Reads a raw "Built Product" grid (array of row arrays from the Sheets
// API) into [{ name, units: [...] }]. Column positions are fixed to match
// the tab's layout: Siari Ritz-Carlton Residences (B–E), Golf Villas
// (H–J), Beach Residences (L–P), and the Cliff Residences per-building
// floor-plan blocks (starting in column R).
function parseBuiltProduct(rows) {
  if (!rows || rows.length < 6) return [];
  const groups = [];

  // Siari - Ritz-Carlton Residences: unit label / unit number / owner / status
  const siari = [];
  for (let r = 5; r < rows.length; r++) {
    const row = rows[r] || [];
    const label = row[1], unitNo = row[2];
    if (!label || unitNo === undefined || unitNo === "") continue;
    const { status, buyer, price } = invClassify(row[3], row[4]);
    siari.push({ unit: `${label} · ${unitNo}`, status, buyer, price });
  }
  if (siari.length) groups.push({ name: "Siari — Ritz-Carlton Residences", units: siari });

  // Golf Villas: # / owner / status
  const golf = [];
  for (let r = 5; r < rows.length; r++) {
    const row = rows[r] || [];
    const n = row[7];
    if (!invIsNumericCell(n)) continue;
    const { status, buyer, price } = invClassify(row[8], row[9]);
    golf.push({ unit: `Villa ${n}`, status, buyer, price });
  }
  if (golf.length) groups.push({ name: "Golf Villas", units: golf });

  // Beach Residences: one column per building (M–P); only the two floor
  // rows that carry a real owner/price value are used — the sheet's other
  // two floor rows show a bare unit number with no recorded status yet.
  const beachBuildingCols = [12, 13, 14, 15];
  const beachBuildingNames = ["Building 1", "Building 2", "Building 3", "Building 4"];
  const beach = [];
  for (let r = 5; r < Math.min(rows.length, 10); r++) {
    const row = rows[r] || [];
    const floorLabel = row[11];
    if (!floorLabel) continue;
    beachBuildingCols.forEach((col, i) => {
      const val = row[col];
      if (val === undefined || val === "") return;
      if (invIsNumericCell(val) && invNumericValue(val) < 100000) return; // bare unit number, no real status
      const { status, buyer, price } = invClassify(null, val);
      beach.push({ unit: `${beachBuildingNames[i]} · ${floorLabel}`, status, buyer, price });
    });
  }
  if (beach.length) groups.push({ name: "Beach Residences", units: beach });

  // Cliff Residences: per-building floor-plan blocks starting wherever
  // column R reads "CLIFF RESIDENCES ..." — two units per floor row
  // (North in S/T, South in V/W).
  for (let r = 0; r < rows.length; r++) {
    const marker = (rows[r] || [])[17];
    if (!marker || !/CLIFF RESIDENCES/i.test(String(marker))) continue;
    const bNum = (String(marker).match(/(\d+)/) || [])[1] || "?";
    const units = [];
    for (let rr = r + 2; rr < rows.length; rr++) {
      const row = rows[rr] || [];
      const floorN = row[17], unitN = row[18], valN = row[19];
      const floorS = row[20], unitS = row[21], valS = row[22];
      if (!floorN && !floorS) break; // blank separator row → end of this building's block
      if (floorN && unitN !== undefined) {
        const { status, buyer, price } = invClassify(null, valN);
        units.push({ unit: `${floorN} (N) · ${unitN}`, status, buyer, price });
      }
      if (floorS && unitS !== undefined) {
        const { status, buyer, price } = invClassify(null, valS);
        units.push({ unit: `${floorS} (S) · ${unitS}`, status, buyer, price });
      }
    }
    if (units.length) groups.push({ name: `Cliff Residences — Building ${bNum}`, units });
  }

  return groups;
}

// Reads a raw "Homesites" grid into [{ name, units: [...] }]. Beach
// Estates / Bluff Estates / Cliff Estates each have their own LOT# /
// OWNER / STATUS column triplet; Cliff Estates has a second "Phase 4"
// mini-table further down the same three columns, kept as its own group.
function parseHomesites(rows) {
  if (!rows || rows.length < 6) return [];
  const groups = [];
  const blocks = [
    { name: "Beach Estates", cols: [1, 2, 3] },
    { name: "Bluff Estates", cols: [5, 6, 7] },
    { name: "Cliff Estates", cols: [9, 10, 11] },
  ];
  blocks.forEach(({ name, cols }) => {
    const [lotCol, ownerCol, statusCol] = cols;
    const units = [];
    for (let r = 5; r < rows.length; r++) {
      const row = rows[r] || [];
      const lot = row[lotCol];
      // A "Phase N" sub-header marks a separate mini-table further down
      // this same column triplet — stop here so its lots are only
      // counted once, under their own group (parsed separately below).
      if (typeof lot === "string" && /Phase\s*\d/i.test(lot)) break;
      if (!invIsNumericCell(lot)) continue; // skips blanks, section labels, and repeated headers
      const { status, buyer, price } = invClassify(row[ownerCol], row[statusCol]);
      units.push({ unit: `Homesite ${lot}`, status, buyer, price });
    }
    if (units.length) groups.push({ name, units });
  });

  // Cliff Estates — Phase 4: same J/K/L columns, further down the sheet,
  // after its own "Cliff Estates Phase 4" / "LOT #" mini-header.
  for (let r = 0; r < rows.length; r++) {
    const marker = (rows[r] || [])[9];
    if (typeof marker !== "string" || !/Phase 4/i.test(marker)) continue;
    const units = [];
    for (let rr = r + 2; rr < rows.length; rr++) {
      const row = rows[rr] || [];
      const lot = row[9];
      if (!invIsNumericCell(lot)) break;
      const { status, buyer, price } = invClassify(row[10], row[11]);
      units.push({ unit: `Homesite ${lot}`, status, buyer, price });
    }
    if (units.length) groups.push({ name: "Cliff Estates — Phase 4", units });
    break;
  }

  return groups;
}

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

// ── Editorial row primitives ────────────────────────────────────────
// Inspired by the LIFE Properties brochure spread: no boxed cards — a
// teal (or status-colored) all-caps eyebrow name, a bold subhead line,
// then quiet metadata and body copy, separated by a hairline rule.
const ROW_STYLE = { padding: "16px 0", borderBottom: "1px solid rgba(54,67,74,0.12)" };
const Eyebrow = ({ children, color = C.teal }) => (
  <div style={{ fontSize: 12, fontWeight: "bold", letterSpacing: "0.07em", textTransform: "uppercase", color, fontFamily: FONT_BODY, marginBottom: 3 }}>
    {children}
  </div>
);
const Subhead = ({ children }) => (
  <div style={{ fontSize: 13.5, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY, marginBottom: 6 }}>
    {children}
  </div>
);
const RowMeta = ({ children }) => (
  <div style={{ fontSize: 11.5, color: "rgba(54,67,74,0.72)", marginBottom: 6, fontFamily: FONT_BODY }}>{children}</div>
);
const RowNotes = ({ children, preLine }) => (
  <div style={{ fontSize: 12.5, color: "rgba(54,67,74,0.85)", lineHeight: 1.55, fontFamily: FONT_BODY, whiteSpace: preLine ? "pre-line" : "normal" }}>{children}</div>
);
// Splits "Property Name | Buyer Name" into its two parts, falling back
// gracefully when there's no buyer segment.
function splitDealName(name) {
  if (!name) return { property: "", buyer: null };
  const [property, ...rest] = String(name).split("|");
  return { property: property.trim(), buyer: rest.length ? rest.join("|").trim() : null };
}

// ── Deal Card ─────────────────────────────────────────────────────────
const DealCard = ({ deal }) => {
  const days = num(deal["Days on Hold"]);
  const accent = days > 90 ? C.amber : C.teal;
  const { property, buyer } = splitDealName(deal["Property / Buyer"] || deal["Deal Name"]);
  return (
    <div style={ROW_STYLE}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <Eyebrow color={accent}>{property}</Eyebrow>
          {buyer && <Subhead>{buyer}</Subhead>}
        </div>
        <span style={{ fontFamily: FONT_DISPLAY, fontSize: 19, color: C.gray, whiteSpace: "nowrap" }}>{money(deal["Amount ($)"] || deal["Amount"])}</span>
      </div>
      <RowMeta>
        {[deal["Advisor"], deal["Source"], days ? `${days} days` : null, deal["DD Expiry"] ? `DD: ${deal["DD Expiry"]}` : null].filter(Boolean).join(" · ")}
      </RowMeta>
      {deal["Notes"] && <RowNotes>{deal["Notes"]}</RowNotes>}
    </div>
  );
};

// ── PSA Card ──────────────────────────────────────────────────────────
const PSACard = ({ deal }) => {
  const days = deal["Total Days on Hold"] || deal["Days on Hold"];
  const psaDate = deal["PSA Date Signed"];
  const { property, buyer } = splitDealName(deal["Deal Name"]);
  return (
    <div style={ROW_STYLE}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <Eyebrow>{property}</Eyebrow>
          {buyer && <Subhead>{buyer}</Subhead>}
        </div>
        <span style={{ fontFamily: FONT_DISPLAY, fontSize: 19, color: C.gray, whiteSpace: "nowrap" }}>{money(deal["Amount ($)"])}</span>
      </div>
      <RowMeta>
        {[deal["Advisor"], deal["Source"], deal["Referral Source"] ? `via ${deal["Referral Source"]}` : null, psaDate ? `PSA: ${psaDate}` : null, days ? `${days} days on hold` : null].filter(Boolean).join(" · ")}
      </RowMeta>
    </div>
  );
};

// ── Inventory Unit Row ──────────────────────────────────────────────
const InventoryUnitRow = ({ u }) => {
  const color = INV_STATUS_COLOR[u.status] || INV_STATUS_COLOR.unknown;
  const label = INV_STATUS_LABEL[u.status] || INV_STATUS_LABEL.unknown;

  let subLabel = null;
  if (u.status === "sold" && u.buyer) subLabel = invFamilyName(u.buyer);
  else if (["hold", "pending", "pending_otp", "signed_otp"].includes(u.status) && u.buyer) subLabel = u.buyer;

  return (
    <div style={ROW_STYLE}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <Eyebrow color={color}>{u.unit}</Eyebrow>
          {subLabel && <Subhead>{subLabel}</Subhead>}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          {u.price != null && (
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, color: C.gray, marginBottom: 4 }}>{money(u.price)}</div>
          )}
          <span style={{
            fontSize: 10, fontWeight: "bold", color: "#fff", background: color,
            borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap", fontFamily: FONT_BODY,
          }}>
            {label}
          </span>
        </div>
      </div>
    </div>
  );
};

// ── Inventory Group Section ──────────────────────────────────────────
const InventoryGroupSection = ({ group }) => (
  <div style={{ marginBottom: 30 }}>
    <div style={{ background: C.gray, borderRadius: 8, padding: "11px 16px", marginBottom: 2 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontStyle: "italic", color: C.teal }}>
        {group.name}
      </div>
    </div>
    {group.units.map((u, i) => <InventoryUnitRow key={i} u={u} />)}
  </div>
);

// ── Modal ─────────────────────────────────────────────────────────────
const Modal = ({ title, subtitle, onClose, children }) => (
  <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(54,67,74,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}>
    <div onClick={e => e.stopPropagation()} style={{ background: C.beige, borderRadius: 12, padding: "1.25rem", maxWidth: 720, width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.gray, fontStyle: "italic" }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: "rgba(54,67,74,0.72)", marginTop: 3, fontFamily: FONT_BODY }}>{subtitle}</div>}
        </div>
        <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 24, cursor: "pointer", color: C.gray, lineHeight: 1, padding: 4 }}>×</button>
      </div>
      {children}
    </div>
  </div>
);

// ══════════════════════════════════════════════════════════════════════
// ── PROSPECT CALENDAR ────────────────────────────────────────────────
// Manually maintained from advisor CRM input (not yet wired to a Sheets
// tab — HubSpot custom-object access for this data isn't available via
// API yet, so this list is hand-updated from what advisors log).
// ══════════════════════════════════════════════════════════════════════

// Local midnight of the day the page is opened — no weekly edit needed.
const CAL_TODAY = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); })();

function cd(s) { return new Date(s + "T00:00:00"); }
function calFmt(dt) { return dt.toLocaleDateString("en-US", { day: "2-digit", month: "short" }); }
function calSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function calInRange(date, start, end) {
  const t = date.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

// Parses the "Prospect_Calendar" sheet tab into the record shape the calendar
// components expect. Falls back to FALLBACK_CALENDAR_RECORDS below if the tab
// is missing or empty (e.g. before it's been created in the spreadsheet).
function parseCalendarSheet(rows) {
  if (!rows || rows.length === 0) return [];
  const parseDate = s => twParseDate(s);
  const parseNotes = s => {
    if (!s || !String(s).trim()) return [];
    return String(s).split("||").map(chunk => {
      const c = chunk.trim();
      const m = c.match(/^([A-Za-z]+ \d{1,2}):\s*([\s\S]*)$/); // [\s\S] so multi-line notes keep their date label
      return m ? { date: m[1], text: m[2] } : { date: null, text: c };
    });
  };
  return rows
    .map(r => ({
      name: r["Name"],
      arrival: parseDate(r["Arrival Date"]),
      departure: parseDate(r["Departure Date"]),
      // Meeting date from HubSpot's "contacts with meetings" report. A visit
      // counts as a tour (60-day and monthly counts) only when it's set.
      tourDate: parseDate(r["Tour Date"]),
      // Links the visit to its lead and deal. Names are never used for matching.
      recordId: r["HubSpot Record ID"] || null,
      contactType: r["Contact Type"] || null,
      // Optional columns: fill them when a toured prospect is Lost.
      lostDate: parseDate(r["Lost Date"]),
      lossReason: r["Loss Reason"] || null,
      stage: r["Stage"],
      coveredBy: r["Covered By"] || null,
      owner: r["Owner"] || null,
      source: r["Source"] || null,
      referral: r["Referral Source"] || null,
      email: r["Email"] || null,
      lifecycle: r["Lifecycle Stage"] || null,
      leadStatus: r["Lead Status"] || null,
      guests: r["Guests"] || null,
      chargeNote: r["Charge Note"] || null,
      notes: parseNotes(r["Notes"]),
    }))
    .filter(r => r.name && r.arrival && r.departure);
}

// Fallback data — used only if the Prospect_Calendar sheet tab isn't set up yet.
const FALLBACK_CALENDAR_RECORDS = [
  {
    name: "Duke Daugherty",
    arrival: cd("2026-08-19"),
    departure: cd("2026-08-23"),
    stage: "Arrived On Property",
    coveredBy: "Oscar Fraustro",
    owner: "Oscar Fraustro",
    source: "Internal",
    referral: "Dulce Ponce",
    email: null,
    lifecycle: "Marketing Qualified Lead",
    leadStatus: "Active",
    guests: null,
    chargeNote: "To Oscar's account with notes",
  },
  {
    name: "Lorenzo Cue",
    arrival: cd("2026-08-15"),
    departure: cd("2026-08-15"),
    stage: "Departed from Property",
    coveredBy: "Oscar Fraustro",
    owner: "Oscar Fraustro",
    source: "Internal",
    referral: "Jaime Ysita",
    email: null,
    lifecycle: "Sales Qualified Lead",
    leadStatus: "Active",
    guests: null,
    chargeNote: "To Oscar's sales account with notes",
  },
  {
    name: "Juan Carlos Hevia",
    arrival: cd("2026-08-14"),
    departure: cd("2026-08-17"),
    stage: "Departed from Property",
    coveredBy: null,
    owner: "Oscar Fraustro",
    source: "Internal",
    referral: "Pepe Miguel",
    email: "juancarlos.hevia@gmail.com",
    lifecycle: "Opportunity",
    leadStatus: "Active",
    guests: "4 adults, 2 children: Federica Hevia Pérez, Marietta (4 YO), Carola (2 YO), Eduardo Garza, Roberta Pérez",
    chargeNote: "To Prospect's Account",
    notes: [
      { date: null, text: "He was at Nauka as a member already — he's all set in terms of sales." },
      { date: null, text: "PSA (Purchase & Sale Agreement) is pending execution." },
    ],
  },
  {
    name: "LB Jamess + group",
    arrival: cd("2026-08-07"),
    departure: cd("2026-08-11"),
    stage: "Departed from Property",
    coveredBy: "Eli Pacino",
    owner: "Eli Pacino",
    source: "Internal",
    referral: "Mark Birnbaum",
    email: null,
    lifecycle: "Sales Qualified Lead",
    leadStatus: "Active",
    guests: "8 adults: LB James, Vivian Christine, Randy Mims, Mark Birnbaum, Sian Cotton, Kiarah Du Barry",
    chargeNote: "To Prospect Account",
    notes: [
      { date: "Aug 7", text: "Arrived 12:28 PM (Tepic) / 1:45 PM (Puerto Vallarta) — 2 airport pickups. Staying at Siari (lock-off), Aug 7 to 11. Group of 7 adults total (8 guests + 1 security), golf + BC dinner." },
      { date: "Aug 21", text: "Club is reviewing the bill with Mark B. — pending approval." },
    ],
  },
  {
    name: "Jose Carlos Perez",
    arrival: cd("2026-08-03"),
    departure: cd("2026-08-03"),
    stage: "Canceled",
    coveredBy: "Oscar Fraustro",
    owner: "Oscar Fraustro",
    source: "Referral",
    referral: "Eduardo Sierra",
    email: null,
    lifecycle: "Sales Qualified Lead",
    leadStatus: "Timing",
    guests: null,
    chargeNote: "To Oscar's Sales Account",
    notes: [
      {
        date: "Aug 3",
        text: "Meeting canceled. Please direct him to MBC where I will welcome them. Understand MBC is closed but need to show topo map first, so if possible someone from F&B to have towels and welcome drink. Full property tour after that with possible lunch at Village or Nest. Please have Black CanAm clean and ready.",
      },
      {
        date: "August 6",
        text: "Unfortunately, the weather was not good — intense rain and wind — and we had to cancel his visit. He was not able to come another day during this visit since more than 50 family members were arriving to the Rosewood for a family reunion. I insisted he should visit soon.",
      },
      {
        date: "August 20",
        text: "Short WhatsApp texting conversation. He had the best time with his family in Mandarina and plans to come back, unsure when. When he does, he is definitely coming to see Nauka.",
      },
    ],
  },
];

// ── Calendar colors: one color per advisor ──────────────────────────
// Each visit bar is colored by its advisor ("Covered By", falling back to
// "Owner" when Covered By is blank). Status isn't color-coded — the date
// already tells you whether a visit is past, current or upcoming — except
// that Canceled visits keep the advisor color with the name crossed out.
// The stage still shows in the pop-up when a visit is clicked.
// To change an advisor's color, edit it here. A new advisor who isn't
// listed gets the next spare color automatically.
const CAL_ADVISOR_COLORS = {
  "Eli Pacino":     "#2F8F8A", // deep teal
  "Oscar Fraustro": "#4A6FA5", // slate blue
  "Trip Morris":    "#C9803F", // warm ochre
  "Brandon Oyler":  "#8E6FA8", // plum
};
const CAL_SPARE_COLORS = ["#B5566B", "#5E8C4A", "#6B6FB0", "#A0763A"];
const CAL_UNASSIGNED_COLOR = "#8A9095";
const CAL_UNASSIGNED_LABEL = "Unassigned";

const calNormName = s => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
const CAL_ADVISOR_LOOKUP = Object.fromEntries(
  Object.entries(CAL_ADVISOR_COLORS).map(([name, color]) => [calNormName(name), { name, color }])
);

// Returns the advisor display name for a visit, or null if unassigned.
function calAdvisor(r) {
  const raw = (r.coveredBy && String(r.coveredBy).trim()) || (r.owner && String(r.owner).trim()) || "";
  if (!raw) return null;
  const known = CAL_ADVISOR_LOOKUP[calNormName(raw)];
  return known ? known.name : raw.replace(/\s+/g, " ");
}

// Builds { advisorName: color } for every advisor that appears in the records,
// handing spare colors to anyone not in CAL_ADVISOR_COLORS (stable by name order).
function calBuildAdvisorColors(records) {
  const map = { ...CAL_ADVISOR_COLORS };
  const extras = [...new Set(records.map(calAdvisor).filter(a => a && !map[a]))].sort();
  extras.forEach((a, i) => { map[a] = CAL_SPARE_COLORS[i % CAL_SPARE_COLORS.length]; });
  return map;
}
function calAdvisorColor(r, colorMap) {
  const a = calAdvisor(r);
  return a ? (colorMap[a] || CAL_UNASSIGNED_COLOR) : CAL_UNASSIGNED_COLOR;
}

const CalAdvisorChip = ({ name, color }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: FONT_BODY, fontSize: 11, fontWeight: "bold", color, border: `1px solid ${color}`, borderRadius: 999, padding: "2px 10px" }}>
    <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
    {name}
  </span>
);

function calGetIssues(r) {
  const issues = [];
  if (r.isMember) return issues;
  if (r.stage !== "Canceled" && !r.coveredBy) issues.push({ label: "No advisor / 'Covered By' assigned", level: "red" });
  // Email check runs regardless of stage (including Canceled) — a canceled visit is
  // still a prospect worth following up with, so a missing email is still an open item.
  if (!r.email) issues.push({ label: "No email captured", level: "amber" });
  return issues;
}
function calSeverity(issues) {
  if (issues.some(i => i.level === "red")) return "red";
  if (issues.some(i => i.level === "amber")) return "amber";
  return "green";
}

const CalDot = ({ level }) => {
  const color = level === "red" ? C.red : level === "amber" ? C.amber : C.green;
  return <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, marginRight: 7, flexShrink: 0 }} />;
};

const CalStagePill = ({ stage }) => {
  const color = stage === "Arrived On Property" ? C.green : stage === "Canceled" ? C.red : C.slate;
  return (
    <span style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: "bold", color: "#fff", background: color, borderRadius: 999, padding: "3px 10px" }}>
      {stage}
    </span>
  );
};

// Writes a visit's details as short sentences for the calendar pop-up, in
// this order: dates + who covers it, then lead source / lifecycle / status,
// and the email last. Any field that's empty in the sheet is simply left out.
function calJoinList(parts) {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}
function calNarrative(r) {
  const sentences = [];
  const dayVisit = calSameDay(r.arrival, r.departure);
  const a = calFmt(r.arrival), d = calFmt(r.departure);
  const covered = r.coveredBy ? `, covered by ${r.coveredBy}` : "";
  if (r.stage === "Canceled") {
    sentences.push(`${dayVisit ? `Visit planned for ${a}` : `Visit planned for ${a} to ${d}`} was cancelled${covered}.`);
  } else if (dayVisit) {
    sentences.push(`${r.arrival > CAL_TODAY ? "Day visit planned for" : "Day visit on"} ${a}${covered}.`);
  } else {
    const arr = r.arrival > CAL_TODAY ? "Arrives" : "Arrived";
    const dep = r.departure >= CAL_TODAY ? "departs" : "departed";
    sentences.push(`${arr} ${a} and ${dep} ${d}${covered}.`);
  }
  const lead = [];
  if (r.source) lead.push(`the lead source is ${r.source}${r.referral ? ` (referred by ${r.referral})` : ""}`);
  else if (r.referral) lead.push(`the lead was referred by ${r.referral}`);
  if (r.lifecycle) lead.push(`the lifecycle stage is ${r.lifecycle}`);
  if (r.leadStatus) lead.push(`the lead status is ${r.leadStatus}`);
  if (lead.length) {
    const t = calJoinList(lead);
    sentences.push(`${t.charAt(0).toUpperCase()}${t.slice(1)}.`);
  }
  if (r.email) {
    const e = String(r.email).trim();
    sentences.push(/^on file$/i.test(e) ? "Email is on file." : `Email: ${e}`);
  }
  return sentences.join(" ");
}

const CalendarRecordCard = ({ r, showIssues, advisorColors = CAL_ADVISOR_COLORS }) => {
  const [open, setOpen] = useState(false);
  const issues = calGetIssues(r);
  const advisor = calAdvisor(r);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <CalAdvisorChip name={advisor || CAL_UNASSIGNED_LABEL} color={calAdvisorColor(r, advisorColors)} />
        <CalStagePill stage={r.stage} />
      </div>

      {/* Visit summary written as sentences (dates → source → email). */}
      <div style={{ fontSize: 13.5, color: C.gray, lineHeight: 1.6, marginBottom: 10, fontFamily: FONT_BODY }}>
        {calNarrative(r)}
      </div>

      {/* Only real open items are listed — nothing is shown when there are none. */}
      {showIssues && issues.length > 0 && (
        <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 5 }}>
          {issues.map((iss, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", fontSize: 13, color: C.gray, fontFamily: FONT_BODY }}>
              <CalDot level={iss.level} /> {iss.label}
            </div>
          ))}
        </div>
      )}

      {r.guests && (
        <div style={{ marginBottom: 8 }}>
          <span onClick={() => setOpen(!open)} style={{ fontSize: 11, color: C.teal, cursor: "pointer", fontFamily: FONT_BODY, fontWeight: "bold" }}>
            {open ? "▲ hide guests" : "▼ view guests"}
          </span>
          {open && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: "0.5px solid rgba(54,67,74,0.12)", fontSize: 13, color: C.gray, fontFamily: FONT_BODY }}>
              {r.guests}
            </div>
          )}
        </div>
      )}

      {r.chargeNote && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "0.5px solid rgba(54,67,74,0.12)" }}>
          <div style={{ fontSize: 10, fontWeight: "bold", color: "rgba(54,67,74,0.55)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, fontFamily: FONT_BODY }}>
            Charge Notes
          </div>
          <div style={{ fontSize: 13, color: C.gray, lineHeight: 1.5, fontFamily: FONT_BODY }}>{r.chargeNote}</div>
        </div>
      )}

      {r.notes && r.notes.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "0.5px solid rgba(54,67,74,0.12)" }}>
          <div style={{ fontSize: 10, fontWeight: "bold", color: "rgba(54,67,74,0.55)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, fontFamily: FONT_BODY }}>
            Notes
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {r.notes.map((n, i) => (
              <div key={i} style={{ fontSize: 13, color: C.gray, lineHeight: 1.5, fontFamily: FONT_BODY, whiteSpace: "pre-line" }}>
                {n.date && <span style={{ fontWeight: "bold", color: "rgba(54,67,74,0.55)" }}>Note added {n.date}: </span>}
                {n.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  const prevMonthDays = new Date(year, month, 0).getDate();
  for (let i = startWeekday - 1; i >= 0; i--) {
    cells.push({ date: new Date(year, month - 1, prevMonthDays - i), outside: true });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ date: new Date(year, month, day), outside: false });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    const next = new Date(last);
    next.setDate(next.getDate() + 1);
    cells.push({ date: next, outside: true });
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// Months the slider can page through. Add another { year, month, label } entry
// here when January 2027 opens up — nothing else needs to change.
const CAL_MONTHS = [
  { year: 2026, month: 7, label: "August 2026" },
  { year: 2026, month: 8, label: "September 2026" },
  { year: 2026, month: 9, label: "October 2026" },
  { year: 2026, month: 10, label: "November 2026" },
  { year: 2026, month: 11, label: "December 2026" },
];

const CalendarView = ({ records }) => {
  const [selected, setSelected] = useState(null);
  // Advisor whose visit list is open (clicked in the color legend), or null.
  const [listAdvisor, setListAdvisor] = useState(null);
  // Open on the current month when it's in the slider, otherwise the latest month.
  const [monthIdx, setMonthIdx] = useState(() => {
    const i = CAL_MONTHS.findIndex(m => m.year === CAL_TODAY.getFullYear() && m.month === CAL_TODAY.getMonth());
    return i >= 0 ? i : CAL_MONTHS.length - 1;
  });
  const { year, month, label } = CAL_MONTHS[monthIdx];
  const weeks = buildMonthGrid(year, month);
  const weekdayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Does this month have any events at all? (used for the empty state)
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const monthHasEvents = records.some(r => r.arrival <= monthEnd && r.departure >= monthStart);

  // Advisor → color for everyone on the calendar; the legend lists each advisor
  // who has at least one visit, plus "Unassigned".
  const advisorColors = calBuildAdvisorColors(records);
  const advisorsInUse = new Set(records.map(calAdvisor).filter(Boolean));
  const legendAdvisors = Object.keys(advisorColors).filter(a => advisorsInUse.has(a));

  const atFirst = monthIdx === 0;
  const atLast = monthIdx === CAL_MONTHS.length - 1;
  const arrowBtn = disabled => ({
    width: 30, height: 30, borderRadius: "50%", border: `0.5px solid rgba(54,67,74,${disabled ? 0.08 : 0.2})`,
    background: C.white, color: disabled ? "rgba(54,67,74,0.25)" : C.gray,
    cursor: disabled ? "default" : "pointer", fontSize: 15, fontFamily: FONT_BODY,
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  });

  return (
    <div>
      {/* Legend */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        {[...legendAdvisors, CAL_UNASSIGNED_LABEL].map(a => (
          <button
            key={a}
            onClick={() => setListAdvisor(a)}
            title={`See all of ${a === CAL_UNASSIGNED_LABEL ? "the unassigned" : `${a}'s`} visits`}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.gray, fontFamily: FONT_BODY, background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 3, background: advisorColors[a] || CAL_UNASSIGNED_COLOR, display: "inline-block" }} />
            <span style={{ borderBottom: "1px dotted rgba(54,67,74,0.45)" }}>{a}</span>
          </button>
        ))}
        <div style={{ fontSize: 11, color: "rgba(54,67,74,0.64)", fontFamily: FONT_BODY }}>
          <span style={{ textDecoration: "line-through" }}>Name</span> = Cancelled
        </div>
      </div>

      {/* Fluid grid — no horizontal scroll, no fixed min-width. Columns shrink
          naturally on narrow screens; event-bar text truncates with ellipsis. */}
      <div style={{ background: C.white, borderRadius: 8, border: "0.5px solid rgba(54,67,74,0.12)", overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "0.5px solid rgba(54,67,74,0.1)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button
            aria-label="Previous month"
            disabled={atFirst}
            onClick={() => setMonthIdx(i => Math.max(0, i - 1))}
            style={arrowBtn(atFirst)}
          >
            ‹
          </button>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, color: C.gray, fontStyle: "italic" }}>{label}</div>
          <button
            aria-label="Next month"
            disabled={atLast}
            onClick={() => setMonthIdx(i => Math.min(CAL_MONTHS.length - 1, i + 1))}
            style={arrowBtn(atLast)}
          >
            ›
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
          {weekdayLabels.map(wd => (
            <div key={wd} style={{ fontSize: 10, fontWeight: "bold", color: "rgba(54,67,74,0.64)", textAlign: "center", padding: "8px 0", borderBottom: "0.5px solid rgba(54,67,74,0.1)", textTransform: "uppercase", fontFamily: FONT_BODY }}>
              {wd.slice(0, 3)}
            </div>
          ))}
        </div>

        {weeks.map((week, wi) => {
          const weekEvents = records
            .map(r => {
              let startIdx = -1, endIdx = -1;
              week.forEach((c, idx) => {
                if (calInRange(c.date, r.arrival, r.departure)) {
                  if (startIdx === -1) startIdx = idx;
                  endIdx = idx;
                }
              });
              return { r, startIdx, endIdx };
            })
            .filter(x => x.startIdx !== -1);

          return (
            <div key={wi} style={{ position: "relative", borderBottom: "0.5px solid rgba(54,67,74,0.1)", minHeight: 88 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
                {week.map((cell, ci) => {
                  const isToday = calSameDay(cell.date, CAL_TODAY);
                  return (
                    <div key={ci} style={{ borderRight: ci < 6 ? "0.5px solid rgba(54,67,74,0.08)" : "none", padding: "5px 3px 3px 3px", background: cell.outside ? "#FAFAF7" : C.white }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, fontWeight: isToday ? "bold" : "normal",
                        color: cell.outside ? "rgba(54,67,74,0.3)" : isToday ? "#fff" : C.gray,
                        background: isToday ? C.teal : "transparent", fontFamily: FONT_BODY,
                      }}>
                        {cell.date.getDate()}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "6px 0" }}>
                {weekEvents.map(({ r, startIdx, endIdx }) => {
                  const advisor = calAdvisor(r) || CAL_UNASSIGNED_LABEL;
                  const isCanceled = r.stage === "Canceled";
                  return (
                    <div key={r.name} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
                      <div
                        onClick={() => setSelected(r)}
                        title={`${r.name} — ${advisor}${isCanceled ? " (Cancelled)" : ""}`}
                        style={{
                          gridColumn: `${startIdx + 1} / span ${endIdx - startIdx + 1}`,
                          background: calAdvisorColor(r, advisorColors), color: "#fff", fontSize: 11, fontWeight: "bold",
                          textDecoration: isCanceled ? "line-through" : "none",
                          padding: "6px 5px", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          fontFamily: FONT_BODY,
                        }}
                      >
                        {r.name}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {!monthHasEvents && (
          <div style={{ padding: "16px 18px", fontSize: 13, color: "rgba(54,67,74,0.64)", fontFamily: FONT_BODY, fontStyle: "italic", borderTop: "0.5px solid rgba(54,67,74,0.1)" }}>
            No tours scheduled yet for {label}.
          </div>
        )}
      </div>

      {/* Advisor visit list — opens from the legend, newest visit first.
          Clicking a visit opens its card on top; closing the card returns here. */}
      {listAdvisor && (() => {
        const color = advisorColors[listAdvisor] || CAL_UNASSIGNED_COLOR;
        const visits = records
          .filter(r => (calAdvisor(r) || CAL_UNASSIGNED_LABEL) === listAdvisor)
          .sort((x, y) => y.arrival - x.arrival || y.departure - x.departure);
        const fmtY = dt => dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        return (
          <Modal
            title={listAdvisor === CAL_UNASSIGNED_LABEL ? "Unassigned visits" : `${listAdvisor} · Visits`}
            subtitle={`${visits.length} visit${visits.length === 1 ? "" : "s"} · newest first`}
            onClose={() => setListAdvisor(null)}
          >
            {visits.length === 0 ? (
              <div style={{ fontSize: 13, color: "rgba(54,67,74,0.64)", padding: "1rem 0", fontFamily: FONT_BODY }}>No visits on the calendar.</div>
            ) : visits.map((r, i) => {
              const isCanceled = r.stage === "Canceled";
              const dayVisit = calSameDay(r.arrival, r.departure);
              return (
                <div
                  key={`${r.name}-${i}`}
                  role="button" tabIndex={0}
                  onClick={() => setSelected(r)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(r); } }}
                  style={{ ...ROW_STYLE, padding: "12px 0", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: "bold", letterSpacing: "0.07em", textTransform: "uppercase", color, fontFamily: FONT_BODY, textDecoration: isCanceled ? "line-through" : "none" }}>
                      {r.name}
                    </div>
                    <div style={{ fontSize: 12.5, color: "rgba(54,67,74,0.85)", marginTop: 3, fontFamily: FONT_BODY }}>
                      {dayVisit ? `${fmtY(r.arrival)} · Day visit` : `${calFmt(r.arrival)} – ${fmtY(r.departure)}`}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <CalStagePill stage={r.stage} />
                    <span style={{ fontSize: 20, color: "rgba(54,67,74,0.3)", lineHeight: 1 }}>›</span>
                  </div>
                </div>
              );
            })}
          </Modal>
        );
      })()}

      {selected && (
        <Modal title={selected.name} onClose={() => setSelected(null)}>
          <CalendarRecordCard r={selected} showIssues={true} advisorColors={advisorColors} />
        </Modal>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════
// ── PERIODS: LAST 60 DAYS + THIS MONTH ──────────────────────────────
// Replaces the old Last Week / This Week tabs. Everything is counted by
// date, straight from the sheet:
//   Funnel_Contacts — Create Date                → New Leads (HubSpot baseline)
//                     HubSpot Tour Date          → Tours (once the date has passed)
//   Master_Leads    — Create Date                → New Leads added since the baseline
//   Master_Deals    — Create Date                → New Inventory on Hold
//                     OTP Sent Date              → New Pending OTPs
//                     OTP Signed Date            → New Signed OTPs
//                     PSA Date Signed            → New Signed Deals (PSAs)
//                     Lost Date                  → Lost Deals
//   Prospect_Calendar — Tour Date (not Canceled) → Tours & Visits
// The masters only hold complete OTP / lost-deal dates from the "Masters
// complete from" date in Report_Settings (Sep 7, 2026). For days before it,
// New Pending OTPs, New Signed OTPs and Lost Deals use the weekly counts in
// Weekly_KPIs_Archive.
//
// Last 60 days = rolling window ending today, compared with the 60 days
// before it. This month = the 1st through today, compared with the same
// days of the previous month.
// ══════════════════════════════════════════════════════════════════════

const REFRESH_MS = 15 * 60 * 1000;             // re-pull the sheet every 15 min while open
const REFRESH_ON_FOCUS_MIN_MS = 5 * 60 * 1000; // …and on returning to the page, if older than 5 min

const WINDOW_DAYS = 60;                               // length of the "last 60 days" window
const MASTERS_COMPLETE_FALLBACK = new Date(2026, 8, 7); // used if Report_Settings can't be read
const DAY_MS = 24 * 60 * 60 * 1000;

// Lead Status values that mean a prospect is Lost. A toured prospect with one
// of these (or a Lost Date in Prospect_Calendar) leaves the Toured Prospects
// stage as Lost. Edit this list to match how sales marks a lost prospect.
const LOST_LEAD_STATUSES = ["Not Interested", "Unqualified", "Unsubscribed"];
// Contact Types that are never counted as toured prospects.
const NOT_A_PROSPECT_TYPES = ["Owner", "Founder", "Connector", "Internal"];

// Lead groups. `match` holds the HubSpot Lead Source values (lower case);
// `sources` is what is printed in parentheses under the group name.
const LEAD_GROUPS = [
  { key: "relationship", label: "Relationship leads", color: C.gray,
    sources: ["Internal", "Member Referral", "Personal Referral", "Local Broker"],
    match: ["internal", "member referral", "referral", "personal referral", "local broker"] },
  { key: "marketing", label: "Marketing leads", color: C.teal,
    sources: ["Nauka Homepage", "Siari Website", "Organic Search", "Instagram", "Press"],
    match: ["nauka homepage", "siari website", "organic search", "instagram", "media/press", "press"] },
  { key: "hotel", label: "Hotel guests", color: C.amber,
    sources: ["Siari Hotel Guest"],
    match: ["siari hotel guest"] },
];
function leadGroupKey(source) {
  const s = String(source ?? "").trim().toLowerCase();
  const g = LEAD_GROUPS.find(x => x.match.includes(s));
  return g ? g.key : "none";
}

// Accepts the sheet's formatted dates ("9/21/2026"), ISO ("2026-09-21")
// or text ("Sep 21, 2026"). Returns a local-midnight Date or null.
function twParseDate(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return new Date(y, +m[1] - 1, +m[2]); }
  let d = new Date(s);
  if (isNaN(d) && !/\d{4}/.test(s)) d = new Date(`${s}, ${new Date().getFullYear()}`);
  return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function twAmount(v) {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

// Monday 00:00 of the week containing `ref`.
function twWeekStart(ref) {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

const pdDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const pdAdd = (d, n) => { const x = pdDay(d); x.setDate(x.getDate() + n); return x; };
const pdDiff = (a, b) => Math.round((pdDay(b) - pdDay(a)) / DAY_MS);
const pdStr = v => String(v ?? "").trim();
const pdId = v => pdStr(v).replace(/\.0+$/, "");

// Turns the sheet tabs into dated entries (one per lead, tour and deal
// milestone) plus a map of people used for the Toured Prospects stage.
function buildEntries(masterLeads, masterDeals, calendarRecords, funnelContacts, today) {
  const out = [];
  const people = new Map(); // key (Record ID, or name when there is none) → person

  // Leads: the HubSpot baseline, then Master_Leads on top (richer detail, and
  // the leads created after the baseline). Matched by Record ID, never by name.
  const leadById = new Map();
  const leadNoId = [];
  (funnelContacts || []).forEach(r => {
    const name = pdStr(r["Name"]);
    const date = twParseDate(r["Create Date"]);
    if (!name || !date) return;
    const rid = pdId(r["Record ID"]);
    const status = pdStr(r["Current Lead Status"]) || pdStr(r["Lead Status (HubSpot)"]);
    const e = {
      date, type: "lead", name, details: status, amount: 0,
      advisor: pdStr(r["Advisor"]) || pdStr(r["Contact Owner"]),
      source: pdStr(r["Source"]), src: pdStr(r["Source"]), rid,
    };
    if (rid) leadById.set(rid, e); else leadNoId.push(e);
    const tourDate = twParseDate(r["HubSpot Tour Date"]);
    if (rid) people.set(rid, {
      key: rid, rid, name, src: e.src, advisor: e.advisor, status,
      contactType: pdStr(r["Contact Type"]),
      lifecycle: pdStr(r["Lifecycle Stage"]), // optional column in Funnel_Contacts
      hubspotTour: tourDate && tourDate <= today ? tourDate : null,
      tourDate: tourDate && tourDate <= today ? tourDate : null,
      psa: ["1", "yes", "true"].includes(pdStr(r["PSA"]).toLowerCase()) || pdStr(r["HubSpot PSA"]).toLowerCase() === "yes",
      lostDate: null, lossReason: "", notes: [],
    });
  });
  (masterLeads || []).forEach(r => {
    const name = pdStr(r["Name"]);
    const date = twParseDate(r["Create Date"]);
    if (!name || !date) return;
    const rid = pdId(r["HubSpot Record ID"]);
    const prev = rid ? leadById.get(rid) : null;
    const e = {
      date, type: "lead", name,
      details: [pdStr(r["Lifecycle Stage"]), pdStr(r["Lead Status"]), pdStr(r["Notes"])].filter(Boolean).join(" · ") || (prev ? prev.details : ""),
      amount: 0,
      advisor: pdStr(r["Advisor"]) || (prev ? prev.advisor : ""),
      source: [pdStr(r["Lead Source"]), pdStr(r["Referral Source"]) ? `via ${pdStr(r["Referral Source"])}` : ""].filter(Boolean).join(" · "),
      src: pdStr(r["Lead Source"]) || (prev ? prev.src : ""), rid,
    };
    if (rid) leadById.set(rid, e); else leadNoId.push(e);
    if (rid) {
      const p = people.get(rid) || { key: rid, rid, name, contactType: "", hubspotTour: null, tourDate: null, psa: false, lostDate: null, lossReason: "", notes: [] };
      people.set(rid, {
        ...p, src: e.src || p.src, advisor: e.advisor || p.advisor,
        status: pdStr(r["Lead Status"]) || p.status || "",
        lifecycle: pdStr(r["Lifecycle Stage"]) || p.lifecycle || "",
        lossReason: pdStr(r["Loss Reason"]) || p.lossReason,
        lostDate: twParseDate(r["Lost Date"]) || p.lostDate,
      });
    }
  });
  leadById.forEach(e => out.push(e));
  leadNoId.forEach(e => out.push(e));

  // Tours: a visit counts once its meeting is logged (Tour Date in
  // Prospect_Calendar, not Canceled) — same rule as the sheet. Connectors are
  // reported as tours but are never prospects.
  const calTours = []; // [{ key, date }] to avoid counting the HubSpot date twice
  (calendarRecords || []).forEach(r => {
    if (!r.name) return;
    const rid = pdId(r.recordId);
    const key = rid || `name:${r.name}`;
    const isConnector = pdStr(r.contactType).toLowerCase() === "connector";
    // Lost Date / Loss Reason / Lead Status typed on the calendar row win over the baseline.
    if (!isConnector && (rid ? people.has(rid) : false)) {
      const p = people.get(rid);
      people.set(rid, { ...p, status: pdStr(r.leadStatus) || p.status, lifecycle: pdStr(r.lifecycle) || p.lifecycle, lostDate: r.lostDate || p.lostDate, lossReason: pdStr(r.lossReason) || p.lossReason });
    }
    if (!r.tourDate || r.stage === "Canceled") return;
    const d = pdDay(r.tourDate);
    const sameDay = r.arrival && r.departure ? calSameDay(r.arrival, r.departure) : true;
    calTours.push({ key, date: d });
    out.push({
      date: d, type: "tour", name: r.name,
      details: `${sameDay || !r.arrival ? "Day visit" : `On property ${calFmt(r.arrival)} – ${calFmt(r.departure)}`} · ${r.stage}${isConnector ? " · Connector" : ""}`,
      amount: 0,
      advisor: r.coveredBy || r.owner || "",
      source: [r.source, r.referral ? `via ${r.referral}` : null].filter(Boolean).join(" · "),
      src: pdStr(r.source), rid, connector: isConnector,
      notes: r.notes || [],
    });
    if (isConnector || d > today) return;
    const p = people.get(key) || { key, rid, name: r.name, contactType: pdStr(r.contactType), hubspotTour: null, tourDate: null, psa: false, status: "", lostDate: null, lossReason: "", src: "", advisor: "" };
    people.set(key, {
      ...p,
      src: p.src || pdStr(r.source), advisor: r.coveredBy || r.owner || p.advisor,
      status: pdStr(r.leadStatus) || p.status,
      lifecycle: pdStr(r.lifecycle) || p.lifecycle || "",
      tourDate: !p.tourDate || d > p.tourDate ? d : p.tourDate,
      lostDate: r.lostDate || p.lostDate, lossReason: pdStr(r.lossReason) || p.lossReason,
      notes: r.notes || [],
    });
  });
  // HubSpot tour dates from the baseline, unless the calendar already has that visit.
  people.forEach(p => {
    if (!p.hubspotTour) return;
    const dup = calTours.some(t => t.key === p.key && Math.abs(pdDiff(t.date, p.hubspotTour)) <= 7);
    if (dup) return;
    out.push({
      date: p.hubspotTour, type: "tour", name: p.name,
      details: ["Prospect visit logged in HubSpot", p.status].filter(Boolean).join(" · "),
      amount: 0, advisor: p.advisor || "", source: p.src || "", src: p.src || "", rid: p.rid,
      connector: false, notes: [],
    });
  });

  // Deals: one entry per milestone date, so a deal put on hold Monday and
  // sent an OTP Thursday shows up under both.
  const milestones = [
    ["Create Date", "hold"], ["OTP Sent Date", "potp"], ["OTP Signed Date", "sotp"],
    ["PSA Date Signed", "psa"], ["Lost Date", "lost"],
  ];
  const dealRids = new Set();
  (masterDeals || []).forEach(r => {
    const name = pdStr(r["Deal Name"]);
    if (!name) return;
    const rid = pdId(r["Buyer HubSpot Record ID"]);
    if (rid) dealRids.add(rid);
    milestones.forEach(([field, type]) => {
      const date = twParseDate(r[field]);
      if (!date) return;
      out.push({
        date, type, name,
        details: type === "lost"
          ? [pdStr(r["Loss Reason"]), pdStr(r["Notes"])].filter(Boolean).join(" — ")
          : pdStr(r["Notes"]),
        amount: twAmount(r["Amount ($)"]),
        advisor: pdStr(r["Advisor"]),
        source: [pdStr(r["Source"]), pdStr(r["Referral Source"]) ? `via ${pdStr(r["Referral Source"])}` : ""].filter(Boolean).join(" · "),
        src: pdStr(r["Source"]), rid, reason: pdStr(r["Loss Reason"]),
        stage: pdStr(r["Stage"]) === "Decision" ? "Pending OTP" : pdStr(r["Stage"]), // where the deal is today
        daysOnHold: parseInt(pdStr(r["Days on Hold"]), 10), // from the sheet: hold date to PSA / lost date, or to today if still open
      });
    });
  });
  return { entries: out.map((e, i) => ({ ...e, i })), people, dealRids };
}

// Weekly counts typed by hand before the masters existed ("Aug 31 - Sep 6",
// "June 1-7", "May 25–31", "Jul 6-19"). Returns the label's start and end.
const PD_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parseWeekLabel(label, today) {
  const s = pdStr(label).replace(/[–—]/g, "-");
  const m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\s*-\s*(?:([A-Za-z]{3})[a-z]*\.?\s+)?(\d{1,2})/);
  if (!m) return null;
  const m1 = PD_MONTHS[m[1].toLowerCase()];
  const m2 = m[3] ? PD_MONTHS[m[3].toLowerCase()] : m1;
  if (m1 == null || m2 == null) return null;
  let y = today.getFullYear();
  let start = new Date(y, m1, +m[2]);
  if (start > today) { y -= 1; start = new Date(y, m1, +m[2]); }
  let end = new Date(y, m2, +m[4]);
  if (end < start) end = new Date(y + 1, m2, +m[4]);
  return { start, end };
}
const PD_WEEKLY_FIELDS = { potp: "New Pending OTPs", sotp: "New Signed OTPs", lost: "Lost Deals" };
function buildWeekly(kpis, archive, today) {
  const byStart = new Map();
  const add = r => {
    const range = twParseDate(r["Week Start"])
      ? { start: twParseDate(r["Week Start"]), end: pdAdd(twParseDate(r["Week Start"]), 6) }
      : parseWeekLabel(r["Week"], today);
    if (!range) return;
    const k = range.start.getTime();
    const w = byStart.get(k) || { start: range.start, end: range.end, vals: {} };
    Object.entries(PD_WEEKLY_FIELDS).forEach(([key, field]) => {
      const raw = pdStr(r[field]);
      const n = parseFloat(raw.replace(/,/g, ""));
      if (raw !== "" && !isNaN(n)) w.vals[key] = n;
    });
    byStart.set(k, w);
  };
  (archive || []).forEach(add);
  (kpis || []).forEach(add); // the calculated tab wins where both report a week
  return [...byStart.values()].map(w => ({ ...w, mid: pdAdd(w.start, Math.floor(pdDiff(w.start, w.end) / 2)) }));
}

// Everything the two period tabs and the pipeline's prospect stages need.
function buildModel({ masterLeads, masterDeals, calRecords, funnelContacts, kpis, kpiArchive, settings, now }) {
  const today = pdDay(now);
  const setting = name => (settings || []).find(r => pdStr(r["Setting"]).toLowerCase().startsWith(name));
  const mastersFrom = twParseDate((setting("masters complete from") || {})["Value"]) || MASTERS_COMPLETE_FALLBACK;
  const { entries, people, dealRids } = buildEntries(masterLeads, masterDeals, calRecords, funnelContacts, today);
  const weekly = buildWeekly(kpis, kpiArchive, today);

  // Types whose dates are only complete in the masters from `mastersFrom`.
  const ARCHIVED = ["potp", "sotp", "lost"];
  // Every dated row in the range. For the archived types, rows dated before
  // `mastersFrom` are shown as detail but the weekly count stays the reference
  // for that stretch (whichever is larger), so nothing is counted twice.
  const list = (type, a, b) => entries.filter(e => e.type === type && e.date >= a && e.date <= b);
  // Archived types before `mastersFrom`: a dated row in Master_Deals counts on its
  // own day. A weekly count only adds what the dated rows of that same week do
  // not already explain, and that remainder is placed by the week's midpoint.
  const countArchived = (type, a, b) => {
    const dated = entries.filter(e => e.type === type);
    let n = dated.filter(e => e.date >= mastersFrom && e.date >= a && e.date <= b).length;
    const early = dated.filter(e => e.date < mastersFrom);
    const used = new Set();
    weekly.forEach(w => {
      if (w.start >= mastersFrom || w.vals[type] == null) return;
      const inWeek = early.filter(e => e.date >= w.start && e.date <= w.end);
      inWeek.forEach(e => used.add(e.i));
      n += inWeek.filter(e => e.date >= a && e.date <= b).length;
      if (w.mid >= a && w.mid <= b) n += Math.max(w.vals[type] - inWeek.length, 0);
    });
    // Dated rows that fall in no reported week still count on their own day.
    return n + early.filter(e => !used.has(e.i) && e.date >= a && e.date <= b).length;
  };
  const count = (type, a, b) => !ARCHIVED.includes(type) ? list(type, a, b).length
    : countArchived(type, a, b);
  const amount = (type, a, b) => list(type, a, b).reduce((s, e) => s + e.amount, 0);
  // Day-level counts exist for [a, b] only if it starts on/after mastersFrom (or the type is always dated).
  const hasDailyData = (type, a) => !ARCHIVED.includes(type) || a >= mastersFrom;

  const win  = { start: pdAdd(today, -(WINDOW_DAYS - 1)), end: today };
  const prev = { start: pdAdd(win.start, -WINDOW_DAYS), end: pdAdd(win.start, -1) };
  // Monday-to-Sunday buckets across the window, clipped to it, for the small bars.
  const weeks = [];
  for (let ws = twWeekStart(win.start); ws <= today; ws = pdAdd(ws, 7)) {
    const a = ws < win.start ? win.start : ws;
    const b = pdAdd(ws, 6) > today ? today : pdAdd(ws, 6);
    weeks.push({ start: ws, a, b });
  }

  // Lead → tour: of the leads created in [a, b], how many had toured by b.
  const firstTour = new Map();
  entries.forEach(e => {
    if (e.type !== "tour" || !e.rid) return;
    if (!firstTour.has(e.rid) || e.date < firstTour.get(e.rid)) firstTour.set(e.rid, e.date);
  });
  const leadTourRate = (a, b) => {
    const leads = list("lead", a, b);
    const toured = leads.filter(e => e.rid && firstTour.has(e.rid) && firstTour.get(e.rid) <= b).length;
    return { leads: leads.length, toured, pct: leads.length ? (toured / leads.length) * 100 : null };
  };

  // This month: the 1st through today vs. the same days of last month.
  const mStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const mEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const pmStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const pmLast = new Date(today.getFullYear(), today.getMonth(), 0);
  const pmEnd = new Date(pmStart.getFullYear(), pmStart.getMonth(), Math.min(today.getDate(), pmLast.getDate()));
  const month = { start: mStart, end: mEnd, prevStart: pmStart, prevEnd: pmEnd };

  // ── Prospect stages (no deal yet, counts only) ──
  const lostStatuses = LOST_LEAD_STATUSES.map(s => s.toLowerCase());
  const skipTypes = NOT_A_PROSPECT_TYPES.map(s => s.toLowerCase());
  const toured = [...people.values()].filter(p => p.tourDate && !skipTypes.includes(pdStr(p.contactType).toLowerCase()));
  const hasDeal = p => (p.rid && dealRids.has(p.rid)) || p.psa || pdStr(p.status).toLowerCase() === "closed won";
  const isLost = p => !!p.lostDate || lostStatuses.includes(pdStr(p.status).toLowerCase()) || pdStr(p.contactType).toLowerCase() === "not interested";
  const byTourDesc = (a, b) => b.tourDate - a.tourDate;
  const open = toured.filter(p => !hasDeal(p) && !isLost(p)).sort(byTourDesc);
  const prospects = {
    active: open.filter(p => p.tourDate >= win.start),
    older: open.filter(p => p.tourDate < win.start),
    // Lost after the tour, in the window: by Lost Date when the sheet has one, else by the tour date.
    lost: toured.filter(p => !hasDeal(p) && isLost(p) && (p.lostDate || p.tourDate) >= win.start && (p.lostDate || p.tourDate) <= today).sort(byTourDesc),
    // Moved to Pending OTP: inventory assigned (deal created) in the window.
    toDeal: list("hold", win.start, today).sort((a, b) => b.date - a.date),
  };
  // Days since the prospect visit, for the ones that have not moved to Pending OTP.
  const daysOpen = p => pdDiff(p.tourDate, today);
  const avgOf = arr => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null;
  const medianOf = arr => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2);
    return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
  };
  // Benchmark from past buyers: days from their first prospect visit to the day
  // inventory was assigned (deal Create Date). Only deals whose buyer has a visit
  // date on or before the deal date can be measured; one per buyer and deal date.
  const visitToDeal = [];
  const seenDeal = new Set();
  (masterDeals || []).forEach(r => {
    const rid = pdId(r["Buyer HubSpot Record ID"]);
    const created = twParseDate(r["Create Date"]);
    const first = rid ? firstTour.get(rid) : null;
    if (!created || !first || first > created) return;
    const k = `${rid}|${created.getTime()}`;
    if (seenDeal.has(k)) return;
    seenDeal.add(k);
    visitToDeal.push(pdDiff(first, created));
  });
  const aging = {
    active: avgOf(prospects.active.map(daysOpen)),
    older: avgOf(prospects.older.map(daysOpen)),
    buyersAvg: avgOf(visitToDeal), buyersMedian: medianOf(visitToDeal), buyersN: visitToDeal.length,
  };

  const visits = (calRecords || [])
    .filter(r => r.name && r.stage === "Scheduled" && r.arrival && r.arrival >= today && pdStr(r.contactType).toLowerCase() !== "connector")
    .sort((a, b) => a.arrival - b.arrival);
  const ddThisMonth = (masterDeals || [])
    .map(r => ({ name: pdStr(r["Deal Name"]), stage: pdStr(r["Stage"]), date: twParseDate(r["DD Expiry"]), amount: twAmount(r["Amount ($)"]), advisor: pdStr(r["Advisor"]) }))
    .filter(d => d.name && d.date && ["Pending OTP", "Signed OTP", "Decision"].includes(d.stage) && d.date >= today && d.date <= mEnd)
    .sort((a, b) => a.date - b.date);

  return { today, entries, list, count, amount, hasDailyData, win, prev, weeks, month, mastersFrom, leadTourRate, prospects, visits, ddThisMonth, aging, daysOpen };
}

const PD_DEAL_STATS = [
  { key: "potp", label: "New Pending OTPs", money: true },
  { key: "sotp", label: "New Signed OTPs",  money: true },
  { key: "psa",  label: "New Signed Deals", sub: "PSAs", money: true },
];
const PD_ACTIVITY_STATS = [
  { key: "lead", label: "New Leads" },
  { key: "tour", label: "Prospect Visits" },
  { key: "hold", label: "New Inventory on Hold" },
  { key: "lost", label: "Lost Deals", money: true, danger: true },
];

const twDayFmt = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
function twRangeLabel(start, end) {
  return start.getMonth() === end.getMonth()
    ? `${twDayFmt(start)} – ${end.getDate()}, ${end.getFullYear()}`
    : `${twDayFmt(start)} – ${twDayFmt(end)}, ${end.getFullYear()}`;
}
// "Oct 1–2" / "Aug 4 – Oct 2" (no year), for comparison labels.
function pdShortRange(start, end) {
  if (calSameDay(start, end)) return twDayFmt(start);
  return start.getMonth() === end.getMonth() ? `${twDayFmt(start)}–${end.getDate()}` : `${twDayFmt(start)} – ${twDayFmt(end)}`;
}

const PD_MUTED = "rgba(54,67,74,0.55)";
const PdSectionHead = ({ text, right, first }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, padding: first ? "0 0 10px" : "26px 0 10px", borderBottom: `1.5px solid ${C.gray}` }}>
    <span style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: "bold", color: PD_MUTED, fontFamily: FONT_BODY }}>{text}</span>
    {right && <span style={{ fontSize: 11, color: PD_MUTED, fontFamily: FONT_BODY, textAlign: "right" }}>{right}</span>}
  </div>
);

// ▲ +9 / ▼ −5 / No change, coloured by whether the move is good news.
const PdDelta = ({ cur, prev, goodWhenUp = true, unit = "", note }) => {
  const diff = Math.round((cur - prev) * 10) / 10;
  const good = diff === 0 ? null : (diff > 0) === goodWhenUp;
  const color = good == null ? "rgba(54,67,74,0.65)" : good ? C.green : C.red;
  const bg = good == null ? "rgba(54,67,74,0.07)" : good ? "rgba(29,158,117,0.12)" : "rgba(192,102,90,0.12)";
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", fontFamily: FONT_BODY }}>
      <span style={{ fontSize: 11.5, fontWeight: "bold", color, background: bg, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
        {diff === 0 ? "No change" : `${diff > 0 ? "▲ +" : "▼ −"}${Math.abs(diff)}${unit}`}
      </span>
      {note && <span style={{ fontSize: 11.5, color: PD_MUTED }}>{note}</span>}
    </span>
  );
};

// One small bar per week inside the window; the current week is darker.
const PdWeekBars = ({ values, weeks }) => {
  const max = Math.max(...values, 1);
  return (
    <div style={{ maxWidth: 260, marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 34, borderBottom: "1px solid rgba(54,67,74,0.18)" }} aria-hidden="true">
        {values.map((v, i) => (
          <div key={i} title={`Week of ${twDayFmt(weeks[i].start)}: ${v}`}
            style={{ flex: 1, height: `${Math.max((v / max) * 100, v > 0 ? 8 : 0)}%`, minHeight: 2, background: i === values.length - 1 ? C.gray : C.teal, opacity: v === 0 ? 0.35 : 1, borderRadius: "2px 2px 0 0" }} />
        ))}
      </div>
      {/* Says what the bars are: one per week, oldest on the left, this week on the right */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 6, marginTop: 3, fontSize: 10.5, color: "rgba(54,67,74,0.6)", fontFamily: FONT_BODY, whiteSpace: "nowrap" }}>
        <span>Week of {twDayFmt(weeks[0].start)}</span>
        <span>By week</span>
        <span>This week</span>
      </div>
    </div>
  );
};

// This period vs. the comparison period, as two bars on one scale.
const PdPairBars = ({ curLabel, cur, prevLabel, prev, prevNote }) => {
  const max = Math.max(cur, prev || 0, 1);
  const line = (label, v, color, note) => (
    <div style={{ display: "grid", gridTemplateColumns: "74px 1fr", gap: 8, alignItems: "center", fontSize: 11.5, color: "rgba(54,67,74,0.7)", fontFamily: FONT_BODY }}>
      <span style={{ whiteSpace: "nowrap" }}>{label}</span>
      {note ? <span style={{ fontStyle: "italic", color: PD_MUTED }}>{note}</span> : (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ height: 9, width: `${(v / max) * 100}%`, minWidth: 2, maxWidth: "calc(100% - 28px)", background: color, borderRadius: 5 }} />
          <span style={{ fontWeight: "bold" }}>{v}</span>
        </div>
      )}
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8, maxWidth: 320 }}>
      {line(curLabel, cur, C.teal)}
      {line(prevLabel, prev, "#C9C4B4", prevNote)}
    </div>
  );
};

// A tappable metric row: label + comparison on the left, count (and $) on the right.
const PdRow = ({ stat, n, total, first, onOpen, children }) => {
  const zero = n === 0;
  const isLost = stat.danger && !zero;
  return (
    <div
      role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={e => { if (onOpen && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } }}
      style={{ cursor: onOpen ? "pointer" : "default", outline: "none", display: "flex", alignItems: "center", gap: 14, padding: "16px 0", borderTop: first ? "none" : "1px solid rgba(54,67,74,0.12)" }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: "bold", color: isLost ? C.red : C.gray, fontFamily: FONT_BODY }}>
          {stat.label}{stat.sub && <span style={{ fontWeight: "normal" }}> ({stat.sub})</span>}
        </div>
        {children}
      </div>
      <div style={{ textAlign: "right", opacity: zero ? 0.5 : 1 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: zero ? 28 : 40, lineHeight: 1, color: isLost ? C.red : C.gray }}>{stat.display ?? n}</div>
        {total > 0 && stat.money && (
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: "bold", color: isLost ? C.red : C.teal, marginTop: 2 }}>{money(total)}</div>
        )}
      </div>
      <span style={{ fontSize: 22, color: onOpen ? "rgba(54,67,74,0.3)" : "transparent", lineHeight: 1, marginLeft: -4 }}>›</span>
    </div>
  );
};

// A single logged update inside the pop-up list.
const TWEntryRow = ({ e, showDate }) => {
  const isDeal = ["hold", "potp", "sotp", "psa", "lost"].includes(e.type);
  const { property, buyer } = isDeal ? splitDealName(e.name) : { property: e.name, buyer: null };
  const color = e.type === "lost" ? C.red : e.type === "hold" ? C.amber : C.teal;
  return (
    <div style={ROW_STYLE}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <Eyebrow color={color}>{property}</Eyebrow>
          {buyer && <Subhead>{buyer}</Subhead>}
        </div>
        <div style={{ textAlign: "right" }}>
          {e.amount > 0 && <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, color: C.gray, whiteSpace: "nowrap" }}>{money(e.amount)}</div>}
          {showDate && <div style={{ fontSize: 11.5, color: "rgba(54,67,74,0.72)", fontFamily: FONT_BODY, whiteSpace: "nowrap" }}>{twDayFmt(e.date)}</div>}
        </div>
      </div>
      {isDeal && e.stage && (
        <div style={{ marginTop: 8, marginBottom: 6 }}>
          <span style={{ display: "inline-block", fontSize: 11, fontWeight: "bold", fontFamily: FONT_BODY, borderRadius: 999, padding: "2px 10px",
            color: e.stage === "Lost" ? C.red : C.gray, background: e.stage === "Lost" ? "rgba(192,102,90,0.12)" : "rgba(136,209,209,0.4)" }}>
            Current stage: {e.stage}
          </span>
        </div>
      )}
      {(e.advisor || e.source || e.daysOnHold >= 0) && (
        <RowMeta>{[e.advisor, e.source, e.daysOnHold >= 0 ? `${e.daysOnHold} day${e.daysOnHold === 1 ? "" : "s"} on hold` : null].filter(Boolean).join(" · ")}</RowMeta>
      )}
      {e.details && <RowNotes preLine>{e.details}</RowNotes>}
      {e.notes && e.notes.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, fontWeight: "bold", color: PD_MUTED, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, fontFamily: FONT_BODY }}>
            Notes
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {e.notes.map((n, i) => (
              <div key={i} style={{ fontSize: 12.5, color: "rgba(54,67,74,0.85)", lineHeight: 1.55, fontFamily: FONT_BODY, whiteSpace: "pre-line" }}>
                {n.date && <span style={{ fontWeight: "bold", color: PD_MUTED }}>{n.date}: </span>}
                {n.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Long lists open with the most recent five; the rest sit behind a toggle.
const PdShowMore = ({ items, render, empty, limit = 5 }) => {
  const [all, setAll] = useState(false);
  if (!items.length) return <div style={{ fontSize: 13, color: "rgba(54,67,74,0.64)", padding: "1rem 0", fontFamily: FONT_BODY }}>{empty}</div>;
  const shown = all ? items : items.slice(0, limit);
  return (
    <>
      {shown.map(render)}
      {items.length > limit && (
        <button onClick={() => setAll(v => !v)}
          style={{ display: "block", width: "100%", marginTop: 12, padding: "10px 12px", background: "transparent", border: `1px solid rgba(54,67,74,0.25)`, borderRadius: 8, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 13, fontWeight: "bold", color: C.gray }}>
          {all ? "Show the most recent 5" : `Show all ${items.length}`}
        </button>
      )}
    </>
  );
};

const PdNote = ({ children }) => (
  <div style={{ fontSize: 11.5, color: PD_MUTED, fontFamily: FONT_BODY, marginTop: 14, lineHeight: 1.5 }}>{children}</div>
);

// A toured prospect / scheduled visit inside a pop-up list.
const ProspectRow = ({ p, right, sub }) => (
  <div style={ROW_STYLE}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
      <Eyebrow>{p.name}</Eyebrow>
      {right && <span style={{ fontSize: 11.5, color: "rgba(54,67,74,0.72)", fontFamily: FONT_BODY, whiteSpace: "nowrap" }}>{right}</span>}
    </div>
    {sub && <Subhead>{sub}</Subhead>}
    {(p.advisor || p.src) && <RowMeta>{[p.advisor, p.src].filter(Boolean).join(" · ")}</RowMeta>}
  </div>
);

// ── LAST 60 DAYS ─────────────────────────────────────────────────────
const SixtyDayView = ({ model, onGo }) => {
  const [openKey, setOpenKey] = useState(null);
  const [showDeals, setShowDeals] = useState(false);
  const { win, prev, weeks, count, amount, list, today, prospects, visits, month } = model;
  const allStats = [...PD_DEAL_STATS, ...PD_ACTIVITY_STATS];
  const open = allStats.find(s => s.key === openKey);

  const cur = k => count(k, win.start, win.end);
  const old = k => count(k, prev.start, prev.end);
  const bars = k => weeks.map(w => count(k, w.a, w.b));
  const rateNow = model.leadTourRate(win.start, win.end);
  const rateOld = model.leadTourRate(prev.start, prev.end);
  // Pipeline updates: every change of stage after the prospect visit, wins and losses alike.
  const updates = cur("hold") + cur("potp") + cur("sotp") + cur("psa") + cur("lost");
  const visitsThisMonth = visits.filter(v => v.arrival <= month.end).length;

  const row = (s, i) => {
    const n = cur(s.key), p = old(s.key);
    // Show a $ total only when every counted item has a detail row with an amount
    // (the weekly counts from before the masters carry no amounts).
    const detailed = list(s.key, win.start, win.end).length === n;
    return (
      <PdRow key={s.key} stat={s} n={n} total={detailed ? amount(s.key, win.start, win.end) : 0} first={i === 0} onOpen={() => setOpenKey(s.key)}>
        <div style={{ marginTop: 5 }}>
          <PdDelta cur={n} prev={p} goodWhenUp={!s.danger} note={`vs. prior 60 days (${p})`} />
        </div>
        <PdWeekBars values={bars(s.key)} weeks={weeks} />
      </PdRow>
    );
  };

  const answer = (q, a, w, go, link) => (
    <div role="button" tabIndex={0} onClick={go} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }}
      className="pd-card pd-click">
      <div style={{ fontSize: 12.5, color: "rgba(54,67,74,0.68)", fontFamily: FONT_BODY }}>{q}</div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 23, lineHeight: 1.2, color: C.gray, marginTop: 4 }}>{a}</div>
      {w && <div style={{ fontSize: 12, color: "rgba(54,67,74,0.68)", fontFamily: FONT_BODY, marginTop: 3 }}>{w}</div>}
      <span className="pd-link">{link} ›</span>
    </div>
  );

  // Leads by group, for the window and the 60 days before it.
  const groupOf = (type, a, b) => {
    const acc = { relationship: 0, marketing: 0, hotel: 0, none: 0 };
    list(type, a, b).forEach(e => { acc[leadGroupKey(e.src)] += 1; });
    return acc;
  };
  const gLeads = groupOf("lead", win.start, win.end), gLeadsOld = groupOf("lead", prev.start, prev.end);
  const gTours = groupOf("tour", win.start, win.end), gPsas = groupOf("psa", win.start, win.end);
  const leadTotal = cur("lead");

  const renderList = () => {
    const items = list(open.key, win.start, win.end).sort((a, b) => b.date - a.date);
    const total = items.reduce((s, e) => s + e.amount, 0);
    const n = cur(open.key);
    return (
      <Modal title={`${open.label}${open.sub ? ` (${open.sub})` : ""} · Last 60 Days`}
        subtitle={`${twRangeLabel(win.start, win.end)} · ${n}${total > 0 && n === items.length ? ` · ${money(total)}` : ""}`}
        onClose={() => setOpenKey(null)}>
        <PdShowMore items={items} empty="None in the last 60 days." render={e => <TWEntryRow key={e.i} e={e} showDate />} />
        {n > items.length && (
          <PdNote>{n - items.length} more were reported in the weekly counts before {twDayFmt(model.mastersFrom)}, when the master tabs start. Those have no detail rows.</PdNote>
        )}
      </Modal>
    );
  };

  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: "bold", color: PD_MUTED, fontFamily: FONT_BODY }}>
        Last 60 days · {twRangeLabel(win.start, win.end)}
      </div>
      <div style={{ fontSize: 13, color: "rgba(54,67,74,0.72)", fontFamily: FONT_BODY, margin: "4px 0 14px" }}>
        Compared with the 60 days before, {pdShortRange(prev.start, prev.end)}
      </div>

      {/* The short answer: sales activity, what moved forward, what is coming */}
      <style>{`
        .pd-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:3px solid ${C.teal};margin-bottom:24px}
        .pd-card{padding:12px 18px 6px;min-width:0}
        .pd-card:first-child{padding-left:2px}
        .pd-card + .pd-card{border-left:1px solid rgba(54,67,74,0.16)}
        .pd-click{cursor:pointer;border-radius:6px;transition:background .15s}
        .pd-click:hover,.pd-click:focus-visible{background:rgba(136,209,209,0.22);outline:none}
        .pd-link{display:inline-block;margin-top:7px;font-family:${FONT_BODY};font-size:12.5px;font-weight:bold;color:${C.gray};text-decoration:underline;text-decoration-color:${C.teal};text-decoration-thickness:2px;text-underline-offset:3px}
        @media (max-width:700px){
          .pd-cards{grid-template-columns:1fr}
          .pd-card{padding:12px 2px}
          .pd-card + .pd-card{border-left:none;border-top:1px solid rgba(54,67,74,0.16)}
        }
      `}</style>
      <div className="pd-cards">
        {/* Sales activity: two sections, each opens its own list */}
        <div className="pd-card">
          <div style={{ fontSize: 12.5, color: "rgba(54,67,74,0.68)", fontFamily: FONT_BODY }}>Sales activity · last 60 days</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 4 }}>
            {[["lead", cur("lead") === 1 ? "new lead" : "new leads"], ["tour", cur("tour") === 1 ? "prospect visit" : "prospect visits"]].map(([key, label], ix) => (
              <div key={key} role="button" tabIndex={0} aria-label={`${cur(key)} ${label}, open the list`}
                onClick={() => setOpenKey(key)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenKey(key); } }}
                className="pd-click" style={{ minWidth: 0, padding: "2px 6px 4px", marginLeft: -6 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 23, lineHeight: 1.2, color: C.gray }}>{cur(key)}</div>
                <div style={{ fontSize: 12.5, color: C.gray, fontFamily: FONT_BODY }}>{label}</div>
                <span className="pd-link" style={{ marginTop: 5 }}>View list ›</span>
              </div>
            ))}
          </div>
        </div>
        {answer("Pipeline updates in the last 60 days", `${updates} Pipeline Update${updates === 1 ? "" : "s"}`, null, () => setShowDeals(true), "View by stage")}
        {answer("Coming up", `${visitsThisMonth} visit${visitsThisMonth === 1 ? "" : "s"} booked`, `Rest of ${today.toLocaleDateString("en-US", { month: "long" })} · ${prospects.active.length} toured prospect${prospects.active.length === 1 ? "" : "s"} in play`, () => onGo("month"), "View this month")}
      </div>

      <PdSectionHead text="Activity" right="One bar per week (Mon–Sun) · dark bar = this week" first />
      {PD_ACTIVITY_STATS.slice(0, 2).map(row)}
      <PdRow stat={{ label: "From Lead to Prospect Visit", display: rateNow.pct == null ? "—" : `${Math.round(rateNow.pct)}%` }} n={rateNow.toured}>
        <div style={{ marginTop: 5 }}>
          {rateNow.pct != null && rateOld.pct != null
            ? <PdDelta cur={Math.round(rateNow.pct)} prev={Math.round(rateOld.pct)} unit=" pts" note={`vs. prior 60 days (${Math.round(rateOld.pct)}%)`} />
            : null}
        </div>
        <div style={{ fontSize: 11.5, color: PD_MUTED, fontFamily: FONT_BODY, marginTop: 6 }}>
          {rateNow.toured} of the {rateNow.leads} new leads in these 60 days have already had a prospect visit
        </div>
      </PdRow>

      <PdSectionHead text="Deals" />
      {PD_DEAL_STATS.map(row)}

      <PdSectionHead text="Also in the last 60 days" />
      {PD_ACTIVITY_STATS.slice(2).map(row)}

      <PdSectionHead text="New leads by group" right={pdShortRange(win.start, win.end)} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginTop: 14 }}>
        {LEAD_GROUPS.map(g => (
          <div key={g.key} style={{ background: C.white, border: "1px solid rgba(54,67,74,0.14)", borderRadius: 8, padding: "13px 15px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: g.color, flex: "none" }} />{g.label}
            </div>
            <div style={{ fontSize: 12.5, color: "rgba(54,67,74,0.68)", fontFamily: FONT_BODY, marginTop: 3 }}>({g.sources.join(", ")})</div>
            <div style={{ display: "flex", gap: 20, marginTop: 10 }}>
              {[["leads", gLeads[g.key]], ["prospect visits", gTours[g.key]], ["signed PSAs", gPsas[g.key]]].map(([l, v]) => (
                <div key={l}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 28, lineHeight: 1.1, color: C.gray }}>{v}</div>
                  <div style={{ fontSize: 11.5, color: "rgba(54,67,74,0.68)", fontFamily: FONT_BODY }}>{l}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <PdDelta cur={gLeads[g.key]} prev={gLeadsOld[g.key]} note={`leads vs. prior 60 days (${gLeadsOld[g.key]})`} />
            </div>
          </div>
        ))}
      </div>
      {leadTotal > 0 && (
        <div style={{ display: "flex", height: 26, borderRadius: 5, overflow: "hidden", marginTop: 12 }} role="img"
          aria-label={`Share of new leads: ${LEAD_GROUPS.map(g => `${g.label} ${Math.round((gLeads[g.key] / leadTotal) * 100)}%`).join(", ")}`}>
          {[...LEAD_GROUPS, { key: "none", color: "#C9C4B4" }].map(g => gLeads[g.key] > 0 && (
            <div key={g.key} style={{ width: `${(gLeads[g.key] / leadTotal) * 100}%`, background: g.color, color: g.key === "relationship" ? C.white : C.gray, fontSize: 11.5, fontWeight: "bold", fontFamily: FONT_BODY, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", whiteSpace: "nowrap" }}>
              {Math.round((gLeads[g.key] / leadTotal) * 100)}%
            </div>
          ))}
        </div>
      )}
      <PdNote>
        No source recorded or other: {gLeads.none} lead{gLeads.none === 1 ? "" : "s"}, {gTours.none} prospect visit{gTours.none === 1 ? "" : "s"}, {gPsas.none} signed PSA{gPsas.none === 1 ? "" : "s"}. Shown apart, not in any group.
        {" "}Before {twDayFmt(model.mastersFrom)}, New Pending OTPs, New Signed OTPs and Lost Deals come from the weekly counts reported at the time.
      </PdNote>

      {open && renderList()}

      {/* Pop-up for the "Pipeline updates" card: every stage change after the prospect visit, by stage */}
      {showDeals && (
        <Modal title="Pipeline Updates" subtitle={`${updates} stage change${updates === 1 ? "" : "s"} after the prospect visit · ${twRangeLabel(win.start, win.end)}`} onClose={() => setShowDeals(false)}>
          {[["hold", "New inventory on hold"], ["potp", "New pending OTPs"], ["sotp", "New signed OTPs"], ["psa", "New signed PSAs"], ["lost", "Lost deals"]].map(([key, label]) => {
            const items = list(key, win.start, win.end).sort((a, b) => b.date - a.date);
            const n = cur(key);
            return (
              <div key={key} style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "8px 0 6px", borderBottom: `1.5px solid ${key === "lost" ? C.red : C.gray}` }}>
                  <span style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: "bold", color: key === "lost" ? C.red : PD_MUTED, fontFamily: FONT_BODY }}>{label}</span>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: key === "lost" ? C.red : C.gray }}>{n}</span>
                </div>
                {items.map(e => <TWEntryRow key={e.i} e={e} showDate />)}
                {n === 0 && <div style={{ fontSize: 13, color: "rgba(54,67,74,0.64)", padding: "10px 0", fontFamily: FONT_BODY }}>None in the last 60 days.</div>}
                {n > items.length && (
                  <div style={{ fontSize: 12, color: PD_MUTED, fontFamily: FONT_BODY, padding: "10px 0", lineHeight: 1.5 }}>
                    {n - items.length} more from the weekly counts before {twDayFmt(model.mastersFrom)}. No deal detail is recorded for those.
                  </div>
                )}
              </div>
            );
          })}
        </Modal>
      )}
    </div>
  );
};

// ── THIS MONTH (the 1st through today, vs. the same days last month) ──
const ThisMonthView = ({ model }) => {
  const [openKey, setOpenKey] = useState(null);
  const { today, month, count, amount, list, hasDailyData, visits, ddThisMonth, mastersFrom } = model;
  const allStats = [...PD_DEAL_STATS, ...PD_ACTIVITY_STATS];
  const open = allStats.find(s => s.key === openKey);
  const dayNum = today.getDate(), daysInMonth = month.end.getDate();
  const curLabel = pdShortRange(month.start, today), prevLabel = pdShortRange(month.prevStart, month.prevEnd);
  const updates = allStats.reduce((s, st) => s + list(st.key, month.start, today).length, 0);
  const coming = visits.filter(v => v.arrival <= month.end);

  const row = (s, i) => {
    const n = count(s.key, month.start, today);
    const comparable = hasDailyData(s.key, month.prevStart);
    const todayN = list(s.key, today, today).length;
    return (
      <PdRow key={s.key} stat={s} n={n} total={amount(s.key, month.start, today)} first={i === 0} onOpen={() => setOpenKey(s.key)}>
        {todayN > 0 && <div style={{ marginTop: 4, fontSize: 11, fontWeight: "bold", color: C.green, fontFamily: FONT_BODY }}>+{todayN} today</div>}
        <PdPairBars curLabel={curLabel} cur={n} prevLabel={prevLabel}
          prev={comparable ? count(s.key, month.prevStart, month.prevEnd) : 0}
          prevNote={comparable ? null : `no daily data before ${twDayFmt(mastersFrom)}`} />
      </PdRow>
    );
  };

  const renderList = () => {
    const items = list(open.key, month.start, today).sort((a, b) => b.date - a.date);
    const total = items.reduce((s, e) => s + e.amount, 0);
    return (
      <Modal title={`${open.label}${open.sub ? ` (${open.sub})` : ""} · This Month`}
        subtitle={`${twRangeLabel(month.start, today)} · ${items.length} so far${total > 0 ? ` · ${money(total)}` : ""}`}
        onClose={() => setOpenKey(null)}>
        <PdShowMore items={items} empty="None yet this month." render={e => <TWEntryRow key={e.i} e={e} showDate />} />
      </Modal>
    );
  };

  return (
    <div>
      {/* Header: month so far + how far into it we are */}
      <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: "bold", color: PD_MUTED, fontFamily: FONT_BODY }}>
        This month · {twRangeLabel(month.start, today)}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "rgba(54,67,74,0.72)", fontFamily: FONT_BODY }}>Day {dayNum} of {daysInMonth} · compared with {prevLabel}</span>
        <span style={{ fontSize: 13, color: "rgba(54,67,74,0.72)", fontFamily: FONT_BODY }}>{updates} update{updates === 1 ? "" : "s"} so far</span>
      </div>
      <div style={{ height: 3, background: "rgba(54,67,74,0.1)", borderRadius: 2, overflow: "hidden", margin: "8px 0 12px" }}>
        <div style={{ height: "100%", width: `${(dayNum / daysInMonth) * 100}%`, background: C.teal, borderRadius: 2, transition: "width 0.5s ease" }} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", fontSize: 11.5, color: "rgba(54,67,74,0.7)", fontFamily: FONT_BODY, marginBottom: 20 }}>
        <span><span style={{ display: "inline-block", width: 12, height: 9, borderRadius: 3, background: C.teal, marginRight: 6 }} />This month so far</span>
        <span><span style={{ display: "inline-block", width: 12, height: 9, borderRadius: 3, background: "#C9C4B4", marginRight: 6 }} />Last month, same days</span>
      </div>

      <PdSectionHead text="Activity this month" first />
      {PD_ACTIVITY_STATS.slice(0, 2).map(row)}

      <PdSectionHead text="Deals this month" />
      {PD_DEAL_STATS.map(row)}

      <PdSectionHead text="Also this month" />
      {PD_ACTIVITY_STATS.slice(2).map(row)}

      <PdSectionHead text="Coming up this month" right={`${coming.length} visit${coming.length === 1 ? "" : "s"} booked`} />
      {coming.length === 0 && ddThisMonth.length === 0 && (
        <div style={{ fontSize: 13, color: "rgba(54,67,74,0.64)", padding: "1rem 0", fontFamily: FONT_BODY }}>No visits or due-diligence deadlines left this month.</div>
      )}
      {coming.map((v, i) => (
        <ProspectRow key={`v${i}`} p={{ name: v.name, advisor: v.coveredBy || v.owner, src: v.source }}
          right={calSameDay(v.arrival, v.departure) ? twDayFmt(v.arrival) : pdShortRange(v.arrival, v.departure)} sub="Visit scheduled" />
      ))}
      {ddThisMonth.map((d, i) => (
        <ProspectRow key={`d${i}`} p={{ name: d.name, advisor: d.advisor, src: money(d.amount) }} right={twDayFmt(d.date)} sub={`Due diligence expires · ${d.stage}`} />
      ))}

      {model.entries.length === 0 && (
        <div style={{ fontSize: 12, color: PD_MUTED, marginTop: 14, fontStyle: "italic", fontFamily: FONT_BODY }}>
          Nothing in the masters yet — add rows to Master_Leads / Master_Deals and they'll show up here.
        </div>
      )}

      {open && renderList()}
    </div>
  );
};

// ── PROSPECT STAGES (shown at the top of the Pipeline tab) ───────────
// Two count-only stages before Pending OTP, then where toured prospects went.
// Every toured prospect leaves the stage one of two ways: Pending OTP
// (inventory assigned, deal amount starts) or Lost (with a reason).
const ProspectStages = ({ model }) => {
  const [openKey, setOpenKey] = useState(null);
  const { prospects, visits, win, today, aging, daysOpen } = model;
  const reasons = (() => {
    const acc = new Map();
    prospects.lost.forEach(p => {
      const k = p.lossReason || "No reason recorded";
      acc.set(k, (acc.get(k) || 0) + 1);
    });
    return [...acc.entries()].sort((a, b) => b[1] - a[1]);
  })();
  const maxReason = Math.max(...reasons.map(r => r[1]), 1);
  const tourInfo = p => `Visited ${twDayFmt(p.tourDate)}${p.tourDate.getFullYear() !== today.getFullYear() ? `, ${p.tourDate.getFullYear()}` : ""} · ${daysOpen(p)} day${daysOpen(p) === 1 ? "" : "s"}`;
  const stageAndStatus = p => [p.lifecycle, p.status || "No lead status"].filter(Boolean).join(" · ");
  const agingMax = Math.max(aging.active || 0, aging.older || 0, aging.buyersAvg || 0, 1);
  const agingLine = (label, hint, days, color) => days != null && (
    <div style={{ padding: "5px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, fontFamily: FONT_BODY }}>
        <span style={{ fontSize: 13, color: C.gray }}>{label} <span style={{ fontSize: 12, color: PD_MUTED }}>{hint}</span></span>
        <span style={{ fontSize: 13, fontWeight: "bold", color: C.gray, whiteSpace: "nowrap" }}>{days} days</span>
      </div>
      <div style={{ height: 9, width: `${Math.max((days / agingMax) * 100, 1)}%`, background: color, borderRadius: 5, marginTop: 4 }} />
    </div>
  );

  const stageRow = (key, label, hint, n, first) => (
    <PdRow key={key} stat={{ label }} n={n} first={first} onOpen={() => setOpenKey(key)}>
      <div style={{ fontSize: 11.5, color: PD_MUTED, fontFamily: FONT_BODY, marginTop: 4 }}>{hint}</div>
    </PdRow>
  );
  const exit = (key, arrow, color, n, label, hint) => (
    <div role="button" tabIndex={0} onClick={() => setOpenKey(key)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenKey(key); } }}
      style={{ display: "grid", gridTemplateColumns: "20px 44px 1fr", gap: 8, alignItems: "center", cursor: "pointer", padding: "6px 0" }}>
      <span style={{ fontSize: 18, fontWeight: "bold", color }}>{arrow}</span>
      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 30, lineHeight: 1, color: C.gray }}>{n}</span>
      <span style={{ fontSize: 13.5, color: C.gray, fontFamily: FONT_BODY }}>
        {label}<br /><span style={{ fontSize: 12, color: "rgba(54,67,74,0.68)" }}>{hint}</span>
      </span>
    </div>
  );

  const lists = {
    visits: { title: "Upcoming Prospect Visits", sub: `${visits.length} upcoming`, empty: "No visits scheduled.",
      items: visits, render: (v, i) => <ProspectRow key={i} p={{ name: v.name, advisor: v.coveredBy || v.owner, src: v.source }} right={calSameDay(v.arrival, v.departure) ? twDayFmt(v.arrival) : pdShortRange(v.arrival, v.departure)} /> },
    active: { title: "Toured Prospects", sub: `Toured since ${twDayFmt(win.start)} · no deal yet · not Lost`, empty: "No open toured prospects from the last 60 days.",
      items: prospects.active, render: (p, i) => <ProspectRow key={i} p={p} right={tourInfo(p)} sub={stageAndStatus(p)} /> },
    older: { title: "Older Toured Prospects Still Open", sub: `Toured before ${twDayFmt(win.start)} · no deal, not marked Lost`, empty: "None.",
      items: prospects.older, render: (p, i) => <ProspectRow key={i} p={p} right={tourInfo(p)} sub={stageAndStatus(p)} /> },
    lost: { title: "Lost After the Tour", sub: `${twRangeLabel(win.start, win.end)}`, empty: "No toured prospects were marked Lost in the last 60 days.",
      items: prospects.lost, render: (p, i) => <ProspectRow key={i} p={p} right={tourInfo(p)} sub={`${p.lossReason || "No reason recorded"} · ${stageAndStatus(p)}`} /> },
    toDeal: { title: "Moved to Pending OTP", sub: `Inventory assigned · ${twRangeLabel(win.start, win.end)}`, empty: "No inventory was assigned in the last 60 days.",
      items: prospects.toDeal, render: e => <TWEntryRow key={e.i} e={e} showDate /> },
  };
  const open = openKey && lists[openKey];

  return (
    <div style={{ marginBottom: 26 }}>
      <PdSectionHead text="Prospect pipeline" first />
      {stageRow("visits", "Upcoming Prospect Visits", "Booked in the prospect calendar, not yet arrived", visits.length, true)}
      {stageRow("active", "Toured Prospects", `Toured in the last 60 days, no deal yet, not Lost`, prospects.active.length, false)}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 10, marginTop: 6 }}>
        <div style={{ background: C.white, border: "1px solid rgba(54,67,74,0.14)", borderRadius: 8, padding: "12px 15px", minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY, marginBottom: 4 }}>
            Where toured prospects went <span style={{ fontWeight: "normal", color: PD_MUTED, fontSize: 12 }}>· last 60 days</span>
          </div>
          {exit("toDeal", "→", C.green, prospects.toDeal.length, "Moved to Pending OTP", "Inventory assigned, deal amount starts here")}
          {exit("lost", "→", C.red, prospects.lost.length, "Lost after the tour", "Each one with a reason and a lead status update")}
        </div>
        <div style={{ background: C.white, border: "1px solid rgba(54,67,74,0.14)", borderRadius: 8, padding: "12px 15px", minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY, marginBottom: 8 }}>Lost reasons</div>
          {reasons.length === 0 && <div style={{ fontSize: 12.5, color: PD_MUTED, fontFamily: FONT_BODY }}>None in the last 60 days.</div>}
          {reasons.map(([label, n]) => (
            <div key={label} style={{ display: "grid", gridTemplateColumns: "minmax(0, 150px) 1fr 18px", gap: 8, alignItems: "center", fontSize: 13, color: C.gray, fontFamily: FONT_BODY, padding: "3px 0" }}>
              <span>{label}</span>
              <div style={{ height: 9, width: `${(n / maxReason) * 100}%`, background: C.red, borderRadius: 5 }} />
              <span style={{ fontWeight: "bold" }}>{n}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ background: C.white, border: "1px solid rgba(54,67,74,0.14)", borderRadius: 8, padding: "12px 15px", marginTop: 10 }}>
        <div style={{ fontSize: 13.5, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY, marginBottom: 4 }}>
          Days since prospect visit <span style={{ fontWeight: "normal", color: PD_MUTED, fontSize: 12 }}>· average, for those not yet in Pending OTP</span>
        </div>
        {agingLine("Toured prospects", `(${prospects.active.length}, last 60 days)`, aging.active, C.teal)}
        {agingLine("Older, still open", `(${prospects.older.length})`, aging.older, C.red)}
        {agingLine("Past buyers: visit to Pending OTP", `(average of ${aging.buyersN} deals)`, aging.buyersAvg, C.gray)}
        {aging.buyersN > 0 && (
          <div style={{ fontSize: 11.5, color: PD_MUTED, fontFamily: FONT_BODY, marginTop: 6, lineHeight: 1.5 }}>
            Half of past buyers had inventory assigned within {aging.buyersMedian} days of their visit. Measured on the {aging.buyersN} deals where HubSpot has a visit date before the deal.
          </div>
        )}
      </div>
      {prospects.older.length > 0 && (
        <div role="button" tabIndex={0} onClick={() => setOpenKey("older")} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenKey("older"); } }}
          style={{ cursor: "pointer", fontSize: 12.5, color: "rgba(54,67,74,0.75)", fontFamily: FONT_BODY, marginTop: 12, lineHeight: 1.5 }}>
          <strong>{prospects.older.length}</strong> older toured prospects are still open: no deal and not marked Lost. Each needs one of the two outcomes. <span style={{ textDecoration: "underline" }}>See the list</span>
        </div>
      )}

      {open && (
        <Modal title={open.title} subtitle={open.sub} onClose={() => setOpenKey(null)}>
          <PdShowMore items={open.items} empty={open.empty} render={open.render} />
        </Modal>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════
// ── MAIN MENU ────────────────────────────────────────────────────────
// Desktop / tablet: one row of big icon tabs that sticks to the top while
// scrolling. Phones (≤700px): an app-style bar pinned to the bottom of the
// screen, in thumb reach. Same six destinations, same order.
// ══════════════════════════════════════════════════════════════════════

const NAV_ITEMS = [
  { key: "weekly",      label: "60 Days",    cap: "Last 60 days", icon: "bars" },
  { key: "month",       label: "This Month", cap: "Live",         icon: "pulse", live: true },
  { key: "calendar",    label: "Calendar",  icon: "calendar" },
  { key: "active",      label: "Pipeline",  icon: "briefcase" },
  { key: "inventories", label: "Inventory", icon: "building" },
  { key: "conversions", label: "Funnel",    icon: "funnel" },
];

const NavIcon = ({ name, size = 22 }) => {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  const shapes = {
    bars: <><rect x="3" y="12" width="4" height="8" rx="1" {...p} /><rect x="10" y="8" width="4" height="12" rx="1" {...p} /><rect x="17" y="4" width="4" height="16" rx="1" {...p} /></>,
    pulse: <path d="M3 12h4l3-8 4 16 3-8h4" {...p} />,
    calendar: <><rect x="4" y="5" width="16" height="16" rx="2" {...p} /><path d="M16 3v4M8 3v4M4 11h16" {...p} /></>,
    briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" {...p} /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" {...p} /></>,
    building: <path d="M3 21h18M5 21V8l7-5 7 5v13M9 10v.01M15 10v.01M9 14v.01M15 14v.01M10 21v-3h4v3" {...p} />,
    funnel: <path d="M4 4h16v2.2a2 2 0 0 1-.6 1.4L15 12v7l-6 2v-8.5L4.5 7.6A2 2 0 0 1 4 6.2V4z" {...p} />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: "block" }}>{shapes[name]}</svg>;
};

const NAV_CSS = `
.nk-topnav{position:sticky;top:8px;z-index:50;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px;background:${C.gray};padding:6px;border-radius:12px;margin-bottom:1rem;box-shadow:0 2px 10px rgba(54,67,74,0.18)}
.nk-tab{appearance:none;border:none;background:transparent;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:64px;padding:8px 4px;border-radius:8px;color:#C9D3D6;cursor:pointer;font-family:${FONT_BODY};font-size:13px;font-weight:bold;position:relative;transition:background .15s,color .15s;text-align:center;line-height:1.15}
.nk-tab:hover{background:rgba(136,209,209,0.14);color:#fff}
.nk-tab.on{background:${C.teal};color:${C.gray}}
.nk-cap{font-size:10px;font-weight:normal;opacity:.85;letter-spacing:.04em;display:flex;align-items:center;gap:4px}
.nk-live{display:inline-block;width:7px;height:7px;border-radius:50%;background:${C.green};animation:nkpulse 1.8s ease-in-out infinite}
.nk-tab.on .nk-live{background:${C.gray}}
@keyframes nkpulse{0%,100%{opacity:1}50%{opacity:.3}}
.nk-badge{position:absolute;top:5px;right:calc(50% - 26px);min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:${C.green};color:#fff;font-size:11px;font-weight:bold;line-height:18px;text-align:center;font-family:${FONT_BODY}}
.nk-bottomnav{display:none}
@media (max-width:700px){
  .nk-root{padding:0.75rem 0.9rem calc(96px + env(safe-area-inset-bottom)) !important}
  .nk-topnav{display:none}
  .nk-bottomnav{display:grid;position:fixed;left:0;right:0;bottom:0;z-index:900;grid-template-columns:repeat(6,minmax(0,1fr));background:${C.gray};padding:7px 2px calc(9px + env(safe-area-inset-bottom));box-shadow:0 -4px 16px rgba(0,0,0,0.2)}
  .nk-btab{appearance:none;border:none;background:transparent;display:flex;flex-direction:column;align-items:center;gap:4px;min-height:52px;padding:5px 0;color:#C9D3D6;font-family:${FONT_BODY};font-size:10.5px;font-weight:bold;cursor:pointer;position:relative;white-space:nowrap;-webkit-tap-highlight-color:transparent}
  .nk-btab.on{color:${C.teal}}
  .nk-btab.on::before{content:"";position:absolute;top:-7px;left:20%;right:20%;height:3px;border-radius:2px;background:${C.teal}}
  .nk-btab .nk-badge{top:0;right:calc(50% - 22px)}
  .nk-btab .nk-live{position:absolute;top:3px;right:calc(50% - 16px)}
  .nk-header{padding:0.8rem 1rem !important;margin-bottom:0.75rem !important}
  .nk-logo{height:34px !important}
  .nk-tagline{display:none}
}
`;

const MainNav = ({ view, onGo, todayCount }) => {
  const extra = item => item.key === "month" && todayCount > 0
    ? <span className="nk-badge" aria-label={`${todayCount} new today`}>{todayCount}</span>
    : null;
  return (
    <>
      <style>{NAV_CSS}</style>
      <nav className="nk-topnav" aria-label="Main menu">
        {NAV_ITEMS.map(item => (
          <button key={item.key} className={`nk-tab${view === item.key ? " on" : ""}`} aria-current={view === item.key ? "page" : undefined} onClick={() => onGo(item.key)}>
            <NavIcon name={item.icon} />
            <span>{item.label}</span>
            {item.cap && <span className="nk-cap">{item.live && <span className="nk-live" />}{item.cap}</span>}
            {extra(item)}
          </button>
        ))}
      </nav>
      <nav className="nk-bottomnav" aria-label="Main menu">
        {NAV_ITEMS.map(item => (
          <button key={item.key} className={`nk-btab${view === item.key ? " on" : ""}`} aria-current={view === item.key ? "page" : undefined} onClick={() => onGo(item.key)}>
            <NavIcon name={item.icon} size={23} />
            <span>{item.label}</span>
            {extra(item) || (item.live && <span className="nk-live" />)}
          </button>
        ))}
      </nav>
    </>
  );
};

// ══════════════════════════════════════════════════════════════════════
// ── FUNNEL (Leads → Toured → Signed PSA) ────────────────────────────
// Reads five sheet tabs built from the HubSpot "NKN Conversions by
// Source, Advisor and Year" workbook: Funnel_AllTime / Funnel_ByYear
// (by Source), Funnel_Advisor_AllTime / Funnel_Advisor_ByYear (by
// Advisor, credited to the owner of the deal signed) and
// Funnel_LeadStatus (present-day status snapshot). Every table has a
// "TOTAL" row.
// ══════════════════════════════════════════════════════════════════════

// Lead → PSA runs in single digits for most groups, so it gets its own
// colour bands instead of the 40% / 15% ones used for stage-to-stage rates.
const rateColorLP = v => {
  const n = parseFloat(String(v).replace("%", ""));
  if (isNaN(n) || v === "—") return { color: "rgba(54,67,74,0.35)" };
  if (n >= 10) return { color: C.green, fontWeight: "bold" };
  if (n >= 3) return { color: C.amber, fontWeight: "bold" };
  return { color: C.red, fontWeight: "bold" };
};
const funnelNum = v => { const n = parseInt(String(v ?? "").replace(/,/g, ""), 10); return isNaN(n) ? 0 : n; };
const funnelFmt = v => funnelNum(v).toLocaleString("en-US");

// Colours by HubSpot Lead Status value, grouped by family: working
// (greens/teals), gone quiet (ambers), won (slate), out (reds), unset (grey).
const LEAD_STATUS_COLOR = {
  "Active": C.green,
  "Timing": "#4FB3A9",
  "Nurture": C.teal,
  "Unresponsive": C.amber,
  "Gone Dark": "#B8763F",
  "Closed Won": C.slate,
  "Unqualified": C.red,
  "Not Interested": "#D68B80",
  "Unsubscribed": "#9E4B41",
  "(No Status Set)": "rgba(54,67,74,0.3)",
};

const SectionLabel = ({ children, style }) => (
  <div style={{ fontSize: 10, color: C.gray, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "bold", opacity: 0.5, margin: "24px 0 10px", fontFamily: FONT_BODY, ...style }}>{children}</div>
);

const FunnelView = ({ allTime, byYear, advAllTime, advByYear, leadStatus, tabStyle, tab, setTab, dim, setDim, year, setYear }) => {
  const years = [...new Set(byYear.map(r => r["Year"]).filter(Boolean))].sort((a, b) => b - a);
  const selectedYear = year ?? years[0] ?? null;
  const isAllTime = tab === "alltime";

  const table = dim === "Source"
    ? (isAllTime ? allTime : byYear)
    : (isAllTime ? advAllTime : advByYear);
  const scoped = isAllTime ? table : table.filter(r => String(r["Year"]) === String(selectedYear));
  const totalRow = scoped.find(r => r[dim] === "TOTAL") ?? {};
  const rows = scoped
    .filter(r => r[dim] && r[dim] !== "TOTAL")
    .sort((a, b) => funnelNum(b["PSAs"]) - funnelNum(a["PSAs"]) || funnelNum(b["Leads"]) - funnelNum(a["Leads"]));

  const L = funnelNum(totalRow["Leads"]), T = funnelNum(totalRow["Toured"]), P = funnelNum(totalRow["PSAs"]);
  const maxV = Math.max(L, T, P, 1);
  const stages = [
    { label: "Total Leads",  value: L },
    { label: "Toured Leads", value: T },
    { label: "Signed PSA",   value: P },
  ];
  const rates = [
    { label: "Lead → Tour", pct: totalRow["L→T%"] || "—", color: rateColor },
    { label: "Tour → PSA",  pct: totalRow["T→P%"] || "—", color: rateColor },
    { label: "Lead → PSA",  pct: totalRow["L→P%"] || "—", color: rateColorLP },
  ];
  const hasData = L + T + P > 0;

  // Year-group comparison strip (All-Time only) — the TOTAL row of each year.
  const cohorts = years.map(y => ({ year: y, ...(byYear.find(r => String(r["Year"]) === String(y) && r["Source"] === "TOTAL") ?? {}) }));
  const statusRows = leadStatus.filter(r => r["Lead Status"] && r["Lead Status"] !== "TOTAL");
  const statusTotal = statusRows.reduce((s, r) => s + funnelNum(r["Leads"]), 0);

  const card = { background: C.white, borderRadius: 8, border: "0.5px solid rgba(54,67,74,0.12)", overflow: "hidden" };
  const headCell = { padding: "10px 14px", background: "rgba(54,67,74,0.04)", fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: "bold", color: "rgba(54,67,74,0.72)", fontFamily: FONT_BODY };
  const grid = "minmax(0,1.6fr) repeat(3, minmax(0,0.7fr)) repeat(2, minmax(0,0.8fr))";
  const gap = { columnGap: 10 };

  return (
    <div>
      {/* Section toggle: All-Time vs By Year */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        <button style={tabStyle(isAllTime)} onClick={() => setTab("alltime")}>All-Time Analysis</button>
        <button style={tabStyle(!isAllTime)} onClick={() => setTab("byyear")}>By Year</button>
      </div>

      {/* Methodology note */}
      <div style={{ fontSize: 11, lineHeight: 1.6, color: "rgba(54,67,74,0.65)", background: "rgba(136,209,209,0.18)", border: "0.5px solid rgba(54,67,74,0.1)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontFamily: FONT_BODY }}>
        <strong style={{ color: C.gray }}>Methodology:</strong> Each lead is assigned to the year it was created in HubSpot and stays in that group for its entire journey — a lead created in 2022 that signs a PSA in 2025 still counts toward 2022.
      </div>

      <div style={{ background: C.beige, borderRadius: 10, padding: "1rem 1.25rem", border: "0.5px solid rgba(54,67,74,0.12)" }}>
        {/* Header + year selector (By Year only) */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
          <div style={{ fontSize: 10, color: C.gray, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "bold", opacity: 0.5, fontFamily: FONT_BODY }}>
            {isAllTime ? "All-Time Lead Conversion Analysis" : `Lead Conversion Analysis · ${selectedYear ?? "—"} Group`}
          </div>
          {!isAllTime && years.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {years.map(y => (
                <button key={y} style={tabStyle(String(selectedYear) === String(y))} onClick={() => setYear(y)}>{y}</button>
              ))}
            </div>
          )}
        </div>

        {!hasData ? (
          <div style={{ fontSize: 13, color: "rgba(54,67,74,0.64)", padding: "1rem 0", fontFamily: FONT_BODY }}>No funnel data available.</div>
        ) : (
          <>
            {/* Funnel bars */}
            {stages.map((s, i) => (
              <div key={i} style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY }}>{s.label}</span>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.gray }}>{s.value.toLocaleString("en-US")}</span>
                </div>
                <div style={{ height: 12, borderRadius: 6, background: "rgba(54,67,74,0.07)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.max((s.value / maxV) * 100, s.value > 0 ? 5 : 0)}%`, background: C.teal, borderRadius: 6, transition: "width 0.5s ease" }} />
                </div>
              </div>
            ))}

            {/* Conversion rate cards */}
            <SectionLabel>Conversion Rates</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
              {rates.map((r, i) => (
                <div key={i} style={{ background: C.white, borderRadius: 8, padding: "14px 16px", border: "0.5px solid rgba(54,67,74,0.12)" }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 26, ...r.color(r.pct) }}>{r.pct}</div>
                  <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: "bold", color: "rgba(54,67,74,0.55)", marginTop: 6, fontFamily: FONT_BODY }}>{r.label}</div>
                </div>
              ))}
            </div>

            {/* Year-group comparison (All-Time only) */}
            {isAllTime && cohorts.length > 0 && (
              <>
                <SectionLabel>By Year Group · tap a year to open it</SectionLabel>
                <div style={card}>
                  <div style={{ display: "grid", gridTemplateColumns: grid, ...gap, ...headCell }}>
                    <span>Year</span>
                    <span style={{ textAlign: "right" }}>Leads</span>
                    <span style={{ textAlign: "right" }}>Toured</span>
                    <span style={{ textAlign: "right" }}>PSAs</span>
                    <span style={{ textAlign: "right" }}>L→T%</span>
                    <span style={{ textAlign: "right" }}>L→P%</span>
                  </div>
                  {cohorts.map(c => (
                    <div key={c.year} onClick={() => { setYear(c.year); setTab("byyear"); }}
                      style={{ display: "grid", gridTemplateColumns: grid, ...gap, padding: "11px 14px", borderTop: "0.5px solid rgba(54,67,74,0.08)", fontSize: 12, color: C.gray, fontFamily: FONT_BODY, alignItems: "baseline", cursor: "pointer" }}>
                      <span style={{ fontWeight: "bold" }}>{c.year}</span>
                      <span style={{ textAlign: "right" }}>{funnelFmt(c["Leads"])}</span>
                      <span style={{ textAlign: "right" }}>{funnelFmt(c["Toured"])}</span>
                      <span style={{ textAlign: "right", fontFamily: FONT_DISPLAY, fontSize: 15 }}>{funnelFmt(c["PSAs"])}</span>
                      <span style={{ textAlign: "right", ...rateColor(c["L→T%"] || "—") }}>{c["L→T%"] || "—"}</span>
                      <span style={{ textAlign: "right", ...rateColorLP(c["L→P%"] || "—") }}>{c["L→P%"] || "—"}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Breakdown by Source / Advisor */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, margin: "24px 0 10px" }}>
              <SectionLabel style={{ margin: 0 }}>By {dim}</SectionLabel>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={tabStyle(dim === "Source")} onClick={() => setDim("Source")}>Source</button>
                <button style={tabStyle(dim === "Advisor")} onClick={() => setDim("Advisor")}>Advisor</button>
              </div>
            </div>
            {rows.length === 0 ? (
              <div style={{ fontSize: 13, color: "rgba(54,67,74,0.64)", padding: "0.5rem 0", fontFamily: FONT_BODY }}>No rows for this view.</div>
            ) : (
              <div style={card}>
                <div style={{ display: "grid", gridTemplateColumns: grid, ...gap, ...headCell }}>
                  <span>{dim}</span>
                  <span style={{ textAlign: "right" }}>Leads</span>
                  <span style={{ textAlign: "right" }}>Toured</span>
                  <span style={{ textAlign: "right" }}>PSAs</span>
                  <span style={{ textAlign: "right" }}>L→T%</span>
                  <span style={{ textAlign: "right" }}>L→P%</span>
                </div>
                {rows.map((r, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: grid, ...gap, padding: "11px 14px", borderTop: "0.5px solid rgba(54,67,74,0.08)", fontSize: 12, color: C.gray, fontFamily: FONT_BODY, alignItems: "baseline" }}>
                    <span style={{ fontWeight: "bold", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r[dim]}</span>
                    <span style={{ textAlign: "right" }}>{funnelFmt(r["Leads"])}</span>
                    <span style={{ textAlign: "right" }}>{funnelFmt(r["Toured"])}</span>
                    <span style={{ textAlign: "right", fontFamily: FONT_DISPLAY, fontSize: 15 }}>{funnelFmt(r["PSAs"])}</span>
                    <span style={{ textAlign: "right", ...rateColor(r["L→T%"] || "—") }}>{r["L→T%"] || "—"}</span>
                    <span style={{ textAlign: "right", ...rateColorLP(r["L→P%"] || "—") }}>{r["L→P%"] || "—"}</span>
                  </div>
                ))}
              </div>
            )}
            {dim === "Advisor" && (
              <div style={{ fontSize: 10.5, color: "rgba(54,67,74,0.6)", marginTop: 8, lineHeight: 1.5, fontFamily: FONT_BODY }}>
                Signed PSAs are credited to the deal owner at the time of sale, so deactivated advisors keep what they closed.
              </div>
            )}

            {/* Current lead status snapshot (All-Time only) */}
            {isAllTime && statusRows.length > 0 && statusTotal > 0 && (
              <>
                <SectionLabel>Current Lead Status (HubSpot) · today's snapshot</SectionLabel>
                <div style={{ ...card, padding: "14px 16px" }}>
                  <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", marginBottom: 14, gap: 2 }}>
                    {statusRows.map((s, i) => (
                      <div key={i} title={`${s["Lead Status"]}: ${s["% of Leads"]}`} style={{ width: `${(funnelNum(s["Leads"]) / statusTotal) * 100}%`, background: LEAD_STATUS_COLOR[s["Lead Status"]] || "rgba(54,67,74,0.3)" }} />
                    ))}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "10px 22px" }}>
                    {statusRows.map((s, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 8, fontFamily: FONT_BODY }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: LEAD_STATUS_COLOR[s["Lead Status"]] || "rgba(54,67,74,0.3)", flexShrink: 0, transform: "translateY(-1px)" }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: "bold", color: C.gray }}>{s["Lead Status"]}</span>
                            <span style={{ fontSize: 12, color: C.gray, whiteSpace: "nowrap" }}>
                              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 15 }}>{funnelFmt(s["Leads"])}</span>
                              <span style={{ color: "rgba(54,67,74,0.55)" }}> · {s["% of Leads"]}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────
export default function NaukaDashboard() {
  const [view, setView]               = useState("weekly");
  const [funnelTab, setFunnelTab]   = useState("alltime"); // "alltime" | "byyear"
  const [funnelDim, setFunnelDim]   = useState("Source");  // "Source" | "Advisor"
  const [funnelYear, setFunnelYear] = useState(null);      // null → newest year group
  const [kpis, setKpis]           = useState([]);
  const [pipeline, setPipeline]   = useState([]);
  const [deals, setDeals]         = useState([]);
  const [kpiArchive, setKpiArchive] = useState([]);
  const [funnelContacts, setFunnelContacts] = useState([]);
  const [settings, setSettings]   = useState([]);
  const [ytdPSAs, setYtdPSAs]     = useState([]);
  const [resalePSAs, setResalePSAs] = useState([]);
  const [funnelAllTime, setFunnelAllTime] = useState([]);
  const [funnelByYear, setFunnelByYear]   = useState([]);
  const [funnelAdvAllTime, setFunnelAdvAllTime] = useState([]);
  const [funnelAdvByYear, setFunnelAdvByYear]   = useState([]);
  const [funnelLeadStatus, setFunnelLeadStatus] = useState([]);
  const [calendarRows, setCalendarRows]   = useState([]);
  const [builtProduct, setBuiltProduct]   = useState([]);
  const [homesites, setHomesites]         = useState([]);
  const [inventoryTab, setInventoryTab]   = useState("built"); // "built" | "homesites"
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [lastUpdated, setLastUpdated] = useState("");
  const [openModal, setOpenModal] = useState(null);
  const [masterLeads, setMasterLeads] = useState([]);
  const [masterDeals, setMasterDeals] = useState([]);
  const [now, setNow]             = useState(() => new Date());
  const lastLoadRef               = useRef(0);

  // Loads every tab. Runs on open, then again every 15 minutes and whenever
  // the page comes back into view, so the This Month section picks up each
  // day's new master rows without a manual reload. Background refreshes
  // keep the current data on screen if a request fails.
  const load = useCallback(async (silent = false) => {
      lastLoadRef.current = Date.now();
      try {
        const [k, p, d, ka, fc, st, ytd, resale, fa, fy, faa, fay, fls, cal, bp, hs, mLeads, mDeals] = await Promise.all([
          fetchSheet("Weekly_KPIs"),
          fetchSheet("Pipeline"),
          fetchSheet("Pending Transactions"),
          fetchSheet("Weekly_KPIs_Archive"),
          fetchSheet("Funnel_Contacts"),
          fetchSheet("Report_Settings"),
          fetchSheet("YTD_PSAs"),
          fetchSheet("YTD_Resale_PSAs"),
          fetchSheet("Funnel_AllTime"),
          fetchSheet("Funnel_ByYear"),
          fetchSheet("Funnel_Advisor_AllTime"),
          fetchSheet("Funnel_Advisor_ByYear"),
          fetchSheet("Funnel_LeadStatus"),
          fetchSheet("Prospect_Calendar"),
          fetchRawSheet("Built Product"),
          fetchRawSheet("Homesites"),
          fetchSheet("Master_Leads"),
          fetchSheet("Master_Deals"),
        ]);
        // fetchSheet returns [] on a network error, so a background refresh
        // that came back with nothing in the core tabs is treated as a failed
        // attempt — keep what's already on screen and try again next time.
        if (silent && k.length === 0 && p.length === 0) return;
        setKpis(k); setPipeline(p); setDeals(d);
        setKpiArchive(ka); setFunnelContacts(fc); setSettings(st);
        setYtdPSAs(ytd);
        setResalePSAs(resale);
        setFunnelAllTime(fa); setFunnelByYear(fy);
        setFunnelAdvAllTime(faa); setFunnelAdvByYear(fay); setFunnelLeadStatus(fls);
        setCalendarRows(cal);
        setBuiltProduct(parseBuiltProduct(bp));
        setHomesites(parseHomesites(hs));
        setMasterLeads(mLeads); setMasterDeals(mDeals);
        setNow(new Date());
        setLastUpdated(new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }));
      } catch { if (!silent) setError("Could not load data."); }
      finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load(false);
    const timer = setInterval(() => load(true), REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoadRef.current > REFRESH_ON_FOCUS_MIN_MS) load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  const pipe = stage => pipeline.find(r => r["Stage"] === stage) ?? {};

  const today = new Date();
  const expiredDeals = deals.filter(d => {
    if (!d["DD Expiry"]) return false;
    const raw = String(d["DD Expiry"]).trim();
    if (!raw) return false;
    // Try parsing as-is first (handles "6/3/2026", "2026-06-03", "Jun 3, 2026", etc).
    // Only fall back to appending a year if that produced an invalid date AND the
    // string doesn't already end in a 4-digit year (e.g. a bare "Jun 3").
    let exp = new Date(raw);
    if (isNaN(exp) && !/\d{4}\s*$/.test(raw)) exp = new Date(`${raw}, 2026`);
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return !isNaN(exp) && exp < todayStart;
  });

  // ── Sales Team YTD (vs. $270M goal) ─────────────────────────
  // = all YTD Signed PSAs, minus related-party/insider deals that don't
  // count toward the team's production goal, plus qualifying re-sale
  // inventory PSAs (tracked separately in the YTD_Resale_PSAs tab).
  // Sheet tabs end with a summary row (e.g. "AVERAGE (33 deals) · Min: 0 days · Max:
  // 368 days" or "TOTAL (1 deal)") — that's a stat, not a deal, so it must never be
  // treated as one: no card, no inclusion in counts/totals/day averages.
  const isSummaryRow = d => !d["Deal Name"] || /^(AVERAGE|TOTAL)\b/i.test(String(d["Deal Name"]).trim());
  const salesTeamPrimaryDeals = ytdPSAs.filter(
    d => !isSummaryRow(d)
      && !SALES_TEAM_GOAL_EXCLUSIONS.includes(d["Deal Name"])
      && String(d["Related Party"] ?? "").trim().toLowerCase() !== "yes"
  );
  const salesTeamResaleDeals = resalePSAs.filter(d => !isSummaryRow(d));
  const salesTeamDeals = [...salesTeamPrimaryDeals, ...salesTeamResaleDeals];
  const salesTeamTotal = sumAmount(salesTeamDeals);
  const salesTeamPct = SALES_TEAM_GOAL_AMOUNT > 0 ? (salesTeamTotal / SALES_TEAM_GOAL_AMOUNT) * 100 : 0;
  const salesTeamAvgDays = (() => {
    const days = salesTeamDeals.map(r => parseInt(r["Days on Hold"])).filter(d => !isNaN(d));
    return days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null;
  })();

  const tabStyle = active => ({
    padding: "6px 14px", fontSize: 12, borderRadius: 20, cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
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

  const activeChips = [
    { key: "Pending OTP",     label: "Pending OTP",             clickable: true },
    { key: "Signed OTP",      label: "Signed OTP",              clickable: true },
    { key: "Expired DD",      label: "Expired Due Diligence",   clickable: true },
    { key: "YTD Signed PSAs", label: "Sales Team YTD",    clickable: true, isGoal: true },
    { key: "All-Time PSAs",   label: "All-Time PSAs",           clickable: false, noTrend: true },
  ];

  const renderModal = () => {
    if (!openModal) return null;
    if (openModal.type === "active") {
      const stage = openModal.key;
      const info = pipe(stage);
      let records = [], subtitle = null;
      if (stage === "Pending OTP") records = deals.filter(d => d["Stage"] === "Decision" || d["Stage"] === "Pending OTP");
      else if (stage === "Signed OTP") records = deals.filter(d => d["Stage"] === "Signed OTP");
      else if (stage === "Expired DD") records = expiredDeals;
      else if (stage === "YTD Signed PSAs") {
        // Sales-team goal view: excludes related-party PSAs, includes qualifying re-sales.
        records = salesTeamDeals;
        const avgLine = salesTeamAvgDays ? ` · Avg. ${salesTeamAvgDays} days on hold` : "";
        subtitle = `${money(salesTeamTotal)} of $270M goal (${salesTeamPct.toFixed(1)}%)${avgLine}`;
      }
      return (
        <Modal title={stage === "YTD Signed PSAs" ? "Sales Team YTD" : stage} subtitle={subtitle} onClose={() => setOpenModal(null)}>
          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            <div style={{ background: C.gray, borderRadius: 8, padding: "0.5rem 1rem", fontFamily: FONT_DISPLAY, fontSize: 20, color: C.teal }}>
              {stage === "YTD Signed PSAs" ? salesTeamDeals.length : (info["Count"] || records.length)}
            </div>
            <div style={{ background: C.gray, borderRadius: 8, padding: "0.5rem 1rem", fontFamily: FONT_DISPLAY, fontSize: 20, color: C.white }}>
              {stage === "YTD Signed PSAs" ? money(salesTeamTotal) : money(info["Value ($)"])}
            </div>
          </div>
          {records.length === 0
            ? <div style={{ fontSize: 13, color: "rgba(54,67,74,0.64)", padding: "1rem 0", fontFamily: FONT_BODY }}>No deals to show.</div>
            : records.map((d, i) => stage === "YTD Signed PSAs" ? <PSACard key={i} deal={d} /> : <DealCard key={i} deal={d} />)
          }
          {subtitle && <div style={{ textAlign: "center", padding: "0.75rem", background: C.teal, borderRadius: 8, fontSize: 12, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY, marginTop: 8 }}>{subtitle}</div>}
        </Modal>
      );
    }
  };

  const calRecords = calendarRows.length ? parseCalendarSheet(calendarRows) : FALLBACK_CALENDAR_RECORDS;
  const model = buildModel({ masterLeads, masterDeals, calRecords, funnelContacts, kpis, kpiArchive, settings, now });
  const todayCount = model.entries.filter(e => calSameDay(e.date, model.today)).length;
  const go = key => {
    setView(key);
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { /* old browsers */ }
  };

  return (
    <div className="nk-root" style={{ fontFamily: FONT_BODY, color: C.gray, padding: "1rem 1.25rem", maxWidth: 960, margin: "0 auto" }}>

      {/* Header */}
      <div className="nk-header" style={{ background: C.gray, padding: "1.25rem 1.5rem", borderRadius: 10, marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
        <div>
          <img className="nk-logo" src="/Nauka_Horizontal_Logo.png" alt="Nauka" style={{ height: 56, width: "auto", display: "block" }} />
          <div className="nk-tagline" style={{ fontSize: 11, color: C.teal, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 10, fontFamily: FONT_BODY }}>Sales Snapshot</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", fontFamily: FONT_BODY }}>Updated {lastUpdated}</div>
        </div>
      </div>

      {/* Main menu — top bar on desktop, bottom bar on phones */}
      <MainNav view={view} onGo={go} todayCount={todayCount} />

      {/* ── LAST 60 DAYS (vs. the 60 days before) ───────────────────── */}
      {view === "weekly" && (
        <SixtyDayView model={model} onGo={go} />
      )}

      {/* ── ACTIVE TRANSACTIONS ───────────────────────────────────── */}
      {/* Same one-column, phone-first rows as Last 60 Days / This Month: count
          on the right with its $ value under it; zeros dimmed; Expired Due
          Diligence turns red when anything has expired. */}
      {view === "active" && (() => {
        const sectionHead = (text, first) => (
          <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: "bold", color: "rgba(54,67,74,0.55)", padding: first ? "0 0 10px" : "26px 0 10px", borderBottom: `1.5px solid ${C.gray}`, fontFamily: FONT_BODY }}>{text}</div>
        );
        const row = (chip, first) => {
          const info  = pipe(chip.key);
          const count = chip.isGoal ? salesTeamDeals.length : num(info["Count"]);
          const value = chip.isGoal ? salesTeamTotal : parseFloat(String(info["Value ($)"] ?? "").replace(/[$,]/g, "")) || 0;
          const zero  = count === 0;
          const alert = chip.key === "Expired DD" && !zero;
          const open  = chip.clickable ? () => setOpenModal({ type: "active", key: chip.key }) : undefined;
          return (
            <div key={chip.key} onClick={open}
              style={{ cursor: open ? "pointer" : "default", display: "flex", alignItems: "center", gap: 14, padding: zero ? "12px 0" : "16px 0", borderTop: first ? "none" : "1px solid rgba(54,67,74,0.12)" }}>
              <div style={{ flex: 1, minWidth: 0, opacity: zero ? 0.5 : 1 }}>
                <div style={{ fontSize: 15, fontWeight: "bold", color: alert ? C.red : C.gray, fontFamily: FONT_BODY }}>{chip.label}</div>
                {chip.isGoal && (
                  <div style={{ marginTop: 8, maxWidth: 260 }}>
                    <div style={{ height: 4, background: "rgba(54,67,74,0.1)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.min(salesTeamPct, 100)}%`, background: C.teal, borderRadius: 2 }} />
                    </div>
                    <div style={{ fontSize: 11, fontWeight: "bold", color: C.teal, marginTop: 5, fontFamily: FONT_BODY }}>
                      {salesTeamPct.toFixed(1)}% of $270M goal
                    </div>
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right", opacity: zero ? 0.45 : (chip.clickable ? 1 : 0.7) }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: zero ? 28 : 40, lineHeight: 1, color: alert ? C.red : C.gray }}>{count}</div>
                {value > 0 && <div style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: "bold", color: alert ? C.red : C.teal, marginTop: 2 }}>{money(value)}</div>}
              </div>
              <span style={{ fontSize: 22, color: open ? "rgba(54,67,74,0.3)" : "transparent", lineHeight: 1, marginLeft: -4 }}>›</span>
            </div>
          );
        };
        const motion = activeChips.slice(0, 3);
        const sales  = activeChips.slice(3);
        return (
          <div>
            <ProspectStages model={model} />
            {sectionHead("Deals · inventory assigned", true)}
            {motion.map((c, i) => row(c, i === 0))}
            {sectionHead("Sales", false)}
            {sales.map((c, i) => row(c, i === 0))}
          </div>
        );
      })()}

      {/* ── INVENTORIES ───────────────────────────────────────────── */}
      {view === "inventories" && (() => {
        const rawGroups = inventoryTab === "built" ? builtProduct : homesites;
        const groups = onlyAvailable
          ? rawGroups
              .map(g => ({ ...g, units: g.units.filter(u => u.status === "available") }))
              .filter(g => g.units.length > 0)
          : rawGroups;
        return (
          <div>
            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
              <button style={tabStyle(inventoryTab === "built")} onClick={() => setInventoryTab("built")}>Built Product</button>
              <button style={tabStyle(inventoryTab === "homesites")} onClick={() => setInventoryTab("homesites")}>Homesites</button>
              <button style={{ ...tabStyle(onlyAvailable), marginLeft: "auto" }} onClick={() => setOnlyAvailable(v => !v)}>
                {onlyAvailable ? "✓ Available Only" : "Show Available Only"}
              </button>
            </div>
            {groups.length === 0 ? (
              <div style={{ fontSize: 13, color: "rgba(54,67,74,0.64)", padding: "1rem 0", fontFamily: FONT_BODY }}>
                {onlyAvailable ? "No available units right now." : "No inventory data available for this tab yet."}
              </div>
            ) : (
              groups.map((g, i) => <InventoryGroupSection key={i} group={g} />)
            )}
          </div>
        );
      })()}

      {/* ── FUNNEL VIEW · LEADS → TOURED → SIGNED PSA (by Source / Advisor) ─── */}
      {view === "conversions" && (
        <FunnelView
          allTime={funnelAllTime} byYear={funnelByYear}
          advAllTime={funnelAdvAllTime} advByYear={funnelAdvByYear}
          leadStatus={funnelLeadStatus} tabStyle={tabStyle}
          tab={funnelTab} setTab={setFunnelTab}
          dim={funnelDim} setDim={setFunnelDim}
          year={funnelYear} setYear={setFunnelYear}
        />
      )}

      {/* ── THIS MONTH (the 1st through today, vs. the same days last month) ─ */}
      {view === "month" && (
        <ThisMonthView model={model} />
      )}

      {/* ── PROSPECT CALENDAR ───────────────────────────────────────── */}
      {view === "calendar" && (
        <CalendarView records={calRecords} />
      )}

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
