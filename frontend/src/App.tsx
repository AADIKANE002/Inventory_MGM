import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, apiBlob, parseApiError } from "./api";

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

type StockRow = { product_id: number; name: string; estimated_stock: number };

type PreviewItem = {
  product_name: string;
  best_model: string;
  test_mape: number;
  test_r2: number;
  forecasted_demand_units: number;
  estimated_stock_units: number;
  suggested_purchase_units: number;
  net_to_buy_after_stock: number;
};

function useAuth() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("token"));
  const [me, setMe] = useState<Me | null>(null);
  const logout = useCallback(() => {
    localStorage.removeItem("token");
    setToken(null);
    setMe(null);
  }, []);

  useEffect(() => {
    if (!token) {
      setMe(null);
      return;
    }
    (async () => {
      try {
        const u = await api<Me>("/auth/me");
        setMe(u);
      } catch {
        logout();
      }
    })();
  }, [token, logout]);

  return { token, setToken, me, setMe, logout };
}

function Protected({
  token,
  children,
}: {
  token: string | null;
  children: ReactNode;
}) {
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function NavLayout({
  children,
  onLogout,
}: {
  children: ReactNode;
  onLogout: () => void;
}) {
  const loc = useLocation();
  const link = (to: string, label: string) => (
    <Link to={to} className={loc.pathname === to ? "active" : ""}>
      {label}
    </Link>
  );
  return (
    <div className="layout">
      <header className="topnav">
        <div className="brand">
          Inventory<span>MGM</span>
        </div>
        <nav className="nav-links">
          {link("/dashboard", "Dashboard")}
          {link("/setup", "Setup")}
          {link("/inventory", "Inventory")}
          {link("/forecast", "Forecast")}
          <button type="button" className="secondary" onClick={onLogout}>
            Log out
          </button>
        </nav>
      </header>
      {children}
    </div>
  );
}

function LoginPage({ onLoggedIn }: { onLoggedIn: (t: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const nav = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = (await res.json()) as { access_token: string };
      localStorage.setItem("token", data.access_token);
      onLoggedIn(data.access_token);
      nav("/dashboard");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Login failed");
    }
  }

  return (
    <div className="layout login-box">
      <div className="card">
        <h1 className="page-title">Sign in</h1>
        <p className="muted">Inventory forecasting and stock planning.</p>
        <form onSubmit={submit} className="stack" style={{ marginTop: "1rem" }}>
          <div>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {err ? <p className="error">{err}</p> : null}
          <button type="submit">Sign in</button>
        </form>
        <hr className="soft" />
        <p className="muted">
          No account? <Link to="/register">Create one</Link>
        </p>
      </div>
    </div>
  );
}

function RegisterPage({ onLoggedIn }: { onLoggedIn: (t: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const nav = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await api("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = (await res.json()) as { access_token: string };
      localStorage.setItem("token", data.access_token);
      onLoggedIn(data.access_token);
      nav("/dashboard");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Registration failed");
    }
  }

  return (
    <div className="layout login-box">
      <div className="card">
        <h1 className="page-title">Create account</h1>
        <form onSubmit={submit} className="stack" style={{ marginTop: "1rem" }}>
          <div>
            <label htmlFor="re">Email</label>
            <input id="re" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="rp">Password (min 6 chars)</label>
            <input id="rp" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>
          {err ? <p className="error">{err}</p> : null}
          <button type="submit">Register</button>
        </form>
        <hr className="soft" />
        <p className="muted">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const s = await api<Summary>("/sales/summary");
        setSummary(s);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Failed to load");
      }
    })();
  }, []);

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>
      <p className="muted">Complete setup once, then maintain buys/sells and run forecasts.</p>
      {err ? <p className="error">{err}</p> : null}
      {summary ? (
        <div className="grid2" style={{ marginTop: "1.25rem" }}>
          <div className="card">
            <h2>Setup status</h2>
            <p>
              Purchase history:{" "}
              {summary.has_purchase_history ? (
                <span className="badge ok">Yes</span>
              ) : (
                <span className="badge wait">Required</span>
              )}
            </p>
            <p>
              Distinct months of sales: <strong>{summary.distinct_months_of_sales}</strong> / {summary.requirements.min_months_sales}
            </p>
            <p>
              Forecasting:{" "}
              {summary.forecast_unlocked ? <span className="badge ok">Unlocked</span> : <span className="badge wait">Locked</span>}
            </p>
            {!summary.forecast_unlocked ? (
              <p className="muted" style={{ marginTop: "0.75rem" }}>
                Upload at least one purchase file and monthly sales covering three different months (CSV/Excel/images/manual).
              </p>
            ) : null}
          </div>
          <div className="card">
            <h2>Quick links</h2>
            <ul className="muted" style={{ margin: 0, paddingLeft: "1.2rem" }}>
              <li>
                <Link to="/setup">Historic uploads</Link>
              </li>
              <li>
                <Link to="/inventory">Log buys &amp; sells</Link>
              </li>
              <li>
                <Link to="/forecast">Run forecast &amp; download Excel</Link>
              </li>
            </ul>
          </div>
        </div>
      ) : !err ? (
        <p className="muted">Loading…</p>
      ) : null}
    </div>
  );
}

