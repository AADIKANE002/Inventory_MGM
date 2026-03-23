import "./styles.css";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, apiBlob, parseApiError } from "./api";

// ─── Types ─────────────────────────────────────────────────────────────────

type Me = { id: number; email: string; allow_forecast: boolean };

type Summary = {
  distinct_months_of_sales: number;
  has_purchase_history: boolean;
  forecast_unlocked: boolean;
  requirements: { min_months_sales: number; purchase_history_required: boolean };
};

type Product = {
  id: number;
  name: string;
  category: string | null;
  product_key: string;
  default_expiry_days: number | null;
};

type StockRow = { product_id: number; name: string; category: string | null; estimated_stock: number };

type ModelEval = {
  name: string;
  mape: number;
  r2: number;
  test_pred: number;
};

type PreviewItem = {
  product_name: string;
  best_model: string;
  test_mape: number;
  test_r2: number;
  forecasted_demand_units: number;
  estimated_stock_units: number;
  suggested_purchase_units: number;
  net_to_buy_after_stock: number;
  all_evals?: ModelEval[];
};

// ─── Auth hook ──────────────────────────────────────────────────────────────

function useAuth() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("token"));
  const [me, setMe] = useState<Me | null>(null);
  const logout = useCallback(() => {
    localStorage.removeItem("token");
    setToken(null);
    setMe(null);
  }, []);
  useEffect(() => {
    if (!token) { setMe(null); return; }
    (async () => {
      try { const u = await api<Me>("/auth/me"); setMe(u); }
      catch { logout(); }
    })();
  }, [token, logout]);
  return { token, setToken, me, setMe, logout };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function Protected({ token, children }: { token: string | null; children: ReactNode }) {
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null || !isFinite(n) || n > 1e7) return "—";
  return n.toFixed(decimals);
}

// ─── Drop-zone component ────────────────────────────────────────────────────

