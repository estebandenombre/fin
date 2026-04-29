"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownCircle,
  ArrowDownUp,
  ArrowLeft,
  ArrowUpCircle,
  CalendarDays,
  ChartSpline,
  ChevronDown,
  Landmark,
  LayoutDashboard,
  ListFilter,
  LogOut,
  Pencil,
  PiggyBank,
  Plus,
  Save,
  Tag,
  Trash2,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type TransactionType = "income" | "expense";
type ActiveChart = "flow" | "trend" | "category" | "top";
type FlowExpenseGrouping = "category" | "none";
type SyncStatus = "loading" | "syncing" | "synced" | "error";

type MovementFilterType = "all" | TransactionType;
type MovementListOrder = "recent" | "category" | "week";

type Bank = {
  id: number;
  name: string;
};

type Transaction = {
  id: number;
  description: string;
  amount: number;
  type: TransactionType;
  category: string;
  month: string;
  date: string;
  bankId: number | null;
};

type FinanceTransactionRow = {
  id: number;
  description: string;
  amount: number | string;
  type: TransactionType;
  category: string;
  period: string;
  transaction_date: string;
  bank_id?: number | null;
};

type FinanceBudgetRow = {
  period: string;
  category: string;
  amount: number | string;
};

type BudgetRecord = {
  period: string;
  category: string;
  amount: number;
};

type Summary = {
  income: number;
  expense: number;
  balance: number;
};

type GroupSummary = {
  id: string;
  label: string;
  type: TransactionType;
  total: number;
  count: number;
  periods: Set<string>;
};

type FlowItem = {
  id: string;
  label: string;
  total: number;
  kind: "expense" | "saving" | "gap";
};

type ChartItem = {
  id: string;
  label: string;
  total: number;
  count: number;
};

const currency = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
});

const CHART_INCOME = "#15803d";
const CHART_EXPENSE = "#b91c1c";
const CHART_ACCENT = "#737373";
const CHART_LINE = "#e8e8e6";
/** Balance acumulado (ingresos − gastos), tono neutro para no competir con ingreso/gasto. */
const CHART_BALANCE = "#64748b";

function TrendEvolutionTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: Array<{
    dataKey?: string | number;
    value?: number;
    payload?: { dayFull?: string; diaIngresos?: number; diaGastos?: number };
  }>;
}) {
  if (!active || !payload?.length) {
    return null;
  }
  const row = payload[0]?.payload;
  const ing = Number(payload.find((p) => p.dataKey === "ingresos")?.value ?? 0);
  const gas = Number(payload.find((p) => p.dataKey === "gastos")?.value ?? 0);
  const balancePoint = payload.find((p) => p.dataKey === "balance");
  const resultado =
    balancePoint?.value !== undefined ? Number(balancePoint.value) : ing - gas;
  const dayFull = row?.dayFull;
  const diaIng = row?.diaIngresos ?? 0;
  const diaGas = row?.diaGastos ?? 0;
  const hayMovimientoDia = diaIng > 0 || diaGas > 0;
  return (
    <div className="chart-tooltip">
      <strong>{dayFull ?? label}</strong>
      <div className="chart-tooltip-row chart-tooltip-row--income">
        Ingresos acumulados: {currency.format(ing)}
      </div>
      <div className="chart-tooltip-row chart-tooltip-row--expense">
        Gastos acumulados: {currency.format(gas)}
      </div>
      <div className="chart-tooltip-row chart-tooltip-row--balance">Balance acumulado: {currency.format(resultado)}</div>
      {hayMovimientoDia ? (
        <div className="chart-tooltip-meta">
          Este día: +{currency.format(diaIng)} ing. · −{currency.format(diaGas)} gast.
        </div>
      ) : null}
    </div>
  );
}

function BarDistributionTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: Array<{
    payload?: { total: number; movimientos?: number; veces?: number; budget?: number | null };
  }>;
}) {
  if (!active || !label || !payload?.length) {
    return null;
  }
  const row = payload[0]?.payload;
  if (!row) {
    return null;
  }
  const budget =
    row.budget != null && Number.isFinite(row.budget) && row.budget > 0 ? row.budget : null;
  const remaining = budget != null ? budget - row.total : null;
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      <div>Total: {currency.format(row.total)}</div>
      {budget != null ? (
        <>
          <div className="chart-tooltip-meta">Presupuesto: {currency.format(budget)}</div>
          <div
            className={`chart-tooltip-meta${remaining !== null && remaining < 0 ? " chart-tooltip-meta--warn" : ""}`}
          >
            {remaining !== null && remaining < 0
              ? `Por encima: ${currency.format(-remaining)}`
              : remaining !== null
                ? `Restante: ${currency.format(remaining)}`
                : null}
          </div>
        </>
      ) : null}
      {row.movimientos != null ? (
        <div className="chart-tooltip-meta">{row.movimientos} movimientos</div>
      ) : null}
      {row.veces != null ? <div className="chart-tooltip-meta">{row.veces} veces</div> : null}
    </div>
  );
}

const EXPENSE_CATEGORIES = [
  "General",
  "Comida",
  "Casa",
  "Transporte",
  "Ocio",
  "Salud",
  "Educación",
  "Servicios",
  "Otros",
] as const;

const INCOME_CATEGORIES = [
  "General",
  "Nómina",
  "Freelance",
  "Inversiones",
  "Reembolsos",
  "Regalos",
  "Otros",
] as const;

function categoriesForType(movementType: TransactionType): readonly string[] {
  return movementType === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
}

function categoryOrDefaultForType(category: string, movementType: TransactionType) {
  const normalized = category.trim() || "General";
  const allowed = categoriesForType(movementType);
  return allowed.includes(normalized) ? normalized : "General";
}

function padNumber(value: number) {
  return String(value).padStart(2, "0");
}

function todayInputValue() {
  const today = new Date();
  return `${today.getFullYear()}-${padNumber(today.getMonth() + 1)}-${padNumber(today.getDate())}`;
}

function currentMonth() {
  return todayInputValue().slice(0, 7);
}

function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

function parseMonthKey(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);

  if (!year || !monthIndex) {
    const today = new Date();
    return { year: today.getFullYear(), monthIndex: today.getMonth() };
  }

  return { year, monthIndex: monthIndex - 1 };
}

function formatMonthKey(year: number, monthIndex: number) {
  return `${year}-${padNumber(monthIndex + 1)}`;
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function clampPaydayDay(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(31, Math.max(1, Math.round(value)));
}

function createDateInMonth(year: number, monthIndex: number, day: number) {
  const safeDay = Math.min(clampPaydayDay(day), daysInMonth(year, monthIndex));
  return new Date(year, monthIndex, safeDay);
}

function dateToInputValue(date: Date) {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
}

function inputValueToDate(value: string) {
  const [year, monthIndex, day] = value.split("-").map(Number);

  if (!year || !monthIndex || !day) {
    return new Date();
  }

  return new Date(year, monthIndex - 1, day);
}

function getPeriodRange(period: string, paydayDay: number) {
  const { year, monthIndex } = parseMonthKey(period);
  const start = createDateInMonth(year, monthIndex, paydayDay);
  const nextStart = createDateInMonth(year, monthIndex + 1, paydayDay);
  const end = new Date(nextStart);
  end.setDate(end.getDate() - 1);

  return {
    end,
    start,
    endInput: dateToInputValue(end),
    startInput: dateToInputValue(start),
  };
}

function getPeriodKeyForDate(dateValue: string, paydayDay: number) {
  const date = inputValueToDate(dateValue);
  const periodStart = createDateInMonth(date.getFullYear(), date.getMonth(), paydayDay);

  if (date >= periodStart) {
    return formatMonthKey(date.getFullYear(), date.getMonth());
  }

  return formatMonthKey(date.getFullYear(), date.getMonth() - 1);
}

function formatDateShort(date: Date) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatPeriod(period: string, paydayDay: number) {
  if (paydayDay === 1) {
    const { year, monthIndex } = parseMonthKey(period);
    return new Intl.DateTimeFormat("es-ES", {
      month: "long",
      year: "numeric",
    }).format(new Date(year, monthIndex, 1));
  }

  const { start, end } = getPeriodRange(period, paydayDay);
  return `${formatDateShort(start)} - ${formatDateShort(end)}`;
}

/** Título del mes de trabajo: mes y año por separado (tipografía distinta en la UI). */
function formatMonthTitleParts(period: string): { month: string; year: string } {
  const { year, monthIndex } = parseMonthKey(period);
  const month = new Intl.DateTimeFormat("es-ES", { month: "long" }).format(
    new Date(year, monthIndex, 1),
  );
  return {
    month: month.replace(/^./u, (character) => character.toUpperCase()),
    year: String(year),
  };
}

function getDefaultMovementDate(period: string, paydayDay: number) {
  const today = todayInputValue();
  const todayPeriod = getPeriodKeyForDate(today, paydayDay);
  return todayPeriod === period ? today : getPeriodRange(period, paydayDay).startInput;
}

type TransactionCategoryGroup = {
  categoryLabel: string;
  items: Transaction[];
  key: string;
  type: TransactionType;
};

/** Agrupa todos los movimientos con el mismo tipo y categoría (no hace falta que sean consecutivos en la lista). */
function groupByCategoryAndType(transactions: Transaction[]): TransactionCategoryGroup[] {
  const bucket = new Map<string, Transaction[]>();

  for (const transaction of transactions) {
    const categoryLabel = transaction.category.trim() || "General";
    const key = `${transaction.type}:${categoryLabel}`;
    const existing = bucket.get(key);
    if (existing) {
      existing.push(transaction);
    } else {
      bucket.set(key, [transaction]);
    }
  }

  return Array.from(bucket.entries()).map(([key, rawItems]) => {
    const items = [...rawItems].sort((a, b) => {
      if (a.date !== b.date) {
        return a.date < b.date ? 1 : -1;
      }
      return b.id - a.id;
    });
    const categoryLabel = items[0].category.trim() || "General";
    const type = items[0].type;
    return { categoryLabel, items, key, type };
  });
}

function maxDateInCategoryGroup(group: TransactionCategoryGroup): string {
  return group.items.reduce((max, row) => (row.date > max ? row.date : max), group.items[0].date);
}

function sortCategoryGroups(groups: TransactionCategoryGroup[], mode: "recent" | "category"): void {
  groups.sort((a, b) => {
    if (mode === "recent") {
      const maxA = maxDateInCategoryGroup(a);
      const maxB = maxDateInCategoryGroup(b);
      if (maxA !== maxB) {
        return maxA < maxB ? 1 : -1;
      }
      return a.key.localeCompare(b.key, "es");
    }

    const labelOrder = a.categoryLabel.localeCompare(b.categoryLabel, "es");
    if (labelOrder !== 0) {
      return labelOrder;
    }

    return a.type === b.type ? 0 : a.type === "expense" ? -1 : 1;
  });
}

type MovementWeekSection = {
  groups: TransactionCategoryGroup[];
  heading: string;
  weekStart: string;
};

/** Lunes como inicio de semana (común en ES). */
function startOfWeekMonday(date: Date): Date {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = local.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  local.setDate(local.getDate() + offset);
  return local;
}

function buildMovementWeekSections(transactions: Transaction[]): MovementWeekSection[] {
  const byWeek = new Map<string, Transaction[]>();

  for (const transaction of transactions) {
    const monday = startOfWeekMonday(inputValueToDate(transaction.date));
    const weekKey = dateToInputValue(monday);
    const list = byWeek.get(weekKey);
    if (list) {
      list.push(transaction);
    } else {
      byWeek.set(weekKey, [transaction]);
    }
  }

  const weekKeys = Array.from(byWeek.keys()).sort((first, second) =>
    first < second ? 1 : first > second ? -1 : 0,
  );

  return weekKeys.map((weekStart) => {
    const weekTransactions = byWeek.get(weekStart)!;
    const groups = groupByCategoryAndType(weekTransactions);
    sortCategoryGroups(groups, "recent");
    const mondayDate = inputValueToDate(weekStart);
    const sundayDate = new Date(mondayDate);
    sundayDate.setDate(sundayDate.getDate() + 6);
    const heading = `${formatDateShort(mondayDate)} – ${formatDateShort(sundayDate)}`;
    return { groups, heading, weekStart };
  });
}

function parsePositiveNumber(value: string) {
  const parsedValue = Number(value.replace(",", "."));
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
}

function parseBudgetInput(value: string): { kind: "amount"; amount: number } | { kind: "clear" } | { kind: "invalid" } {
  const trimmed = value.trim();
  if (trimmed === "") {
    return { kind: "clear" };
  }
  const parsedValue = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return { kind: "invalid" };
  }
  if (parsedValue === 0) {
    return { kind: "clear" };
  }
  return { kind: "amount", amount: parsedValue };
}