function SetupPage() {
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function uploadPurchasesFile(f: File | null) {
    if (!f) return;
    setErr("");
    setMsg("");
    const fd = new FormData();
    fd.append("file", f);
    try {
      const res = await fetch("/api/uploads/purchases/tabular", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: fd,
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const j = (await res.json()) as { inserted?: number; message?: string };
      setMsg(j.message || `Recorded ${j.inserted ?? 0} rows.`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    }
  }

  async function uploadPurchasesImage(f: File | null) {
    if (!f) return;
    setErr("");
    setMsg("");
    const fd = new FormData();
    fd.append("file", f);
    try {
      const res = await fetch("/api/uploads/purchases/image", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: fd,
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const j = (await res.json()) as { inserted?: number; message?: string };
      setMsg(j.message || `OCR: ${j.inserted ?? 0} rows.`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "OCR failed — try CSV/Excel or install Tesseract.");
    }
  }

  async function uploadSalesFile(f: File | null) {
    if (!f) return;
    setErr("");
    setMsg("");
    const fd = new FormData();
    fd.append("file", f);
    try {
      const res = await fetch("/api/sales/monthly/tabular", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: fd,
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const j = (await res.json()) as { upserted?: number };
      setMsg(`Monthly sales saved: ${j.upserted ?? 0} rows.`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    }
  }

  const [manualP, setManualP] = useState(
    '[{"datetime":"2024-01-15T10:00:00","product_name":"Milk","quantity":2,"category":"Dairy"}]'
  );
  const [manualS, setManualS] = useState(
    '[{"year_month":"2024-01-01","product_name":"Milk","quantity_sold":10}]'
  );

  async function submitManualPurchases() {
    setErr("");
    setMsg("");
    try {
      const rows = JSON.parse(manualP) as unknown[];
      const j = await api<{ inserted: number }>("/uploads/purchases/manual", {
        method: "POST",
        body: JSON.stringify({ rows }),
      });
      setMsg(`Purchases inserted: ${j.inserted}`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Invalid JSON");
    }
  }

  async function submitManualSales() {
    setErr("");
    setMsg("");
    try {
      const rows = JSON.parse(manualS) as unknown[];
      const j = await api<{ upserted: number }>("/sales/monthly/manual", {
        method: "POST",
        body: JSON.stringify({ rows }),
      });
      setMsg(`Monthly sales upserted: ${j.upserted}`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Invalid JSON");
    }
  }

  return (
    <div>
      <h1 className="page-title">Historic setup</h1>
      <p className="muted">Upload purchases once, then monthly totals sold (at least three distinct months).</p>
      {err ? <p className="error">{err}</p> : null}
      {msg ? <p style={{ color: "var(--success)" }}>{msg}</p> : null}

      <div className="grid2" style={{ marginTop: "1rem" }}>
        <div className="card">
          <h2>Purchases (CSV / Excel)</h2>
          <p className="muted">Columns: date, product name, quantity; optional category, expiry.</p>
          <div className="file-row">
            <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => uploadPurchasesFile(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <div className="card">
          <h2>Purchases (image / receipt)</h2>
          <p className="muted">Uses OCR when Tesseract is installed.</p>
          <input type="file" accept="image/*" onChange={(e) => uploadPurchasesImage(e.target.files?.[0] ?? null)} />
        </div>
        <div className="card">
          <h2>Monthly sales (CSV / Excel)</h2>
          <p className="muted">Columns: month/period, product name, quantity sold.</p>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => uploadSalesFile(e.target.files?.[0] ?? null)} />
        </div>
        <div className="card">
          <h2>Manual JSON — purchases</h2>
          <textarea value={manualP} onChange={(e) => setManualP(e.target.value)} spellCheck={false} />
          <button type="button" style={{ marginTop: "0.5rem" }} onClick={submitManualPurchases}>
            Submit purchases
          </button>
        </div>
        <div className="card">
          <h2>Manual JSON — monthly sales</h2>
          <textarea value={manualS} onChange={(e) => setManualS(e.target.value)} spellCheck={false} />
          <button type="button" style={{ marginTop: "0.5rem" }} onClick={submitManualSales}>
            Submit sales
          </button>
        </div>
      </div>
    </div>
  );
}

function InventoryPage() {
  const [stock, setStock] = useState<StockRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [rowsJson, setRowsJson] = useState(
    '[{"occurred_at":"2024-02-01T12:00:00","product_name":"Milk","quantity":1,"movement_type":"sell"}]'
  );
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([api<StockRow[]>("/inventory/stock"), api<Product[]>("/products")]);
      setStock(s);
      setProducts(p);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Load failed");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submitMovements() {
    setErr("");
    setMsg("");
    try {
      const rows = JSON.parse(rowsJson) as unknown[];
      const j = await api<{ inserted: number }>("/inventory/movements/manual", {
        method: "POST",
        body: JSON.stringify({ rows }),
      });
      setMsg(`Movements recorded: ${j.inserted}`);
      load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Invalid JSON");
    }
  }

  async function saveExpiry(pid: number, days: string) {
    setErr("");
    try {
      const n = parseInt(days, 10);
      await api(`/products/${pid}/expiry`, {
        method: "PATCH",
        body: JSON.stringify({ default_expiry_days: Number.isFinite(n) && n > 0 ? n : null }),
      });
      setMsg("Expiry days updated.");
      load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Update failed");
    }
  }

  return (
    <div>
      <h1 className="page-title">Ongoing inventory</h1>
      <p className="muted">Log buys and sells (JSON below), or use the same upload endpoints from API for bulk files.</p>
      {err ? <p className="error">{err}</p> : null}
      {msg ? <p style={{ color: "var(--success)" }}>{msg}</p> : null}

      <div className="card">
        <h2>Quick log (JSON array)</h2>
        <p className="muted">movement_type: &quot;buy&quot; or &quot;sell&quot;</p>
        <textarea value={rowsJson} onChange={(e) => setRowsJson(e.target.value)} spellCheck={false} />
        <button type="button" style={{ marginTop: "0.5rem" }} onClick={submitMovements}>
          Submit movements
        </button>
      </div>

      <div className="card">
        <h2>Estimated stock</h2>
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Stock</th>
              <th>Expiry (days)</th>
            </tr>
          </thead>
          <tbody>
            {stock.map((r) => {
              const pr = products.find((p) => p.id === r.product_id);
              const exp = pr?.default_expiry_days ?? "";
              return (
                <tr key={r.product_id}>
                  <td>{r.name}</td>
                  <td>{r.estimated_stock.toFixed(2)}</td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      placeholder="optional"
                      defaultValue={exp === "" ? "" : String(exp)}
                      style={{ maxWidth: "120px" }}
                      onBlur={(e) => saveExpiry(r.product_id, e.target.value)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {stock.length === 0 ? <p className="muted">No products yet — complete setup uploads first.</p> : null}
      </div>
    </div>
  );
}

function ForecastPage() {
  const [status, setStatus] = useState<{ forecast_unlocked: boolean; distinct_months_sales: number } | null>(null);
  const [horizon, setHorizon] = useState<"weekly" | "monthly" | "quarterly">("monthly");
  const [safety, setSafety] = useState(1.1);
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const s = await api<{ forecast_unlocked: boolean; distinct_months_sales: number }>("/forecast/status");
        setStatus(s);
      } catch {
        setStatus(null);
      }
    })();
  }, []);

  async function runPreview() {
    setErr("");
    setMsg("");
    try {
      const res = await api<{ items: PreviewItem[] }>("/forecast/preview", {
        method: "POST",
        body: JSON.stringify({ horizon, safety_stock_factor: safety }),
      });
      setPreview(res.items);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Preview failed");
    }
  }

  async function downloadExcel() {
    setErr("");
    setMsg("");
    try {
      const blob = await apiBlob("/forecast/run", {
        method: "POST",
        body: JSON.stringify({ horizon, safety_stock_factor: safety }),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `purchase_plan_${horizon}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg("Download started.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Download failed");
    }
  }

  return (
    <div>
      <h1 className="page-title">Forecast &amp; purchase plan</h1>
      <p className="muted">
        Models are compared on the last month (MAPE / R²); the best model per product forecasts demand. Excel includes suggested
        purchases and net to buy after estimated stock.
      </p>
      {status && !status.forecast_unlocked ? (
        <p className="error">Complete setup (purchases + 3 months of sales) to unlock forecasting.</p>
      ) : null}
      {err ? <p className="error">{err}</p> : null}
      {msg ? <p style={{ color: "var(--success)" }}>{msg}</p> : null}

      <div className="card">
        <div className="grid2">
          <div>
            <label htmlFor="hz">Horizon</label>
            <select id="hz" value={horizon} onChange={(e) => setHorizon(e.target.value as typeof horizon)}>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          </div>
          <div>
            <label htmlFor="sf">Safety stock factor</label>
            <input id="sf" type="number" step={0.05} min={0.1} value={safety} onChange={(e) => setSafety(parseFloat(e.target.value) || 1)} />
          </div>
        </div>
        <div className="file-row" style={{ marginTop: "1rem" }}>
          <button type="button" className="secondary" onClick={runPreview} disabled={!status?.forecast_unlocked}>
            Preview (JSON)
          </button>
          <button type="button" onClick={downloadExcel} disabled={!status?.forecast_unlocked}>
            Download Excel
          </button>
        </div>
      </div>

      {preview && preview.length > 0 ? (
        <div className="card">
          <h2>Preview</h2>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Model</th>
                  <th>MAPE</th>
                  <th>Demand</th>
                  <th>Net to buy</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.product_name}>
                    <td>{r.product_name}</td>
                    <td>{r.best_model}</td>
                    <td>{Number.isFinite(r.test_mape) && r.test_mape < 1e6 ? r.test_mape.toFixed(4) : "—"}</td>
                    <td>{r.forecasted_demand_units.toFixed(2)}</td>
                    <td>{r.net_to_buy_after_stock.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  const { token, setToken, logout } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/dashboard" replace /> : <LoginPage onLoggedIn={setToken} />} />
      <Route path="/register" element={token ? <Navigate to="/dashboard" replace /> : <RegisterPage onLoggedIn={setToken} />} />
      <Route
        path="/dashboard"
        element={
          <Protected token={token}>
            <NavLayout onLogout={logout}>
              <DashboardPage />
            </NavLayout>
          </Protected>
        }
      />
      <Route
        path="/setup"
        element={
          <Protected token={token}>
            <NavLayout onLogout={logout}>
              <SetupPage />
            </NavLayout>
          </Protected>
        }
      />
      <Route
        path="/inventory"
        element={
          <Protected token={token}>
            <NavLayout onLogout={logout}>
              <InventoryPage />
            </NavLayout>
          </Protected>
        }
      />
      <Route
        path="/forecast"
        element={
          <Protected token={token}>
            <NavLayout onLogout={logout}>
              <ForecastPage />
            </NavLayout>
          </Protected>
        }
      />
      <Route path="/" element={<Navigate to={token ? "/dashboard" : "/login"} replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