function DropZone({
  accept,
  onFiles,
  icon,
  label,
  hint,
}: {
  accept: string;
  onFiles: (f: File) => void;
  icon: string;
  label: string;
  hint: string;
}) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  function handleFile(f: File | undefined) {
    if (!f) return;
    setFileName(f.name);
    onFiles(f);
  }

  return (
    <div
      ref={ref}
      className={`drop-zone${dragging ? " drag-over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
    >
      <input type="file" accept={accept} onChange={(e) => handleFile(e.target.files?.[0])} />
      <div className="drop-zone-icon">{icon}</div>
      <div className="drop-zone-text">{fileName || label}</div>
      <div className="drop-zone-hint">{hint}</div>
    </div>
  );
}

// ─── Alert component ────────────────────────────────────────────────────────

function Alert({ type, children }: { type: "success" | "error" | "info" | "warn"; children: ReactNode }) {
  const icons = { success: "✓", error: "✕", info: "ℹ", warn: "⚠" };
  return <div className={`alert ${type}`}><span>{icons[type]}</span><span>{children}</span></div>;
}

// ─── Nav layout ─────────────────────────────────────────────────────────────

function NavLayout({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const loc = useLocation();
  const lk = (to: string, icon: string, label: string) => (
    <Link to={to} className={loc.pathname === to ? "active" : ""}>
      <span className="nav-icon">{icon}</span>{label}
    </Link>
  );
  return (
    <>
      <header className="topnav">
        <div className="brand">
          <div className="logo-icon">📦</div>
          Inventory<span>MGM</span>
        </div>
        <nav className="nav-links">
          {lk("/dashboard", "🏠", "Dashboard")}
          {lk("/setup", "📁", "Setup")}
          {lk("/inventory", "🔄", "Inventory")}
          {lk("/forecast", "📈", "Forecast")}
          <button type="button" className="secondary sm" onClick={onLogout}>Sign out</button>
        </nav>
      </header>
      <div className="layout">{children}</div>
    </>
  );
}

// ─── Login ───────────────────────────────────────────────────────────────────

function LoginPage({ onLoggedIn }: { onLoggedIn: (t: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(""); setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json() as { access_token: string };
      localStorage.setItem("token", data.access_token);
      onLoggedIn(data.access_token);
      nav("/dashboard");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Login failed"); }
    finally { setLoading(false); }
  }

  return (
    <div className="login-box">
      <div style={{ textAlign: "center", marginBottom: "2rem" }}>
        <div style={{ fontSize: "3rem", marginBottom: "0.75rem" }}>📦</div>
        <h1 className="page-title" style={{ WebkitTextFillColor: "white", textAlign: "center" }}>Inventory<span style={{ color: "var(--accent)" }}>MGM</span></h1>
        <p className="muted">AI-powered inventory forecasting & planning</p>
      </div>
      <div className="card">
        <h2>Sign in</h2>
        <form onSubmit={submit} className="stack">
          <div><label>Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
          <div><label>Password</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
          {err && <Alert type="error">{err}</Alert>}
          <button type="submit" disabled={loading}>{loading ? <><span className="spinner" /> Signing in…</> : "Sign in"}</button>
        </form>
        <hr className="soft" />
        <p className="muted" style={{ textAlign: "center" }}>No account? <Link to="/register">Create one</Link></p>
      </div>
    </div>
  );
}

// ─── Register ────────────────────────────────────────────────────────────────

function RegisterPage({ onLoggedIn }: { onLoggedIn: (t: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(""); setLoading(true);
    try {
      await api("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });
      const res = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json() as { access_token: string };
      localStorage.setItem("token", data.access_token);
      onLoggedIn(data.access_token);
      nav("/dashboard");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Registration failed"); }
    finally { setLoading(false); }
  }

  return (
    <div className="login-box">
      <div style={{ textAlign: "center", marginBottom: "2rem" }}>
        <div style={{ fontSize: "3rem", marginBottom: "0.75rem" }}>📦</div>
        <h1 className="page-title" style={{ WebkitTextFillColor: "white", textAlign: "center" }}>Create account</h1>
        <p className="muted">Start forecasting your inventory today</p>
      </div>
      <div className="card">
        <h2>Register</h2>
        <form onSubmit={submit} className="stack">
          <div><label>Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
          <div><label>Password (min 6 chars)</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} /></div>
          {err && <Alert type="error">{err}</Alert>}
          <button type="submit" disabled={loading}>{loading ? <><span className="spinner" /> Creating…</> : "Create account"}</button>
        </form>
        <hr className="soft" />
        <p className="muted" style={{ textAlign: "center" }}>Have an account? <Link to="/login">Sign in</Link></p>
      </div>
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try { setSummary(await api<Summary>("/sales/summary")); }
      catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed to load"); }
    })();
  }, []);

  const pct = summary ? Math.min((summary.distinct_months_of_sales / 3) * 100, 100) : 0;

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>
      <p className="page-subtitle">Your inventory intelligence hub — upload historic data, log movements, and run AI forecasts.</p>
      {err && <Alert type="error">{err}</Alert>}

      {summary ? (
        <>
          <div className="grid4" style={{ marginBottom: "1.5rem" }}>
            <div className="stat-card">
              <div className="stat-icon">🗓</div>
              <div className="stat-label">Months of sales data</div>
              <div className="stat-value" style={{ color: summary.distinct_months_of_sales >= 3 ? "var(--success)" : "var(--warn)" }}>
                {summary.distinct_months_of_sales}<span style={{ fontSize: "1rem", color: "var(--muted)" }}>/3</span>
              </div>
              <div className="stat-sub">Min. 3 required for forecasting</div>
              <div className="progress-wrap">
                <div className="progress-bar" style={{ width: `${pct}%` }} />
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon">📥</div>
              <div className="stat-label">Purchase history</div>
              <div className="stat-value" style={{ fontSize: "1.2rem", paddingTop: "0.6rem" }}>
                {summary.has_purchase_history
                  ? <span className="badge ok">✓ Uploaded</span>
                  : <span className="badge wait">⚠ Missing</span>}
              </div>
              <div className="stat-sub">Required for forecasting</div>
            </div>

            <div className="stat-card">
              <div className="stat-icon">🔮</div>
              <div className="stat-label">Forecasting</div>
              <div className="stat-value" style={{ fontSize: "1.2rem", paddingTop: "0.6rem" }}>
                {summary.forecast_unlocked
                  ? <span className="badge ok">✓ Unlocked</span>
                  : <span className="badge danger">🔒 Locked</span>}
              </div>
              <div className="stat-sub">{summary.forecast_unlocked ? "Ready to run" : "Complete setup first"}</div>
            </div>

            <div className="stat-card">
              <div className="stat-icon">🤖</div>
              <div className="stat-label">Models available</div>
              <div className="stat-value">10</div>
              <div className="stat-sub">ARIMA, RF, XGBoost, Prophet…</div>
            </div>
          </div>

          {!summary.forecast_unlocked && (
            <Alert type="warn">
              Complete setup: upload purchase history &amp; monthly sales for at least 3 distinct months to unlock forecasting.
            </Alert>
          )}

          <div className="grid2" style={{ marginTop: "1.5rem" }}>
            <div className="card card-accent">
              <h2><span className="card-icon">⚡</span> Quick start</h2>
              <div className="stack" style={{ gap: "0.6rem" }}>
                <Link to="/setup" className="btn secondary" style={{ justifyContent: "flex-start" }}>
                  📁 &nbsp; Step 1 — Upload historic purchases &amp; sales
                </Link>
                <Link to="/inventory" className="btn secondary" style={{ justifyContent: "flex-start" }}>
                  🔄 &nbsp; Step 2 — Log ongoing buys &amp; sells
                </Link>
                <Link to="/forecast" className="btn" style={{ justifyContent: "flex-start" }}>
                  📈 &nbsp; Step 3 — Run forecast &amp; download Excel
                </Link>
              </div>
            </div>

            <div className="card">
              <h2><span className="card-icon">📋</span> How it works</h2>
              <ol style={{ paddingLeft: "1.2rem", color: "var(--text2)", fontSize: "0.88rem", lineHeight: 2 }}>
                <li>Upload purchase history (CSV, Excel, image, receipt, manual)</li>
                <li>Upload monthly sales data for ≥ 3 months</li>
                <li>Log ongoing inventory movements in the Inventory tab</li>
                <li>Run forecast — 10 models compete, best MAPE wins</li>
                <li>Download Excel with per-product purchase recommendations</li>
              </ol>
            </div>
          </div>
        </>
      ) : !err ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
          <span className="spinner" style={{ fontSize: "2rem" }} />
          <p className="muted" style={{ marginTop: "1rem" }}>Loading dashboard…</p>
        </div>
      ) : null}
    </div>
  );
}

// ─── Setup page ──────────────────────────────────────────────────────────────

type SetupTab = "purchases-file" | "purchases-image" | "purchases-manual" | "sales-file" | "sales-image" | "sales-manual";

function SetupPage() {
  const [tab, setTab] = useState<SetupTab>("purchases-file");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [manualP, setManualP] = useState(
    '[{"datetime":"2024-01-15T10:00:00","product_name":"Milk","quantity":2,"category":"Dairy"}]'
  );
  const [manualS, setManualS] = useState(
    '[{"year_month":"2024-01-01","product_name":"Milk","quantity_sold":10}]'
  );

  function toast(m: string, isErr = false) {
    if (isErr) { setErr(m); setMsg(""); } else { setMsg(m); setErr(""); }
  }

  async function postFile(url: string, file: File | null) {
    if (!file) return;
    setLoading(true);
    const fd = new FormData(); fd.append("file", file);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: fd,
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const j = await res.json() as Record<string, unknown>;
      toast(
        (j.message as string) ||
        `Saved: ${(j.inserted ?? j.upserted ?? 0)} rows.` +
        (j.ocr_preview ? ` OCR preview: "${String(j.ocr_preview).slice(0, 120)}…"` : "")
      );
    } catch (e: unknown) { toast(e instanceof Error ? e.message : "Upload failed", true); }
    finally { setLoading(false); }
  }

  async function submitManualPurchases() {
    setLoading(true);
    try {
      const rows = JSON.parse(manualP);
      const j = await api<{ inserted: number }>("/uploads/purchases/manual", { method: "POST", body: JSON.stringify({ rows }) });
      toast(`Purchases inserted: ${j.inserted}`);
    } catch (e: unknown) { toast(e instanceof Error ? e.message : "Invalid JSON", true); }
    finally { setLoading(false); }
  }

  async function submitManualSales() {
    setLoading(true);
    try {
      const rows = JSON.parse(manualS);
      const j = await api<{ upserted: number }>("/sales/monthly/manual", { method: "POST", body: JSON.stringify({ rows }) });
      toast(`Monthly sales upserted: ${j.upserted}`);
    } catch (e: unknown) { toast(e instanceof Error ? e.message : "Invalid JSON", true); }
    finally { setLoading(false); }
  }

  const isPurchasesTab = tab.startsWith("purchases");
  const isSalesTab = tab.startsWith("sales");

  return (
    <div>
      <h1 className="page-title">Historic Setup</h1>
      <p className="page-subtitle">Upload your purchase and sales history once. Forecasting unlocks after ≥ 3 months of sales data.</p>

      {msg && <Alert type="success">{msg}</Alert>}
      {err && <Alert type="error">{err}</Alert>}
      {loading && <Alert type="info"><span className="spinner" /> Processing…</Alert>}

      <div className="tabs">
        {(["purchases-file","purchases-image","purchases-manual"] as SetupTab[]).map(t => (
          <button key={t} className={`tab-btn${tab === t ? " active" : ""}`} onClick={() => setTab(t)} type="button">
            { t === "purchases-file" ? "📄 Purchases (file)" :
              t === "purchases-image" ? "🖼 Purchases (image/OCR)" :
              "✏️ Purchases (manual)" }
          </button>
        ))}
        {(["sales-file","sales-image","sales-manual"] as SetupTab[]).map(t => (
          <button key={t} className={`tab-btn${tab === t ? " active" : ""}`} onClick={() => setTab(t)} type="button">
            { t === "sales-file" ? "📊 Sales (file)" :
              t === "sales-image" ? "🖼 Sales (image/OCR)" :
              "✏️ Sales (manual)" }
          </button>
        ))}
      </div>

      {tab === "purchases-file" && (
        <div className="card">
          <h2><span className="card-icon">📄</span> Upload Purchases — CSV / Excel</h2>
          <p className="muted" style={{ marginBottom: "1rem" }}>
            Required columns: <span className="tag">date</span> <span className="tag">product_name</span> <span className="tag">quantity</span> &nbsp;
            Optional: <span className="tag">category</span> <span className="tag">expiry_date</span>
          </p>
          <DropZone
            accept=".csv,.xlsx,.xls"
            icon="📥"
            label="Drop your CSV or Excel file here, or click to browse"
            hint="Supports .csv, .xlsx, .xls"
            onFiles={f => postFile("/api/uploads/purchases/tabular", f)}
          />
        </div>
      )}

      {tab === "purchases-image" && (
        <div className="card">
          <h2><span className="card-icon">🖼</span> Upload Purchases — Image / Receipt / Handwritten Note</h2>
          <p className="muted" style={{ marginBottom: "1rem" }}>
            OCR reads dates, product names and quantities. Works best on printed receipts. Requires Tesseract installed on the server.
          </p>
          <DropZone
            accept="image/*"
            icon="📷"
            label="Drop a receipt photo, scan, or handwritten note here"
            hint="Supports JPG, PNG, WEBP, BMP, TIFF"
            onFiles={f => postFile("/api/uploads/purchases/image", f)}
          />
        </div>
      )}

      {tab === "purchases-manual" && (
        <div className="card">
          <h2><span className="card-icon">✏️</span> Enter Purchases Manually (JSON)</h2>
          <p className="muted" style={{ marginBottom: "1rem" }}>Edit the JSON array below. Each row needs <span className="tag">datetime</span>, <span className="tag">product_name</span>, <span className="tag">quantity</span>.</p>
          <textarea value={manualP} onChange={e => setManualP(e.target.value)} spellCheck={false} style={{ fontFamily: "monospace", minHeight: "160px" }} />
          <div style={{ marginTop: "0.75rem" }}>
            <button type="button" onClick={submitManualPurchases} disabled={loading}>Submit purchases</button>
          </div>
        </div>
      )}

      {tab === "sales-file" && (
        <div className="card">
          <h2><span className="card-icon">📊</span> Upload Monthly Sales — CSV / Excel</h2>
          <p className="muted" style={{ marginBottom: "1rem" }}>
            Required columns: <span className="tag">month</span> / <span className="tag">year_month</span> &nbsp; <span className="tag">product_name</span> &nbsp; <span className="tag">quantity_sold</span>
          </p>
          <DropZone
            accept=".csv,.xlsx,.xls"
            icon="📊"
            label="Drop your monthly sales CSV or Excel file here"
            hint="Supports .csv, .xlsx, .xls — upload 3+ months to unlock forecasting"
            onFiles={f => postFile("/api/sales/monthly/tabular", f)}
          />
        </div>
      )}

      {tab === "sales-image" && (
        <div className="card">
          <h2><span className="card-icon">🖼</span> Upload Monthly Sales — Image / OCR</h2>
          <p className="muted" style={{ marginBottom: "1rem" }}>
            Upload a photo of handwritten sales tallies or a scanned sales summary. OCR will extract product names and quantities.
          </p>
          <DropZone
            accept="image/*"
            icon="📷"
            label="Drop a sales summary image or handwritten note"
            hint="Supports JPG, PNG, WEBP — Tesseract-based OCR"
            onFiles={f => postFile("/api/sales/monthly/image", f)}
          />
        </div>
      )}

      {tab === "sales-manual" && (
        <div className="card">
          <h2><span className="card-icon">✏️</span> Enter Monthly Sales Manually (JSON)</h2>
          <p className="muted" style={{ marginBottom: "1rem" }}>Each row: <span className="tag">year_month</span> (YYYY-MM-01), <span className="tag">product_name</span>, <span className="tag">quantity_sold</span>.</p>
          <textarea value={manualS} onChange={e => setManualS(e.target.value)} spellCheck={false} style={{ fontFamily: "monospace", minHeight: "160px" }} />
          <div style={{ marginTop: "0.75rem" }}>
            <button type="button" onClick={submitManualSales} disabled={loading}>Submit sales</button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: "1.5rem", background: "var(--warn-bg)", borderColor: "rgba(255,209,102,0.2)" }}>
        <h2 style={{ color: "var(--warn)" }}>⚠ Setup requirements</h2>
        <ul style={{ paddingLeft: "1.2rem", color: "var(--text2)", fontSize: "0.88rem", lineHeight: 1.9 }}>
          <li>At least <strong>1 purchase upload</strong> (any format)</li>
          <li>Monthly sales covering <strong>at least 3 distinct months</strong></li>
          <li>Once both are done, forecasting will unlock automatically</li>
        </ul>
      </div>
    </div>
  );
}

// ─── Inventory page ───────────────────────────────────────────────────────────

type QuickRow = { product_id: number; name: string; category: string | null; estimated_stock: number; buy_qty: string; sell_qty: string };

function InventoryPage() {
  const [stock, setStock] = useState<StockRow[]>([]);
  const [quickRows, setQuickRows] = useState<QuickRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [activeTab, setActiveTab] = useState<"quick" | "bulk" | "json" | "recent">("quick");
  const [rowsJson, setRowsJson] = useState('[{"occurred_at":"2024-02-01T12:00:00","product_name":"Milk","quantity":1,"movement_type":"sell"}]');
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const toast = (m: string, isErr = false) => { if (isErr) { setErr(m); setMsg(""); } else { setMsg(m); setErr(""); } };

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([api<StockRow[]>("/inventory/stock"), api<Product[]>("/products")]);
      setStock(s);
      setProducts(p);
      setQuickRows(s.map(r => ({ ...r, buy_qty: "", sell_qty: "" })));
    } catch (e: unknown) { toast(e instanceof Error ? e.message : "Load failed", true); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveQuickEntry() {
    const rows = quickRows
      .filter(r => parseFloat(r.buy_qty) > 0 || parseFloat(r.sell_qty) > 0)
      .map(r => ({ product_id: r.product_id, buy_qty: parseFloat(r.buy_qty) || 0, sell_qty: parseFloat(r.sell_qty) || 0 }));
    if (!rows.length) { toast("Enter at least one quantity.", true); return; }
    setLoading(true);
    try {
      const j = await api<{ inserted: number }>("/inventory/quick-entry", { method: "POST", body: JSON.stringify({ rows }) });
      toast(`✓ Recorded ${j.inserted} movements.`);
      load();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : "Failed", true); }
    finally { setLoading(false); }
  }

  async function submitMovements() {
    setLoading(true);
    try {
      const rows = JSON.parse(rowsJson);
      const j = await api<{ inserted: number }>("/inventory/movements/manual", { method: "POST", body: JSON.stringify({ rows }) });
      toast(`✓ Recorded ${j.inserted} movements.`);
      load();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : "Invalid JSON", true); }
    finally { setLoading(false); }
  }

  async function postBulkFile(file: File | null) {
    if (!file) return;
    setLoading(true);
    const fd = new FormData(); fd.append("file", file);
    try {
      const res = await fetch("/api/inventory/movements/tabular", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: fd,
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const j = await res.json() as { inserted: number; message?: string };
      toast(j.message || `Recorded ${j.inserted} movements.`);
      load();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : "Upload failed", true); }
    finally { setLoading(false); }
  }

  async function saveExpiry(pid: number, days: string) {
    try {
      const n = parseInt(days, 10);
      await api(`/products/${pid}/expiry`, { method: "PATCH", body: JSON.stringify({ default_expiry_days: Number.isFinite(n) && n > 0 ? n : null }) });
      toast("Expiry days updated.");
    } catch (e: unknown) { toast(e instanceof Error ? e.message : "Update failed", true); }
  }

  return (
    <div>
      <h1 className="page-title">Ongoing Inventory</h1>
      <p className="page-subtitle">Log buys and sells to keep stock levels accurate. Use Quick Entry for speed, or bulk-upload a file.</p>

      {msg && <Alert type="success">{msg}</Alert>}
      {err && <Alert type="error">{err}</Alert>}

      <div className="tabs">
        <button className={`tab-btn${activeTab === "quick" ? " active" : ""}`} onClick={() => setActiveTab("quick")} type="button">⚡ Quick Entry</button>
        <button className={`tab-btn${activeTab === "bulk" ? " active" : ""}`} onClick={() => setActiveTab("bulk")} type="button">📂 Bulk File Upload</button>
        <button className={`tab-btn${activeTab === "json" ? " active" : ""}`} onClick={() => setActiveTab("json")} type="button">{ } JSON Manual</button>
        <button className={`tab-btn${activeTab === "recent" ? " active" : ""}`} onClick={() => setActiveTab("recent")} type="button">📋 Stock Levels</button>
      </div>

      {activeTab === "quick" && (
        <div className="card">
          <h2><span className="card-icon">⚡</span> Quick Entry — Log today's movements</h2>
          <p className="muted" style={{ marginBottom: "1rem" }}>Enter quantities bought and/or sold for each product today. Leave blank to skip a product.</p>
          {quickRows.length === 0 ? (
            <Alert type="info">No products yet — complete setup uploads first.</Alert>
          ) : (
            <>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Category</th>
                      <th>Current Stock</th>
                      <th style={{ textAlign: "center" }}>Qty Bought</th>
                      <th style={{ textAlign: "center" }}>Qty Sold</th>
                      <th>Expiry (days)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quickRows.map((r, i) => {
                      const pr = products.find(p => p.id === r.product_id);
                      return (
                        <tr key={r.product_id}>
                          <td><strong>{r.name}</strong></td>
                          <td><span className="muted">{r.category || "—"}</span></td>
                          <td>{r.estimated_stock.toFixed(2)}</td>
                          <td style={{ textAlign: "center" }}>
                            <input
                              type="number" min="0" step="any" placeholder="0"
                              className="qty-input"
                              value={r.buy_qty}
                              onChange={e => setQuickRows(prev => prev.map((q, j) => j === i ? { ...q, buy_qty: e.target.value } : q))}
                            />
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <input
                              type="number" min="0" step="any" placeholder="0"
                              className="qty-input"
                              value={r.sell_qty}
                              onChange={e => setQuickRows(prev => prev.map((q, j) => j === i ? { ...q, sell_qty: e.target.value } : q))}
                            />
                          </td>
                          <td>
                            <input
                              type="number" min="1" placeholder="optional" className="qty-input"
                              defaultValue={pr?.default_expiry_days ?? ""}
                              onBlur={e => saveExpiry(r.product_id, e.target.value)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem", alignItems: "center" }}>
                <button type="button" onClick={saveQuickEntry} disabled={loading}>
                  {loading ? <><span className="spinner" /> Saving…</> : "💾 Save all movements"}
                </button>
                <button type="button" className="secondary" onClick={load}>↺ Refresh</button>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === "bulk" && (
        <div className="card">
          <h2><span className="card-icon">📂</span> Bulk Upload Movements — CSV / Excel</h2>
          <p className="muted" style={{ marginBottom: "1rem" }}>
            Required columns: <span className="tag">date</span> <span className="tag">product_name</span> <span className="tag">quantity</span> <span className="tag">movement_type</span> (buy/sell)
          </p>
          <DropZone
            accept=".csv,.xlsx,.xls"
            icon="📂"
            label="Drop your movements file here"
            hint=".csv or .xlsx — columns: date, product_name, quantity, movement_type"
            onFiles={postBulkFile}
          />
        </div>
      )}

      {activeTab === "json" && (
        <div className="card">
          <h2><span className="card-icon">{ }</span> JSON Manual Entry</h2>
          <p className="muted" style={{ marginBottom: "1rem" }}>movement_type: <span className="tag">buy</span> or <span className="tag">sell</span></p>
          <textarea value={rowsJson} onChange={e => setRowsJson(e.target.value)} spellCheck={false} style={{ fontFamily: "monospace" }} />
          <div style={{ marginTop: "0.75rem" }}>
            <button type="button" onClick={submitMovements} disabled={loading}>Submit movements</button>
          </div>
        </div>
      )}

      {activeTab === "recent" && (
        <div className="card">
          <h2><span className="card-icon">📋</span> Current Stock Levels</h2>
          {stock.length === 0 ? (
            <Alert type="info">No products yet — complete setup uploads first.</Alert>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Key</th>
                    <th className="num">Estimated Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {stock.map(r => (
                    <tr key={r.product_id}>
                      <td><strong>{r.name}</strong></td>
                      <td><span className="muted">{r.category || "—"}</span></td>
                      <td><span className="tag">{products.find(p => p.id === r.product_id)?.product_key || "—"}</span></td>
                      <td className="num">{r.estimated_stock.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Forecast page ────────────────────────────────────────────────────────────

function ForecastPage() {
  const [status, setStatus] = useState<{ forecast_unlocked: boolean; distinct_months_sales: number } | null>(null);
  const [horizon, setHorizon] = useState<"weekly" | "monthly" | "quarterly">("monthly");
  const [safety, setSafety] = useState(1.1);
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingExcel, setLoadingExcel] = useState(false);

  useEffect(() => {
    (async () => {
      try { setStatus(await api<{ forecast_unlocked: boolean; distinct_months_sales: number }>("/forecast/status")); }
      catch { setStatus(null); }
    })();
  }, []);

  async function runPreview() {
    setErr(""); setMsg(""); setLoadingPreview(true);
    try {
      const res = await api<{ items: PreviewItem[] }>("/forecast/preview", {
        method: "POST",
        body: JSON.stringify({ horizon, safety_stock_factor: safety }),
      });
      setPreview(res.items);
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Preview failed"); }
    finally { setLoadingPreview(false); }
  }

  async function downloadExcel() {
    setErr(""); setMsg(""); setLoadingExcel(true);
    try {
      const blob = await apiBlob("/forecast/run", { method: "POST", body: JSON.stringify({ horizon, safety_stock_factor: safety }) });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `purchase_plan_${horizon}.xlsx`; a.click();
      URL.revokeObjectURL(url);
      setMsg("✓ Download started.");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Download failed"); }
    finally { setLoadingExcel(false); }
  }

  return (
    <div>
      <h1 className="page-title">Forecast & Purchase Plan</h1>
      <p className="page-subtitle">
        10 models compete per product; the winner is chosen by lowest MAPE on last-month holdout. Download an Excel with per-product purchase recommendations.
      </p>

      {status && !status.forecast_unlocked && (
        <Alert type="warn">Forecasting is locked — complete setup with purchases + 3 months of sales data.</Alert>
      )}
      {err && <Alert type="error">{err}</Alert>}
      {msg && <Alert type="success">{msg}</Alert>}

      <div className="card">
        <h2><span className="card-icon">⚙️</span> Forecast parameters</h2>
        <div className="grid2">
          <div>
            <label>Horizon</label>
            <select value={horizon} onChange={e => setHorizon(e.target.value as typeof horizon)}>
              <option value="weekly">Weekly (next 7 days)</option>
              <option value="monthly">Monthly (next 30 days)</option>
              <option value="quarterly">Quarterly (next 3 months)</option>
            </select>
          </div>
          <div>
            <label>Safety stock factor</label>
            <input type="number" step={0.05} min={0.1} max={3} value={safety} onChange={e => setSafety(parseFloat(e.target.value) || 1)} />
            <p className="muted" style={{ marginTop: "0.35rem" }}>Multiplier on forecasted demand (e.g. 1.1 = +10% buffer)</p>
          </div>
        </div>
        <div className="row" style={{ marginTop: "1.25rem" }}>
          <button type="button" className="secondary" onClick={runPreview} disabled={!status?.forecast_unlocked || loadingPreview}>
            {loadingPreview ? <><span className="spinner" /> Running models…</> : "🔍 Preview results (JSON)"}
          </button>
          <button type="button" onClick={downloadExcel} disabled={!status?.forecast_unlocked || loadingExcel}>
            {loadingExcel ? <><span className="spinner" /> Building Excel…</> : "⬇️ Download Excel"}
          </button>
        </div>
      </div>

      {preview && preview.length > 0 && (
        <div className="card">
          <h2><span className="card-icon">📊</span> Forecast results — {preview.length} product{preview.length !== 1 ? "s" : ""}</h2>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Best model</th>
                  <th className="num">MAPE</th>
                  <th className="num">R²</th>
                  <th className="num">Demand</th>
                  <th className="num">Stock</th>
                  <th className="num">Net to buy</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {preview.map(r => (
                  <>
                    <tr key={r.product_name}>
                      <td><strong>{r.product_name}</strong></td>
                      <td><span className="badge info">{r.best_model}</span></td>
                      <td className="num">{fmt(r.test_mape, 4)}</td>
                      <td className="num">{fmt(r.test_r2, 4)}</td>
                      <td className="num">{fmt(r.forecasted_demand_units)}</td>
                      <td className="num">{fmt(r.estimated_stock_units)}</td>
                      <td className="num"><strong style={{ color: r.net_to_buy_after_stock > 0 ? "var(--warn)" : "var(--success)" }}>
                        {fmt(r.net_to_buy_after_stock)}
                      </strong></td>
                      <td>
                        {r.all_evals && (
                          <button type="button" className="secondary sm" onClick={() =>
                            setExpandedProduct(expandedProduct === r.product_name ? null : r.product_name)
                          }>
                            {expandedProduct === r.product_name ? "▲ Hide" : "▼ All models"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expandedProduct === r.product_name && r.all_evals && (
                      <tr key={`${r.product_name}-evals`}>
                        <td colSpan={8} style={{ background: "rgba(0,0,0,0.2)", padding: "0.75rem 1rem" }}>
                          <table style={{ fontSize: "0.8rem" }}>
                            <thead>
                              <tr>
                                <th>Model</th>
                                <th className="num">MAPE</th>
                                <th className="num">R²</th>
                                <th className="num">Test prediction</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.all_evals.map((ev, i) => (
                                <tr key={ev.name} className={i === 0 ? "best-row" : ""}>
                                  <td>{i === 0 ? "⭐ " : ""}{ev.name}</td>
                                  <td className="num">{fmt(ev.mape, 4)}</td>
                                  <td className="num">{fmt(ev.r2, 4)}</td>
                                  <td className="num">{fmt(ev.test_pred)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card card-accent">
        <h2><span className="card-icon">🤖</span> Models compared</h2>
        <div className="grid3">
          {["Naive Last", "Seasonal Naive (12)", "Moving Average (3)", "Simple Exp. Smoothing", "Holt Linear", "ARIMA (1,1,1)", "Linear Trend", "Random Forest", "XGBoost", "Prophet"].map(m => (
            <div key={m} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.83rem" }}>
              <span style={{ color: "var(--accent)" }}>◆</span> {m}
            </div>
          ))}
        </div>
        <p className="muted" style={{ marginTop: "1rem" }}>
          Each model is trained on all data except the last month (test). Best MAPE wins; R² is used as tiebreaker.
          XGBoost and Prophet require optional libraries — they fall back to Naive if not installed.
        </p>
      </div>
    </div>
  );
}

// ─── Root ────────────────────────────────────────────────────────────────────

export default function App() {
  const { token, setToken, logout } = useAuth();
  return (
    <Routes>
      <Route path="/login"    element={token ? <Navigate to="/dashboard" replace /> : <LoginPage onLoggedIn={setToken} />} />
      <Route path="/register" element={token ? <Navigate to="/dashboard" replace /> : <RegisterPage onLoggedIn={setToken} />} />
      <Route path="/dashboard" element={<Protected token={token}><NavLayout onLogout={logout}><DashboardPage /></NavLayout></Protected>} />
      <Route path="/setup"     element={<Protected token={token}><NavLayout onLogout={logout}><SetupPage /></NavLayout></Protected>} />
      <Route path="/inventory" element={<Protected token={token}><NavLayout onLogout={logout}><InventoryPage /></NavLayout></Protected>} />
      <Route path="/forecast"  element={<Protected token={token}><NavLayout onLogout={logout}><ForecastPage /></NavLayout></Protected>} />
      <Route path="/"          element={<Navigate to={token ? "/dashboard" : "/login"} replace />} />
      <Route path="*"          element={<Navigate to="/" replace />} />
    </Routes>
  );
}
