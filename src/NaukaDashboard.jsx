import { useState, useEffect, useCallback, useRef, Fragment } from "react";

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

// Shortens an owner / buyer to family names only, for a quick scan:
//   "Andres Conesa"                    → "Conesa"
//   "Mark Sear/Jim DeCota/Mike Lebbin" → "Sear/DeCota/Lebbin"
//   "Gary and Aliz Simpson"            → "Simpson"  (first names sharing one surname)
//   "Danny Epstien & Andy Cohen"       → "Epstien & Cohen"
//   "Frank Van Veenendaal"             → "Van Veenendaal"
// Company names are left as typed. A cell holding first names only
// ("Pepe & Jaime") cannot be resolved here and must be fixed in the sheet.
const INV_NAME_PARTICLE_RE = /^(de|del|la|las|los|da|di|du|le|van|von|der|den)$/i;
function invLastName(person) {
  const parts = String(person).replace(/\([^)]*\)/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || "";
  if (INV_NAME_PARTICLE_RE.test(parts[0])) return parts.join(" ");
  let i = parts.length - 1;
  while (i > 1 && INV_NAME_PARTICLE_RE.test(parts[i - 1])) i--;
  return parts.slice(i).join(" ");
}
function invFamilyName(raw) {
  if (!raw) return raw;
  const s = String(raw).trim();
  if (/(SA de CV|LLC|Corp\.?|Inc\.?|Servicios|Empresariales|Ownership)/i.test(s)) return s;
  // Split joint owners, keeping the separators exactly as typed in the sheet.
  const tokens = s.split(/(\s*\/\s*|\s*&\s*|\s+and\s+)/i);
  const people = tokens.filter((_, i) => i % 2 === 0);
  const seps = tokens.filter((_, i) => i % 2 === 1);
  if (people.length === 1) return invLastName(s) || s;
  const wordCount = p => p.trim().split(/\s+/).filter(Boolean).length;
  // "Gary and Aliz Simpson": single first names joined by and / & before a
  // full name share that person's surname.
  const shared = seps.every(x => !x.includes("/"))
    && wordCount(people[people.length - 1]) > 1
    && people.slice(0, -1).every(p => wordCount(p) === 1);
  if (shared) return invLastName(people[people.length - 1]);
  return people.map((p, i) => invLastName(p) + (seps[i] || "")).join("");
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
// A homesite lot label: a number, optionally followed by one letter for
// split lots ("8A", "10B").
function invIsLotCell(v) {
  return invIsNumericCell(v) || (typeof v === "string" && /^\d+\s*[A-Za-z]$/.test(v.trim()));
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
// Totals for the "Available Only" view: units and asking-price total, overall
// and per product (Cliff Residence buildings and Cliff Estates phases combined).
const invProduct = name => {
  const base = String(name).split(" — ")[0].trim();
  return base === "Siari" ? "Siari Residences" : base;
};
const InventoryTotals = ({ groups, allAvailable }) => {
  const sum = units => units.reduce((t, u) => t + (u.price || 0), 0);
  const noPrice = units => units.filter(u => u.price == null).length;
  const byProduct = new Map();
  groups.forEach(g => { const k = invProduct(g.name); byProduct.set(k, [...(byProduct.get(k) || []), ...g.units]); });
  const tabUnits = groups.flatMap(g => g.units);
  const cell = { padding: "8px 10px", borderBottom: "1px solid rgba(54,67,74,0.12)", fontFamily: FONT_BODY, fontSize: 13.5, color: C.gray };
  const num = { ...cell, textAlign: "right", whiteSpace: "nowrap" };
  const Row = ({ label, units, bold }) => (
    <tr>
      <td style={{ ...cell, fontWeight: bold ? "bold" : "normal" }}>{label}</td>
      <td style={{ ...num, fontWeight: bold ? "bold" : "normal" }}>{units.length}</td>
      <td style={{ ...num, fontWeight: bold ? "bold" : "normal" }}>{money(sum(units))}{noPrice(units) ? <span style={{ color: PD_MUTED, fontWeight: "normal" }}> · {noPrice(units)} no price</span> : null}</td>
    </tr>
  );
  return (
    <div style={{ background: C.white, border: "1px solid rgba(54,67,74,0.12)", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: "bold", color: PD_MUTED, fontFamily: FONT_BODY }}>Available inventory</span>
        <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.gray }}>All products: <strong>{allAvailable.length} units · {money(sum(allAvailable))}</strong></span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
        <thead><tr>
          <th style={{ ...cell, textAlign: "left", fontSize: 11.5, color: PD_MUTED }}>Product</th>
          <th style={{ ...num, fontSize: 11.5, color: PD_MUTED }}>Units</th>
          <th style={{ ...num, fontSize: 11.5, color: PD_MUTED }}>Asking price total</th>
        </tr></thead>
        <tbody>
          {[...byProduct.entries()].map(([k, units]) => <Row key={k} label={k} units={units} />)}
          <Row label="Total" units={tabUnits} bold />
        </tbody>
      </table>
    </div>
  );
};

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
      // The unit number (101, 202, …) sits in the row just below the owner/price cell.
      const below = (rows[r + 1] || [])[col];
      const unitNo = invIsNumericCell(below) && invNumericValue(below) < 100000 ? String(invNumericValue(below)) : null;
      const floor = String(floorLabel).trim().toLowerCase().replace(/\bph\b/, "PH").replace(/^./, c => c.toUpperCase());
      beach.push({ unit: unitNo ? `Beach Residence ${unitNo} · ${beachBuildingNames[i]} · ${floor}` : `${beachBuildingNames[i]} · ${floorLabel}`, status, buyer, price });
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
      if (!invIsLotCell(lot)) continue; // skips blanks, section labels, and repeated headers
      const { status, buyer, price } = invClassify(row[ownerCol], row[statusCol]);
      units.push({ unit: `Homesite ${String(lot).trim()}`, status, buyer, price });
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
      if (!invIsLotCell(lot)) break;
      const { status, buyer, price } = invClassify(row[10], row[11]);
      units.push({ unit: `Homesite ${String(lot).trim()}`, status, buyer, price });
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
  if (["sold", "hold", "pending", "pending_otp", "signed_otp"].includes(u.status) && u.buyer) subLabel = invFamilyName(u.buyer);

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
      // Meeting date from HubSpot's "contacts with meetings" report. Kept for
      // reference; prospect visits are counted by Arrival Date.
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
      // Sales side of the visit (HubSpot Experiences pipeline), kept apart from
      // the calendar status in "Stage": Qualified Opportunity, Moved to Active
      // Negotiation, Not This Time, Legacy… Never shown on screen as-is.
      pipelineStage: pdStr(r["Pipeline Stage"]) || null,
      lastActivity: parseDate(r["Last Activity Date"]),
      leadStatus: r["Lead Status"] || null,
      guests: r["Guests"] || null,
      chargeNote: r["Charge Note"] || null,
      notes: parseNotes(r["Notes"]),
    }))
    .filter(r => r.name && r.arrival)
    .map(r => (r.departure ? r : { ...r, departure: r.arrival })); // a day visit may leave Departure empty
}

// Visits show only the latest note, call or meeting logged in HubSpot for that
// contact (Contact_Notes tab, tasks excluded). The calendar's own Notes cell is
// used only when HubSpot has nothing for the contact (Nov 3).
function withLatestNote(records, contactNotes) {
  const latest = new Map();
  (contactNotes || []).forEach(n => {
    if (!n.rid || /^task$/i.test(n.type) || !n.date || !noteHasText(n)) return;
    const cur = latest.get(n.rid);
    if (!cur || n.date > cur.date) latest.set(n.rid, n);
  });
  return records.map(r => {
    const n = latest.get(pdId(r.recordId));
    if (!n) return r.notes && r.notes.length ? { ...r, notes: [r.notes[r.notes.length - 1]] } : r;
    const kind = activityLabel(n);
    return { ...r, notes: [{ date: [twDayFmt(n.date), kind.charAt(0).toUpperCase() + kind.slice(1), n.author && n.author.split(" ")[0]].filter(Boolean).join(" · "), text: n.text }] };
  });
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
  "Eli Pacino":     "#A9DDE0", // soft teal
  "Oscar Fraustro": "#E5C3A0", // sand
  "Trip Morris":    "#F2E3A0", // yellow
  "Brandon Oyler":  "#EBB0A6", // coral
  "Sales Team":     "#D9C3DD", // lavender (events)
};
// Soft colors: the text on top of them is always dark gray, never white.
// No greens, and none repeat a color above.
const CAL_SPARE_COLORS = ["#C5D5EA", "#E8CFD9", "#CFD8DC"];
const CAL_UNASSIGNED_COLOR = "#E3DCD0";
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
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: FONT_BODY, fontSize: 11, fontWeight: "bold", color: C.gray, background: color, borderRadius: 999, padding: "3px 10px" }}>
    {name}
  </span>
);

// Club events (Stage or Contact Type "Event", e.g. the Nauka Cup) show on the
// calendar only. They are never counted as Prospect Visits or upcoming visits.
const calIsEvent = r => /^event$/i.test(String(r.stage || "").trim()) || /^event$/i.test(String(r.contactType || "").trim());