function createSummary(transactions: Transaction[]): Summary {
  return transactions.reduce(
    (summary, transaction) => {
      if (transaction.type === "income") {
        summary.income += transaction.amount;
      } else {
        summary.expense += transaction.amount;
      }

      summary.balance = summary.income - summary.expense;
      return summary;
    },
    { income: 0, expense: 0, balance: 0 },
  );
}

function normalizeDescription(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function createFlowItems(
  transactions: Transaction[],
  summary: Summary,
  expenseGrouping: FlowExpenseGrouping,
): FlowItem[] {
  const expenseGroups = new Map<string, FlowItem>();

  for (const transaction of transactions) {
    if (transaction.type !== "expense") {
      continue;
    }

    if (expenseGrouping === "category") {
      const label = transaction.category.trim() || "General";
      const id = normalizeDescription(label);
      const group = expenseGroups.get(id);

      if (group) {
        group.total += transaction.amount;
      } else {
        expenseGroups.set(id, {
          id,
          label,
          total: transaction.amount,
          kind: "expense",
        });
      }
    } else {
      const id = `expense-${transaction.id}`;
      const label = transaction.description.trim() || "Sin descripción";
      expenseGroups.set(id, {
        id,
        label,
        total: transaction.amount,
        kind: "expense",
      });
    }
  }

  const items = Array.from(expenseGroups.values()).sort((first, second) => second.total - first.total);

  if (summary.balance > 0) {
    items.push({
      id: "saving",
      label: "Ahorro",
      total: summary.balance,
      kind: "saving",
    });
  }

  if (summary.balance < 0) {
    items.push({
      id: "gap",
      label: "Falta por cubrir",
      total: Math.abs(summary.balance),
      kind: "gap",
    });
  }

  return items;
}

/** Grosor máximo del conector (px); el grosor real es proporcional al importe: value / maxValue * esto. */
const FLOW_PATH_MAX_STROKE = 40;

function getFlowStrokeWidth(value: number, maxValue: number) {
  if (maxValue <= 0 || value <= 0 || !Number.isFinite(value) || !Number.isFinite(maxValue)) {
    return 0;
  }
  return (value / maxValue) * FLOW_PATH_MAX_STROKE;
}

function shortenLabel(value: string) {
  return value.length > 22 ? `${value.slice(0, 21)}...` : value;
}

function formatPeriodCompact(period: string) {
  const { year, monthIndex } = parseMonthKey(period);
  return new Intl.DateTimeFormat("es-ES", {
    month: "short",
    year: "2-digit",
  }).format(new Date(year, monthIndex, 1));
}

function getBarWidth(value: number, maxValue: number) {
  if (maxValue <= 0) {
    return "0%";
  }

  return `${Math.max(4, Math.min(100, (value / maxValue) * 100))}%`;
}

function groupExpensesBy(
  transactions: Transaction[],
  getLabel: (transaction: Transaction) => string,
): ChartItem[] {
  const groups = new Map<string, ChartItem>();

  for (const transaction of transactions) {
    if (transaction.type !== "expense") {
      continue;
    }

    const label = getLabel(transaction).trim() || "General";
    const id = normalizeDescription(label);
    const group = groups.get(id);

    if (group) {
      group.total += transaction.amount;
      group.count += 1;
    } else {
      groups.set(id, {
        id,
        label,
        total: transaction.amount,
        count: 1,
      });
    }
  }

  return Array.from(groups.values()).sort((first, second) => second.total - first.total);
}

function makeDateInPeriod(period: string, paydayDay: number) {
  return getPeriodRange(period, paydayDay).startInput;
}

function normalizeTransactions(transactions: Transaction[], paydayDay: number) {
  return transactions.map((transaction) => {
    const legacyTransaction = transaction as Transaction & { date?: string; month?: string };
    const fallbackPeriod = legacyTransaction.month ?? currentMonth();
    const date = legacyTransaction.date ?? makeDateInPeriod(fallbackPeriod, paydayDay);

    return {
      ...legacyTransaction,
      date,
      month: getPeriodKeyForDate(date, paydayDay),
    };
  });
}

function mapTransactionRow(row: FinanceTransactionRow): Transaction {
  return {
    id: Number(row.id),
    description: row.description,
    amount: Number(row.amount),
    type: row.type,
    category: row.category,
    month: row.period,
    date: row.transaction_date,
    bankId: row.bank_id ?? null,
  };
}

function mapBudgetRow(row: FinanceBudgetRow): BudgetRecord {
  return {
    period: row.period,
    category: row.category,
    amount: Number(row.amount),
  };
}

function createTransactionPayload(transaction: Transaction, userId: string) {
  return {
    user_id: userId,
    description: transaction.description,
    amount: transaction.amount,
    type: transaction.type,
    category: transaction.category,
    period: transaction.month,
    transaction_date: transaction.date,
    bank_id: transaction.bankId,
  };
}

function MissingSupabase() {
  return (
    <main className="shell">
      <section className="panel missing-supabase" aria-label="Configuracion requerida">
        <h1>Falta configurar Supabase</h1>
        <p>
          Anade en <code>.env.local</code> la URL del proyecto y una clave publica. Reinicia <code>npm run dev</code>{" "}
          despues de guardar.
        </p>
        <ul className="missing-supabase-list">
          <li>
            <code>NEXT_PUBLIC_SUPABASE_URL</code> (Project Settings &gt; API &gt; Project URL)
          </li>
          <li>
            Clave de cliente: <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> (sb_publishable_…) <strong>o</strong>{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (JWT largo, pestaña Legacy API Keys &gt; anon public)
          </li>
        </ul>
      </section>
    </main>
  );
}

function connectionFailureText(error: unknown): string {
  const pieces: string[] = [];

  if (error && typeof error === "object") {
    const record = error as {
      message?: string;
      details?: string;
      hint?: string;
      code?: string;
    };

    if (record.message) {
      pieces.push(record.message);
    }

    if (record.details && record.details !== record.message) {
      pieces.push(record.details);
    }

    if (record.hint) {
      pieces.push(record.hint);
    }

    if (record.code) {
      pieces.push(`(codigo ${record.code})`);
    }
  } else if (error instanceof Error) {
    pieces.push(error.message);
  } else if (error !== undefined && error !== null) {
    pieces.push(String(error));
  }

  const base = pieces.filter(Boolean).join(" — ") || "Error desconocido al conectar con Supabase.";
  const low = base.toLowerCase();

  if (
    low.includes("invalid login credentials") ||
    low.includes("invalid_credentials") ||
    low.includes("invalid email or password")
  ) {
    return `${base}

→ Comprueba correo y contrasena. Si acabas de registrarte, puede que debas confirmar el correo antes de poder entrar (Authentication → Providers → Email en Supabase).`;
  }

  if (
    low.includes("invalid api key") ||
    low.includes("jwt") ||
    (low.includes("invalid") && low.includes("key"))
  ) {
    return `${base}

→ Revisa Project Settings → API: copia la clave publishable o la anon (JWT). Usa NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local.`;
  }

  return base;
}

function UserAuthPanel({ db }: { db: SupabaseClient }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    setInfo(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setLocalError("Introduce correo y contrasena.");
      return;
    }

    if (password.length < 6) {
      setLocalError("La contrasena debe tener al menos 6 caracteres.");
      return;
    }

    setBusy(true);

    try {
      if (mode === "login") {
        const { error } = await db.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (error) {
          throw error;
        }
      } else {
        const { data, error } = await db.auth.signUp({
          email: trimmedEmail,
          password,
        });
        if (error) {
          throw error;
        }
        if (!data.session) {
          setInfo(
            "Si tu proyecto requiere confirmar el correo, abre el enlace del mensaje y luego vuelve a iniciar sesion aqui.",
          );
        }
      }
    } catch (err: unknown) {
      setLocalError(connectionFailureText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <section className="panel auth-panel" aria-label="Inicio de sesion">
        <p className="eyebrow">Finanzas</p>
        <h1>{mode === "login" ? "Entrar" : "Crear cuenta"}</h1>
        <p className="auth-lead">
          Tus movimientos se guardan vinculados a tu usuario. Usa el mismo correo en cada dispositivo.
        </p>

        {localError ? (
          <p className="auth-error" role="alert">
            {localError}
          </p>
        ) : null}
        {info ? (
          <p className="auth-info" role="status">
            {info}
          </p>
        ) : null}

        <form className="auth-form" onSubmit={(e) => void handleSubmit(e)}>
          <label htmlFor="auth-email">
            Correo
            <input
              autoComplete="email"
              id="auth-email"
              name="email"
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              value={email}
            />
          </label>
          <label htmlFor="auth-password">
            Contrasena
            <input
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              id="auth-password"
              name="password"
              minLength={6}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              value={password}
            />
          </label>
          <div className="auth-form-actions">
            <button className="auth-primary" disabled={busy} type="submit">
              {busy ? "Espera…" : mode === "login" ? "Entrar" : "Registrarse"}
            </button>
            <button
              className="auth-secondary"
              disabled={busy}
              type="button"
              onClick={() => {
                setMode((current) => (current === "login" ? "register" : "login"));
                setLocalError(null);
                setInfo(null);
              }}
            >
              {mode === "login" ? "Crear cuenta" : "Ya tengo cuenta"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

function FinanceApp() {
  const db = supabase!;
  const initialPaydayDay = 1;
  const initialPeriod = getPeriodKeyForDate(todayInputValue(), initialPaydayDay);
  const [selectedPeriod, setSelectedPeriod] = useState(initialPeriod);
  const [paydayDay, setPaydayDay] = useState(initialPaydayDay);
  const [draftSelectedPeriod, setDraftSelectedPeriod] = useState(initialPeriod);
  const [draftPaydayDay, setDraftPaydayDay] = useState(String(initialPaydayDay));
  const [globalSummaryOpen, setGlobalSummaryOpen] = useState(false);
  const [activeChart, setActiveChart] = useState<ActiveChart>("flow");
  const [flowExpenseGrouping, setFlowExpenseGrouping] = useState<FlowExpenseGrouping>("category");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [supabaseUserId, setSupabaseUserId] = useState<string | null>(null);
  const [authPhase, setAuthPhase] = useState<"unknown" | "guest" | "user">("unknown");
  const loadGenRef = useRef(0);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgetRecords, setBudgetRecords] = useState<BudgetRecord[]>([]);
  const [budgetInputs, setBudgetInputs] = useState<Record<string, string>>({});
  const [budgetPanelCollapsed, setBudgetPanelCollapsed] = useState(true);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<TransactionType>("expense");
  const [category, setCategory] = useState("General");
  const [movementDate, setMovementDate] = useState(() =>
    getDefaultMovementDate(initialPeriod, initialPaydayDay),
  );
  const [movementFilterType, setMovementFilterType] = useState<MovementFilterType>("all");
  const [movementFilterCategory, setMovementFilterCategory] = useState("");
  const [movementSearch, setMovementSearch] = useState("");
  const [movementFiltersOpen, setMovementFiltersOpen] = useState(false);
  const [movementListOrder, setMovementListOrder] = useState<MovementListOrder>("recent");
  const [editingTransactionId, setEditingTransactionId] = useState<number | null>(null);
  const movementFormPanelRef = useRef<HTMLFormElement | null>(null);

  // Bancos
  const [banks, setBanks] = useState<Bank[]>([]);
  const [formBankId, setFormBankId] = useState<number | null>(null);
  const [movementFilterBankId, setMovementFilterBankId] = useState<number | "">("");
  const [banksPanelCollapsed, setBanksPanelCollapsed] = useState(true);
  const [bankDraftName, setBankDraftName] = useState("");
  const [editingBankId, setEditingBankId] = useState<number | null>(null);

  function setMovementType(next: TransactionType) {
    setType(next);
    const allowed = categoriesForType(next);
    setCategory((current) => (allowed.includes(current) ? current : "General"));
  }

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setMovementFilterType("all");
    setMovementFilterCategory("");
    setMovementFilterBankId("");
    setMovementSearch("");
    setMovementFiltersOpen(false);
    setEditingTransactionId(null);
    setDescription("");
    setAmount("");
    setType("expense");
    setCategory("General");
    setFormBankId(null);
    setMovementDate(getDefaultMovementDate(selectedPeriod, paydayDay));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [paydayDay, selectedPeriod]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const next: Record<string, string> = {};
    for (const cat of EXPENSE_CATEGORIES) {
      const rec = budgetRecords.find((r) => r.period === selectedPeriod && r.category === cat);
      next[cat] = rec && rec.amount > 0 ? String(rec.amount) : "";
    }
    setBudgetInputs(next);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [budgetRecords, selectedPeriod]);

  const loadUserFinanceData = useCallback(
    async (userId: string) => {
      const generation = ++loadGenRef.current;
      setSyncStatus("loading");
      setConnectionError(null);

      try {
        const settingsResult = await db
          .from("finance_settings")
          .select("payday_day")
          .eq("user_id", userId)
          .maybeSingle();

        if (settingsResult.error) {
          throw settingsResult.error;
        }

        const nextPaydayDay = clampPaydayDay(settingsResult.data?.payday_day ?? 1);
        const nextPeriod = getPeriodKeyForDate(todayInputValue(), nextPaydayDay);

        if (generation !== loadGenRef.current) {
          return;
        }

        setPaydayDay(nextPaydayDay);
        setSelectedPeriod(nextPeriod);
        setDraftPaydayDay(String(nextPaydayDay));
        setDraftSelectedPeriod(nextPeriod);
        setMovementDate(getDefaultMovementDate(nextPeriod, nextPaydayDay));

        if (!settingsResult.data) {
          const settingsUpsert = await db.from("finance_settings").upsert({
            user_id: userId,
            payday_day: nextPaydayDay,
          });

          if (settingsUpsert.error) {
            throw settingsUpsert.error;
          }
        }

        const banksResult = await db
          .from("finance_banks")
          .select("id, name")
          .eq("user_id", userId)
          .order("name");

        if (banksResult.error) {
          throw banksResult.error;
        }

        if (generation !== loadGenRef.current) {
          return;
        }

        setBanks((banksResult.data ?? []).map((row) => ({ id: Number(row.id), name: String(row.name) })));

        const transactionsResult = await db
          .from("finance_transactions")
          .select("id, description, amount, type, category, period, transaction_date, bank_id")
          .eq("user_id", userId)
          .order("transaction_date", { ascending: false })
          .order("id", { ascending: false });

        if (transactionsResult.error) {
          throw transactionsResult.error;
        }

        const remoteTransactions = (transactionsResult.data ?? []).map((row) =>
          mapTransactionRow(row as FinanceTransactionRow),
        );

        if (generation !== loadGenRef.current) {
          return;
        }

        if (remoteTransactions.length > 0) {
          setTransactions(normalizeTransactions(remoteTransactions, nextPaydayDay));
        } else {
          setTransactions([]);
        }

        const budgetsResult = await db
          .from("finance_budgets")
          .select("period, category, amount")
          .eq("user_id", userId);

        if (budgetsResult.error) {
          throw budgetsResult.error;
        }

        const remoteBudgets = (budgetsResult.data ?? []).map((row) => mapBudgetRow(row as FinanceBudgetRow));

        if (generation !== loadGenRef.current) {
          return;
        }

        setBudgetRecords(remoteBudgets);

        setConnectionError(null);
        setSyncStatus("synced");
      } catch (error: unknown) {
        if (generation !== loadGenRef.current) {
          return;
        }
        setConnectionError(connectionFailureText(error));
        setSyncStatus("error");
      }
    },
    [db],
  );

  useEffect(() => {
    let cancelled = false;

    const {
      data: { subscription },
    } = db.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED") {
        return;
      }

      void (async () => {
        if (!session?.user) {
          loadGenRef.current += 1;
          if (cancelled) {
            return;
          }

          setSupabaseUserId(null);
          setTransactions([]);
          setBudgetRecords([]);
          setBanks([]);
          const resetPeriod = getPeriodKeyForDate(todayInputValue(), initialPaydayDay);
          setPaydayDay(initialPaydayDay);
          setSelectedPeriod(resetPeriod);
          setDraftPaydayDay(String(initialPaydayDay));
          setDraftSelectedPeriod(resetPeriod);
          setMovementDate(getDefaultMovementDate(resetPeriod, initialPaydayDay));
          setGlobalSummaryOpen(false);
          setEditingTransactionId(null);
          setConnectionError(null);
          setSyncStatus("loading");
          setDescription("");
          setAmount("");
          setType("expense");
          setCategory("General");
          setFormBankId(null);
          setMovementFilterBankId("");
          setAuthPhase("guest");
          return;
        }

        const userId = session.user.id;
        if (cancelled) {
          return;
        }

        setSupabaseUserId(userId);
        setAuthPhase("user");
        await loadUserFinanceData(userId);
      })();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [db, loadUserFinanceData, initialPaydayDay]);

  const periodTransactions = useMemo(() => {
    return transactions.filter(
      (transaction) => getPeriodKeyForDate(transaction.date, paydayDay) === selectedPeriod,
    );
  }, [paydayDay, selectedPeriod, transactions]);

  const expenseSpentByCategory = useMemo(() => {
    const spent = new Map<string, number>();
    for (const transaction of periodTransactions) {
      if (transaction.type !== "expense") {
        continue;
      }
      const cat = categoryOrDefaultForType(transaction.category, "expense");
      spent.set(cat, (spent.get(cat) ?? 0) + transaction.amount);
    }
    return spent;
  }, [periodTransactions]);

  const budgetAmountByCategory = useMemo(() => {
    const amounts = new Map<string, number>();
    for (const row of budgetRecords) {
      if (row.period !== selectedPeriod) {
        continue;
      }
      amounts.set(row.category, row.amount);
    }
    return amounts;
  }, [budgetRecords, selectedPeriod]);

  const periodTransactionCategories = useMemo(() => {
    const unique = new Set<string>();
    for (const transaction of periodTransactions) {
      unique.add(transaction.category.trim() || "General");
    }
    return Array.from(unique).sort((first, second) => first.localeCompare(second, "es"));
  }, [periodTransactions]);

  const filteredPeriodTransactions = useMemo(() => {
    const query = movementSearch.trim().toLowerCase();

    return periodTransactions.filter((transaction) => {
      if (movementFilterType !== "all" && transaction.type !== movementFilterType) {
        return false;
      }

      const categoryLabel = transaction.category.trim() || "General";

      if (movementFilterCategory && categoryLabel !== movementFilterCategory) {
        return false;
      }

      if (movementFilterBankId !== "" && transaction.bankId !== movementFilterBankId) {
        return false;
      }

      if (query && !transaction.description.toLowerCase().includes(query)) {
        return false;
      }

      return true;
    });
  }, [
    movementFilterCategory,
    movementFilterBankId,
    movementFilterType,
    movementSearch,
    periodTransactions,
  ]);

  const movementListRender = useMemo(() => {
    if (movementListOrder === "week") {
      return {
        kind: "week" as const,
        sections: buildMovementWeekSections(filteredPeriodTransactions),
      };
    }

    const groups = groupByCategoryAndType(filteredPeriodTransactions);
    sortCategoryGroups(groups, movementListOrder);
    return { kind: "flat" as const, groups };
  }, [filteredPeriodTransactions, movementListOrder]);

  const hasActiveMovementFilters =
    movementFilterType !== "all" || movementFilterCategory !== "" || movementSearch.trim() !== "" || movementFilterBankId !== "";

  const totals = useMemo(() => {
    return createSummary(periodTransactions);
  }, [periodTransactions]);

  const globalTotals = useMemo(() => {
    return createSummary(transactions);
  }, [transactions]);

  const visibleTotals = globalSummaryOpen ? globalTotals : totals;
  const visibleTransactions = globalSummaryOpen ? transactions : periodTransactions;

  const flowItems = useMemo(() => {
    return createFlowItems(visibleTransactions, visibleTotals, flowExpenseGrouping);
  }, [flowExpenseGrouping, visibleTotals, visibleTransactions]);

  const flowMaxValue = useMemo(() => {
    return Math.max(visibleTotals.income, ...flowItems.map((item) => item.total), 1);
  }, [flowItems, visibleTotals.income]);

  const flowSvgHeight = Math.max(230, 96 + Math.max(flowItems.length, 1) * 64);

  const periodSummaries = useMemo(() => {
    const groupedPeriods = new Map<string, Transaction[]>();

    for (const transaction of transactions) {
      const period = getPeriodKeyForDate(transaction.date, paydayDay);
      const currentTransactions = groupedPeriods.get(period) ?? [];
      currentTransactions.push(transaction);
      groupedPeriods.set(period, currentTransactions);
    }

    if (!groupedPeriods.has(selectedPeriod)) {
      groupedPeriods.set(selectedPeriod, []);
    }

    return Array.from(groupedPeriods.entries())
      .map(([period, periodItems]) => ({
        period,
        summary: createSummary(periodItems),
      }))
      .sort((first, second) => second.period.localeCompare(first.period));
  }, [paydayDay, selectedPeriod, transactions]);

  const groupedTransactions = useMemo(() => {
    const groups = new Map<string, GroupSummary>();

    for (const transaction of transactions) {
      const normalizedDescription = normalizeDescription(transaction.description);
      const id = `${transaction.type}-${normalizedDescription}`;
      const period = getPeriodKeyForDate(transaction.date, paydayDay);
      const group = groups.get(id);

      if (group) {
        group.total += transaction.amount;
        group.count += 1;
        group.periods.add(period);
      } else {
        groups.set(id, {
          id,
          label: transaction.description.trim(),
          type: transaction.type,
          total: transaction.amount,
          count: 1,
          periods: new Set([period]),
        });
      }
    }

    return {
      income: Array.from(groups.values())
        .filter((group) => group.type === "income")
        .sort((first, second) => second.total - first.total),
      expense: Array.from(groups.values())
        .filter((group) => group.type === "expense")
        .sort((first, second) => second.total - first.total),
    };
  }, [paydayDay, transactions]);

  const trendChartItems = useMemo(() => {
    return [...periodSummaries]
      .sort((first, second) => first.period.localeCompare(second.period))
      .slice(-6);
  }, [periodSummaries]);

  const dailyEvolutionChartData = useMemo(() => {
    const { startInput, endInput } = getPeriodRange(selectedPeriod, paydayDay);
    const start = inputValueToDate(startInput);
    const end = inputValueToDate(endInput);
    const byDay = new Map<string, { income: number; expense: number }>();

    for (const transaction of periodTransactions) {
      const day = transaction.date;
      if (day < startInput || day > endInput) {
        continue;
      }
      const bucket = byDay.get(day) ?? { income: 0, expense: 0 };
      if (transaction.type === "income") {
        bucket.income += transaction.amount;
      } else {
        bucket.expense += transaction.amount;
      }
      byDay.set(day, bucket);
    }

    const dayFormatter = new Intl.DateTimeFormat("es-ES", {
      day: "numeric",
      month: "short",
    });
    const dayFullFormatter = new Intl.DateTimeFormat("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const rows: Array<{
      dayKey: string;
      dayLabel: string;
      dayFull: string;
      diaIngresos: number;
      diaGastos: number;
      ingresos: number;
      gastos: number;
      balance: number;
    }> = [];

    let ingresosAcum = 0;
    let gastosAcum = 0;

    const cursor = new Date(start.getTime());
    while (cursor <= end) {
      const dayKey = dateToInputValue(cursor);
      const agg = byDay.get(dayKey) ?? { income: 0, expense: 0 };
      ingresosAcum += agg.income;
      gastosAcum += agg.expense;
      rows.push({
        dayKey,
        dayLabel: dayFormatter.format(cursor),
        dayFull: dayFullFormatter.format(cursor).replace(/^./u, (c) => c.toUpperCase()),
        diaIngresos: agg.income,
        diaGastos: agg.expense,
        ingresos: ingresosAcum,
        gastos: gastosAcum,
        balance: ingresosAcum - gastosAcum,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    return rows;
  }, [paydayDay, periodTransactions, selectedPeriod]);

  const categoryChartItems = useMemo(() => {
    return groupExpensesBy(visibleTransactions, (transaction) => transaction.category);
  }, [visibleTransactions]);

  const categoryBarChartData = useMemo(() => {
    return [...categoryChartItems].reverse().map((item) => ({
      name: shortenLabel(item.label),
      total: item.total,
      movimientos: item.count,
      budget: budgetAmountByCategory.get(item.label) ?? null,
    }));
  }, [budgetAmountByCategory, categoryChartItems]);

  const topExpenseItems = useMemo(() => {
    return groupExpensesBy(visibleTransactions, (transaction) => transaction.description).slice(0, 5);
  }, [visibleTransactions]);

  const topBarChartData = useMemo(() => {
    return [...topExpenseItems].reverse().map((item) => ({
      name: shortenLabel(item.label),
      total: item.total,
      veces: item.count,
    }));
  }, [topExpenseItems]);

  const globalSummaryCategories = useMemo(() => {
    return groupExpensesBy(transactions, (transaction) => transaction.category).slice(0, 8);
  }, [transactions]);

  const globalSummaryCategoryMax = useMemo(() => {
    return Math.max(...globalSummaryCategories.map((item) => item.total), 1);
  }, [globalSummaryCategories]);

  const bankSummaries = useMemo(() => {
    return banks.map((bank) => {
      const bankTransactions = transactions.filter((t) => t.bankId === bank.id);
      return { bank, summary: createSummary(bankTransactions) };
    });
  }, [banks, transactions]);

  function selectPeriod(period: string) {
    setSelectedPeriod(period);
    setDraftSelectedPeriod(period);
    setMovementDate(getDefaultMovementDate(period, paydayDay));
  }

  function updatePaydayDay(value: string) {
    setDraftPaydayDay(value);
  }

  async function savePeriodSettings() {
    const nextPaydayDay = clampPaydayDay(Number(draftPaydayDay));
    const nextPeriod = isMonthKey(draftSelectedPeriod)
      ? draftSelectedPeriod
      : getPeriodKeyForDate(todayInputValue(), nextPaydayDay);

    if (!supabaseUserId) {
      setSyncStatus("error");
      return;
    }

    setSyncStatus("syncing");

    const result = await db.from("finance_settings").upsert(
      {
        user_id: supabaseUserId,
        payday_day: nextPaydayDay,
      },
      { onConflict: "user_id" },
    );

    if (result.error) {
      setSyncStatus("error");
      return;
    }

    setPaydayDay(nextPaydayDay);
    setSelectedPeriod(nextPeriod);
    setDraftPaydayDay(String(nextPaydayDay));
    setDraftSelectedPeriod(nextPeriod);
    setMovementDate(getDefaultMovementDate(nextPeriod, nextPaydayDay));
    setSyncStatus("synced");
  }

  async function saveBudgetsForPeriod() {
    if (!supabaseUserId) {
      setSyncStatus("error");
      return;
    }

    setSyncStatus("syncing");

    try {
      setConnectionError(null);
      for (const cat of EXPENSE_CATEGORIES) {
        const parsed = parseBudgetInput(budgetInputs[cat] ?? "");
        if (parsed.kind === "invalid") {
          setConnectionError("Revisa los importes de presupuesto: solo numeros positivos o dejalos vacios.");
          setSyncStatus("error");
          return;
        }

        if (parsed.kind === "clear") {
          const del = await db
            .from("finance_budgets")
            .delete()
            .eq("user_id", supabaseUserId)
            .eq("period", selectedPeriod)
            .eq("category", cat);
          if (del.error) {
            throw del.error;
          }
        } else {
          const upsert = await db.from("finance_budgets").upsert(
            {
              user_id: supabaseUserId,
              period: selectedPeriod,
              category: cat,
              amount: parsed.amount,
            },
            { onConflict: "user_id,period,category" },
          );
          if (upsert.error) {
            throw upsert.error;
          }
        }
      }

      const refreshed = await db
        .from("finance_budgets")
        .select("period, category, amount")
        .eq("user_id", supabaseUserId);

      if (refreshed.error) {
        throw refreshed.error;
      }

      setBudgetRecords((refreshed.data ?? []).map((row) => mapBudgetRow(row as FinanceBudgetRow)));
      setSyncStatus("synced");
    } catch (error: unknown) {
      setConnectionError(connectionFailureText(error));
      setSyncStatus("error");
    }
  }

  async function saveBankForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = bankDraftName.trim();
    if (!cleanName || !supabaseUserId) {
      return;
    }
    setSyncStatus("syncing");
    try {
      if (editingBankId !== null) {
        const result = await db
          .from("finance_banks")
          .update({ name: cleanName })
          .eq("user_id", supabaseUserId)
          .eq("id", editingBankId)
          .select("id, name")
          .single();
        if (result.error) {
          throw result.error;
        }
        setBanks((current) =>
          current.map((b) =>
            b.id === editingBankId ? { id: Number(result.data.id), name: String(result.data.name) } : b,
          ),
        );
        setEditingBankId(null);
      } else {
        const result = await db
          .from("finance_banks")
          .insert({ user_id: supabaseUserId, name: cleanName })
          .select("id, name")
          .single();
        if (result.error) {
          throw result.error;
        }
        setBanks((current) =>
          [...current, { id: Number(result.data.id), name: String(result.data.name) }].sort((a, b) =>
            a.name.localeCompare(b.name, "es"),
          ),
        );
      }
      setBankDraftName("");
      setSyncStatus("synced");
    } catch (error: unknown) {
      setConnectionError(connectionFailureText(error));
      setSyncStatus("error");
    }
  }

  async function removeBank(id: number) {
    if (!supabaseUserId) {
      return;
    }
    setSyncStatus("syncing");
    const result = await db
      .from("finance_banks")
      .delete()
      .eq("user_id", supabaseUserId)
      .eq("id", id);
    if (result.error) {
      setSyncStatus("error");
      return;
    }
    setBanks((current) => current.filter((b) => b.id !== id));
    if (editingBankId === id) {
      setEditingBankId(null);
      setBankDraftName("");
    }
    if (formBankId === id) {
      setFormBankId(null);
    }
    setTransactions((current) =>
      current.map((t) => (t.bankId === id ? { ...t, bankId: null } : t)),
    );
    setSyncStatus("synced");
  }

  function resetMovementForm() {
    setEditingTransactionId(null);
    setDescription("");
    setAmount("");
    setType("expense");
    setCategory("General");
    setFormBankId(null);
    setMovementDate(getDefaultMovementDate(selectedPeriod, paydayDay));
  }

  function openTransactionEditor(transaction: Transaction) {
    setEditingTransactionId(transaction.id);
    setDescription(transaction.description);
    setAmount(String(transaction.amount));
    setType(transaction.type);
    setCategory(categoryOrDefaultForType(transaction.category, transaction.type));
    setMovementDate(transaction.date);
    setFormBankId(transaction.bankId);
    requestAnimationFrame(() => {
      movementFormPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  async function submitMovementForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedAmount = parsePositiveNumber(amount);
    const cleanDescription = description.trim();

    if (!cleanDescription || parsedAmount === null) {
      return;
    }

    if (!supabaseUserId) {
      setSyncStatus("error");
      return;
    }

    const transactionPeriod = getPeriodKeyForDate(movementDate, paydayDay);
    const nextCategory = categoryOrDefaultForType(category.trim() || "General", type);

    setSyncStatus("syncing");

    if (editingTransactionId !== null) {
      const updateResult = await db
        .from("finance_transactions")
        .update({
          amount: parsedAmount,
          category: nextCategory,
          description: cleanDescription,
          period: transactionPeriod,
          transaction_date: movementDate,
          type,
          bank_id: formBankId,
        })
        .eq("user_id", supabaseUserId)
        .eq("id", editingTransactionId)
        .select("id, description, amount, type, category, period, transaction_date, bank_id")
        .single();

      if (updateResult.error) {
        setSyncStatus("error");
        return;
      }

      const savedTransaction = mapTransactionRow(updateResult.data as FinanceTransactionRow);
      setTransactions((current) =>
        current.map((row) => (row.id === editingTransactionId ? savedTransaction : row)),
      );
    } else {
      const pendingTransaction: Transaction = {
        id: 0,
        amount: parsedAmount,
        category: nextCategory,
        date: movementDate,
        description: cleanDescription,
        month: transactionPeriod,
        type,
        bankId: formBankId,
      };

      const insertResult = await db
        .from("finance_transactions")
        .insert(createTransactionPayload(pendingTransaction, supabaseUserId))
        .select("id, description, amount, type, category, period, transaction_date, bank_id")
        .single();

      if (insertResult.error) {
        setSyncStatus("error");
        return;
      }

      const savedTransaction = mapTransactionRow(insertResult.data as FinanceTransactionRow);
      setTransactions((current) => [savedTransaction, ...current]);
    }

    setSelectedPeriod(transactionPeriod);
    setDraftSelectedPeriod(transactionPeriod);
    resetMovementForm();
    setSyncStatus("synced");
  }

  async function removeTransaction(id: number) {
    if (!supabaseUserId) {
      setSyncStatus("error");
      return;
    }

    setSyncStatus("syncing");

    const deleteResult = await db
      .from("finance_transactions")
      .delete()
      .eq("user_id", supabaseUserId)
      .eq("id", id);

    if (deleteResult.error) {
      setSyncStatus("error");
      return;
    }

    setTransactions((current) => current.filter((transaction) => transaction.id !== id));
    if (editingTransactionId === id) {
      resetMovementForm();
    }
    setSyncStatus("synced");
  }

  const interactive = syncStatus === "synced";

  function renderTransactionCard(transaction: Transaction, variant: "full" | "nested") {
    const isFormEditingThis = editingTransactionId === transaction.id;
    const baseClass = [
      variant === "nested" ? "transaction transaction--nested" : "transaction",
      isFormEditingThis ? "transaction--editing-target" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <article className={baseClass} key={transaction.id}>
        <div className={`icon ${transaction.type}`}>
          {transaction.type === "income" ? (
            <ArrowUpCircle aria-hidden="true" size={20} />
          ) : (
            <ArrowDownCircle aria-hidden="true" size={20} />
          )}
        </div>
        <div className="transaction-copy">
          <strong>{transaction.description}</strong>
          <div className="transaction-subrow">
            {variant === "full" ? (
              <span className={`transaction-category-pill transaction-category-pill--${transaction.type}`}>
                {transaction.category}
              </span>
            ) : null}
            {transaction.bankId !== null ? (
              <span className="transaction-bank-pill">
                <Landmark aria-hidden="true" size={11} />
                {banks.find((b) => b.id === transaction.bankId)?.name ?? "Banco"}
              </span>
            ) : null}
            <time className="transaction-date" dateTime={transaction.date}>
              {formatDateShort(inputValueToDate(transaction.date))}
            </time>
          </div>
        </div>
        <strong className={transaction.type}>
          {transaction.type === "income" ? "+" : "-"}
          {currency.format(transaction.amount)}
        </strong>
        <div className="transaction-actions">
          <button
            className="icon-button"
            disabled={!interactive}
            type="button"
            onClick={() => openTransactionEditor(transaction)}
            aria-label={`Editar ${transaction.description}`}
            title="Editar"
          >
            <Pencil aria-hidden="true" size={17} />
          </button>
          <button
            className="icon-button"
            disabled={!interactive}
            type="button"
            onClick={() => void removeTransaction(transaction.id)}
            aria-label={`Eliminar ${transaction.description}`}
            title="Eliminar"
          >
            <Trash2 aria-hidden="true" size={17} />
          </button>
        </div>
      </article>
    );
  }

  function renderCategoryGroup(group: TransactionCategoryGroup) {
    if (group.items.length === 1) {
      return renderTransactionCard(group.items[0], "full");
    }

    return (
      <div
        className="transaction-group"
        key={`${group.key}-${group.items[0].id}`}
        aria-label={`${group.categoryLabel}, ${group.items.length} movimientos`}
        role="group"
      >
        <div className="transaction-group-header">
          <span className={`transaction-category-pill transaction-category-pill--${group.type}`}>
            {group.categoryLabel}
          </span>
          <span className="transaction-group-meta">{group.items.length} movimientos</span>
          <strong className={`transaction-group-total ${group.type}`}>
            {group.type === "income" ? "+" : "-"}
            {currency.format(group.items.reduce((subtotal, row) => row.amount + subtotal, 0))}
          </strong>
        </div>
        <div className="transaction-group-rows">
          {group.items.map((item) => renderTransactionCard(item, "nested"))}
        </div>
      </div>
    );
  }

  if (authPhase === "unknown") {
    return (
      <main className="shell">
        <p className="auth-loading">Cargando sesion…</p>
      </main>
    );
  }

  if (authPhase === "guest") {
    return <UserAuthPanel db={db} />;
  }

  const headingPeriod = isMonthKey(draftSelectedPeriod) ? draftSelectedPeriod : selectedPeriod;

  return (
    <main className="shell">
      <section className="topbar" aria-label="Resumen principal">
        <div className="title-block">
          {syncStatus === "error" ? (
            <div className="title-block-status">
              <button
                className="retry-bootstrap"
                type="button"
                onClick={() => {
                  if (supabaseUserId) {
                    void loadUserFinanceData(supabaseUserId);
                  }
                }}
              >
                Reintentar conexion
              </button>
              {connectionError ? (
                <pre className="connection-error" role="alert">
                  {connectionError}
                </pre>
              ) : null}
            </div>
          ) : null}
          <div className="title-heading-row">
            {globalSummaryOpen ? (
              <h1 className="title-month-heading title-month-heading--summary">Resumen global</h1>
            ) : (
              <h1 className="title-month-heading">
                {(() => {
                  const { month, year } = formatMonthTitleParts(headingPeriod);
                  return (
                    <>
                      <span className="title-month-heading__month">{month}</span>
                      <span className="title-month-heading__year">{year}</span>
                    </>
                  );
                })()}
              </h1>
            )}
            <div className="title-block-actions">
              <button className="sign-out-button" type="button" onClick={() => void db.auth.signOut()}>
                <LogOut aria-hidden="true" size={17} />
                Cerrar sesion
              </button>
              {globalSummaryOpen ? (
                <button
                  className="global-summary-back"
                  type="button"
                  onClick={() => setGlobalSummaryOpen(false)}
                >
                  <ArrowLeft aria-hidden="true" size={18} />
                  Volver al periodo
                </button>
              ) : (
                <button
                  className="global-summary-trigger"
                  disabled={!interactive}
                  type="button"
                  onClick={() => setGlobalSummaryOpen(true)}
                >
                  <LayoutDashboard aria-hidden="true" size={18} />
                  Resumen global
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="topbar-tools">
          <div className={`balance ${visibleTotals.balance >= 0 ? "positive" : "negative"}`}>
            {syncStatus !== "error" ? (
              <span
                className={`db-status-indicator${syncStatus === "synced" ? " db-status-indicator--ok" : " db-status-indicator--pending"}`}
                role="status"
                aria-live="polite"
                aria-label={
                  syncStatus === "synced"
                    ? "Conexion con la base de datos correcta"
                    : syncStatus === "syncing"
                      ? "Sincronizando cambios con la base de datos"
                      : "Conectando con la base de datos"
                }
                title={
                  syncStatus === "synced"
                    ? "Conexion con la base de datos correcta"
                    : syncStatus === "syncing"
                      ? "Sincronizando cambios"
                      : "Conectando con la base de datos"
                }
              >
                <span className="db-status-indicator__dot" />
              </span>
            ) : null}
            <div className="balance-icon">
              <Wallet aria-hidden="true" size={23} />
            </div>
            <div>
              <small>{globalSummaryOpen ? "Balance global" : "Balance del periodo"}</small>
              <span>{currency.format(visibleTotals.balance)}</span>
              <em>{globalSummaryOpen ? "Todos los movimientos" : formatPeriod(selectedPeriod, paydayDay)}</em>
            </div>
          </div>
        </div>
      </section>

      {globalSummaryOpen ? null : (
      <section className="period-settings-row" aria-label="Configuracion del periodo">
        <div className="period-controls" aria-label="Periodo y dia de cobro">
          <div className="period-controls-summary">
            <span className="period-controls-summary__icon">
              <CalendarDays aria-hidden="true" size={18} />
            </span>
            <div>
              <span className="period-controls-summary__eyebrow">Periodo activo</span>
              <strong>
                {formatPeriod(
                  isMonthKey(draftSelectedPeriod) ? draftSelectedPeriod : selectedPeriod,
                  clampPaydayDay(Number(draftPaydayDay)),
                )}
              </strong>
            </div>
          </div>
          <div className="period-controls-fields">
            <label className="control-field month-control" htmlFor="field-period-month">
              <span className="control-field__label">Periodo</span>
              <input
                disabled={!interactive}
                id="field-period-month"
                type="month"
                value={draftSelectedPeriod}
                onChange={(event) => setDraftSelectedPeriod(event.target.value)}
              />
            </label>
            <label className="control-field payday-control" htmlFor="field-payday-day">
              <span className="control-field__label">Día de cobro</span>
              <input
                disabled={!interactive}
                id="field-payday-day"
                max="31"
                min="1"
                type="number"
                inputMode="numeric"
                aria-label="Día del mes en que cobras"
                value={draftPaydayDay}
                onChange={(event) => updatePaydayDay(event.target.value)}
              />
            </label>
          </div>
          <button
            className="settings-save"
            disabled={!interactive}
            type="button"
            aria-label="Guardar periodo y día de cobro"
            title="Guardar"
            onClick={() => void savePeriodSettings()}
          >
            <Save aria-hidden="true" size={17} />
            <span>Guardar</span>
          </button>
        </div>
      </section>
      )}

      <section className="summary-grid" aria-label="Resumen financiero">
        <article className="metric">
          <span>Ingresos</span>
          <strong>{currency.format(visibleTotals.income)}</strong>
        </article>
        <article className="metric">
          <span>Gastos</span>
          <strong>{currency.format(visibleTotals.expense)}</strong>
        </article>
        <article className="metric">
          <span>Ahorro</span>
          <strong className={visibleTotals.balance >= 0 ? "income" : "expense"}>
            {currency.format(visibleTotals.balance)}
          </strong>
        </article>
      </section>

      {!globalSummaryOpen ? (
        <section
          className={`panel budget-panel${budgetPanelCollapsed ? " budget-panel--collapsed" : ""}`}
          aria-label="Presupuestos por categoria"
        >
          <div className="panel-heading budget-panel-heading">
            <h2 className="budget-panel-title">
              <PiggyBank aria-hidden="true" size={18} />
              Presupuestos de gasto
            </h2>
            <div className="budget-panel-heading__actions">
              <span className="list-panel-meta">{formatPeriod(selectedPeriod, paydayDay)}</span>
              <button
                aria-controls="budget-panel-body"
                aria-expanded={!budgetPanelCollapsed}
                className="budget-collapse-toggle"
                type="button"
                onClick={() => setBudgetPanelCollapsed((current) => !current)}
              >
                <ChevronDown
                  aria-hidden="true"
                  className={budgetPanelCollapsed ? "" : "budget-collapse-toggle__icon--open"}
                  size={17}
                />
                <span>{budgetPanelCollapsed ? "Mostrar" : "Ocultar"}</span>
              </button>
            </div>
          </div>
          {!budgetPanelCollapsed ? (
            <div className="budget-panel-body" id="budget-panel-body">
              <p className="budget-panel-lead">
                Define un tope por categoría. Se compara con los gastos de este periodo. Deja vacío el importe para
                quitar el presupuesto de esa categoría.
              </p>
              <ul className="budget-rows">
                {EXPENSE_CATEGORIES.map((cat) => {
                  const spent = expenseSpentByCategory.get(cat) ?? 0;
                  const cap = budgetAmountByCategory.get(cat) ?? 0;
                  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
                  const over = cap > 0 && spent > cap;
                  return (
                    <li className="budget-row" key={cat}>
                      <div className="budget-row__main">
                        <span className="budget-row__cat">{cat}</span>
                        <span className="budget-row__spent">
                          Gastado: <strong>{currency.format(spent)}</strong>
                        </span>
                      </div>
                      {cap > 0 ? (
                        <div className={`budget-row__track${over ? " budget-row__track--over" : ""}`}>
                          <div className="budget-row__fill" style={{ width: `${pct}%` }} />
                        </div>
                      ) : null}
                      <label className="budget-row__field">
                        <span className="visually-hidden">Presupuesto {cat}</span>
                        <input
                          disabled={!interactive}
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          type="number"
                          placeholder="Sin tope"
                          value={budgetInputs[cat] ?? ""}
                          onChange={(event) =>
                            setBudgetInputs((current) => ({ ...current, [cat]: event.target.value }))
                          }
                        />
                      </label>
                    </li>
                  );
                })}
              </ul>
              <div className="budget-panel-footer">
                <button
                  className="primary-action"
                  disabled={!interactive}
                  type="button"
                  onClick={() => void saveBudgetsForPeriod()}
                >
                  <Save aria-hidden="true" size={18} />
                  Guardar presupuestos
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {!globalSummaryOpen ? (
        <section
          className={`panel budget-panel${banksPanelCollapsed ? " budget-panel--collapsed" : ""}`}
          aria-label="Bancos y cuentas"
        >
          <div className="panel-heading budget-panel-heading">
            <h2 className="budget-panel-title">
              <Landmark aria-hidden="true" size={18} />
              Bancos y cuentas
            </h2>
            <div className="budget-panel-heading__actions">
              <button
                aria-controls="banks-panel-body"
                aria-expanded={!banksPanelCollapsed}
                className="budget-collapse-toggle"
                type="button"
                onClick={() => setBanksPanelCollapsed((current) => !current)}
              >
                <ChevronDown
                  aria-hidden="true"
                  className={banksPanelCollapsed ? "" : "budget-collapse-toggle__icon--open"}
                  size={17}
                />
                <span>{banksPanelCollapsed ? "Mostrar" : "Ocultar"}</span>
              </button>
            </div>
          </div>
          {!banksPanelCollapsed ? (
            <div className="budget-panel-body" id="banks-panel-body">
              <p className="budget-panel-lead">
                Crea tus bancos o cuentas y asócialos a cada movimiento para ver el balance por cuenta.
              </p>

              {bankSummaries.length > 0 ? (
                <ul className="budget-rows banks-summary-list">
                  {bankSummaries.map(({ bank, summary }) => (
                    <li className="bank-summary-row" key={bank.id}>
                      <div className="bank-summary-row__main">
                        <span className="bank-summary-row__name">
                          <Landmark aria-hidden="true" size={14} />
                          {editingBankId === bank.id ? (
                            <input
                              autoFocus
                              className="bank-name-input"
                              disabled={!interactive}
                              maxLength={60}
                              value={bankDraftName}
                              onChange={(event) => setBankDraftName(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                  setEditingBankId(null);
                                  setBankDraftName("");
                                }
                              }}
                            />
                          ) : (
                            bank.name
                          )}
                        </span>
                        <div className="bank-summary-row__actions">
                          {editingBankId === bank.id ? (
                            <>
                              <button
                                className="icon-button"
                                disabled={!interactive || !bankDraftName.trim()}
                                type="button"
                                title="Guardar nombre"
                                aria-label={`Guardar nombre del banco ${bank.name}`}
                                onClick={() => {
                                  void saveBankForm({
                                    preventDefault: () => {},
                                  } as FormEvent<HTMLFormElement>);
                                }}
                              >
                                <Save aria-hidden="true" size={15} />
                              </button>
                              <button
                                className="icon-button"
                                type="button"
                                title="Cancelar edición"
                                aria-label="Cancelar edición"
                                onClick={() => {
                                  setEditingBankId(null);
                                  setBankDraftName("");
                                }}
                              >
                                ✕
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="icon-button"
                                disabled={!interactive}
                                type="button"
                                title="Editar banco"
                                aria-label={`Editar banco ${bank.name}`}
                                onClick={() => {
                                  setEditingBankId(bank.id);
                                  setBankDraftName(bank.name);
                                }}
                              >
                                <Pencil aria-hidden="true" size={15} />
                              </button>
                              <button
                                className="icon-button"
                                disabled={!interactive}
                                type="button"
                                title="Eliminar banco"
                                aria-label={`Eliminar banco ${bank.name}`}
                                onClick={() => void removeBank(bank.id)}
                              >
                                <Trash2 aria-hidden="true" size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="bank-summary-row__stats">
                        <span className="income">+{currency.format(summary.income)}</span>
                        <span className="expense">−{currency.format(summary.expense)}</span>
                        <strong className={summary.balance >= 0 ? "income" : "expense"}>
                          {currency.format(summary.balance)}
                        </strong>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}

              <form
                className="bank-add-form"
                onSubmit={(e) => void saveBankForm(e)}
              >
                <label htmlFor="field-bank-name" className="visually-hidden">
                  Nombre del banco
                </label>
                <input
                  disabled={!interactive || editingBankId !== null}
                  id="field-bank-name"
                  maxLength={60}
                  placeholder="Nombre del banco o cuenta"
                  value={editingBankId !== null ? "" : bankDraftName}
                  onChange={(event) => setBankDraftName(event.target.value)}
                />
                <button
                  className="primary-action"
                  disabled={!interactive || !bankDraftName.trim() || editingBankId !== null}
                  type="submit"
                >
                  <Plus aria-hidden="true" size={17} />
                  Añadir banco
                </button>
              </form>
            </div>
          ) : null}
        </section>
      ) : null}

      {!globalSummaryOpen ? (
      <section className="panel charts-panel" aria-label="Graficas utiles">
        <div className="charts-header">
          <div>
            <h2>Graficas</h2>
            <span>{formatPeriod(selectedPeriod, paydayDay)}</span>
          </div>
          <ChartSpline aria-hidden="true" size={19} />
        </div>

        <div className="chart-selector" role="tablist" aria-label="Seleccionar grafica">
          <button
            aria-selected={activeChart === "flow"}
            className={activeChart === "flow" ? "active" : ""}
            role="tab"
            type="button"
            onClick={() => setActiveChart("flow")}
          >
            Flujo
          </button>
          <button
            aria-selected={activeChart === "trend"}
            className={activeChart === "trend" ? "active" : ""}
            role="tab"
            type="button"
            onClick={() => setActiveChart("trend")}
          >
            Evolución diaria
          </button>
          <button
            aria-selected={activeChart === "category"}
            className={activeChart === "category" ? "active" : ""}
            role="tab"
            type="button"
            onClick={() => setActiveChart("category")}
          >
            Categorias
          </button>
          <button
            aria-selected={activeChart === "top"}
            className={activeChart === "top" ? "active" : ""}
            role="tab"
            type="button"
            onClick={() => setActiveChart("top")}
          >
            Mayores gastos
          </button>
        </div>

        <div className="chart-stage">
          {activeChart === "flow" && (
            <>
              {visibleTotals.income <= 0 && flowItems.length === 0 ? (
                <p className="empty-state">Anade ingresos y gastos para ver el flujo.</p>
              ) : (
                <div className="flow-chart">
                  <div className="flow-expense-grouping" role="group" aria-label="Agrupacion de gastos en el flujo">
                    <span className="flow-expense-grouping__label">Gastos</span>
                    <div className="flow-expense-grouping__toggle">
                      <button
                        type="button"
                        className={flowExpenseGrouping === "category" ? "active" : ""}
                        aria-pressed={flowExpenseGrouping === "category"}
                        onClick={() => setFlowExpenseGrouping("category")}
                      >
                        Por categoría
                      </button>
                      <button
                        type="button"
                        className={flowExpenseGrouping === "none" ? "active" : ""}
                        aria-pressed={flowExpenseGrouping === "none"}
                        onClick={() => setFlowExpenseGrouping("none")}
                      >
                        Sin agrupar
                      </button>
                    </div>
                  </div>
                  <svg
                    aria-hidden="true"
                    className="flow-svg"
                    preserveAspectRatio="xMidYMid meet"
                    style={{ aspectRatio: `900 / ${flowSvgHeight}` }}
                    viewBox={`0 0 900 ${flowSvgHeight}`}
                  >
                    <rect className="flow-node income-node" x="24" y="32" width="190" height="76" rx="8" />
                    <text className="flow-node-label" x="52" y="66">
                      Ingresos
                    </text>
                    <text className="flow-node-value" x="52" y="91">
                      {currency.format(visibleTotals.income)}
                    </text>

                    {flowItems.map((item, index) => {
                      const y = 56 + index * 64;
                      const sourceY = 70;
                      const strokeWidth = getFlowStrokeWidth(item.total, flowMaxValue);

                      return (
                        <g className={`flow-group ${item.kind}`} key={item.id}>
                          <path
                            className="flow-path"
                            d={`M 214 ${sourceY} C 380 ${sourceY}, 438 ${y}, 604 ${y}`}
                            strokeWidth={strokeWidth}
                          />
                          <rect className="flow-target" x="628" y={y - 28} width="238" height="56" rx="8" />
                          <text className="flow-target-label" x="650" y={y - 5}>
                            {shortenLabel(item.label)}
                          </text>
                          <text className="flow-target-value" x="650" y={y + 18}>
                            {currency.format(item.total)}
                          </text>
                        </g>
                      );
                    })}
                  </svg>

                  <div className="flow-legend">
                    {flowItems.map((item) => (
                      <div className="flow-legend-row" key={item.id}>
                        <span className={`legend-dot ${item.kind}`} />
                        <strong>{item.label}</strong>
                        <span>{currency.format(item.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {activeChart === "trend" && (
            <>
              {dailyEvolutionChartData.length === 0 ? (
                <p className="empty-state">No hay fechas en este periodo.</p>
              ) : (
                <div
                  className="chart-recharts chart-recharts--trend"
                  role="img"
                  aria-label="Evolución diaria acumulada: ingresos, gastos y balance en el periodo"
                >
                  <ResponsiveContainer width="100%" height={340} minHeight={300}>
                    <LineChart
                      data={dailyEvolutionChartData}
                      margin={{ top: 8, right: 14, left: 8, bottom: 4 }}
                    >
                      <CartesianGrid stroke={CHART_LINE} strokeDasharray="4 6" vertical={false} />
                      <XAxis
                        dataKey="dayLabel"
                        tick={{ fill: CHART_ACCENT, fontSize: 11, fontWeight: 600 }}
                        tickLine={false}
                        axisLine={{ stroke: CHART_LINE }}
                        interval="preserveStartEnd"
                        minTickGap={10}
                        angle={-32}
                        textAnchor="end"
                        height={72}
                      />
                      <YAxis
                        tick={{ fill: CHART_ACCENT, fontSize: 11, fontWeight: 600 }}
                        tickFormatter={(value: number) => currency.format(value)}
                        tickLine={false}
                        axisLine={{ stroke: CHART_LINE }}
                        width={112}
                        tickMargin={8}
                      />
                      <Tooltip content={<TrendEvolutionTooltip />} />
                      <Legend
                        formatter={(value) => {
                          if (value === "ingresos") {
                            return "Ingresos acumulados";
                          }
                          if (value === "gastos") {
                            return "Gastos acumulados";
                          }
                          if (value === "balance") {
                            return "Balance acumulado";
                          }
                          return String(value);
                        }}
                        wrapperStyle={{ fontSize: 13, fontWeight: 700 }}
                      />
                      <Line
                        type="stepAfter"
                        dataKey="gastos"
                        name="gastos"
                        stroke={CHART_EXPENSE}
                        strokeWidth={2.5}
                        dot={{ r: 4, strokeWidth: 2, fill: "#fff" }}
                        activeDot={{ r: 6 }}
                      />
                      <Line
                        type="stepAfter"
                        dataKey="ingresos"
                        name="ingresos"
                        stroke={CHART_INCOME}
                        strokeWidth={2.5}
                        dot={{ r: 4, strokeWidth: 2, fill: "#fff" }}
                        activeDot={{ r: 6 }}
                      />
                      <Line
                        type="stepAfter"
                        dataKey="balance"
                        name="balance"
                        stroke={CHART_BALANCE}
                        strokeWidth={2.75}
                        dot={{ r: 4, strokeWidth: 2, fill: "#fff" }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                 
                </div>
              )}
            </>
          )}

          {activeChart === "category" && (
            <>
              {categoryBarChartData.length === 0 ? (
                <p className="empty-state">No hay gastos para comparar.</p>
              ) : (
                <div
                  className="chart-recharts chart-recharts--bars"
                  style={{ height: Math.max(240, categoryBarChartData.length * 44 + 80) }}
                >
                  <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                    <BarChart
                      data={categoryBarChartData}
                      layout="vertical"
                      margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                    >
                      <CartesianGrid stroke={CHART_LINE} strokeDasharray="4 6" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fill: CHART_ACCENT, fontSize: 11 }}
                        tickFormatter={(value: number) => currency.format(value)}
                        tickLine={false}
                        axisLine={{ stroke: CHART_LINE }}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={128}
                        tick={{ fill: CHART_ACCENT, fontSize: 11 }}
                        tickLine={false}
                        axisLine={{ stroke: CHART_LINE }}
                      />
                      <Tooltip content={<BarDistributionTooltip />} cursor={{ fill: "rgba(43, 95, 117, 0.06)" }} />
                      <Bar dataKey="total" name="Total" fill={CHART_EXPENSE} radius={[0, 6, 6, 0]} maxBarSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}

          {activeChart === "top" && (
            <>
              {topBarChartData.length === 0 ? (
                <p className="empty-state">No hay gastos registrados.</p>
              ) : (
                <div
                  className="chart-recharts chart-recharts--bars"
                  style={{ height: Math.max(220, topBarChartData.length * 44 + 80) }}
                >
                  <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                    <BarChart
                      data={topBarChartData}
                      layout="vertical"
                      margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                    >
                      <CartesianGrid stroke={CHART_LINE} strokeDasharray="4 6" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fill: CHART_ACCENT, fontSize: 11 }}
                        tickFormatter={(value: number) => currency.format(value)}
                        tickLine={false}
                        axisLine={{ stroke: CHART_LINE }}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={128}
                        tick={{ fill: CHART_ACCENT, fontSize: 11 }}
                        tickLine={false}
                        axisLine={{ stroke: CHART_LINE }}
                      />
                      <Tooltip content={<BarDistributionTooltip />} cursor={{ fill: "rgba(43, 95, 117, 0.06)" }} />
                      <Bar dataKey="total" name="Total" fill={CHART_ACCENT} radius={[0, 6, 6, 0]} maxBarSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}
        </div>
      </section>
      ) : null}

      {!globalSummaryOpen ? (
        <>
          <section className="workspace">
            <form
              ref={movementFormPanelRef}
              className={`panel form-panel${editingTransactionId !== null ? " form-panel--editing" : ""}`}
              onSubmit={submitMovementForm}
            >
              <div className="panel-heading">
                <h2>{editingTransactionId !== null ? "Editar movimiento" : "Nuevo movimiento"}</h2>
              </div>

              <fieldset className="form-fieldset" disabled={!interactive}>
              <div className="segmented" role="group" aria-label="Tipo de movimiento">
                <button
                  className={type === "expense" ? "active" : ""}
                  type="button"
                  onClick={() => setMovementType("expense")}
                >
                  <ArrowDownCircle aria-hidden="true" size={18} />
                  Gasto
                </button>
                <button
                  className={type === "income" ? "active" : ""}
                  type="button"
                  onClick={() => setMovementType("income")}
                >
                  <ArrowUpCircle aria-hidden="true" size={18} />
                  Ingreso
                </button>
              </div>

              <label>
                Concepto
                <input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Ej. Transporte"
                />
              </label>

              <div className="two-fields">
                <label>
                  Importe
                  <input
                    min="0"
                    step="0.01"
                    type="number"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="0,00"
                  />
                </label>
                <label htmlFor="field-movement-date">
                  Fecha
                  <input
                    id="field-movement-date"
                    type="date"
                    autoComplete="off"
                    enterKeyHint="done"
                    value={movementDate}
                    onChange={(event) => setMovementDate(event.target.value)}
                  />
                </label>
              </div>

              <label htmlFor="field-movement-category">
                Categoría
                <span className="select-shell select-shell--block">
                  <Tag aria-hidden="true" className="select-shell__icon" size={17} />
                  <select
                    className="select-shell__control"
                    id="field-movement-category"
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                  >
                    {categoriesForType(type).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" className="select-shell__chevron" size={18} />
                </span>
              </label>

              {banks.length > 0 ? (
                <label htmlFor="field-movement-bank">
                  Banco / Cuenta
                  <span className="select-shell select-shell--block">
                    <Landmark aria-hidden="true" className="select-shell__icon" size={17} />
                    <select
                      className="select-shell__control"
                      id="field-movement-bank"
                      value={formBankId ?? ""}
                      onChange={(event) =>
                        setFormBankId(event.target.value ? Number(event.target.value) : null)
                      }
                    >
                      <option value="">Sin banco</option>
                      {banks.map((bank) => (
                        <option key={bank.id} value={bank.id}>
                          {bank.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown aria-hidden="true" className="select-shell__chevron" size={18} />
                  </span>
                </label>
              ) : null}

              <div className="form-submit-row">
                {editingTransactionId !== null ? (
                  <button
                    className="filter-clear"
                    disabled={!interactive}
                    type="button"
                    onClick={resetMovementForm}
                  >
                    Cancelar edición
                  </button>
                ) : null}
                <button className="primary-action" type="submit">
                  {editingTransactionId !== null ? (
                    <>
                      <Save aria-hidden="true" size={18} />
                      Guardar
                    </>
                  ) : (
                    <>
                      <Plus aria-hidden="true" size={18} />
                      Anadir movimiento
                    </>
                  )}
                </button>
              </div>
              </fieldset>
            </form>

            <section className="panel list-panel" aria-label="Listado de movimientos">
              <div className="panel-heading">
                <h2>Movimientos</h2>
                <span className="list-panel-meta">
                  {formatPeriod(selectedPeriod, paydayDay)}
                  {periodTransactions.length > 0 ? (
                    <>
                      {" · "}
                      {filteredPeriodTransactions.length === periodTransactions.length
                        ? String(periodTransactions.length)
                        : `${filteredPeriodTransactions.length} de ${periodTransactions.length}`}
                    </>
                  ) : null}
                </span>
              </div>

              <div className="list-panel-toolbar">
                <label className="select-shell select-shell--toolbar" htmlFor="field-movement-order">
                  <ArrowDownUp aria-hidden="true" className="select-shell__icon" size={17} />
                  <select
                    className="select-shell__control"
                    disabled={!interactive}
                    id="field-movement-order"
                    aria-label="Orden del listado de movimientos"
                    value={movementListOrder}
                    onChange={(event) => setMovementListOrder(event.target.value as MovementListOrder)}
                  >
                    <option value="recent">Fecha (más reciente)</option>
                    <option value="category">Categoría (A-Z)</option>
                    <option value="week">Por semana</option>
                  </select>
                  <ChevronDown aria-hidden="true" className="select-shell__chevron" size={18} />
                </label>
                <button
                  aria-controls="transaction-filters-panel"
                  aria-expanded={movementFiltersOpen}
                  className="transaction-filters-toggle"
                  disabled={!interactive}
                  type="button"
                  onClick={() => setMovementFiltersOpen((open) => !open)}
                >
                  <ListFilter aria-hidden="true" size={17} />
                  Filtros
                  {hasActiveMovementFilters ? (
                    <span className="filter-active-badge">Activos</span>
                  ) : null}
                  <ChevronDown
                    aria-hidden="true"
                    className={movementFiltersOpen ? "filters-chevron filters-chevron--open" : "filters-chevron"}
                    size={18}
                  />
                </button>
              </div>

              {movementFiltersOpen ? (
                <div
                  className="transaction-filters"
                  id="transaction-filters-panel"
                  role="search"
                  aria-label="Filtrar movimientos del periodo"
                >
                  <div className="transaction-filter-row">
                    <label>
                      Tipo
                      <select
                        disabled={!interactive}
                        value={movementFilterType}
                        onChange={(event) =>
                          setMovementFilterType(event.target.value as MovementFilterType)
                        }
                      >
                        <option value="all">Todos</option>
                        <option value="income">Ingresos</option>
                        <option value="expense">Gastos</option>
                      </select>
                    </label>
                    <label>
                      Categoría
                      <select
                        disabled={!interactive}
                        value={movementFilterCategory}
                        onChange={(event) => setMovementFilterCategory(event.target.value)}
                      >
                        <option value="">Todas</option>
                        {periodTransactionCategories.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </label>
                    {banks.length > 0 ? (
                      <label>
                        Banco
                        <select
                          disabled={!interactive}
                          value={movementFilterBankId}
                          onChange={(event) =>
                            setMovementFilterBankId(event.target.value ? Number(event.target.value) : "")
                          }
                        >
                          <option value="">Todos</option>
                          {banks.map((bank) => (
                            <option key={bank.id} value={bank.id}>
                              {bank.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                  <label className="transaction-filter-search">
                    Buscar en concepto
                    <input
                      disabled={!interactive}
                      type="search"
                      value={movementSearch}
                      autoComplete="off"
                      placeholder="Ej. supermercado"
                      onChange={(event) => setMovementSearch(event.target.value)}
                    />
                  </label>
                  {hasActiveMovementFilters ? (
                    <button
                      className="filter-clear"
                      disabled={!interactive}
                      type="button"
                      onClick={() => {
                        setMovementFilterType("all");
                        setMovementFilterCategory("");
                        setMovementFilterBankId("");
                        setMovementSearch("");
                      }}
                    >
                      Limpiar filtros
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div className="transactions">
                {periodTransactions.length === 0 ? (
                  <p className="empty-state">No hay movimientos en este periodo.</p>
                ) : filteredPeriodTransactions.length === 0 ? (
                  <p className="empty-state">Ningún movimiento coincide con los filtros.</p>
                ) : movementListRender.kind === "week" ? (
                  movementListRender.sections.map((section) => (
                    <section
                      key={section.weekStart}
                      className="transaction-week-block"
                      aria-label={`Semana del ${section.heading}`}
                    >
                      <h3 className="transaction-week-heading">Semana · {section.heading}</h3>
                      <div className="transaction-week-groups">
                        {section.groups.map((group) => renderCategoryGroup(group))}
                      </div>
                    </section>
                  ))
                ) : (
                  movementListRender.groups.map((group) => renderCategoryGroup(group))
                )}
              </div>
            </section>
          </section>

          <section className="panel months-panel" aria-label="Resumen por periodos">
            <div className="panel-heading">
              <h2>Resumen por periodos</h2>
            </div>
            <div className="month-rows">
              {periodSummaries.map(({ period, summary }) => (
                <button
                  className={period === selectedPeriod ? "month-row active" : "month-row"}
                  disabled={!interactive}
                  key={period}
                  type="button"
                  onClick={() => selectPeriod(period)}
                >
                  <strong>{formatPeriod(period, paydayDay)}</strong>
                  <span>{currency.format(summary.income)}</span>
                  <span>{currency.format(summary.expense)}</span>
                  <span className={summary.balance >= 0 ? "income" : "expense"}>
                    {currency.format(summary.balance)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </>
      ) : (
        <section className="global-summary-view" aria-label="Resumen global">
         

          <div className="global-summary-highlights">
            <section className="panel global-summary-panel">
              <div className="panel-heading">
                <h2>Evolución reciente</h2>
                <span>Últimos periodos</span>
              </div>
              <div className="summary-trend-list">
                {trendChartItems.length === 0 ? (
                  <p className="empty-state">Aún no hay periodos con datos.</p>
                ) : (
                  trendChartItems.map(({ period, summary }) => (
                    <div className="summary-trend-row" key={period}>
                      <div className="summary-trend-copy">
                        <strong>{formatPeriodCompact(period)}</strong>
                        <span>
                          Ingresos {currency.format(summary.income)} · Gastos {currency.format(summary.expense)}
                        </span>
                      </div>
                      <strong className={summary.balance >= 0 ? "income" : "expense"}>
                        {currency.format(summary.balance)}
                      </strong>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="panel global-summary-panel">
              <div className="panel-heading">
                <h2>Mayores gastos por categoría</h2>
                <span>Historial completo</span>
              </div>
              <div className="bar-list">
                {globalSummaryCategories.length === 0 ? (
                  <p className="empty-state">No hay gastos registrados.</p>
                ) : (
                  globalSummaryCategories.map((item) => (
                    <article className="bar-row" key={item.id}>
                      <div className="bar-row-copy">
                        <strong>{item.label}</strong>
                        <span>{item.count} movimientos</span>
                      </div>
                      <strong>{currency.format(item.total)}</strong>
                      <div className="bar-track">
                        <span
                          className="bar-fill expense-fill"
                          style={{ width: getBarWidth(item.total, globalSummaryCategoryMax) }}
                        />
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          </div>

        <section className="global-grid global-summary-grouped" aria-label="Totales por concepto">
          <section className="panel grouped-panel">
            <div className="panel-heading">
              <h2>Ingresos agrupados</h2>
              <span>{groupedTransactions.income.length}</span>
            </div>
            <div className="group-list">
              {groupedTransactions.income.length === 0 ? (
                <p className="empty-state">No hay ingresos registrados.</p>
              ) : (
                groupedTransactions.income.map((group) => (
                  <article className="group-row" key={group.id}>
                    <div>
                      <strong>{group.label}</strong>
                      <span>
                        {group.count} movimientos - {group.periods.size} periodos
                      </span>
                    </div>
                    <strong className="income">{currency.format(group.total)}</strong>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="panel grouped-panel">
            <div className="panel-heading">
              <h2>Gastos agrupados</h2>
              <span>{groupedTransactions.expense.length}</span>
            </div>
            <div className="group-list">
              {groupedTransactions.expense.length === 0 ? (
                <p className="empty-state">No hay gastos registrados.</p>
              ) : (
                groupedTransactions.expense.map((group) => (
                  <article className="group-row" key={group.id}>
                    <div>
                      <strong>{group.label}</strong>
                      <span>
                        {group.count} movimientos - {group.periods.size} periodos
                      </span>
                    </div>
                    <strong className="expense">{currency.format(group.total)}</strong>
                  </article>
                ))
              )}
            </div>
          </section>
        </section>
        </section>
      )}
    </main>
  );
}

export default function Home() {
  if (!supabase) {
    return <MissingSupabase />;
  }

  return <FinanceApp />;
}