function calGetIssues(r) {
  const issues = [];
  if (r.isMember || calIsEvent(r)) return issues;
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
  if (calIsEvent(r)) return `Club event, ${dayVisit ? a : `${a} to ${d}`}. Not counted as a Prospect Visit.`;
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
            Last note
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {r.notes.map((n, i) => (
              <div key={i} style={{ fontSize: 13, color: C.gray, lineHeight: 1.5, fontFamily: FONT_BODY, whiteSpace: "pre-line" }}>
                {n.date && <span style={{ fontWeight: "bold", color: "rgba(54,67,74,0.55)" }}>{n.date}: </span>}
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

  const CAL_LINE = "#D4D6D3";
  return (
    <div>
      <style>{`
        .nkc-top{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;padding-bottom:16px;border-bottom:1px solid ${CAL_LINE}}
        .nkc-title{font-family:${FONT_DISPLAY};font-size:34px;line-height:1;color:${C.gray}}
        .nkc-legend{display:flex;flex-wrap:wrap;gap:14px 34px;padding:22px 0}
        .nkc-lg{appearance:none;background:transparent;border:none;padding:0;text-align:left;cursor:pointer;color:${C.gray};font-family:${FONT_BODY};font-size:10px;letter-spacing:.14em;text-transform:uppercase;line-height:1.5}
        .nkc-lg i{display:block;width:44px;height:3px;margin-bottom:9px}
        .nkc-grid{background:${C.white};border-top:1px solid ${CAL_LINE};border-left:1px solid ${CAL_LINE}}
        .nkc-7{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}
        .nkc-wd{font-family:${FONT_BODY};font-size:10px;font-weight:bold;letter-spacing:.16em;text-transform:uppercase;text-align:center;padding:13px 0;color:${C.gray};border-right:1px solid ${CAL_LINE};border-bottom:1px solid ${CAL_LINE}}
        .nkc-wd .s{display:none}
        .nkc-week{position:relative;min-height:118px;border-bottom:1px solid ${CAL_LINE}}
        .nkc-cols{position:absolute;inset:0}
        .nkc-cols div{border-right:1px solid ${CAL_LINE}}
        .nkc-num{position:relative;text-align:right;padding:8px 9px 6px;height:30px;font-family:${FONT_BODY};font-size:12px;color:#5C676C}
        .nkc-num.today span{display:inline-block;min-width:20px;height:20px;line-height:20px;text-align:center;border-radius:50%;background:${C.teal};color:${C.gray};font-weight:bold;margin:-3px -4px 0 0}
        .nkc-evs{position:relative;display:flex;flex-direction:column;gap:2px;padding-bottom:10px}
        .nkc-ev{font-family:${FONT_BODY};font-size:10.5px;line-height:1.25;text-align:center;padding:5px 4px;margin-right:1px;color:${C.gray};cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .nkc-ev.x{text-decoration:line-through;opacity:.75}
        @media (max-width:700px){
          .nkc-title{font-size:26px}
          .nkc-legend{gap:12px 22px;padding:16px 0}
          .nkc-wd{font-size:9px;letter-spacing:.08em}
          .nkc-wd .l{display:none}
          .nkc-wd .s{display:inline}
          .nkc-week{min-height:92px}
          .nkc-num{padding:6px 5px;font-size:11px}
          .nkc-ev{font-size:9px;padding:4px 2px}
        }
      `}</style>

      {/* Month title + arrows */}
      <div className="nkc-top">
        <div className="nkc-title">{label}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            aria-label="Previous month"
            disabled={atFirst}
            onClick={() => setMonthIdx(i => Math.max(0, i - 1))}
            style={arrowBtn(atFirst)}
          >
            ‹
          </button>
          <button
            aria-label="Next month"
            disabled={atLast}
            onClick={() => setMonthIdx(i => Math.min(CAL_MONTHS.length - 1, i + 1))}
            style={arrowBtn(atLast)}
          >
            ›
          </button>
        </div>
      </div>

      {/* Legend: a short color line above each advisor. Click a name for their visits. */}
      <div className="nkc-legend">
        {[...legendAdvisors, CAL_UNASSIGNED_LABEL].map(a => {
          const parts = a.split(" ");
          return (
            <button
              key={a}
              className="nkc-lg"
              onClick={() => setListAdvisor(a)}
              title={`See all of ${a === CAL_UNASSIGNED_LABEL ? "the unassigned" : `${a}'s`} visits`}
            >
              <i style={{ background: advisorColors[a] || CAL_UNASSIGNED_COLOR }} />
              {parts[0]}<br />{parts.slice(1).join(" ") || " "}
            </button>
          );
        })}
        <div className="nkc-lg" style={{ cursor: "default" }}>
          <i />
          <span style={{ textDecoration: "line-through" }}>Name</span><br />Cancelled
        </div>
      </div>

      {/* Fluid grid — no horizontal scroll, no fixed min-width. Columns shrink
          naturally on narrow screens; event-bar text truncates with ellipsis. */}
      <div className="nkc-grid">
        <div className="nkc-7">
          {weekdayLabels.map(wd => (
            <div key={wd} className="nkc-wd"><span className="l">{wd}</span><span className="s">{wd.slice(0, 3)}</span></div>
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
            <div key={wi} className="nkc-week">
              {/* Day column lines run the full height of the week, behind the bars */}
              <div className="nkc-cols nkc-7" aria-hidden="true">
                {week.map((_, ci) => <div key={ci} />)}
              </div>
              <div className="nkc-7">
                {week.map((cell, ci) => (
                  <div key={ci} className={`nkc-num${calSameDay(cell.date, CAL_TODAY) ? " today" : ""}`}>
                    {!cell.outside && <span>{cell.date.getDate()}</span>}
                  </div>
                ))}
              </div>

              <div className="nkc-evs">
                {weekEvents.map(({ r, startIdx, endIdx }) => {
                  const advisor = calAdvisor(r) || CAL_UNASSIGNED_LABEL;
                  const isCanceled = r.stage === "Canceled";
                  return (
                    <div key={r.name} className="nkc-7">
                      <div
                        className={`nkc-ev${isCanceled ? " x" : ""}`}
                        onClick={() => setSelected(r)}
                        title={`${r.name} — ${advisor}${isCanceled ? " (Cancelled)" : ""}`}
                        style={{ gridColumn: `${startIdx + 1} / span ${endIdx - startIdx + 1}`, background: calAdvisorColor(r, advisorColors) }}
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
          <div style={{ padding: "16px 18px", fontSize: 13, color: "rgba(54,67,74,0.64)", fontFamily: FONT_BODY, fontStyle: "italic", borderRight: `1px solid ${CAL_LINE}`, borderBottom: `1px solid ${CAL_LINE}` }}>
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
                    <div style={{ fontSize: 12, fontWeight: "bold", letterSpacing: "0.07em", textTransform: "uppercase", color: C.gray, fontFamily: FONT_BODY, textDecoration: isCanceled ? "line-through" : "none" }}>
                      <span style={{ display: "inline-block", width: 18, height: 3, background: color, marginRight: 8, verticalAlign: "middle" }} />
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
//   Prospect_Calendar — Arrival Date (not Canceled) → Prospect Visits
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
// Lead statuses that take a person off the Pipeline whiteboard (one list, one place).
const WHITEBOARD_OFF_STATUSES = ["Not Interested", "Unqualified", "Unsubscribed", "Timing"]; // Timing = not active (Nov 3)
// Visit Pipeline Stage values that take someone off the list (HubSpot Experiences pipeline).
const QO_CLOSED_STAGES = ["moved to active negotiation", "not this time", "canceled", "legacy"];
const TALKS_OFF_STATUSES = ["unresponsive", "no contact", "gone dark", "closed won"]; // also kept out of "In talks to visit"
const isHotelSource = src => /siari hotel guest/i.test(String(src || ""));
const isNegotiationStage = st => /^active negotiation/i.test(String(st || "").trim());
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
  m = s.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return new Date(y, +m[1] - 1, +m[2]); }
  // Month names ("Oct 31, 2026", "Saturday, October 31, 2026", "31 Oct 2026",
  // "Oct 15, 2026, 3:04 PM", "Oct 31") are read by hand: Safari on iPhone / iPad
  // cannot read several of these, so the same sheet gave different counts there.
  const mon = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?/i);
  if (mon) {
    const mi = TW_MONTHS.indexOf(mon[1].toLowerCase());
    const after = s.slice(mon.index + mon[0].length), before = s.slice(0, mon.index);
    let dm = after.match(/^[\s\-.,\/]*(\d{1,2})(?:st|nd|rd|th)?(?!\d)/), day = dm ? +dm[1] : null;
    if (day == null) { const bm = before.match(/(?:^|\D)(\d{1,2})[\s\-.,\/]*$/); day = bm ? +bm[1] : null; }
    const ym = s.match(/\b(\d{4})\b/);
    const year = ym ? +ym[1] : new Date().getFullYear();
    if (day != null && day >= 1 && day <= 31) return new Date(year, mi, day);
  }
  const d = new Date(s);
  return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
const TW_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

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
const pdId = v => pdStr(v).replace(/[,\s]/g, "").replace(/\.0+$/, "");

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
      date, type: "lead", name, details: status, amount: 0, status,
      advisor: pdStr(r["Advisor"]) || pdStr(r["Contact Owner"]),
      source: pdStr(r["Source"]), src: pdStr(r["Source"]), rid,
      lifecycle: pdStr(r["Lifecycle Stage"]),
    };
    if (rid) leadById.set(rid, e); else leadNoId.push(e);
    const tourDate = twParseDate(r["HubSpot Tour Date"]);
    if (rid) people.set(rid, {
      key: rid, rid, name, src: e.src, advisor: e.advisor, status,
      contactType: pdStr(r["Contact Type"]),
      lifecycle: pdStr(r["Lifecycle Stage"]), // optional column in Funnel_Contacts
      ref: pdStr(r["Referral Source"]),
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
      status: pdStr(r["Lead Status"]) || (prev ? prev.status : ""),
      details: [pdStr(r["Lifecycle Stage"]), pdStr(r["Lead Status"]), pdStr(r["Notes"])].filter(Boolean).join(" · ") || (prev ? prev.details : ""),
      amount: 0,
      advisor: pdStr(r["Advisor"]) || (prev ? prev.advisor : ""),
      source: [pdStr(r["Lead Source"]), pdStr(r["Referral Source"]) ? `via ${pdStr(r["Referral Source"])}` : ""].filter(Boolean).join(" · "),
      src: pdStr(r["Lead Source"]) || (prev ? prev.src : ""), rid,
      lifecycle: pdStr(r["Lifecycle Stage"]) || (prev ? prev.lifecycle : ""),
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
        ref: pdStr(r["Referral Source"]) || p.ref || "",
      });
    }
  });
  leadById.forEach(e => out.push(e));
  leadNoId.forEach(e => out.push(e));
  // CEO report lead lines: Hotel = Lead Source Siari Hotel Guest; Web = Nauka
  // or Siari website leads not yet SQL; Qualified = every other lead (a
  // relationship source, or made SQL by an advisor), except Unqualified.
  const isWebSource = src => /^(nauka homepage|siari website)$/i.test(pdStr(src));
  const isSql = e => /sales qualified|opportunity|customer/i.test(pdStr(e.lifecycle));
  [...leadById.values(), ...leadNoId].forEach(e => {
    if (isHotelSource(e.src)) out.push({ ...e, type: "hlead" });
    else if (isWebSource(e.src) && !isSql(e)) out.push({ ...e, type: "wlead" });
    else if (pdStr(e.status).toLowerCase() !== "unqualified") out.push({ ...e, type: "qlead" });
  });

  // Prospect visits: counted by Arrival Date in Prospect_Calendar (not
  // Canceled), the same date HubSpot's prospect visit report uses. A visit
  // enters the counts on the day of arrival. Connectors are reported as
  // visits but are never prospects.
  const calTours = []; // [{ key, date }] to avoid counting the HubSpot date twice
  (calendarRecords || []).forEach(r => {
    if (!r.name || calIsEvent(r)) return; // club events are not Prospect Visits
    const rid = pdId(r.recordId);
    const key = rid || `name:${r.name}`;
    const isConnector = pdStr(r.contactType).toLowerCase() === "connector";
    // Lost Date / Loss Reason / Lead Status typed on the calendar row win over the baseline.
    if (!isConnector && (rid ? people.has(rid) : false)) {
      const p = people.get(rid);
      people.set(rid, { ...p, status: pdStr(r.leadStatus) || p.status, lifecycle: pdStr(r.lifecycle) || p.lifecycle, lostDate: r.lostDate || p.lostDate, lossReason: pdStr(r.lossReason) || p.lossReason });
    }
    if (!r.arrival || r.stage === "Canceled") return;
    const d = pdDay(r.arrival);
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
      ref: pdStr(r.referral) || p.ref || "",
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
    const isNeg = isNegotiationStage(r["Stage"]);
    milestones.forEach(([field, t]) => {
      // An Active Negotiation deal is created before inventory is assigned, so
      // its Create Date is a new negotiation, not a new hold.
      const type = isNeg && t === "hold" ? "neg" : t;
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
    // Visited in the window, no deal yet, any lead status (for "Where toured prospects are now").
    recent: toured.filter(p => !hasDeal(p) && p.tourDate >= win.start).sort(byTourDesc),
    // Lost after the tour, in the window: by Lost Date when the sheet has one, else by the tour date.
    lost: toured.filter(p => !hasDeal(p) && isLost(p) && (p.lostDate || p.tourDate) >= win.start && (p.lostDate || p.tourDate) <= today).sort(byTourDesc),
    // Moved to Pending OTP: inventory assigned (deal created) in the window, only for
    // buyers who had a prospect visit in the window on or before the deal date.
    toDeal: list("hold", win.start, today)
      .filter(d => d.rid && entries.some(t => t.type === "tour" && !t.connector && t.rid === d.rid && t.date >= win.start && t.date <= d.date))
      .sort((a, b) => b.date - a.date),
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
    .filter(r => r.name && r.stage === "Scheduled" && !calIsEvent(r) && r.arrival && r.arrival >= today && pdStr(r.contactType).toLowerCase() !== "connector")
    .sort((a, b) => a.arrival - b.arrival);
  const ddThisMonth = (masterDeals || [])
    .map(r => ({ name: pdStr(r["Deal Name"]), stage: pdStr(r["Stage"]), date: twParseDate(r["DD Expiry"]), amount: twAmount(r["Amount ($)"]), advisor: pdStr(r["Advisor"]) }))
    .filter(d => d.name && d.date && ["Pending OTP", "Signed OTP", "Decision"].includes(d.stage) && d.date >= today && d.date <= mEnd)
    .sort((a, b) => a.date - b.date);

  return { today, entries, people, list, count, amount, hasDailyData, win, prev, weeks, month, mastersFrom, leadTourRate, prospects, visits, ddThisMonth, aging, daysOpen };
}

// Labels follow Paul White's weekly CEO report; `house` is our own term, shown small underneath.
const PD_DEAL_STATS = [
  { key: "neg",  label: "Active Negotiations",        house: "New · advisor's estimated amount", money: true },
  { key: "hold", label: "OTPs Submitted",             house: "Pending OTP · inventory on hold", money: true },
  { key: "sotp", label: "Offers to Purchase (OTPs)",  house: "Signed OTPs", money: true },
  { key: "psa",  label: "Executed PSAs (Sales)",      house: "Signed PSAs", money: true },
];
const PD_ACTIVITY_STATS = [
  { key: "qlead", label: "New Qualified Leads", house: "New leads, excluding hotel guests and Unqualified" },
  { key: "hlead", label: "New Hotel Leads",     house: "Lead Source: Siari Hotel Guest" },
  { key: "tour",  label: "Site Tours / Immersions Completed", house: "Prospect Visits" },
  { key: "lost",  label: "Lost Deals", money: true, danger: true },
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
const PdSectionHead = ({ text, right, first, big }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, padding: first ? "0 0 10px" : big ? "34px 0 10px" : "26px 0 10px", borderBottom: `1.5px solid ${C.gray}` }}>
    <span style={big ? { fontSize: 15, letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY, lineHeight: 1.3 } : { fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: "bold", color: PD_MUTED, fontFamily: FONT_BODY }}>{text}</span>
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
const PdRow = ({ stat, n, total, first, onOpen, children, numSize = 40 }) => {
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
        {stat.house && <div style={{ fontSize: 11.5, color: PD_MUTED, fontFamily: FONT_BODY, marginTop: 2 }}>{stat.house}</div>}
        {children}
      </div>
      <div style={{ textAlign: "right", opacity: zero ? 0.5 : 1 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: zero ? Math.min(28, numSize) : numSize, lineHeight: 1, color: isLost ? C.red : C.gray }}>{stat.display ?? n}</div>
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
  const isDeal = ["neg", "hold", "potp", "sotp", "psa", "lost"].includes(e.type);
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
            Last note
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
// ══════════════════════════════════════════════════════════════════════
// ── ACTIVE QUALIFIED LEADS (whiteboard by advisor, 60 Days tab) ───────
// Reads the "Active_Leads" tab: one row per active qualified lead, typed by
// the sales team. Columns: Advisor | Name | Interest | Notes | Next Step |
// HubSpot Record ID. Remove a row when the lead is no longer active.
// The last / next prospect visit is added from Prospect_Calendar by
// HubSpot Record ID (never by name).
// ══════════════════════════════════════════════════════════════════════
const AL_ADVISORS = ["Eli Pacino", "Oscar Fraustro", "Trip Morris"]; // always shown, in this order

function parseActiveLeads(rows) {
  return (rows || [])
    .map(r => ({
      advisor: pdStr(r["Advisor"]) || "Unassigned",
      name: pdStr(r["Name"]),
      interest: pdStr(r["Interest"]),
      notes: pdStr(r["Notes"]),
      next: pdStr(r["Next Step"]),
      rid: pdStr(r["HubSpot Record ID"]).replace(/[,\s]/g, "").replace(/\.0+$/, ""),
      lastActivity: twParseDate(r["Last Activity Date"]),
    }))
    .filter(r => r.name);
}

const ActiveLeadsBoard = ({ leads, calRecords, today }) => {
  const advisors = [...AL_ADVISORS, ...[...new Set(leads.map(l => l.advisor))].filter(a => !AL_ADVISORS.includes(a)).sort()];
  const visitFor = rid => {
    if (!rid) return null;
    const mine = (calRecords || []).filter(r => r.stage !== "Canceled" && r.arrival &&
      String(r.recordId ?? "").replace(/[,\s]/g, "").replace(/\.0+$/, "") === rid);
    const upcoming = mine.filter(r => (r.departure || r.arrival) >= today).sort((a, b) => a.arrival - b.arrival)[0];
    const fmt = r => calSameDay(r.arrival, r.departure) ? twDayFmt(r.arrival) : pdShortRange(r.arrival, r.departure);
    if (upcoming) return { text: `${upcoming.arrival <= today ? "On property" : "Visiting"} ${fmt(upcoming)}`, soon: true };
    const last = mine.sort((a, b) => b.arrival - a.arrival)[0];
    return last ? { text: `Visited ${fmt(last)}`, soon: false } : null;
  };
  return (
    <div>
      <style>{`
        .al-board{display:grid;grid-template-columns:repeat(${advisors.length},minmax(0,1fr));gap:12px;margin-top:14px;align-items:start}
        .al-col{background:rgba(54,67,74,0.045);border-radius:10px;padding:10px 10px 12px;min-width:0}
        .al-card{background:${C.white};border:1px solid rgba(54,67,74,0.12);border-radius:8px;padding:11px 12px;margin-top:8px;box-shadow:0 1px 2px rgba(54,67,74,0.06)}
        @media (max-width:900px){.al-board{grid-template-columns:1fr}}
      `}</style>
      <div className="al-board">
        {advisors.map(a => {
          const mine = leads.filter(l => l.advisor === a);
          const color = CAL_ADVISOR_COLORS[a] || CAL_UNASSIGNED_COLOR;
          return (
            <div key={a} className="al-col">
              <div style={{ height: 4, borderRadius: 2, background: color, marginBottom: 8 }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontFamily: FONT_BODY }}>
                <span style={{ fontSize: 14, fontWeight: "bold", color: C.gray }}>{a}</span>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: C.gray }}>{mine.length}</span>
              </div>
              {mine.length === 0 && (
                <div style={{ fontSize: 12.5, color: PD_MUTED, fontFamily: FONT_BODY, padding: "10px 2px 2px" }}>No active leads listed yet.</div>
              )}
              {mine.map((l, i) => {
                const v = visitFor(l.rid);
                return (
                  <div key={i} className="al-card">
                    <div style={{ fontSize: 14.5, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY, lineHeight: 1.25 }}>{l.name}</div>
                    {l.interest && (
                      <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: "bold", color: "#4E8F8F", fontFamily: FONT_BODY, marginTop: 4 }}>{l.interest}</div>
                    )}
                    {l.notes && (
                      <div style={{ fontSize: 13, color: "rgba(54,67,74,0.85)", fontFamily: FONT_BODY, marginTop: 5, lineHeight: 1.45 }}>{l.notes}</div>
                    )}
                    {(l.next || v) && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        {l.next && (
                          <span style={{ fontSize: 11.5, fontWeight: "bold", fontFamily: FONT_BODY, color: C.gray, background: "rgba(136,209,209,0.35)", borderRadius: 999, padding: "3px 9px" }}>{l.next}</span>
                        )}
                        {v && (
                          <span style={{ fontSize: 11.5, fontFamily: FONT_BODY, color: C.gray, background: v.soon ? "rgba(136,209,209,0.35)" : "rgba(54,67,74,0.07)", fontWeight: v.soon ? "bold" : "normal", borderRadius: 999, padding: "3px 9px" }}>{v.text}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <PdNote>Typed by the sales team in the Active_Leads tab. Visit dates come from Prospect_Calendar.</PdNote>
    </div>
  );
};

const SixtyDayView = ({ model, onGo, activeLeads = [], calRecords = [] }) => {
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
  const updates = cur("neg") + cur("hold") + cur("sotp") + cur("psa") + cur("lost");

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
            {[["qlead", "New Qualified Leads"], ["tour", "Site Tours / Immersions"]].map(([key, label], ix) => (
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
        {/* Coming up: the next booked Prospect Visit (Scheduled, from today on) */}
        {(() => {
          const next = visits[0];
          const when = next ? (calSameDay(next.arrival, next.departure) ? twDayFmt(next.arrival) : pdShortRange(next.arrival, next.departure)) : null;
          const who = next ? (next.coveredBy || next.owner) : null;
          return answer(`Upcoming Site Tours Booked · ${visits.length}`, next ? `Next: ${next.name}` : "No visits booked", next ? [when, who].filter(Boolean).join(" · ") : null, () => onGo("calendar"), "View calendar");
        })()}
      </div>

      <PdSectionHead text="Weekly sales activity" right="One bar per week (Mon–Sun) · dark bar = this week" first />
      {PD_ACTIVITY_STATS.slice(0, 3).map(row)}
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

      <PdSectionHead text="Sales pipeline" />
      {PD_DEAL_STATS.map(row)}

      <PdSectionHead text="Also in the last 60 days" />
      {PD_ACTIVITY_STATS.slice(3).map(row)}

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
        {" "}Before {twDayFmt(model.mastersFrom)}, signed OTPs and Lost Deals come from the weekly counts reported at the time.
      </PdNote>

      {open && renderList()}

      {/* Pop-up for the "Pipeline updates" card: every stage change after the prospect visit, by stage */}
      {showDeals && (
        <Modal title="Pipeline Updates" subtitle={`${updates} stage change${updates === 1 ? "" : "s"} after the prospect visit · ${twRangeLabel(win.start, win.end)}`} onClose={() => setShowDeals(false)}>
          {[["neg", "Active Negotiations"], ["hold", "OTPs Submitted (inventory on hold)"], ["sotp", "Offers to Purchase (OTPs)"], ["psa", "Executed PSAs (Sales)"], ["lost", "Lost deals"]].map(([key, label]) => {
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

// ══════════════════════════════════════════════════════════════════════
// ── PIPELINE: sales pipeline (CEO report wording) + whiteboard ─────────
// Deal stages, in order: Active Negotiation → Pending OTP (HubSpot
// "Decision") → Signed OTP → Signed PSA. Lost is the exit from any stage.
// Qualified Opportunities are not deals (no amount): they come from the
// visit's Pipeline Stage in Prospect_Calendar, kept apart from the calendar
// status in "Stage". Stage names are never shown as-is on screen: every
// label is the CEO report's.
// ══════════════════════════════════════════════════════════════════════
const PIPE_STAGES = [
  { key: "neg",  label: "Active Negotiations", house: "Advisor working toward an OTP · estimated amount", match: st => isNegotiationStage(st) },
  { key: "potp", label: "OTPs Submitted / Pending Acceptance", house: "Pending OTP · inventory on hold", match: st => /^(decision|pending otp)$/i.test(st) },
  { key: "sotp", label: "Accepted OTPs / Pending PSA", house: "Signed OTP", match: st => /^signed otp$/i.test(st) },
];
// Open deals by stage, from Master_Deals.
function openDealsByStage(masterDeals) {
  const out = { neg: [], potp: [], sotp: [] };
  (masterDeals || []).forEach(r => {
    const name = pdStr(r["Deal Name"]);
    const st = pdStr(r["Stage"]);
    if (!name) return;
    const stage = PIPE_STAGES.find(s => s.match(st));
    if (!stage) return;
    out[stage.key].push({
      name, amount: twAmount(r["Amount ($)"]), advisor: pdStr(r["Advisor"]) || "Unassigned",
      rid: pdId(r["Buyer HubSpot Record ID"]), created: twParseDate(r["Create Date"]),
      dd: twParseDate(r["DD Expiry"]), notes: pdStr(r["Notes"]), stageKey: stage.key,
      src: pdStr(r["Source"]), ref: pdStr(r["Referral Source"]),
    });
  });
  Object.values(out).forEach(list => list.sort((a, b) => b.amount - a.amount));
  return out;
}

// Traffic light from days since the last activity (decided Nov 3, 2026).
const WB_GREEN = 14, WB_YELLOW = 30;
const WB_LIGHT = {
  green:  { color: C.green, label: "Active",       hint: `note, call or meeting in the last ${WB_GREEN} days` },
  yellow: { color: "#E0B23C", label: "Slowing down", hint: `${WB_GREEN + 1}–${WB_YELLOW} days since the last note, call or meeting, or a follow-up task scheduled` },
  red:    { color: C.red,   label: "Stalled",      hint: `more than ${WB_YELLOW} days since the last note, call or meeting, no follow-up task` },
  none:   { color: "#C9CED1", label: "No activity date", hint: "no note, call or meeting in HubSpot" },
};
const wbLight = days => days == null ? "none" : days <= WB_GREEN ? "green" : days <= WB_YELLOW ? "yellow" : "red";

// Qualified Opportunities: one card per person who toured Nauka in the last 60
// days, has Lead Status = Active and a note, call or meeting this month or last
// month. An open deal shows as its own stage instead.
// A note worth showing has real text: not empty, not an image-only note, and not
// just the HubSpot title of the meeting or call ("Meeting logged", "Call with …").
const NOTE_PLACEHOLDER = /^(meeting logged|call logged|note logged|\(note with no text\)|call with .+|meeting with .+|property tour|on-site meeting|virtual call|meeting|call|note)$/i;
const noteHasText = n => { const t = pdStr(n && n.text); return !!t && !NOTE_PLACEHOLDER.test(t); };
function buildWhiteboard({ calRecords, people, openDeals, activeLeads, contactNotes, today, winStart }) {
  const off = WHITEBOARD_OFF_STATUSES.map(s => s.toLowerCase());
  const skipTypes = NOT_A_PROSPECT_TYPES.map(s => s.toLowerCase());
  const openByRid = new Map();
  [...openDeals.neg, ...openDeals.potp, ...openDeals.sotp].forEach(d => { if (d.rid) openByRid.set(d.rid, d); });
  // Open HubSpot tasks (Type = Task, Date = due date) are next steps, not activity.
  const isTask = n => /^task$/i.test(n.type);
  const tasksByRid = new Map();
  (contactNotes || []).filter(isTask).forEach(n => {
    if (!n.date || n.date < today) return;
    if (!tasksByRid.has(n.rid)) tasksByRid.set(n.rid, []);
    tasksByRid.get(n.rid).push(n);
  });
  const notesByRid = new Map();
  (contactNotes || []).filter(n => !isTask(n)).forEach(n => {
    if (!n.rid) return;
    if (!notesByRid.has(n.rid)) notesByRid.set(n.rid, []);
    notesByRid.get(n.rid).push(n);
  });

  // Group calendar rows by person (Record ID; name only when there is no ID).
  const persons = new Map();
  [...(calRecords || [])].sort((a, b) => (a.arrival || 0) - (b.arrival || 0)).forEach(r => {
    if (!r.name || calIsEvent(r)) return;
    if (skipTypes.includes(pdStr(r.contactType).toLowerCase())) return;
    const rid = pdId(r.recordId);
    const key = rid || `name:${r.name.toLowerCase()}`;
    const g = persons.get(key) || { key, rid, name: r.name, advisor: "", visits: [], notes: [], lastActivity: null, leadStatus: "", src: "" };
    g.visits.push(r);
    g.advisor = r.coveredBy || r.owner || g.advisor;
    g.leadStatus = pdStr(r.leadStatus) || g.leadStatus;
    g.src = pdStr(r.source) || g.src;
    g.ref = pdStr(r.referral) || g.ref || "";
    if (r.lastActivity && (!g.lastActivity || r.lastActivity > g.lastActivity)) g.lastActivity = r.lastActivity;
    (r.notes || []).forEach(n => g.notes.push(n));
    persons.set(key, g);
  });

  // Qualified Opportunity (Nov 3): toured in the last 60 days, Lead Status = Active,
  // and a note, call or meeting this month or last month.
  const qoFrom = new Date(today.getTime() - 60 * 864e5);
  const recentFrom = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const cards = new Map();
  persons.forEach(g => {
    const status = g.leadStatus || (g.rid && people.get(g.rid) ? pdStr(people.get(g.rid).status) : "");
    // Once on the list they stay (Pipeline Stage = Qualified Opportunity on the visit),
    // whatever the time, until an action removes them: a deal, Not This Time /
    // Canceled on the visit, or a Lead Status change (WHITEBOARD_OFF_STATUSES).
    const ps = v => pdStr(v.pipelineStage).toLowerCase();
    const staged = [...g.visits].filter(v => ps(v)).sort((a, b) => (b.arrival || 0) - (a.arrival || 0))[0];
    if (staged && QO_CLOSED_STAGES.includes(ps(staged))) return;
    const sticky = staged && ps(staged) === "qualified opportunity";
    if (!sticky) {
      // Entry: 1 · visited in the last 60 days (on property counts) · 2 · Lead Status Active
      // · 3 · a note, call or meeting this month or last month
      if (!g.visits.some(v => v.stage !== "Canceled" && v.arrival && v.arrival <= today && v.arrival >= qoFrom)) return;
      if (status.toLowerCase() !== "active") return;
      const touch = g.rid ? (notesByRid.get(g.rid) || []).reduce((m, n) => (n.date && (!m || n.date > m) ? n.date : m), null) : null;
      if (!touch || touch < recentFrom) return;
    }
    if (off.includes(status.toLowerCase())) return;
    // an open deal is counted in its own stage instead (no double counting)
    if (g.rid && openByRid.has(g.rid)) return;
    const past = g.visits.filter(v => v.stage !== "Canceled" && v.departure && v.departure < today).sort((a, b) => b.departure - a.departure)[0];
    const next = g.visits.filter(v => v.stage !== "Canceled" && v.arrival && (v.departure || v.arrival) >= today).sort((a, b) => a.arrival - b.arrival)[0];
    cards.set(g.key, {
      key: g.key, rid: g.rid, name: g.name, advisor: g.advisor || "Unassigned", kind: "qo",
      leadStatus: status, src: g.src, lastActivity: g.lastActivity, lastVisit: past || null, nextVisit: next || null,
      notes: [...g.notes], interest: "", nextStep: "", amount: 0, property: "",
    });
  });

  // Active Negotiation deals: one card each, by the deal's advisor.
  openDeals.neg.forEach(d => {
    const { property, buyer } = splitDealName(d.name);
    const key = d.rid || `deal:${d.name}`;
    const g = d.rid ? [...persons.values()].find(p => p.rid === d.rid) : null;
    cards.set(key, {
      key, rid: d.rid, name: buyer || d.name, advisor: d.advisor, kind: "neg",
      leadStatus: g ? g.leadStatus : "", src: g ? g.src : "", lastActivity: g ? g.lastActivity : null,
      lastVisit: g ? g.visits.filter(v => v.departure && v.departure < today).slice(-1)[0] || null : null,
      nextVisit: g ? g.visits.find(v => v.arrival && (v.departure || v.arrival) >= today && v.stage !== "Canceled") || null : null,
      notes: g ? [...g.notes] : [], interest: "", nextStep: "", amount: d.amount, property: property || "",
      dealNotes: d.notes,
    });
  });

  // Names the advisors add (Active_Leads tab): joined to their card by Record ID, else their own card.
  (activeLeads || []).forEach(l => {
    const hit = l.rid && cards.get(l.rid);
    if (hit) {
      // The advisor's own name for the card wins (e.g. Eli's "Esteban Vizcaino" for the visit booked under Roberto).
      if (l.name && l.name !== hit.name) { hit.notes = [{ date: null, text: `Visit booked under ${hit.name}` }, ...hit.notes]; hit.name = l.name; }
      hit.interest = hit.interest || l.interest; hit.nextStep = hit.nextStep || l.next;
      if (l.notes) hit.notes = [{ date: null, text: l.notes }, ...hit.notes];
      if (l.lastActivity && (!hit.lastActivity || l.lastActivity > hit.lastActivity)) hit.lastActivity = l.lastActivity;
      if (l.advisor && l.advisor !== "Unassigned") hit.advisor = l.advisor;
      return;
    }
    const status = l.rid && people.get(l.rid) ? pdStr(people.get(l.rid).status) : "";
    if (off.includes(status.toLowerCase())) return;
    const g = l.rid ? [...persons.values()].find(p => p.rid === l.rid) : null;
    cards.set(l.rid || `added:${l.name}`, {
      key: l.rid || `added:${l.name}`, rid: l.rid, name: l.name, advisor: l.advisor, kind: "added",
      leadStatus: status || (g ? g.leadStatus : ""), src: g ? g.src : "", lastActivity: l.lastActivity || (g ? g.lastActivity : null),
      lastVisit: g ? g.visits.filter(v => v.departure && v.departure < today && v.stage !== "Canceled").slice(-1)[0] || null : null,
      nextVisit: g ? g.visits.find(v => v.arrival && (v.departure || v.arrival) >= today && v.stage !== "Canceled") || null : null,
      notes: [...(l.notes ? [{ date: null, text: l.notes }] : []), ...(g ? g.notes : [])],
      interest: l.interest, nextStep: l.next, amount: 0, property: "",
    });
  });

  // Live activity (Nov 3): anyone with a note or meeting an advisor logged by hand
  // in HubSpot in the last 30 days (Contact_Notes tab; emails do not count).
  // Already came → whiteboard. Not yet → "In talks to visit" (Unresponsive /
  // No Contact are left out there: background research is not talks).
  // A spouse or broker on the same notes/meetings is folded into one card.
  const liveFrom = new Date(today.getTime() - WB_YELLOW * 864e5);
  const hasCome = g => !!g && g.visits.some(v => v.stage !== "Canceled" && v.arrival && v.arrival <= today);
  const aidsByRid = new Map();
  notesByRid.forEach((list, rid) => aidsByRid.set(rid, new Set(list.map(n => n.aid || `${+n.date}|${n.text.slice(0, 40)}`))));
  const sortedRids = [...aidsByRid.keys()].sort();
  const foldInto = rid => {
    const mine = aidsByRid.get(rid);
    return sortedRids.find(o => {
      if (o === rid) return false;
      const theirs = aidsByRid.get(o);
      if (![...mine].every(a => theirs.has(a))) return false;
      return theirs.size > mine.size || (theirs.size === mine.size && ((cards.has(o) && !cards.has(rid)) || (cards.has(o) === cards.has(rid) && o < rid)));
    }) || null;
  };
  const also = new Map();
  sortedRids.forEach(rid => {
    if (cards.has(rid)) return;
    const list = notesByRid.get(rid);
    if (!list.some(n => n.date && n.date >= liveFrom)) return;
    const status = [...list].sort((x, y) => (y.date || 0) - (x.date || 0)).find(n => n.leadStatus)?.leadStatus || (people.get(rid) ? pdStr(people.get(rid).status) : "");
    if ([...off, "closed won"].includes(status.toLowerCase())) return;
    if (openByRid.has(rid)) return;
    // Already on the board under the same name without a Record ID (e.g. a calendar row): join them.
    const byName = list[0].name && [...cards.values()].find(c => !c.rid && c.name.toLowerCase() === list[0].name.toLowerCase());
    if (byName) { byName.rid = rid; return; }
    // Not visited yet: goes to "In talks to visit", only when they are really in talks.
    const g = [...persons.values()].find(p => p.rid === rid);
    if (hasCome(g)) return; // visited people: the Qualified Opportunity rule decides
    if (TALKS_OFF_STATUSES.includes(status.toLowerCase())) return;
    const host = foldInto(rid);
    if (host) { if (!also.has(host)) also.set(host, []); also.get(host).push(list[0].name); return; }
    const latest = [...list].sort((a, b) => (b.date || 0) - (a.date || 0))[0];
    cards.set(rid, {
      key: rid, rid, name: latest.name || (g ? g.name : ""), advisor: latest.advisor || (g ? g.advisor : "") || "Unassigned", kind: "live",
      leadStatus: status, src: g ? g.src : "", lastActivity: null,
      lastVisit: g ? g.visits.filter(v => v.departure && v.departure < today && v.stage !== "Canceled").slice(-1)[0] || null : null,
      nextVisit: g ? g.visits.find(v => v.arrival && (v.departure || v.arrival) >= today && v.stage !== "Canceled") || null : null,
      notes: g ? [...g.notes] : [], interest: "", nextStep: "", amount: 0, property: "",
    });
  });
  also.forEach((names, host) => { const c = cards.get(host); if (c && c.kind === "live") c.name = [c.name, ...names.filter(n => n && n !== c.name)].join(" & "); });

  // The last note or meeting (any author, any date, from Contact_Notes) sets the light.
  return [...cards.values()].map(c => {
    const hs = c.rid ? [...(notesByRid.get(c.rid) || [])].sort((a, b) => (b.date || 0) - (a.date || 0)) : [];
    const lastTouch = hs.find(n => n.date)?.date || null;
    const lastActivity = lastTouch; // notes and meetings only; emails never count
    const days = lastActivity ? Math.max(pdDiff(lastActivity, today), 0) : null;
    const g = c.rid ? [...persons.values()].find(p => p.rid === c.rid) : persons.get(`name:${pdStr(c.name).toLowerCase()}`);
    // On the whiteboard: people who have already come (or are on property now) and every Active Negotiation.
    const visited = c.kind === "qo" || c.kind === "neg" || hasCome(g);
    const p = c.rid ? people.get(c.rid) : null;
    const src = c.src || (g && g.src) || hs.find(n => n.source)?.source || (p ? pdStr(p.src) : "");
    const deal = c.rid ? [...openDeals.neg, ...openDeals.potp, ...openDeals.sotp].find(d => d.rid === c.rid) : null;
    const ref = c.ref || (g && g.ref) || (p ? pdStr(p.ref) : "") || (deal ? deal.ref : "");
    const leadStatus = c.leadStatus || hs.find(n => n.leadStatus)?.leadStatus || (p ? pdStr(p.status) : ""); // hs is newest first
    const nextTask = c.rid ? [...(tasksByRid.get(c.rid) || [])].sort((a, b) => a.date - b.date)[0] || null : null;
    const baseLight = wbLight(days);
    const light = nextTask && (baseLight === "red" || baseLight === "none") ? "yellow" : baseLight; // follow-up scheduled = yellow
    return { ...c, src, leadStatus, visited, nextTask, light, lastActivity, fromNotes: !!lastTouch, hubspotNotes: hs, ref, lastNote: hs[0] || null, shownNote: hs.find(noteHasText) || null, days };
  });
}

// What the last activity was, in HubSpot's "Call and meeting type" words
// (Property Tour, On-site Meeting, Text / Whats App Messages…), lower case for
// "Last …". Falls back to note / call / meeting.
const ACTIVITY_LABELS = { "text / whats app messages": "text / WhatsApp", "siari hotel guest property tour": "Siari hotel guest property tour" };
const activityLabel = n => {
  if (!n) return "";
  const t = pdStr(n.activityType);
  if (t) return ACTIVITY_LABELS[t.toLowerCase()] || t.toLowerCase();
  return pdStr(n.type).toLowerCase() || "note";
};

function parseContactNotes(rows) {
  return (rows || []).map(r => ({
    rid: pdId(pdStr(r["HubSpot Record ID"]).replace(/[,\s]/g, "")),
    date: twParseDate(r["Date"]),
    author: pdStr(r["Author"]),
    name: pdStr(r["Name"]),
    type: pdStr(r["Type"]) || "Note",
    aid: pdStr(r["Activity ID"]),
    leadStatus: pdStr(r["Lead Status"]),
    advisor: pdStr(r["Advisor"]),
    source: pdStr(r["Lead Source"]),
    activityType: pdStr(r["Activity Type"]),
    text: pdStr(r["Note"]),
  })).filter(n => n.rid && n.text && !/^email$/i.test(n.type));
}

const WB_ORDER = { red: 0, yellow: 1, none: 2, green: 3 };
const visitWhen = v => v ? (calSameDay(v.arrival, v.departure || v.arrival) ? twDayFmt(v.arrival) : pdShortRange(v.arrival, v.departure)) : "";
const nextVisitLabel = (v, today) => v ? `${v.arrival <= today ? "On property" : "Next visit"} ${visitWhen(v)}` : "";

// Title on each card, like "Active Negotiation" on deals.
const WB_KIND_LABEL = c => c.kind === "qo" ? "Qualified Opportunity" : !c.visited ? "In talks to visit" : "Added by advisor";

const WhiteboardCard = ({ c, onOpen }) => {
  const L = WB_LIGHT[c.light];
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className="wb-card" style={{ borderLeft: `5px solid ${L.color}` }}>
      <div className="wb-top" style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <span className="wb-name" style={{ fontSize: 14.5, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY, lineHeight: 1.25 }}>{c.name}</span>
        {c.kind === "neg" && c.amount > 0 && <span className="wb-amt" style={{ fontFamily: FONT_DISPLAY, fontSize: 16, color: C.gray, whiteSpace: "nowrap" }}>{money(c.amount)}</span>}
      </div>
      {c.kind === "neg" && (
        <div className="wb-kind" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: "bold", color: "#4E8F8F", fontFamily: FONT_BODY, marginTop: 3 }}>
          <span className="wb-d">Active Negotiation{c.property ? ` · ${c.property}` : ""}</span><span className="wb-m">Active Negotiation</span>
        </div>
      )}
      {c.kind !== "neg" && (
        <div className="wb-kind" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: "bold", color: "#4E8F8F", fontFamily: FONT_BODY, marginTop: 3 }}>
          <span className="wb-d">{WB_KIND_LABEL(c)}{c.interest ? ` · ${c.interest}` : ""}</span><span className="wb-m">{c.kind === "qo" ? "Qualified Opp." : WB_KIND_LABEL(c)}</span>
        </div>
      )}
      {c.ref && <div className="wb-m wb-ref" style={{ fontSize: 10, color: PD_MUTED, fontFamily: FONT_BODY, marginTop: 3, lineHeight: 1.25 }}>via {c.ref}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7, alignItems: "center" }}>
        <span className="wb-light" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontFamily: FONT_BODY, color: C.gray }}>
          <span className="wb-dot" style={{ width: 9, height: 9, borderRadius: "50%", background: L.color, flex: "none" }} />
          <span className="wb-d">{c.days == null ? "No note, call or meeting yet" : `Last ${activityLabel(c.lastNote)} ${twDayFmt(c.lastActivity)} · ${c.days === 0 ? "today" : `${c.days} day${c.days === 1 ? "" : "s"}`}`}</span>
          <span className="wb-m">{c.days == null ? "No activity" : `${twDayFmt(c.lastActivity)} · ${c.days === 0 ? "today" : `${c.days}d`}`}</span>
        </span>
      </div>
      <div className="wb-chips" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6, alignItems: "center" }}>
        {c.src && <span className="wb-chip">{c.src}{c.ref ? ` · via ${c.ref}` : ""}</span>}
        {!c.src && c.ref && <span className="wb-chip">Referred by {c.ref}</span>}
        {c.leadStatus && <span className="wb-chip">Lead Status: {c.leadStatus}</span>}
        {c.nextVisit && <span className="wb-chip wb-chip-on">{nextVisitLabel(c.nextVisit, pdDay(new Date()))}</span>}
        {!c.nextVisit && c.lastVisit && <span className="wb-chip">Visited {visitWhen(c.lastVisit)}</span>}
        {c.nextStep && <span className="wb-chip wb-chip-on">{c.nextStep}</span>}
      </div>
      {c.nextTask && (
        <div className="wb-next"><strong>Next · {twDayFmt(c.nextTask.date)}</strong><span className="wb-d"> {c.nextTask.text}</span></div>
      )}
    </div>
  );
};

const WhiteboardDetail = ({ c, onClose }) => {
  const L = WB_LIGHT[c.light];
  const meta = [c.advisor, c.leadStatus && `Lead Status: ${c.leadStatus}`, c.src, c.ref && `Referral Source: ${c.ref}`].filter(Boolean).join(" · ");
  const noteRow = (n, i) => (
    <div key={i} style={{ ...ROW_STYLE, fontFamily: FONT_BODY }}>
      {(n.date || n.author || n.type) && (
        <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: "bold", color: PD_MUTED, marginBottom: 3 }}>
          {[n.activityType ? activityLabel(n) : n.type, n.date ? (n.date instanceof Date ? twDayFmt(n.date) : n.date) : null, n.author].filter(Boolean).join(" · ")}
        </div>
      )}
      <div style={{ fontSize: 13.5, color: C.gray, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{n.text}</div>
    </div>
  );
  return (
    <Modal title={c.name} subtitle={meta} onClose={onClose}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <span className="wb-chip" style={{ background: L.color, color: c.light === "none" ? C.gray : C.white, fontWeight: "bold" }}>
          {c.days != null ? `${c.days} day${c.days === 1 ? "" : "s"} since the last note, call or meeting` : "No note, call or meeting yet"}
        </span>
        {c.kind === "neg" && <span className="wb-chip wb-chip-on">Active Negotiation{c.amount ? ` · ${money(c.amount)}` : ""}{c.property ? ` · ${c.property}` : ""}</span>}
        {c.lastVisit && <span className="wb-chip">Visited {visitWhen(c.lastVisit)}</span>}
        {c.nextVisit && <span className="wb-chip wb-chip-on">{nextVisitLabel(c.nextVisit, pdDay(new Date()))}</span>}
        {c.nextStep && <span className="wb-chip wb-chip-on">{c.nextStep}</span>}
      </div>
      {c.interest && <div style={{ fontSize: 13, color: C.gray, fontFamily: FONT_BODY, marginBottom: 8 }}><strong>Interest:</strong> {c.interest}</div>}
      {c.dealNotes && <div style={{ fontSize: 13, color: C.gray, fontFamily: FONT_BODY, marginBottom: 8 }}><strong>Deal notes:</strong> {c.dealNotes}</div>}
      {c.nextTask && <div style={{ fontSize: 13, color: C.gray, fontFamily: FONT_BODY, marginBottom: 10 }}><strong>Next step · {twDayFmt(c.nextTask.date)}:</strong> {c.nextTask.text}{c.nextTask.author ? ` (${c.nextTask.author})` : ""}</div>}
      {c.shownNote && <PdSectionHead text="Most recent note, call or meeting · HubSpot" first />}
      {c.shownNote && noteRow(c.shownNote, "last")}
      {!c.shownNote && c.notes.length > 0 && <PdSectionHead text="Most recent note" first />}
      {!c.shownNote && c.notes.length > 0 && noteRow(c.notes[c.notes.length - 1], "n")}
      {!c.shownNote && c.notes.length === 0 && (
        <div style={{ fontSize: 13, color: PD_MUTED, fontFamily: FONT_BODY }}>No notes yet.</div>
      )}
    </Modal>
  );
};

// Upcoming tasks (Nov 3): open HubSpot tasks due in the next 30 days for leads
// who are not already on the whiteboard or in "In talks to visit", by advisor.
const TASKS_AHEAD_DAYS = 30;
function buildTaskLeads({ contactNotes, cards, people, today }) {
  const until = new Date(today.getTime() + TASKS_AHEAD_DAYS * 864e5);
  const onCards = new Set(cards.map(c => c.rid).filter(Boolean));
  const off = ["not interested", "unqualified", "unsubscribed"];
  const byRid = new Map();
  (contactNotes || []).filter(n => /^task$/i.test(n.type) && n.rid && n.date && n.date >= today && n.date <= until).forEach(n => {
    if (onCards.has(n.rid)) return;
    if (!byRid.has(n.rid)) byRid.set(n.rid, []);
    byRid.get(n.rid).push(n);
  });
  const out = [];
  byRid.forEach((list, rid) => {
    list.sort((a, b) => a.date - b.date);
    const t = list[0];
    const p = people.get(rid);
    const status = t.leadStatus || (p ? pdStr(p.status) : "");
    if (off.includes(status.toLowerCase())) return;
    out.push({ rid, name: t.name || (p ? p.name : ""), advisor: t.advisor || t.author || "Unassigned", status, src: t.source || (p ? pdStr(p.src) : ""), ref: p ? pdStr(p.ref) : "", task: t, more: list.length - 1 });
  });
  return out.sort((a, b) => a.task.date - b.task.date);
}

const TaskLeads = ({ leads, today }) => {
  const advisors = [...AL_ADVISORS, ...[...new Set(leads.map(l => l.advisor))].filter(a => !AL_ADVISORS.includes(a)).sort()];
  return (
    <div>
      <div className="wb-board">
        {advisors.map(a => {
          const mine = leads.filter(l => l.advisor === a);
          return (
            <div key={a} className="wb-col">
              <div style={{ height: 4, borderRadius: 2, background: CAL_ADVISOR_COLORS[a] || CAL_UNASSIGNED_COLOR, marginBottom: 8 }} />
              <div className="wb-col-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 4, fontFamily: FONT_BODY }}>
                <span style={{ fontSize: 14, fontWeight: "bold", color: C.gray }}>{a}</span>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: C.gray }}>{mine.length}</span>
              </div>
              {mine.length === 0 && <div style={{ fontSize: 12.5, color: PD_MUTED, fontFamily: FONT_BODY, padding: "10px 2px 2px" }}>No upcoming tasks.</div>}
              {mine.map(l => {
                const days = pdDiff(today, l.task.date);
                return (
                  <div key={l.rid} className="wb-card" style={{ borderLeft: `5px solid ${C.teal}`, cursor: "default" }}>
                    <div className="wb-top" style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                      <span className="wb-name" style={{ fontSize: 14.5, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY, lineHeight: 1.25 }}>{l.name}</span>
                      <span className="wb-due" style={{ fontSize: 11.5, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY, whiteSpace: "nowrap" }}>{days <= 0 ? "Due today" : `${twDayFmt(l.task.date)} · ${days}d`}</span>
                    </div>
                    <div className="wb-kind" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: "bold", color: "#4E8F8F", fontFamily: FONT_BODY, marginTop: 3 }}>Upcoming task</div>
                    <div className="wb-task" style={{ fontSize: 12.5, color: C.gray, fontFamily: FONT_BODY, lineHeight: 1.4, marginTop: 5, overflowWrap: "anywhere" }}>{l.task.text}{l.more > 0 ? ` (+${l.more} more)` : ""}</div>
                    <div className="wb-chips" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
                      {l.src && <span className="wb-chip">{l.src}{l.ref ? ` · via ${l.ref}` : ""}</span>}
                      {l.status && <span className="wb-chip">Lead Status: {l.status}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <PdNote>Open HubSpot tasks due in the next {TASKS_AHEAD_DAYS} days, for leads who are not on the whiteboard or in talks to visit. Earliest task first.</PdNote>
    </div>
  );
};

const Whiteboard = ({ cards, talks = false }) => {
  const [open, setOpen] = useState(null);
  const advisors = [...AL_ADVISORS, ...[...new Set(cards.map(c => c.advisor))].filter(a => !AL_ADVISORS.includes(a)).sort()];
  const sortCards = list => [...list].sort((a, b) => (a.kind === "neg" ? -1 : 0) - (b.kind === "neg" ? -1 : 0) || WB_ORDER[a.light] - WB_ORDER[b.light] || (b.days ?? -1) - (a.days ?? -1));
  return (
    <div>
      <style>{`
        .wb-board{display:grid;grid-template-columns:repeat(${advisors.length},minmax(0,1fr));gap:12px;margin-top:12px;align-items:start}
        .wb-col{background:rgba(54,67,74,0.045);border-radius:10px;padding:10px 10px 12px;min-width:0}
        .wb-card{background:${C.white};border:1px solid rgba(54,67,74,0.12);border-radius:8px;padding:10px 12px;margin-top:8px;cursor:pointer;box-shadow:0 1px 2px rgba(54,67,74,0.06)}
        .wb-card:hover,.wb-card:focus-visible{outline:none;box-shadow:0 0 0 2px ${C.teal}}
        .wb-chip{font-size:11.5px;font-family:${FONT_BODY};color:${C.gray};background:rgba(54,67,74,0.07);border-radius:999px;padding:3px 9px}
        .wb-chip-on{background:rgba(136,209,209,0.35);font-weight:bold}
        .wb-next{margin-top:7px;font-size:12px;font-family:${FONT_BODY};color:${C.gray};line-height:1.35;background:rgba(136,209,209,0.18);border-radius:6px;padding:5px 8px}
        .wb-last{margin-top:8px;padding-top:7px;border-top:1px solid rgba(54,67,74,0.1);font-family:${FONT_BODY}}
        .wb-last-meta{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;font-weight:bold;color:${PD_MUTED}}
        .wb-last-text{font-size:12.5px;color:${C.gray};line-height:1.4;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-line;overflow-wrap:anywhere}
        .wb-m{display:none}
        @media (max-width:700px){
          .wb-board{gap:6px}
          .wb-col{padding:7px 5px 8px;border-radius:8px}
          .wb-col-h span:first-child{font-size:11.5px !important;line-height:1.2}
          .wb-col-h span:last-child{font-size:16px !important}
          .wb-card{padding:7px 7px 8px;margin-top:6px;border-left-width:4px !important;border-radius:6px}
          .wb-top{display:block !important}
          .wb-name{display:block;font-size:12px !important;line-height:1.25 !important;overflow-wrap:anywhere}
          .wb-amt{display:block;font-size:13px !important;margin-top:2px}
          .wb-kind{font-size:8.5px !important;letter-spacing:.04em !important;margin-top:3px !important;line-height:1.25}
          .wb-light{font-size:10.5px !important;gap:4px !important}
          .wb-dot{width:7px !important;height:7px !important}
          .wb-chips{display:none !important}
          .wb-next{font-size:10px;padding:3px 5px;margin-top:5px}
          .wb-due{display:block;font-size:10.5px !important;margin-top:2px}
          .wb-task{font-size:10.5px !important;line-height:1.35 !important}
          .wb-d{display:none}
          .wb-m{display:inline}
          div.wb-m{display:block}
        }
      `}</style>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 10, fontSize: 12, color: "rgba(54,67,74,0.75)", fontFamily: FONT_BODY }}>
        {["green", "yellow", "red"].map(k => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: WB_LIGHT[k].color }} />
            {WB_LIGHT[k].hint}
          </span>
        ))}
      </div>
      <div className="wb-board">
        {advisors.map(a => {
          const mine = sortCards(cards.filter(c => c.advisor === a));
          return (
            <div key={a} className="wb-col">
              <div style={{ height: 4, borderRadius: 2, background: CAL_ADVISOR_COLORS[a] || CAL_UNASSIGNED_COLOR, marginBottom: 8 }} />
              <div className="wb-col-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 4, fontFamily: FONT_BODY }}>
                <span style={{ fontSize: 14, fontWeight: "bold", color: C.gray }}>{a}</span>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: C.gray }}>{mine.length}</span>
              </div>
              {mine.length === 0 && <div style={{ fontSize: 12.5, color: PD_MUTED, fontFamily: FONT_BODY, padding: "10px 2px 2px" }}>{talks ? "No one in talks right now." : "No one on the list yet."}</div>}
              {mine.map(c => <WhiteboardCard key={c.key} c={c} onOpen={() => setOpen(c)} />)}
            </div>
          );
        })}
      </div>
      <PdNote>
        {talks ? <>Not visited yet; a note, call or meeting in the last {WB_YELLOW} days. Moves up to the whiteboard after the visit.</> : <><strong>Qualified Opportunity:</strong> active prospect that visited in the last 60 days. <strong>Active Negotiation:</strong> advisor working toward an OTP · estimated amount.</>}
      </PdNote>
      {open && <WhiteboardDetail c={open} onClose={() => setOpen(null)} />}
    </div>
  );
};

// The CEO report's pipeline table, live.
const SalesPipelineTable = ({ qoCount, openDeals, onOpenStage }) => {
  const rows = [
    { key: "qo", label: "Qualified Opportunities", house: "Active prospect that visited in the last 60 days", n: qoCount, value: null },
    ...PIPE_STAGES.map(s => ({ key: s.key, label: s.label, house: s.house, n: openDeals[s.key].length, value: openDeals[s.key].reduce((t, d) => t + d.amount, 0) })),
  ];
  const totalN = rows.reduce((t, r) => t + r.n, 0);
  const totalV = rows.reduce((t, r) => t + (r.value || 0), 0);
  return (
    <div>
      {rows.map((r, i) => (
        <PdRow key={r.key} numSize={30} stat={{ label: r.label, house: r.house, money: true }} n={r.n} total={r.value || 0} first={i === 0}
          onOpen={() => onOpenStage(r.key)} />
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderTop: `1.5px solid ${C.gray}` }}>
        <div style={{ flex: 1, fontSize: 15, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY, letterSpacing: "0.04em" }}>TOTAL OPEN PIPELINE
          <div style={{ fontSize: 11.5, fontWeight: "normal", color: PD_MUTED, marginTop: 2, letterSpacing: 0 }}>Each opportunity in one stage only · executed PSAs excluded</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 30, lineHeight: 1, color: C.gray }}>{totalN}</div>
          {totalV > 0 && <div style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: "bold", color: C.teal, marginTop: 2 }}>{money(totalV)}</div>}
        </div>
        <span aria-hidden="true" style={{ fontSize: 22, color: "transparent", lineHeight: 1, marginLeft: -4 }}>›</span>
      </div>
    </div>
  );
};

// Qualified Opportunities list (Sales pipeline row), same people the count uses.
const QualifiedOppList = ({ cards, onClose }) => {
  const list = [...cards].sort((a, b) => (a.advisor || "").localeCompare(b.advisor || "") || (b.lastVisit?.departure || 0) - (a.lastVisit?.departure || 0));
  return (
    <Modal title="Qualified Opportunities" subtitle={`${list.length} · Active prospect that visited in the last 60 days`} onClose={onClose}>
      {list.length === 0 && <div style={{ fontSize: 13, color: PD_MUTED, fontFamily: FONT_BODY }}>None right now.</div>}
      {list.map(c => {
        const L = WB_LIGHT[c.light];
        return (
          <div key={c.key} style={ROW_STYLE}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
              <Subhead>{c.name}</Subhead>
              {(() => {
                const today = pdDay(new Date());
                const onProp = c.nextVisit && c.nextVisit.arrival <= today;
                const label = onProp ? nextVisitLabel(c.nextVisit, today) : c.lastVisit ? `Visited ${visitWhen(c.lastVisit)}` : "";
                return label ? <span style={{ fontSize: 12, color: onProp ? C.gray : PD_MUTED, fontWeight: onProp ? "bold" : "normal", fontFamily: FONT_BODY, whiteSpace: "nowrap" }}>{label}</span> : null;
              })()}
            </div>
            <RowMeta>{[c.advisor, c.src, c.ref && `via ${c.ref}`, c.leadStatus && `Lead Status: ${c.leadStatus}`].filter(Boolean).join(" · ")}</RowMeta>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 12.5, color: C.gray, fontFamily: FONT_BODY }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: L.color }} />
              {c.days == null ? "No note, call or meeting yet" : `Last ${activityLabel(c.lastNote)} ${twDayFmt(c.lastActivity)} · ${c.days === 0 ? "today" : `${c.days} day${c.days === 1 ? "" : "s"}`}`}
            </div>
            {c.nextTask && <div className="wb-next" style={{ marginTop: 6 }}><strong>Next · {twDayFmt(c.nextTask.date)}</strong> {c.nextTask.text}</div>}
          </div>
        );
      })}
    </Modal>
  );
};

const PipelineDealList = ({ stageKey, openDeals, onClose }) => {
  const st = PIPE_STAGES.find(s => s.key === stageKey);
  const items = openDeals[stageKey];
  const total = items.reduce((t, d) => t + d.amount, 0);
  return (
    <Modal title={st.label} subtitle={`${items.length} · ${money(total)} · ${st.house}`} onClose={onClose}>
      {items.length === 0 && <div style={{ fontSize: 13, color: PD_MUTED, fontFamily: FONT_BODY }}>None right now.</div>}
      {items.map((d, i) => {
        const { property, buyer } = splitDealName(d.name);
        return (
          <div key={i} style={ROW_STYLE}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <Eyebrow>{property}</Eyebrow>
                {buyer && <Subhead>{buyer}</Subhead>}
              </div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, color: C.gray, whiteSpace: "nowrap" }}>{money(d.amount)}</div>
            </div>
            <RowMeta>{[d.advisor, d.src && `${d.src}${d.ref ? ` · via ${d.ref}` : ""}`, d.created && `Created ${twDayFmt(d.created)}`, d.dd && `DD ${twDayFmt(d.dd)}`, d.notes].filter(Boolean).join(" · ")}</RowMeta>
          </div>
        );
      })}
    </Modal>
  );
};

// ══════════════════════════════════════════════════════════════════════
// ── REPORT (Paul White's LIFE Weekly CEO Sales Report, live) ──────────
// Numbers are built live from the same data as the rest of the app, for a
// Monday–Sunday week. Eli's parts (status, comments, forecasts, top 3, wins,
// priorities, support) are typed in the "CEO_Report" tab, one row per week,
// keyed by "Week Ending" (the Sunday). Past weeks stay visible.
// Point-in-time lines (pipeline, active counts) always show today's numbers.
// ══════════════════════════════════════════════════════════════════════
const LIFE_LOGO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEARwBHAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wgARCADIASoDASIAAhEBAxEB/8QAHAABAAIDAQEBAAAAAAAAAAAAAAUGAwQHCAIB/8QAFwEBAQEBAAAAAAAAAAAAAAAAAAECA//aAAwDAQACEAMQAAAB9UgAAAAAAAAAAAAAAAAAAAAAAAAAAAAIffNkAAAAAAAAAAAAAAAAA/DknW/NvpOULAAAAAAAAAAAAAAAAFNuXniWP9L8G7yBYAAAAAAAAAAAAAAhJuvlgcC7Qu7409CebZr0L1ygX9kLAAAAAAAAAAAAAAAKj5m9j8zmuF139yTfr6fw5tcgAAAAAAAAAAAAAAAHFu00qXynOd632oKe3INnpbQ37AAAAAAAAABgM4AAADFlAAADX+TafH2AADGZGDIfYAAAHJOt8ll60LAAAOU9W5T1ZQQADkF5oV1lsW4WAAOQdf4+t4lYW2J+gAAAcl61VotKnT1SYAAOUdXgZ4AAA5P1iAn4CgAHJetVdbQqMok0AAAAUsuilzJNoGHLsq2csSD1yyKpvk4q06biqb5OKp9loVz6LCqmwWNXP0sSC+SfUqyEirkubgAAAEdIiB2JYR3zJiGyygjf2REHsyYiN/YEX8S4jteZEVhmxD4p0ROWREX9yIr8jviE2JMAAAAAAAAAAAAAAAAAAAAAf//EACwQAAICAQIFAgUFAQAAAAAAAAMEAgUBAAYTFSAwUAcUEhcjNTcQITZHYHD/2gAIAQEAAQUC/wCDW7uK6tW+L2/hN7ucVnHhM/thdvN5vrwm7bLllJ6fA4l94T1EsePYemofr+A5sGL/AOjB4rAebk+56cB+Gs8BdUwbpNTc7+2W66zWtQb+s/aVGtjB4W3PA7j2+K+TxN2gfurw96bVAD21L4LfFOu3WaHDiEFDhi8F6jWXwA1Rh9xc7w3E1SP0e707jwVptJG3b+X1VpDZldXN2+10rtj5fVWklMJA81xx8XsTLAeeubAh590HUZYnjqkSMNcceoyxLtR/I3Y3h946zgGz6gT21Vk0ooFEHVuYcTbsntiqJpCtWrBdmP5F7G8PvPW2Ugd/RtbDJuvc+Zx3ZNu3xnHah+Rexu/711/2J2NwfzHts7dWZsJ7YCTVfXjrV+qwpgWTPXyUHOOxZbfDZuSoJz1W1vLseP5o1720tTquPvZV1FsgrPmjWXW3iwtLR0ieUisO1tQdhuELI2aqsPNkNbZ+7acLkCjDzXKkLDFhKJW+ZtvEhZ2rpEtAcOSmQtCsSs7KSJ7xk6SDzB0Khl+QsDdmO1zcHEds8xKhspHo0y5Op2VUoqlbqBOGPX4ZANPGGFUYqnNXym6wjhqSKWEAIpxRDGqhFFNUisYIfXOLDAIoRiBStGm1hOOHzISm4yhhvIauIUp1g5WDNQByDiGHa51OLqLCEGBiTjFlumE4qdSLEh1QxLpqzVj/AJD/xAAaEQEAAgMBAAAAAAAAAAAAAAABAEARIVBg/9oACAEDAQE/Aeg0iNIjRGmTM1yzyH//xAAUEQEAAAAAAAAAAAAAAAAAAABw/9oACAECAQE/AXf/xABBEAACAQIDAwgDDQgDAAAAAAABAgMAEQQSIRMxQQUUIjBQUWFxEDLBICMzQlJyc3SBhJGhsRVDU4KSk+HwYHDR/9oACAEBAAY/Av8AobEYj5C6efCos5u+UXPYvJ3Jqn4WUO48L6djRS702vR+avYs7g2kf3tPM1n/AIcTH2dixYRT0YRmbzNY2XuVV7BOElOxm3oH3SDw9Mkr6Ki5jU2If1pWLViJPly2/AdgmGTRhqkg3qaOB5TU4iNdzfGt3jvFbXDSiRfzHnXN1PvmIOX+Xj6MOflln/PsLKbLOvwcnd/imAZsNiIzY2/3WopJwoKJlsu7z9GCj7ol/TsOTFsdnPANH7/D0InyiBSL3C3YcGBU+udo/lw9GCj75VrBjDsLFSzo25qVCeb4j+G53+R7COIxG1MhFui9hX7/APuVHiYtrtIzcZn0pZsTtMyrlGVrV+//ALlCISSSgbjK1z23s9ou035L69SAzqpO6539RZpFU9xNfCp/VV1II8Pd9JgPM166/jWhB8uqf6t7B1PIP0x/VeoCSosic29VhcV0sBB/TSwwII4l3KPd8jRuoZG0Kncda1wMP2C1GPDR7JCc1geqk+rewdTyD9Mf1XqM0UJnfm/qBgKRTyRIqk2L7ZdOo5HMah34KTbjXR5PgP3j/HVyfVvYOp5B+mP6r1H3bqeRP949Y2NzzRYgrlzRSZdK6WKxp+8GtjGzst73kbMfd4WeXPnwzZkynqP2ld+cZMm/o26mDFNLLFNCLIYzWvKmP+yQf+VIOcT4jOb3nfNbtCVFCuFxIh2eXXLYEm/hUkURTSJWRCPXYta1YWMAbXESbMX3DS5/ShhJDnV4zIjWsdN4NTooWQJilhyZdcuUEm/hXNhIIk2Ie+zza5rVhAHVBI+V3YbhlJ9lRSMRBM2twt9KaWWUEB3TKEtuNqx2I6O0hMoXTTo7qWRpc91U5cmWxp4pJNlOl82FZbHfoQeIqeRfWRCw/CsJNAqNiJMpKnjpcis8ZvC0YYd99b0cLzhbLEJM2z8a5sJBEmxz3yZtb2rCAOq7SXI7sNwyk+yjiXVUm2bMO7wNQxSBUxCuY51/luCPA1h7AbLMNsT8UHQfnU2JhkUbJL5WW96xWIziSVELrdbDdWDQW2uIbKD3aXNczk6YaPao/wBtiDWKilCi+c4Zrb8u8HxosljKdEB3ZuFHGAASiIkg8GG/86gkb1nQMbeXVYiQMSZnzm/DS1SvIW98iEdhwsb386hSR2MkRDLLxzDjW3ds8uXID3CsVIGJM75zfhoB7K5zHOYpNns/VB0vesMzsbwtm+dpatirs0YPRDfFHdRjViwLs+vib1icNnbLOXJPEZqVDOZEVQoBUCo5ZZDM8d8hKgWvUkRNg6lbisLHmNsPa3jYWrETRkjbm5TgD4U2KzHMY9nl4b65zHMYpNns/VB43rDF3N4Xz/O0tUuFEjbJrhb/ABAeAqHFglZI1K6bmHjWJEvSM+mbiumlqfCSSNZ0yF+NS4ZmKrImS431ELlXiIZHG8GjiGOeYrkzdwp4XZheTaBxvU1Fn1WM3ycCaxcKsRHiCxt8m41tSoZjIiqFAKgf8R//xAAsEAACAgECBAYCAgMBAAAAAAABEQAhMUFRYXGBkTBQobHB8BAgQNFgcOHx/9oACAEBAAE/If8AQxUmznjOg7kQy7hUVfkpLCBHIDu+0BBeSECElDePUivgFez6weSUsH7GwZjNGOulfI+S2GJg+2PeM/6xJPkIKIfQdweDyz+TQNicAHCXs14PA7T6eAf35CJ/3mMQ9u02mgnuQJ13WXYNIqU7Mv4Dr+GwEe+EB6DyIkW5K8tjxRf6iWfgICs4crfqhKBM+t4t8+RgjORDF5/H4MMz3UwQmgNOQ8jyFVGyg7+34qBh7u4dlFkwNXAbVrXPU9/IivCGIAbCcD6coF3UEZLHWbImGTcAD9Paab+0xs/O+AvBruvBKaFCIHk8DgP5gx/9aDpq1Jj9zyLngT/w8DsbxP8Al0eDBUx0RtDbIO4X2jW6aUa/uKExCsG4Qg3t/hQKtmMN9f5eBhEa1hrcwcc7ABdlDwByiDVCW10lMB5gyDz/AC2OGj7wIvA+zm8RQFjMwJfgkbgtdsPE/uXVhUh1nfA8Dpi/aLwVGfHCtuwZihyXtFqUFgTby84jAJ8BW3FuJ2mTgoycteqh5G+daJxQKDcVQhgO4BBgGuZGw7C3E7Sk8VxuXZCBysKCDmAwJwC1FE6hHg5v9KOIFvhCv7mRbtB5nwLoM3rCjAStvYhzzpEVWZhgjE7KN05ibEqokqh9CIAeSSh55Kmssws7CDpYS8/jRdRcGwHMYyQCydWxCK4wKcwimC6AEQIEkPVN/ohvyStG93H+76TQCAbgk0RArOLkITLJhhFBA6guKUQLT0kzxHKAZFjMi/tBsgaoMoegxVWxhkD4SDS5LIg7TR2hNIE7D7QfN7oCDou2OMYpfIADGUOJg02xpaoIMDIJgA2Netw9NhwETW7xwSSpdp4DSNEQFbJ8owZQvIa5OIJNcFqxDUc5QDLGahzBAyBhQSzkM6bNu8TqjroebJlIXYKAi/WabsQAslxVq6gWa3C4Z/XEfpgaOFmVRkhXRa5wZ6jGAmgbFnmYkgAYD8dodZIloCE4U6zMkE+2kKrEgQVrQHOMqUtBpdeohZJo4AoIE8ri03CAq3yRfF7gqbH+I//aAAwDAQACAAMAAAAQ88888888888888888888888888888o888888888888888884j8888888888888888823888888888888888dUI+8888888888888888+yc88888888888888882FfU8888888888888808884888488888S8888A88830888h8888HJ888p888j8884F88881995191591xxx1x8888Mtsd888s8sdds9M888888888888888888888//8QAHxEAAgICAwADAAAAAAAAAAAAAREAIDFAECFBMFBh/9oACAEDAQE/EPsOgA0gZmegP2EKD7MtFHRmNIgCzCMw3h7U4FC/KZQuonVCeqEugKNk4oooouFFFFFwrv4Xy9f/xAAZEQEBAQADAAAAAAAAAAAAAAABQAARUGD/2gAIAQIBAT8Q7AicROIWTi987//EACsQAQEAAgECBQMDBQEAAAAAAAERACExQWEwUFFxgSCRoRCxwWBw0fDx4f/aAAgBAQABPxD+wxmgof8A0InzicyK3o6+98lqwTjaAjspTswjBA0eSGAAqnQeuGFKHSH/ALrw4HkgTNxHbUU/1jKLAC9FL8eSLozlNUNT0PcJ92V44N9xPweQPGHuLWfM8HTcekwb+gN1OeEL9sfZZHQtHYgOwY6h0T6mh9/IVIWga3Dcz1Op8YNQAa60eY6bEl6Yk16LnqDtdn4zmaMDsivz+R+jXBruKPseRCFypH57qHTkziZ+AeSnJNlojhBGoRKsFYqU41nawuAARvO4L8+RuvetTBPqK7cj2uHGcINPcD+cION+gA/jyN4Sw13x7tfj+nRoB2CvwZqYADSCNjpiPXBiTogfFHt12YN8gchHDRNAhrq+7n/cYczZXsVMb0ssAMU+3CO64AQCNEYj64RQc0UQqVCatfOxUUFtB7mzvPBpMcVNaC7dnHr4GoKjo540uAKOdv8APnDgYyfJ9YYCUCSfLgpRv9PXFwgxQF+PBeMA6Nj34LuOSfWsYgZE1a1S5dAdC/vGc4nS2qpVeV+u7BAAOnAmOqbmt90YyXgjWAuy8B4LxhvYfgu54B9YSZoxCa8evTviLs+tgXYgbh6YfWgnboPTLHeOHBKBXAu3jjTEJKDQfBeMNyd9/tl8AQfXz7zIENHgb29FyEy+FXsRpIhDqBfbLe55pftgLZzr5OtNaOn1lSEN9rZjHS118Dupa3AF5rrm4eA1aGydUKneOqM9Dfw4FzA1Ak1IPL5fos2T9SIQaNRSgmluNgqNm6YSNE42tCYPYi7Gtk4IUqnTCATcJFRp4gHUTVxUdThFA0ailBOUcuX6YYJB1AenvkmGrBAkBGm9LgPTuzrHUnBXuTCZfC1zjNmxJXCUkQVCMLvhdl7YPWcEByTpv0164O5iCSEkpFQCjseOHLsIp1KGDWbBD2h0GJWKc5tpp52kelWjSOJroEnVnUIb53heN1StSD0f9wE/k4ESQGw7urjtCEOXVVBb2tLjRh1xYtoAjelORzlyNU+H03q9ByHRNZKWCBXRki4Cwh0gEd05zYGfIhbrcQC8piRBUTEE0pAAoomqvt1W5ge7gGSjMUHBIaUM3Kr2HLal+DQrwClyOOWpWIdCvgpRMjY0kcGCyF3drirVlgUzVEiPBGBIptOBIcCIRETG4lwisBwwV7BwYOdq4LRCyB3drku2ECJAu0cyZLBCVhwU4RsP2xtQPxVRAruKqEOmOiUEAsNBoUHbAg7CWtDScko97iALWhIVsVD2yb6BTMCk9DodWu8mC+iDJLql642SkmiPGbKZNmD8UlI7NKLYcXfVw3IvRACNW2OZli5ZD6QLb3mPkCGMXBTSGwmbEn20N02i8iDOAxcvmhARm20jijjFC60KhGcgnuOcK2RoFlNmXibwXzPKoCiX3M3L1NGEJEUiiIuCmYiTqbiqrtYdDKHS0iackjs5FHFZGGiKCepE6t6GQH1dUA14Ww3a4k8poCBbFh7f0j//2Q=="; // LIFE Properties International logo (from the report PDF)
const CONTRACTED_GOAL = 270000000;   // Contracted Sales Volume goal in the report (Eli, Nov 2)
const RAISED_TARGET = 350000000;      // updated goal (Eli, Nov 2): its own row in Section 1
const CEO_FIELDS = {
  status: "Sales Status", s1: "Sales Performance Comments", s2: "Weekly Activity Comments",
  next30: "Next 30 Days", next60: "Next 60 Days", s3: "Pipeline Comments", s4: "Top Opportunities Comments",
  wins: "Key Wins", priorities: "Top 3 Priorities", support: "Challenges / Leadership Support", s5: "Director Comments",
  forecast30: "30-Day OTP Forecast", portfolio: "Portfolio Comments", director: "Director of Sales",
  paul: "Question for Paul", others: "Other Projects", oppTotal: "Top Opportunities Total",
};
const ceoList = v => pdStr(v).split(/\s*(?:\|\||\n)\s*/).map(x => x.trim()).filter(Boolean);
function ceoRowFor(rows, weekEnd) {
  return (rows || []).find(r => { const d = twParseDate(r["Week Ending"]); return d && calSameDay(d, weekEnd); }) || null;
}
function topOppsFrom(row) {
  if (!row) return [];
  return [1, 2, 3, 4, 5].map(i => ({
    prospect: pdStr(row[`Opp ${i} Prospect`]), product: pdStr(row[`Opp ${i} Product / Value`]),
    status: pdStr(row[`Opp ${i} Status / Next Step`]), target: pdStr(row[`Opp ${i} Target PSA Date`]),
  })).filter(o => o.prospect);
}
// "Saved …" columns in CEO_Report keep the numbers as they were sent that
// Monday; when a cell is empty the report uses the live number.
const ceoSaved = (row, name) => {
  const v = row ? pdStr(row[`Saved ${name}`]).replace(/[$,\s]/g, "") : "";
  return v === "" || isNaN(Number(v)) ? null : Number(v);
};
// Inline markup typed in CEO_Report: **bold**, ^^yellow (still open)^^.
const RpText = ({ text }) => {
  const parts = String(text || "").split(/(\^\^[\s\S]+?\^\^|\*\*[\s\S]+?\*\*)/g).filter(Boolean);
  return <>{parts.map((p, i) => p.startsWith("^^") ? <mark key={i} className="rp-hl"><RpText text={p.slice(2, -2)} /></mark>
    : p.startsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>)}</>;
};
// $5.85M · $257.3M (one decimal from $100M) · $270M for round goals.
const rpM = v => {
  if (v == null) return "—";
  const m = v / 1e6;
  if (Number.isInteger(m)) return `$${m}M`;
  return `$${m >= 100 ? m.toFixed(1) : m.toFixed(2)}M`;
};
const rpLongDate = d => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

const RP_BLUE = "#365F91", RP_RULE = "#4F81BD", RP_INK = "#222222", RP_GREY = "#6B6B6B";
const RP_CSS = `
.rp-wrap{background:#fff;border-radius:12px;border:1px solid rgba(54,67,74,0.10);padding:26px 20px 28px}
.rp{max-width:540px;margin:0 auto;font-family:Arial,"Liberation Sans",Helvetica,sans-serif;color:${RP_INK};font-size:14px;line-height:1.45;font-variant-numeric:tabular-nums}
.rp-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.rp-logo{display:block;width:74px;height:auto}
.rp-kicker{font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:${RP_GREY};margin-top:14px}
.rp-title{font-family:Georgia,"DejaVu Serif",serif;font-size:38px;line-height:1.05;margin:4px 0 10px;color:${RP_INK}}
.rp-meta{display:grid;grid-template-columns:auto 1fr;column-gap:12px;row-gap:2px;font-size:12.5px;color:${RP_GREY};padding:10px 0 12px;border-top:2px solid ${RP_BLUE};border-bottom:1px solid #E4E4E4}
.rp-meta b{font-weight:normal;color:${RP_INK}}
.rp h2{display:flex;align-items:baseline;gap:10px;font-family:Georgia,"DejaVu Serif",serif;font-weight:normal;font-size:22px;line-height:1.2;color:${RP_BLUE};margin:34px 0 12px;padding-bottom:9px;border-bottom:1px solid ${RP_RULE};break-after:avoid;page-break-after:avoid}
.rp h2 .no{font-size:13px;font-family:Arial,sans-serif;font-weight:bold;color:#fff;background:${RP_BLUE};border-radius:50%;min-width:22px;height:22px;line-height:22px;text-align:center;flex:none;transform:translateY(-2px)}
.rp-kpi{padding:11px 0 12px;border-bottom:1px solid #ECECEC;break-inside:avoid;page-break-inside:avoid}
.rp-kpi-n{font-weight:bold;font-size:14px}
.rp-kpi-g{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));column-gap:8px;margin-top:6px}
.rp-kpi-g span{display:block;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:${RP_RULE}}
.rp-kpi-g b{display:block;font-weight:normal;font-size:14.5px;margin-top:3px;white-space:nowrap;color:${RP_INK}}
.rp-kpi-g div:nth-child(2) b,.rp-kpi-g div:nth-child(2) span{font-weight:bold}
.rp-kpi-g div:nth-child(3) b{color:${RP_GREY}}
.rp-kpi-g div:nth-child(4) b{color:${RP_BLUE}}
.rp-hl{background:#FFF200;color:inherit;padding:0 2px;border-radius:2px}
.rp-status{margin-top:16px;padding-top:12px;font-size:14.5px}
.rp-status .rp-kpi-n{margin-bottom:6px}
.rp-st{display:flex;align-items:center;flex-wrap:wrap;gap:10px}
.rp-pill{display:inline-block;font-weight:bold;font-size:13px;letter-spacing:.03em;padding:4px 12px;border-radius:999px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.rp-pill.ok{background:#F6E3A1;color:#6B5200;border:1px solid #E2C463}
.rp-pill.risk{background:#F8D3CF;color:#8A1C12;border:1px solid #E7A39B}
.rp-pill.behind{background:#FBDDBE;color:#8A4A00;border:1px solid #EDB57E}
.rp-off{font-size:11px;color:#A3A3A3}
.rp-lbl{font-size:10px;letter-spacing:.18em;text-transform:uppercase;font-weight:bold;color:${RP_BLUE};margin:20px 0 6px;break-after:avoid;page-break-after:avoid}
.rp-cm p{margin:0 0 9px;font-size:13.5px;line-height:1.55;color:#333}
.rp-cm p,.rp li{orphans:3;widows:3}
.rp-list-h b{font-weight:bold}
.rp-list-h{text-align:right;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:${RP_RULE};margin-bottom:2px}
.rp-row{display:flex;justify-content:space-between;align-items:baseline;gap:14px;padding:8px 0;border-bottom:1px solid #ECECEC;break-inside:avoid;page-break-inside:avoid}
.rp-row > span:first-child{color:#333}
.rp-row > span:last-child{text-align:right;white-space:nowrap}
.rp-row .v{font-size:14px}
.rp-row .v.y,.rp-row .v.y + .u{font-weight:bold}
.rp-row .d{color:#B5B5B5;margin:0 5px}
.rp-row .u{color:${RP_GREY};font-size:12px;margin-left:3px}
.rp-row.tot{border-top:1.5px solid ${RP_INK};border-bottom:none;margin-top:-1px;padding-top:10px}
.rp-row.tot > span:first-child{font-weight:bold;color:${RP_INK};letter-spacing:.04em}
.rp-fc{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:4px}
.rp-fc .rp-lbl{margin-top:14px}
.rp-fc div div:last-child{font-size:13px;line-height:1.45}
.rp-opp{display:grid;grid-template-columns:26px 1fr;column-gap:10px;padding:12px 0;border-bottom:1px solid #ECECEC;break-inside:avoid;page-break-inside:avoid}
.rp-opp-i{width:24px;height:24px;border-radius:50%;border:1.5px solid ${RP_BLUE};color:${RP_BLUE};font-weight:bold;font-size:12px;line-height:21px;text-align:center}
.rp-opp-n{font-weight:bold;font-size:14.5px}
.rp-opp-p{display:flex;justify-content:space-between;gap:10px;align-items:baseline;margin-top:2px;font-size:13.5px}
.rp-opp-p strong{white-space:nowrap;font-size:14px}
.rp-opp-s{font-size:12px;color:${RP_GREY};margin-top:3px;line-height:1.4}
.rp-opp-t{font-size:11.5px;margin-top:5px;color:${RP_GREY};letter-spacing:.02em}
.rp-total{display:flex;justify-content:space-between;font-weight:bold;padding:10px 0 0;border-top:1.5px solid ${RP_INK};margin-top:-1px}
.rp ul,.rp ol{margin:4px 0 0 18px;padding:0}
.rp li{margin-bottom:7px;font-size:13.5px;line-height:1.5;color:#333}
.rp li::marker{color:${RP_RULE}}
.rp-sub{font-size:12px;font-style:italic;color:${RP_GREY};margin:-2px 0 12px}
.rp-small{font-size:11.5px;color:${RP_GREY};margin:16px 0 2px;letter-spacing:.02em}
.rp-proj{font-weight:bold;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${RP_INK};margin:6px 0 2px}
.rp-def li strong{font-weight:bold;color:${RP_INK}}
.rp-foot{text-align:center;font-size:9px;letter-spacing:.26em;color:${RP_GREY};margin-top:30px;padding-top:12px;border-top:1px solid #ECECEC}
@media (max-width:700px){
  .rp-wrap{padding:20px 16px 24px;border-radius:10px}
  .rp-title{font-size:34px}
  .rp h2{font-size:min(20px,3.75vw);white-space:nowrap;gap:7px}
}
@media print{
  .nk-topnav,.nk-bottomnav,.nk-header,.nk-footmark,.rp-noprint{display:none !important}
  html,body{background:#fff !important}
  .nk-root{padding:0 !important;max-width:none !important}
  .rp-wrap{border:none;padding:0;border-radius:0}
  .rp{-webkit-print-color-adjust:exact;print-color-adjust:exact;max-width:none}
  .rp-foot{display:none}
  @page{size:3.6in 7.8in;margin:0.3in 0.3in 0.45in;@bottom-center{content:"LIFE  |  INTERNAL SALES REPORTING";font-family:Arial,sans-serif;font-size:7px;letter-spacing:.24em;color:#6B6B6B}}
  .rp{font-size:12px}
  .rp-title{font-size:28px}
  .rp h2{font-size:13.5px;white-space:nowrap;gap:6px;margin:22px 0 8px;padding-bottom:6px}
  .rp h2 .no{font-size:10px;min-width:17px;height:17px;line-height:17px}
  .rp-kpi{padding:7px 0 8px}
  .rp-kpi-n,.rp-opp-n{font-size:12px}
  .rp-kpi-g b{font-size:11.5px}
  .rp-kpi-g span{font-size:7px}
  .rp-row{padding:5px 0}
  .rp-row .v{font-size:11.5px}
  .rp-row .u{font-size:10px}
  .rp-cm p,.rp li,.rp-opp-p,.rp-fc div div:last-child{font-size:11.5px}
  .rp-opp{padding:8px 0;grid-template-columns:20px 1fr;column-gap:8px}
  .rp-opp-i{width:18px;height:18px;font-size:9.5px;line-height:15px}
  .rp-opp-s,.rp-opp-t,.rp-sub,.rp-small{font-size:9.5px}
  .rp-lbl{font-size:8px;margin:14px 0 4px}
  .rp-list-h{font-size:7px}
  .rp-meta{font-size:10.5px}
  .rp-kicker{font-size:8px}
  .rp-pill{font-size:10.5px;padding:2px 9px}
  .rp-off{font-size:8.5px}
  .rp-logo{width:56px}
}
`;
const RP_GUIDELINES = [
  "Submit Monday morning for the prior Monday–Sunday reporting period.",
  "Use HubSpot as the source of record; apply consistent pipeline stages across projects.",
  "Count a sale upon fully executed PSA; report OTPs separately.",
  "Each opportunity belongs to one open pipeline stage; exclude executed PSAs.",
  "30-day and 60-day forecasts represent expected conversions; the 60-day period is cumulative.",
  "Status should reflect performance against the approved year-to-date plan.",
  "Central Sales Operations tracks Tour-to-OTP and OTP-to-PSA conversion using consistent cohorts.",
  "Project sales goals shown above are planning targets; confirm against approved budgets.",
];
const RP_DEFINITIONS = [
  ["Goal:", "$270M in contracted sales, raised to $350M; includes related-party sales and re-sales. No goal for OTP or PSA counts."],
  ["New leads:", "Qualified = relationship source or made SQL by an advisor. Web = Nauka or Siari website leads not yet SQL. Hotel = Siari Hotel Guest source only."],
  ["Prospect visits (Site Tours):", "every visit on property (experience, property tour or on-site meeting); second visits count again."],
  ["Qualified Opportunities:", "visited in the last 60 days, Lead Status Active and in contact with their advisor."],
  ["Active Negotiations:", "new deal stage before Pending OTP; the advisor is working toward an OTP. Value = advisor's estimate."],
  ["OTPs:", "Submitted = Pending OTP (Decision stage). Accepted = OTP signed."],
  ["Closed Sales Volume:", <>definition pending. <mark className="rp-hl"><strong>To confirm: Paul</strong></mark></>],
];

const RP_FIRST_WEEK_END = new Date(2026, 10, 1); // first weekly report sent: week ending Nov 1, 2026
const ReportView = ({ model, openDeals, qoCount, ceoRows, masterDeals }) => {
  const today = model.today;
  // Weeks run Monday–Sunday. The list starts with the first report (week ending
  // Nov 1, 2026) and ends with this week (in progress), newest first.
  const thisMon = twWeekStart(today);
  const weeks = [];
  for (let start = thisMon; pdAdd(start, 6) >= RP_FIRST_WEEK_END; start = pdAdd(start, -7)) {
    weeks.push({ start, end: pdAdd(start, 6), live: weeks.length === 0 });
  }
  const [idx, setIdx] = useState(weeks.length > 1 ? 1 : 0); // default: last finished week (the one sent Monday)
  const wk = weeks[idx];
  const until = wk.live ? today : wk.end;
  const jan1 = new Date(until.getFullYear(), 0, 1);
  const row = ceoRowFor(ceoRows, wk.end);
  const f = k => (row ? pdStr(row[CEO_FIELDS[k]]) : "");
  const todo = <span className="rp-hl">[Eli]</span>;
  const S = (name, live) => { const v = ceoSaved(row, name); return v == null ? live : v; };

  const c = (t, a, b) => model.count(t, a, b);
  const amt = (t, a, b) => model.amount(t, a, b);
  // Signed OTPs straight from Master_Deals (every OTP signed, also deals later Lost).
  const otpDates = (masterDeals || []).map(r => twParseDate(r["OTP Signed Date"])).filter(Boolean);
  const otpIn = (a, b) => otpDates.filter(d => d >= a && d <= b).length;
  const otpW = S("OTPs LW", otpIn(wk.start, until)), otpY = S("OTPs YTD", otpIn(jan1, until));
  const psaW = S("PSAs LW", c("psa", wk.start, until)), psaY = S("PSAs YTD", c("psa", jan1, until));
  const volW = S("Contracted LW", amt("psa", wk.start, until)), volY = S("Contracted YTD", amt("psa", jan1, until));
  const pct = (v, g) => g ? `${Math.round((v / g) * 100)}%` : "—";
  const qo = S("Qualified Opportunities", qoCount);
  const negN = S("Active Negotiations", openDeals.neg.length), negV = S("Active Negotiations $", openDeals.neg.reduce((t, d) => t + d.amount, 0));
  const potpN = S("Pending Acceptance", openDeals.potp.length), potpV = S("Pending Acceptance $", openDeals.potp.reduce((t, d) => t + d.amount, 0));
  const sotpN = S("Pending PSA", openDeals.sotp.length), sotpV = S("Pending PSA $", openDeals.sotp.reduce((t, d) => t + d.amount, 0));
  const openN = qo + negN + potpN + sotpN, openV = negV + potpV + sotpV;
  const booked = ceoSaved(row, "Tours Booked New"), scheduled = S("Tours Scheduled", model.visits.length);
  const opps = topOppsFrom(row);
  const autoOpps = [...openDeals.neg, ...openDeals.potp, ...openDeals.sotp].sort((a, b) => b.amount - a.amount).slice(0, 3)
    .map(d => { const { property, buyer } = splitDealName(d.name); return { prospect: buyer || d.name, product: `${property} · ${money(d.amount)}`, status: PIPE_STAGES.find(s => s.key === d.stageKey).label, target: "" }; });
  const top = opps.length ? opps : autoOpps;
  const paras = k => ceoList(f(k)).map((x, i) => <p key={i}><RpText text={x} /></p>);
  const Comments = ({ k }) => (
    <div className="rp-cm"><div className="rp-lbl">Comments / context</div>{f(k) ? paras(k) : <p>{todo}</p>}</div>
  );
  const Kpi = ({ name, lw, ytd, goal, pc, hl }) => (
    <div className="rp-kpi">
      <div className="rp-kpi-n">{name}</div>
      <div className="rp-kpi-g">
        <div><span>Last week</span><b>{hl ? <mark className="rp-hl">—</mark> : lw}</b></div>
        <div><span>YTD</span><b>{hl ? <mark className="rp-hl">—</mark> : ytd}</b></div>
        <div><span>Goal</span><b>{goal}</b></div>
        <div><span>% Achieved</span><b>{pc}</b></div>
      </div>
    </div>
  );
  const Row = ({ l, v, tot }) => <div className={`rp-row${tot ? " tot" : ""}`}><span>{l}</span><span>{v}</span></div>;
  // "3 · 188 YTD": numbers bold, separator and unit light.
  const two = (a, b, ua, ub) => <><span className="v">{a}</span>{ua && <span className="u">{ua}</span>}<span className="d">·</span><span className="v y">{b}</span>{ub && <span className="u">{ub}</span>}</>;
  const pair = (lw, ytd) => two(lw, ytd, "", "YTD");
  const status = f("status") || "";
  // The chosen status is a coloured pill; the other two stay small and grey.
  const statusLine = <div className="rp-st">{[["On Track", "ok"], ["At Risk", "risk"], ["Behind Plan", "behind"]].map(([s, k]) => (
    status.toLowerCase() === s.toLowerCase()
      ? <span key={s} className={`rp-pill ${k}`}>{s}</span>
      : <span key={s} className="rp-off">{s}</span>
  ))}</div>;
  const others = ceoList(f("others")).map(x => { const i = x.lastIndexOf(":"); return i > 0 ? [x.slice(0, i).trim(), x.slice(i + 1).trim()] : [x, ""]; });
  const weekLabel = w => `Week ending ${twDayFmt(w.end)}, ${w.end.getFullYear()}${w.live ? " (in progress)" : ""}`;

  return (
    <div>
      <style>{RP_CSS}</style>
      <div className="rp-noprint" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <select value={idx} onChange={e => setIdx(Number(e.target.value))}
          style={{ fontFamily: FONT_BODY, fontSize: 14, padding: "8px 10px", borderRadius: 8, border: `1px solid rgba(54,67,74,0.3)`, background: C.white, color: C.gray }}>
          {weeks.map((w, i) => <option key={i} value={i}>{weekLabel(w)}</option>)}
        </select>
      </div>

      <div className="rp-wrap"><div className="rp">
        <img className="rp-logo" src={LIFE_LOGO} alt="LIFE Properties International" />
        <div className="rp-kicker">LIFE &nbsp;|&nbsp; CEO Weekly Sales Report</div>
        <div className="rp-title">Nauka</div>
        <div className="rp-meta">
          <span>Director of Sales</span><b>{f("director") || "Eli Pacino"}</b>
          <span>Week ending</span><b>{rpLongDate(wk.end)}{wk.live ? " (in progress)" : ""}</b>
        </div>

        <h2><span className="no">1</span><span>Sales Performance &nbsp;|&nbsp; Actual vs. Goal</span></h2>
        <Kpi name="Offers to Purchase (OTPs)" lw={otpW} ytd={otpY} goal="—" pc="—" />
        <Kpi name="Executed PSAs (Sales)" lw={psaW} ytd={psaY} goal="—" pc="—" />
        <Kpi name="Contracted Sales Volume" lw={rpM(volW)} ytd={rpM(volY)} goal={rpM(CONTRACTED_GOAL)} pc={pct(volY, CONTRACTED_GOAL)} />
        <Kpi name="Contracted Sales Volume (updated goal)" lw="—" ytd={rpM(volY)} goal={rpM(RAISED_TARGET)} pc={pct(volY, RAISED_TARGET)} />
        <Kpi name="Closed Sales Volume" hl goal="—" pc="—" />
        <div className="rp-status"><div className="rp-kpi-n">Sales Status</div><div>{statusLine}</div></div>
        <Comments k="s1" />
        {f("paul") && <p className="rp-cm"><mark className="rp-hl"><strong>QUESTION FOR PAUL</strong> &nbsp;<RpText text={f("paul")} /></mark></p>}

        <h2><span className="no">2</span><span>Weekly Sales Activity</span></h2>
        <div className="rp-list-h">Last week · <b>YTD / Current</b></div>
        <Row l="New Qualified Leads" v={pair(S("Qualified Leads LW", c("qlead", wk.start, until)), S("Qualified Leads YTD", c("qlead", jan1, until)))} />
        <Row l="New Web Leads" v={pair(S("Web Leads LW", c("wlead", wk.start, until)), S("Web Leads YTD", c("wlead", jan1, until)))} />
        <Row l="New Hotel Leads" v={pair(S("Hotel Leads LW", c("hlead", wk.start, until)), S("Hotel Leads YTD", c("hlead", jan1, until)))} />
        <Row l="Site Tours / Immersions Completed" v={pair(S("Site Tours LW", c("tour", wk.start, until)), S("Site Tours YTD", c("tour", jan1, until)))} />
        <Row l="Upcoming Site Tours Booked" v={two(booked == null ? "—" : booked, scheduled, "New", "Scheduled")} />
        <Row l="Active Qualified Prospects" v={two(qo, "—", "Active", "")} />
        <Row l="Active Negotiations" v={two(negN, "—", "Active", "")} />
        <Row l="OTPs Submitted" v={pair(S("OTPs Submitted LW", c("hold", wk.start, until)), S("OTPs Submitted YTD", c("hold", jan1, until)))} />
        <Row l="OTPs Accepted / Pending PSA" v={pair(S("OTPs Accepted LW", otpW), S("OTPs Accepted YTD", otpY))} />
        <Row l="PSAs Executed" v={pair(psaW, psaY)} />
        <Row l="Sales Closed" v={<mark className="rp-hl"><span className="v">—</span><span className="d">·</span><span className="v">—</span></mark>} />
        <Comments k="s2" />

        <h2><span className="no">3</span><span>Sales Pipeline &amp; Forecast</span></h2>
        <div className="rp-list-h"># Deals · Estimated value</div>
        <Row l="Qualified Opportunities" v={two(qo, "—")} />
        <Row l="Active Negotiations" v={two(negN, money(negV))} />
        <Row l="OTPs Submitted / Pending Acceptance" v={two(potpN, money(potpV))} />
        <Row l="Accepted OTPs / Pending PSA" v={two(sotpN, money(sotpV))} />
        <Row tot l="TOTAL OPEN PIPELINE" v={two(openN, money(openV))} />
        <div className="rp-fc">
          <div><div className="rp-lbl">Next 30 days</div><div>{f("next30") ? <RpText text={f("next30")} /> : todo}</div></div>
          <div><div className="rp-lbl">Next 60 days</div><div>{f("next60") ? <RpText text={f("next60")} /> : todo}</div></div>
        </div>
        <Comments k="s3" />

        <h2><span className="no">4</span><span>Top 3 Sales Opportunities</span></h2>
        {top.map((o, i) => {
          const j = o.product.lastIndexOf(" · ");
          const product = j > 0 ? o.product.slice(0, j) : o.product, value = j > 0 ? o.product.slice(j + 3) : "";
          return (
            <div key={i} className="rp-opp">
              <div className="rp-opp-i">{i + 1}</div>
              <div>
                <div className="rp-opp-n">{o.prospect}</div>
                <div className="rp-opp-p"><span>{product}</span>{value && <strong>{value}</strong>}</div>
                {o.status && <div className="rp-opp-s">{o.status}</div>}
                <div className="rp-opp-t">Target PSA date &nbsp;{o.target ? <RpText text={o.target} /> : <mark className="rp-hl"><em>[Eli]</em></mark>}</div>
              </div>
            </div>
          );
        })}
        {f("oppTotal") && <div className="rp-total"><span>TOTAL</span><span>{f("oppTotal")}</span></div>}
        {!opps.length && top.length > 0 && <p className="rp-small">Largest open deals until Eli's list is in the CEO_Report tab.</p>}
        <Comments k="s4" />

        <h2><span className="no">5</span><span>Director of Sales Update</span></h2>
        <div className="rp-lbl">Key wins this week</div>
        {ceoList(f("wins")).length ? <ul>{ceoList(f("wins")).map((x, i) => <li key={i}><RpText text={x} /></li>)}</ul> : <p>{todo}</p>}
        <div className="rp-lbl">Top 3 priorities for next week</div>
        {ceoList(f("priorities")).length ? <ol>{ceoList(f("priorities")).map((x, i) => <li key={i}><RpText text={x} /></li>)}</ol> : <p>{todo}</p>}
        <div className="rp-lbl">Challenges / leadership support needed</div>
        {ceoList(f("support")).length ? <ul>{ceoList(f("support")).map((x, i) => <li key={i}><RpText text={x} /></li>)}</ul> : <p>{todo}</p>}
        {f("s5") && <Comments k="s5" />}

        <h2>LIFE &nbsp;|&nbsp; Consolidated Portfolio Dashboard</h2>
        <div className="rp-sub">Prepared by Sales Operations each Monday from individual project reports.</div>
        <div className="rp-proj">Nauka</div>
        <Row l="Sales Goal" v={rpM(RAISED_TARGET)} />
        <Row l="OTPs YTD" v={otpY} />
        <Row l="PSAs YTD" v={psaY} />
        <Row l="% Goal" v={pct(volY, RAISED_TARGET)} />
        <Row l="Open Pipeline" v={money(openV)} />
        <Row l="30-Day OTP Forecast" v={f("forecast30") || "—"} />
        {others.length > 0 && <>
          <div className="rp-small">Other projects &nbsp;(Sales Goal; other columns to be completed)</div>
          {others.map(([l, v], i) => <Row key={i} l={l} v={v} tot={/^total$/i.test(l)} />)}
        </>}
        {f("portfolio") && <Comments k="portfolio" />}

        <h2>Reporting Guidelines</h2>
        <ul>{RP_GUIDELINES.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <div className="rp-lbl" style={{ marginTop: 18 }}>Nauka definitions</div>
        <ul className="rp-def">{RP_DEFINITIONS.map(([b, t], i) => <li key={i}><strong>{b}</strong> {t}</li>)}</ul>

        <div className="rp-foot">LIFE &nbsp;|&nbsp; INTERNAL SALES REPORTING</div>
      </div></div>
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
  // Current HubSpot lead status of everyone who had a prospect visit in the last 60 days and has no deal yet.
  const statusOf = p => { const v = pdStr(p.status); return !v || v === "(No Status Set)" ? "No status" : v; };
  const STATUS_ORDER = ["Active", "Nurture", "Timing", "Unresponsive", "Gone Dark", "Not Interested", "Unqualified", "Unsubscribed"];
  const byStatus = (() => {
    const acc = new Map();
    prospects.recent.forEach(p => { const k = statusOf(p); acc.set(k, (acc.get(k) || 0) + 1); });
    const rank = k => { const i = STATUS_ORDER.indexOf(k); return i === -1 ? (k === "No status" ? 99 : 50) : i; };
    return [...acc.entries()].sort((x, y) => rank(x[0]) - rank(y[0]) || y[1] - x[1]);
  })();
  const maxStatus = Math.max(...byStatus.map(r => r[1]), 1);
  const tourInfo = p => `Visited ${twDayFmt(p.tourDate)}${p.tourDate.getFullYear() !== today.getFullYear() ? `, ${p.tourDate.getFullYear()}` : ""} · ${daysOpen(p)} day${daysOpen(p) === 1 ? "" : "s"}`;
  const stageAndStatus = p => [p.lifecycle, p.status || "No lead status"].filter(Boolean).join(" · ");

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
    visits: { title: "Upcoming Site Tours Booked", sub: `${visits.length} upcoming`, empty: "No visits scheduled.",
      items: visits, render: (v, i) => <ProspectRow key={i} p={{ name: v.name, advisor: v.coveredBy || v.owner, src: v.source }} right={calSameDay(v.arrival, v.departure) ? twDayFmt(v.arrival) : pdShortRange(v.arrival, v.departure)} /> },
    active: { title: "Toured Prospects", sub: `Toured since ${twDayFmt(win.start)} · no deal yet · not Lost`, empty: "No open toured prospects from the last 60 days.",
      items: prospects.active, render: (p, i) => <ProspectRow key={i} p={p} right={tourInfo(p)} sub={stageAndStatus(p)} /> },
    older: { title: "Older Toured Prospects Still Open", sub: `Toured before ${twDayFmt(win.start)} · no deal, not marked Lost`, empty: "None.",
      items: prospects.older, render: (p, i) => <ProspectRow key={i} p={p} right={tourInfo(p)} sub={stageAndStatus(p)} /> },
    toDeal: { title: "Moved to Pending OTP", sub: `Visited and inventory assigned · ${twRangeLabel(win.start, win.end)}`, empty: "No one who visited in the last 60 days has had inventory assigned yet.",
      items: prospects.toDeal, render: e => <TWEntryRow key={e.i} e={e} showDate /> },
  };
  byStatus.forEach(([st]) => {
    lists[`status:${st}`] = { title: `Toured Prospects · ${st}`, sub: `Visited since ${twDayFmt(win.start)} · no deal yet · current lead status`, empty: "None.",
      items: prospects.recent.filter(p => statusOf(p) === st), render: (p, i) => <ProspectRow key={i} p={p} right={tourInfo(p)} sub={stageAndStatus(p)} /> };
  });
  const open = openKey && lists[openKey];

  return (
    <div style={{ marginBottom: 26 }}>
      <PdSectionHead text="Site tours / immersions" first />
      {stageRow("visits", "Upcoming Site Tours Booked", "Upcoming Prospect Visits · booked in the calendar, not yet arrived", visits.length, true)}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 10, marginTop: 6 }}>
        <div style={{ background: C.white, border: "1px solid rgba(54,67,74,0.14)", borderRadius: 8, padding: "12px 15px", minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY, marginBottom: 4 }}>
            Where toured prospects went <span style={{ fontWeight: "normal", color: PD_MUTED, fontSize: 12 }}>· last 60 days</span>
          </div>
          {exit("toDeal", "→", C.green, prospects.toDeal.length, "Moved to Pending OTP", "Visited in the last 60 days, then inventory assigned")}
        </div>
        <div style={{ background: C.white, border: "1px solid rgba(54,67,74,0.14)", borderRadius: 8, padding: "12px 15px", minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY, marginBottom: 8 }}>
            Where toured prospects are now <span style={{ fontWeight: "normal", color: PD_MUTED, fontSize: 12 }}>· lead status, last 60 days</span>
          </div>
          {byStatus.length === 0 && <div style={{ fontSize: 12.5, color: PD_MUTED, fontFamily: FONT_BODY }}>No prospect visits in the last 60 days.</div>}
          {byStatus.map(([label, n]) => (
            <div key={label} role="button" tabIndex={0} onClick={() => setOpenKey(`status:${label}`)}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenKey(`status:${label}`); } }}
              style={{ display: "grid", gridTemplateColumns: "minmax(0, 110px) 1fr 22px", gap: 8, alignItems: "center", fontSize: 13, color: C.gray, fontFamily: FONT_BODY, padding: "4px 0", cursor: "pointer" }}>
              <span>{label}</span>
              <div style={{ height: 9, width: `${(n / maxStatus) * 100}%`, minWidth: 4, background: LEAD_STATUS_COLOR[label] || "rgba(54,67,74,0.3)", borderRadius: 5 }} />
              <span style={{ fontWeight: "bold", textAlign: "right" }}>{n}</span>
            </div>
          ))}
        </div>
      </div>
      {/* Days since the prospect visit, in one sentence (median past buyer as the benchmark) */}
      {aging.active != null && (
        <div style={{ fontSize: 13, color: C.gray, fontFamily: FONT_BODY, marginTop: 12, lineHeight: 1.5 }}>
          Recent prospects: {aging.active} day{aging.active === 1 ? "" : "s"} since their visit.
          {aging.buyersMedian != null && <> Buyers usually take about {Math.max(1, Math.round(aging.buyersMedian / 30))} month{Math.max(1, Math.round(aging.buyersMedian / 30)) === 1 ? "" : "s"}.</>}
        </div>
      )}
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
// screen, in thumb reach. Same seven destinations, same order.
// ══════════════════════════════════════════════════════════════════════

const NAV_ITEMS = [
  { key: "home",        label: "Home",       cap: "2026 sales",   icon: "home" },
  { key: "weekly",      label: "60 Days",    cap: "Last 60 days", icon: "bars" },
  { key: "calendar",    label: "Calendar",  icon: "calendar" },
  { key: "active",      label: "Pipeline",  icon: "briefcase" },
  { key: "inventories", label: "Inventory", icon: "building" },
  { key: "conversions", label: "Funnel",    icon: "funnel" },
  { key: "report",      label: "Weekly",    cap: "CEO report", icon: "report" },
];

const NavIcon = ({ name, size = 22 }) => {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  const shapes = {
    bars: <><rect x="3" y="12" width="4" height="8" rx="1" {...p} /><rect x="10" y="8" width="4" height="12" rx="1" {...p} /><rect x="17" y="4" width="4" height="16" rx="1" {...p} /></>,
    home: <path d="M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10" {...p} />,
    pulse: <path d="M3 12h4l3-8 4 16 3-8h4" {...p} />,
    calendar: <><rect x="4" y="5" width="16" height="16" rx="2" {...p} /><path d="M16 3v4M8 3v4M4 11h16" {...p} /></>,
    briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" {...p} /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" {...p} /></>,
    building: <path d="M3 21h18M5 21V8l7-5 7 5v13M9 10v.01M15 10v.01M9 14v.01M15 14v.01M10 21v-3h4v3" {...p} />,
    report: <><path d="M6 3h9l4 4v14H6z" {...p} /><path d="M15 3v4h4M9 12h7M9 16h7M9 8h3" {...p} /></>,
    funnel: <path d="M4 4h16v2.2a2 2 0 0 1-.6 1.4L15 12v7l-6 2v-8.5L4.5 7.6A2 2 0 0 1 4 6.2V4z" {...p} />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: "block" }}>{shapes[name]}</svg>;
};

const NAV_CSS = `
.nk-topnav{position:sticky;top:8px;z-index:50;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;background:${C.gray};padding:6px;border-radius:12px;margin-bottom:1rem;box-shadow:0 2px 10px rgba(54,67,74,0.18)}
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
  .nk-bottomnav{display:grid;position:fixed;left:0;right:0;bottom:0;z-index:900;grid-template-columns:repeat(7,minmax(0,1fr));background:${C.gray};padding:7px 2px calc(9px + env(safe-area-inset-bottom));box-shadow:0 -4px 16px rgba(0,0,0,0.2)}
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

// ── Cohort conversion (Paul's guideline: Visit → OTP and OTP → PSA with
// consistent cohorts). A cohort is a fixed group followed forward:
//   Visit → OTP: each person counts once, in the quarter of their first
//   Prospect Visit; converted = a signed OTP on or after that visit.
//   OTP → PSA: each deal counts once, in the quarter its OTP was signed;
//   then PSA signed, Lost, or still open.
// Master_Deals dates are complete from COHORT_FROM, so cohorts start there.
// Related-party deals are left out.
const COHORT_FROM = new Date(2026, 0, 1);
const COHORT_OPEN_DAYS = 90; // a cohort younger than this is still open
const qKey = d => `${d.getFullYear()} Q${Math.floor(d.getMonth() / 3) + 1}`;
const qEnd = d => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 0);
const median = xs => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2); };
function buildCohorts(entries, masterDeals, today) {
  const deals = (masterDeals || []).filter(r => pdStr(r["Deal Name"]) && pdStr(r["Related Party"]).toLowerCase() !== "yes").map(r => {
    const otp = twParseDate(r["OTP Signed Date"]), psa = twParseDate(r["PSA Date Signed"]);
    return { name: pdStr(r["Deal Name"]), rid: pdId(r["Buyer HubSpot Record ID"]), otp: otp || psa, psa, lost: twParseDate(r["Lost Date"]) };
  });
  // Visit → OTP
  const first = new Map();
  (entries || []).forEach(e => {
    if (e.type !== "tour" || e.connector || !e.date || e.date > today) return;
    const k = e.rid || `name:${e.name}`;
    const f = first.get(k);
    if (!f || e.date < f.date) first.set(k, { date: e.date, rid: e.rid, name: e.name });
  });
  const vq = new Map();
  first.forEach(v => {
    if (v.date < COHORT_FROM) return;
    const k = qKey(v.date);
    const g = vq.get(k) || { key: k, end: qEnd(v.date), people: [], conv: [], days: [] };
    g.people.push(v);
    const otps = v.rid ? deals.filter(d => d.rid === v.rid && d.otp && d.otp >= v.date).map(d => d.otp) : [];
    if (otps.length) { const o = otps.sort((a, b) => a - b)[0]; g.conv.push({ ...v, otp: o }); g.days.push(pdDiff(v.date, o)); }
    vq.set(k, g);
  });
  // OTP → PSA
  const oq = new Map();
  deals.forEach(d => {
    if (!d.otp || d.otp < COHORT_FROM || d.otp > today) return;
    const k = qKey(d.otp);
    const g = oq.get(k) || { key: k, end: qEnd(d.otp), deals: [], psa: 0, lost: 0, open: 0, days: [] };
    g.deals.push(d);
    if (d.psa) { g.psa++; g.days.push(pdDiff(d.otp, d.psa)); } else if (d.lost) g.lost++; else g.open++;
    oq.set(k, g);
  });
  const isOpen = g => pdDiff(g.end, today) < COHORT_OPEN_DAYS;
  const sortQ = m => [...m.values()].sort((a, b) => a.end - b.end).map(g => ({ ...g, open: g.open, still: isOpen(g), median: median(g.days) }));
  return { visit: sortQ(vq), otp: sortQ(oq) };
}
const cohortPct = (n, d) => d ? `${Math.round((n / d) * 100)}%` : "—";
const CohortView = ({ cohorts }) => {
  const card = { background: C.white, borderRadius: 8, border: "0.5px solid rgba(54,67,74,0.12)", overflow: "hidden" };
  const head = { padding: "10px 12px", background: "rgba(54,67,74,0.04)", fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: "bold", color: "rgba(54,67,74,0.72)", fontFamily: FONT_BODY };
  const row = { padding: "11px 12px", borderTop: "0.5px solid rgba(54,67,74,0.08)", fontSize: 12.5, color: C.gray, fontFamily: FONT_BODY, alignItems: "baseline" };
  const R = { textAlign: "right" };
  const Q = ({ g }) => <span style={{ fontWeight: "bold" }}>{g.key}{g.still ? <span style={{ fontWeight: "normal", color: PD_MUTED, fontSize: 11 }}> · still open</span> : null}</span>;
  const days = g => g.median == null ? "—" : `${g.median} d`;
  const g1 = "minmax(0,1.5fr) repeat(4, minmax(0,0.75fr))";
  const g2 = "minmax(0,1.5fr) repeat(5, minmax(0,0.7fr))";
  const tot = (rows, f) => rows.reduce((s, g) => s + f(g), 0);
  const vT = cohorts.visit, oT = cohorts.otp;
  return (
    <div>
      <div style={{ background: C.beige, borderRadius: 10, padding: "1rem 1.25rem", border: "0.5px solid rgba(54,67,74,0.12)" }}>
        <SectionLabel style={{ marginTop: 0 }}>Prospect Visit → Signed OTP</SectionLabel>
        <div style={card}>
          <div style={{ display: "grid", gridTemplateColumns: g1, columnGap: 8, ...head }}>
            <span>Visit quarter</span><span style={R}>Visits</span><span style={R}>Signed OTP</span><span style={R}>Rate</span><span style={R}>Median days</span>
          </div>
          {vT.map(g => (
            <div key={g.key} style={{ display: "grid", gridTemplateColumns: g1, columnGap: 8, ...row }}>
              <Q g={g} /><span style={R}>{g.people.length}</span><span style={{ ...R, fontFamily: FONT_DISPLAY, fontSize: 15 }}>{g.conv.length}</span><span style={R}>{cohortPct(g.conv.length, g.people.length)}</span><span style={R}>{days(g)}</span>
            </div>
          ))}
          <div style={{ display: "grid", gridTemplateColumns: g1, columnGap: 8, ...row, fontWeight: "bold" }}>
            <span>2026 to date</span><span style={R}>{tot(vT, g => g.people.length)}</span><span style={R}>{tot(vT, g => g.conv.length)}</span><span style={R}>{cohortPct(tot(vT, g => g.conv.length), tot(vT, g => g.people.length))}</span><span style={R}>{(() => { const m = median(vT.flatMap(g => g.days)); return m == null ? "—" : `${m} d`; })()}</span>
          </div>
        </div>

        <SectionLabel>Signed OTP → Signed PSA</SectionLabel>
        <div style={card}>
          <div style={{ display: "grid", gridTemplateColumns: g2, columnGap: 8, ...head }}>
            <span>OTP quarter</span><span style={R}>OTPs</span><span style={R}>PSA</span><span style={R}>Lost</span><span style={R}>Open</span><span style={R}>Rate</span>
          </div>
          {oT.map(g => (
            <div key={g.key} style={{ display: "grid", gridTemplateColumns: g2, columnGap: 8, ...row }}>
              <Q g={g} /><span style={R}>{g.deals.length}</span><span style={{ ...R, fontFamily: FONT_DISPLAY, fontSize: 15 }}>{g.psa}</span><span style={R}>{g.lost}</span><span style={R}>{g.open}</span><span style={R}>{cohortPct(g.psa, g.deals.length)}</span>
            </div>
          ))}
          <div style={{ display: "grid", gridTemplateColumns: g2, columnGap: 8, ...row, fontWeight: "bold" }}>
            <span>2026 to date</span><span style={R}>{tot(oT, g => g.deals.length)}</span><span style={R}>{tot(oT, g => g.psa)}</span><span style={R}>{tot(oT, g => g.lost)}</span><span style={R}>{tot(oT, g => g.open)}</span><span style={R}>{cohortPct(tot(oT, g => g.psa), tot(oT, g => g.deals.length))}</span>
          </div>
        </div>
        <div style={{ fontSize: 11, color: PD_MUTED, marginTop: 6, fontFamily: FONT_BODY }}>
          Median days OTP → PSA: {(() => { const m = median(oT.flatMap(g => g.days)); return m == null ? "—" : `${m}`; })()}
        </div>

        <div style={{ fontSize: 10.5, color: "rgba(54,67,74,0.6)", marginTop: 12, lineHeight: 1.55, fontFamily: FONT_BODY }}>
          <strong>Consistent cohorts:</strong> each group is fixed when it starts and followed forward. A person counts once, in the quarter of their first Prospect Visit; a deal counts once, in the quarter its OTP was signed. Quarters that ended less than {COHORT_OPEN_DAYS} days ago are still open. From Jan 1, 2026 (Master_Deals dates complete); related-party deals left out.
        </div>
      </div>
    </div>
  );
};


// ══════════════════════════════════════════════════════════════════════
// ── HOME (landing page: 2026 sales and the breakdowns from Eli's
// Q3 2026 Executive Sales Report) ────────────────────────────────────
// Live from the sheet:
//   YTD_PSAs + YTD_Resale_PSAs → total property transactions
//     · Cash transactions = YTD PSAs that are not related-party, plus re-sales
//     · Partner deals     = related-party YTD PSAs (Related Party = Yes, or
//                           listed in SALES_TEAM_GOAL_EXCLUSIONS)
//   Pending Transactions (Pending OTP / Decision / Signed OTP) → set to close
//   Built Product + Homesites (Available) → available inventory
// Past years are not in the sheet; they come from the report (below).
// ══════════════════════════════════════════════════════════════════════

const HOME_YEAR = 2026;
const HOME_TOTAL_TARGET = 350000000; // 2026 year-end total property transaction target
// Cash transactions by quarter in past years, from the Q3 2026 report.
// 2025 Q4 = full-year 2025 ($161.3M) minus Jan–Sep 2025 ($123.4M). 2024 Q4 was not reported.
const HOME_HIST_QUARTERS = {
  2024: [12.1e6, 39.2e6, 20.3e6, null],
  2025: [28.9e6, 30.4e6, 64.1e6, 37.9e6],
};
const HOME_FULL_YEAR_PREV = 161.3e6; // full-year 2025 cash transactions
// January–September signed sales by year (amount, number of PSAs), from the report.
const HOME_JAN_SEP_HISTORY = [
  { year: 2022, amount: 53.2e6, n: 16 },
  { year: 2023, amount: 56.7e6, n: 11 },
  { year: 2024, amount: 71.6e6, n: 12 },
  { year: 2025, amount: 123.4e6, n: 17 },
];
const HOME_YEAR_COLOR = { 2024: "#D9D4C4", 2025: "#8C979C", 2026: C.teal };
const HOME_SET_TO_CLOSE_STAGES = ["Pending OTP", "Decision", "Signed OTP"];

// $251.4M · $28.65M · $7.2M (no trailing zeros)
function homeM(v, digits = 1) {
  const f = 10 ** digits;
  const s = (Math.round((v / 1e6) * f + 1e-6) / f).toFixed(digits); // half-up, so $93.05M shows $93.1M like the report
  return `$${s.includes(".") ? s.replace(/\.?0+$/, "") : s}M`;
}
const homeQuarterOf = r => {
  const d = twParseDate(r["PSA Date Signed"]);
  return d && d.getFullYear() === HOME_YEAR ? Math.floor(d.getMonth() / 3) : -1;
};

const HOME_CSS = `
.hm-eyebrow{font-family:${FONT_BODY};font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:bold;color:${PD_MUTED}}
.hm-hero{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-top:6px}
.hm-total{font-family:${FONT_DISPLAY};font-size:64px;line-height:1;color:${C.gray}}
.hm-split{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}
.hm-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:3px solid ${C.teal};margin:26px 0 6px}
.hm-cell{padding:12px 18px 8px;min-width:0}
.hm-cell:first-child{padding-left:2px}
.hm-cell + .hm-cell{border-left:1px solid rgba(54,67,74,0.16)}
.hm-big{font-family:${FONT_DISPLAY};font-size:34px;line-height:1.1;color:${C.gray}}
.hm-small{font-family:${FONT_BODY};font-size:12.5px;color:rgba(54,67,74,0.7);line-height:1.45}
.hm-click{cursor:pointer;border-radius:6px;transition:background .15s}
.hm-click:hover,.hm-click:focus-visible{background:rgba(136,209,209,0.22);outline:none}
.hm-link{display:inline-block;margin-top:6px;font-family:${FONT_BODY};font-size:12.5px;font-weight:bold;color:${C.gray};text-decoration:underline;text-decoration-color:${C.teal};text-decoration-thickness:2px;text-underline-offset:3px}
.hm-quarters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 34px;margin-top:14px}
@media (max-width:700px){
  .hm-total{font-size:52px}
  .hm-strip{grid-template-columns:1fr}
  .hm-cell{padding:12px 2px}
  .hm-cell + .hm-cell{border-left:none;border-top:1px solid rgba(54,67,74,0.16)}
  .hm-quarters{grid-template-columns:1fr}
}
`;

// One labelled horizontal bar: label · bar · value.
const HomeBar = ({ label, value, max, color, text, note, bold }) => (
  <div style={{ display: "grid", gridTemplateColumns: "44px 1fr", gap: 10, alignItems: "center", fontFamily: FONT_BODY, fontSize: 12.5, color: C.gray, padding: "3px 0" }}>
    <span style={{ fontWeight: bold ? "bold" : "normal" }}>{label}</span>
    {value == null ? (
      <span style={{ fontStyle: "italic", color: PD_MUTED, fontSize: 12 }}>{note}</span>
    ) : (
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <div style={{ height: 12, width: `${(value / max) * 100}%`, minWidth: value > 0 ? 3 : 0, maxWidth: "calc(100% - 96px)", background: color, borderRadius: 6 }} />
        <span style={{ whiteSpace: "nowrap", fontWeight: bold ? "bold" : "normal" }}>{text}</span>
      </div>
    )}
  </div>
);

const HomeView = ({ cashDeals, partnerDeals, setToClose, inventory, today, onGo, onInventory }) => {
  const [open, setOpen] = useState(null);
  const cash = sumAmount(cashDeals), partner = sumAmount(partnerDeals), total = cash + partner;
  const count = cashDeals.length + partnerDeals.length;
  const closing = sumAmount(setToClose);
  const milestonePct = (total / SALES_TEAM_GOAL_AMOUNT) * 100;
  const toTarget = Math.max(HOME_TOTAL_TARGET - total, 0);
  const afterClosing = Math.max(toTarget - closing, 0);

  // 2026 cash transactions by quarter (PSA Date Signed)
  const q = [0, 0, 0, 0], qn = [0, 0, 0, 0];
  cashDeals.forEach(r => { const i = homeQuarterOf(r); if (i >= 0) { q[i] += twAmount(r["Amount ($)"]); qn[i] += 1; } });
  const curQ = today.getFullYear() > HOME_YEAR ? 4 : Math.floor(today.getMonth() / 3); // completed quarters
  const prevYear = HOME_HIST_QUARTERS[HOME_YEAR - 1];
  const samePrev = prevYear.slice(0, curQ).reduce((s, v) => s + (v || 0), 0);
  const sameCur = q.slice(0, curQ).reduce((s, v) => s + v, 0);
  const periodLabel = curQ > 0 ? `Jan–${["Mar", "Jun", "Sep", "Dec"][curQ - 1]}` : null;
  const pct = (a, b) => (b > 0 ? Math.round((a / b - 1) * 100) : null);
  const vsFull = pct(cash, HOME_FULL_YEAR_PREV);
  const vsSame = curQ > 0 ? pct(sameCur, samePrev) : null;
  const signedPct = v => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v)}%`);

  const qMax = Math.max(...q, ...Object.values(HOME_HIST_QUARTERS).flat().map(v => v || 0), 1);
  const janSep = [...HOME_JAN_SEP_HISTORY, { year: HOME_YEAR, amount: q[0] + q[1] + q[2], n: qn[0] + qn[1] + qn[2] }];
  const janSepMax = Math.max(...janSep.map(r => r.amount), 1);

  const barMax = Math.max(HOME_TOTAL_TARGET, total + closing);
  const w = v => `${(v / barMax) * 100}%`;

  const click = fn => ({ role: "button", tabIndex: 0, onClick: fn, onKeyDown: e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } } });
  const byPsaDesc = (a, b) => (twParseDate(b["PSA Date Signed"]) || 0) - (twParseDate(a["PSA Date Signed"]) || 0);

  const lists = {
    cash: { title: "Cash Transactions", sub: `${HOME_YEAR} year to date · ${cashDeals.length} · ${homeM(cash)} · re-sales included`, items: [...cashDeals].sort(byPsaDesc), psa: true },
    partner: { title: "Partner Deals", sub: `${HOME_YEAR} year to date · ${partnerDeals.length} · ${homeM(partner)} · related-party sales`, items: [...partnerDeals].sort(byPsaDesc), psa: true },
    closing: { title: "Set to Close", sub: `${setToClose.length} deal${setToClose.length === 1 ? "" : "s"} · ${homeM(closing, 2)} · Pending OTP and Signed OTP`, items: setToClose, psa: false },
  };
  const list = open && lists[open];

  return (
    <div>
      <style>{HOME_CSS}</style>

      {/* 1 · The sales number */}
      <div className="hm-eyebrow">{HOME_YEAR} sales · year to date · {twRangeLabel(new Date(HOME_YEAR, 0, 1), today)}</div>
      <div className="hm-hero">
        <div>
          <div className="hm-total">{homeM(total)}</div>
          <div style={{ fontSize: 14, color: C.gray, fontFamily: FONT_BODY, marginTop: 6 }}>
            <strong>{count} properties</strong> · total property transactions
          </div>
        </div>
      </div>

      {/* Cash vs partner split */}
      <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", marginTop: 16, gap: 2 }} role="img"
        aria-label={`Cash transactions ${homeM(cash)}, partner deals ${homeM(partner)}`}>
        <div style={{ width: `${total ? (cash / total) * 100 : 0}%`, background: C.teal }} />
        <div style={{ width: `${total ? (partner / total) * 100 : 0}%`, background: C.gray }} />
      </div>
      <div className="hm-split">
        {[["cash", "Cash transactions", cash, cashDeals.length, C.teal], ["partner", "Partner deals", partner, partnerDeals.length, C.gray]].map(([key, label, amt, n, color]) => (
          <div key={key} className="hm-click" {...click(() => setOpen(key))} style={{ padding: "4px 6px 6px", marginLeft: -6, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "rgba(54,67,74,0.75)", fontFamily: FONT_BODY }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: color, flex: "none" }} />{label}
            </div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 28, lineHeight: 1.15, color: C.gray, marginTop: 2 }}>
              {homeM(amt)} <span style={{ fontSize: 17, color: "rgba(54,67,74,0.6)" }}>· {n}</span>
            </div>
            <span className="hm-link">View list ›</span>
          </div>
        ))}
      </div>

      {/* 2 · Versus last year and the $270M milestone */}
      <div className="hm-strip">
        <div className="hm-cell">
          <div className="hm-big" style={{ color: vsFull != null && vsFull < 0 ? C.red : C.gray }}>{signedPct(vsFull)}</div>
          <div className="hm-small">Cash transactions vs. full-year {HOME_YEAR - 1} ({homeM(HOME_FULL_YEAR_PREV)})</div>
        </div>
        <div className="hm-cell">
          <div className="hm-big" style={{ color: vsSame != null && vsSame < 0 ? C.red : C.gray }}>{signedPct(vsSame)}</div>
          <div className="hm-small">{periodLabel ? `${periodLabel} ${HOME_YEAR} vs. ${periodLabel} ${HOME_YEAR - 1} (${homeM(samePrev)})` : "First quarter not closed yet"}</div>
        </div>
        <div className="hm-cell">
          <div className="hm-big">{Math.round(milestonePct)}%</div>
          <div className="hm-small">of the {homeM(SALES_TEAM_GOAL_AMOUNT, 0)} milestone ({homeM(total)} total property transactions)</div>
        </div>
      </div>

      {/* 3 · Year-end target */}
      <PdSectionHead text="Year-end target" right={`${homeM(HOME_TOTAL_TARGET, 0)} total property transactions`} />
      <div style={{ position: "relative", marginTop: 34, marginBottom: 34 }}>
        <div style={{ position: "absolute", right: 0, top: -22, fontSize: 11.5, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY, whiteSpace: "nowrap" }}>{homeM(HOME_TOTAL_TARGET, 0)} new milestone</div>
        <div style={{ display: "flex", height: 22, borderRadius: 6, overflow: "hidden", background: "rgba(54,67,74,0.08)" }}>
          <div style={{ width: w(total), background: C.teal }} title={`Signed ${homeM(total)}`} />
          <div style={{ width: w(closing), background: `repeating-linear-gradient(135deg, rgba(136,209,209,0.85) 0 6px, rgba(136,209,209,0.4) 6px 12px)` }} title={`Set to close ${homeM(closing, 2)}`} />
        </div>
        <div style={{ position: "absolute", left: w(SALES_TEAM_GOAL_AMOUNT), top: -4, bottom: -4, width: 2, background: C.gray }} />
        <div style={{ position: "absolute", left: w(SALES_TEAM_GOAL_AMOUNT), top: 28, transform: "translateX(-50%)", fontSize: 11.5, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY, whiteSpace: "nowrap" }}>
          {homeM(SALES_TEAM_GOAL_AMOUNT, 0)} milestone
        </div>
      </div>
      <div className="hm-strip" style={{ marginTop: 0 }}>
        <div className="hm-cell">
          <div style={{ display: "flex", alignItems: "center", gap: 7 }} className="hm-small"><span style={{ width: 10, height: 10, borderRadius: 3, background: C.teal }} />Signed</div>
          <div className="hm-big">{homeM(total)}</div>
          <div className="hm-small">{count} properties</div>
        </div>
        <div className="hm-cell hm-click" {...click(() => setOpen("closing"))}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }} className="hm-small"><span style={{ width: 10, height: 10, borderRadius: 3, background: "repeating-linear-gradient(135deg, rgba(136,209,209,0.9) 0 3px, rgba(136,209,209,0.35) 3px 6px)" }} />Set to close</div>
          <div className="hm-big">{homeM(closing, 2)}</div>
          <div className="hm-small">{setToClose.length} deal{setToClose.length === 1 ? "" : "s"} at Pending OTP or Signed OTP</div>
          <span className="hm-link">View list ›</span>
        </div>
        <div className="hm-cell">
          <div className="hm-small">Still to reach {homeM(HOME_TOTAL_TARGET, 0)}</div>
          <div className="hm-big">{homeM(toTarget)}</div>
          <div className="hm-small">{homeM(afterClosing)} after the deals set to close</div>
        </div>
      </div>

      {/* 4 · Cash transactions by quarter */}
      <PdSectionHead text="Cash transactions by quarter" right="2024 · 2025 · 2026" />
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 12, fontSize: 11.5, color: "rgba(54,67,74,0.7)", fontFamily: FONT_BODY }}>
        {[2024, 2025, 2026].map(y => (
          <span key={y}><span style={{ display: "inline-block", width: 12, height: 9, borderRadius: 3, background: HOME_YEAR_COLOR[y], marginRight: 6 }} />{y}</span>
        ))}
      </div>
      <div className="hm-quarters">
        {[0, 1, 2, 3].map(i => {
          const live = curQ === i && today.getFullYear() === HOME_YEAR;
          if (i > curQ && today.getFullYear() === HOME_YEAR) return null;
          return (
            <div key={i}>
              <div style={{ fontSize: 13.5, fontWeight: "bold", color: C.gray, fontFamily: FONT_BODY, marginBottom: 4 }}>
                Q{i + 1}{live && <span style={{ fontWeight: "normal", color: PD_MUTED, fontSize: 12 }}> · so far</span>}
              </div>
              {[2024, 2025].map(y => {
                const v = HOME_HIST_QUARTERS[y][i];
                return <HomeBar key={y} label={y} value={v} max={qMax} color={HOME_YEAR_COLOR[y]} text={v != null ? homeM(v) : ""} note="not reported" />;
              })}
              <HomeBar label={HOME_YEAR} value={q[i]} max={qMax} color={HOME_YEAR_COLOR[HOME_YEAR]} bold
                text={`${homeM(q[i])} · ${qn[i]} sale${qn[i] === 1 ? "" : "s"}`} />
            </div>
          );
        })}
      </div>

      {/* 5 · January–September signed sales by year */}
      <PdSectionHead text="January–September signed sales" right="2022 – 2026" />
      <div style={{ marginTop: 12 }}>
        {janSep.map(r => (
          <HomeBar key={r.year} label={r.year} value={r.amount} max={janSepMax} bold={r.year === HOME_YEAR}
            color={r.year === HOME_YEAR ? C.teal : "#C9C4B4"} text={`${homeM(r.amount)} · ${r.n} PSAs`} />
        ))}
      </div>

      <PdNote>
        Total property transactions = signed PSAs this year, including re-sales and partner deals. Cash transactions leave out partner (related-party) deals. Past years come from the Q3 {HOME_YEAR} Executive Sales Report; {HOME_YEAR - 1} Q4 is full-year {HOME_YEAR - 1} minus January–September.
      </PdNote>

      {list && (
        <Modal title={list.title} subtitle={list.sub} onClose={() => setOpen(null)}>
          <PdShowMore items={list.items} empty="None yet."
            render={(d, i) => list.psa ? <PSACard key={i} deal={d} /> : <DealCard key={i} deal={d} />} />
        </Modal>
      )}
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────
export default function NaukaDashboard() {
  const [view, setView]               = useState("home");
  const [kpis, setKpis]           = useState([]);
  const [pipeline, setPipeline]   = useState([]);
  const [deals, setDeals]         = useState([]);
  const [kpiArchive, setKpiArchive] = useState([]);
  const [funnelContacts, setFunnelContacts] = useState([]);
  const [settings, setSettings]   = useState([]);
  const [ytdPSAs, setYtdPSAs]     = useState([]);
  const [resalePSAs, setResalePSAs] = useState([]);
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
  const [activeLeads, setActiveLeads] = useState([]);
  const [contactNotes, setContactNotes] = useState([]);
  const [ceoRows, setCeoRows] = useState([]);
  const [now, setNow]             = useState(() => new Date());
  const lastLoadRef               = useRef(0);

  // Loads every tab. Runs on open, then again every 15 minutes and whenever
  // the page comes back into view, so the This Month section picks up each
  // day's new master rows without a manual reload. Background refreshes
  // keep the current data on screen if a request fails.
  const load = useCallback(async (silent = false) => {
      lastLoadRef.current = Date.now();
      try {
        const [k, p, d, ka, fc, st, ytd, resale, cal, bp, hs, mLeads, mDeals, al, cn, ceo] = await Promise.all([
          fetchSheet("Weekly_KPIs"),
          fetchSheet("Pipeline"),
          fetchSheet("Pending Transactions"),
          fetchSheet("Weekly_KPIs_Archive"),
          fetchSheet("Funnel_Contacts"),
          fetchSheet("Report_Settings"),
          fetchSheet("YTD_PSAs"),
          fetchSheet("YTD_Resale_PSAs"),
          fetchSheet("Prospect_Calendar"),
          fetchRawSheet("Built Product"),
          fetchRawSheet("Homesites"),
          fetchSheet("Master_Leads"),
          fetchSheet("Master_Deals"),
          fetchSheet("Active_Leads"),
          fetchSheet("Contact_Notes"),
          fetchSheet("CEO_Report"),
        ]);
        // fetchSheet returns [] on a network error, so a background refresh
        // that came back with nothing in the core tabs is treated as a failed
        // attempt — keep what's already on screen and try again next time.
        if (silent && k.length === 0 && p.length === 0) return;
        setKpis(k); setPipeline(p); setDeals(d);
        setKpiArchive(ka); setFunnelContacts(fc); setSettings(st);
        setYtdPSAs(ytd);
        setResalePSAs(resale);
        setCalendarRows(cal);
        setBuiltProduct(parseBuiltProduct(bp));
        setHomesites(parseHomesites(hs));
        setMasterLeads(mLeads); setMasterDeals(mDeals);
        setActiveLeads(parseActiveLeads(al));
        setContactNotes(parseContactNotes(cn));
        setCeoRows(ceo);
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
    let exp = twParseDate(raw) || new Date(NaN);
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
  // Home: partner deals = the related-party YTD PSAs left out of the cash figure.
  const partnerDeals = ytdPSAs.filter(d => !isSummaryRow(d) && !salesTeamPrimaryDeals.includes(d));
  const setToClose = deals.filter(d => HOME_SET_TO_CLOSE_STAGES.includes(String(d["Stage"] ?? "").trim()) && !isSummaryRow(d));
  const availableUnits = [...builtProduct, ...homesites].flatMap(g => g.units).filter(u => u.status === "available");
  const availablePrices = availableUnits.map(u => u.price).filter(p => p != null);
  const inventorySummary = {
    count: availableUnits.length,
    min: availablePrices.length ? Math.min(...availablePrices) : 0,
    max: availablePrices.length ? Math.max(...availablePrices) : 0,
  };

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
    if (openModal.type === "pipeStage" && openModal.key === "qo") return <QualifiedOppList cards={whiteboard.filter(c => c.kind === "qo")} onClose={() => setOpenModal(null)} />;
    if (openModal.type === "pipeStage") return <PipelineDealList stageKey={openModal.key} openDeals={openDealsByStage(masterDeals)} onClose={() => setOpenModal(null)} />;
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

  const calRecords = withLatestNote(calendarRows.length ? parseCalendarSheet(calendarRows) : FALLBACK_CALENDAR_RECORDS, contactNotes);
  const model = buildModel({ masterLeads, masterDeals, calRecords, funnelContacts, kpis, kpiArchive, settings, now });
  const todayCount = model.entries.filter(e => calSameDay(e.date, model.today)).length;
  const openDeals = openDealsByStage(masterDeals);
  const whiteboard = buildWhiteboard({ calRecords, people: model.people, openDeals, activeLeads, contactNotes, today: model.today, winStart: model.win.start });
  // Qualified Opportunities = people after a prospect visit (names added by hand who have not visited are on the board, not in the count).
  const qoCount = whiteboard.filter(c => c.kind === "qo").length;
  const boardCards = whiteboard.filter(c => c.visited);
  const talkCards = whiteboard.filter(c => !c.visited);
  const taskLeads = buildTaskLeads({ contactNotes, cards: whiteboard, people: model.people, today: model.today });
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

      {/* ── HOME · 2026 sales and breakdowns ──────────────────────── */}
      {view === "home" && (
        <HomeView cashDeals={salesTeamDeals} partnerDeals={partnerDeals} setToClose={setToClose}
          inventory={inventorySummary} today={model.today} onGo={go}
          onInventory={() => { setOnlyAvailable(true); go("inventories"); }} />
      )}

      {/* ── LAST 60 DAYS (vs. the 60 days before) ───────────────────── */}
      {view === "weekly" && (
        <SixtyDayView model={model} onGo={go} activeLeads={activeLeads} calRecords={calRecords} />
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
        const sales  = activeChips.slice(3);
        const expired = activeChips.find(c => c.key === "Expired DD");
        return (
          <div>
            <PdSectionHead text="Sales pipeline" right={`Today · ${twDayFmt(model.today)}`} first />
            <SalesPipelineTable qoCount={qoCount} openDeals={openDeals} onOpenStage={k => setOpenModal({ type: "pipeStage", key: k })} />
            <PdSectionHead big text="Qualified Opportunities & Active Negotiations · by advisor" right="Tap a name for the notes" />
            <Whiteboard cards={boardCards} />
            <PdSectionHead text={`Leads with upcoming tasks · ${taskLeads.length}`} right={`Next ${TASKS_AHEAD_DAYS} days`} />
            <TaskLeads leads={taskLeads} today={model.today} />
            <PdSectionHead text={`In talks to visit · ${talkCards.length}`} right="Not on property yet" />
            <Whiteboard cards={talkCards} talks />
            <div style={{ height: 18 }} />
            <ProspectStages model={model} />
            {sectionHead("Due diligence", true)}
            {row(expired, true)}
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
            {onlyAvailable && groups.length > 0 && <InventoryTotals groups={groups} allAvailable={availableUnits} />}
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

      {/* ── FUNNEL · VISIT → OTP → PSA (consistent cohorts) ─── */}
      {view === "conversions" && (
        <CohortView cohorts={buildCohorts(model.entries, masterDeals, model.today)} />
      )}

      {/* ── REPORT · the CEO weekly report, live ─────────────────────── */}
      {view === "report" && (
        <ReportView model={model} openDeals={openDeals} qoCount={qoCount} ceoRows={ceoRows} masterDeals={masterDeals} />
      )}

      {/* ── PROSPECT CALENDAR ───────────────────────────────────────── */}
      {view === "calendar" && (
        <CalendarView records={calRecords} />
      )}

      {renderModal()}

      {/* Footer mark */}
      <div className="nk-footmark" style={{ display: "flex", alignItems: "center", gap: 16, padding: "1.75rem 0 0.5rem" }}>
        <div style={{ flex: 1, height: 1, background: "rgba(54,67,74,0.12)" }} />
        <img src="/Nauka_Icon_Primary_HEX.png" alt="Nauka" style={{ height: 38, width: "auto", display: "block", opacity: 0.85 }} />
        <div style={{ flex: 1, height: 1, background: "rgba(54,67,74,0.12)" }} />
      </div>
    </div>
  );
}
