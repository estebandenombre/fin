"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  CalendarDays,
  ChartSpline,
  Plus,
  Save,
  Trash2,
  Wallet,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

type TransactionType = "income" | "expense";
type ActiveView = "period" | "global";
type ActiveChart = "flow" | "trend" | "category" | "top";
type SyncStatus = "loading" | "syncing" | "synced" | "error";

type Transaction = {
  id: number;
  description: string;
  amount: number;
  type: TransactionType;
  category: string;
  month: string;
  date: string;
};

type FinanceTransactionRow = {
  id: number;
  description: string;
  amount: number | string;
  type: TransactionType;
  category: string;
  period: string;
  transaction_date: string;
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

function getDefaultMovementDate(period: string, paydayDay: number) {
  const today = todayInputValue();
  const todayPeriod = getPeriodKeyForDate(today, paydayDay);
  return todayPeriod === period ? today : getPeriodRange(period, paydayDay).startInput;
}

function parsePositiveNumber(value: string) {
  const parsedValue = Number(value.replace(",", "."));
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
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

function createFlowItems(transactions: Transaction[], summary: Summary): FlowItem[] {
  const expenseGroups = new Map<string, FlowItem>();

  for (const transaction of transactions) {
    if (transaction.type !== "expense") {
      continue;
    }

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

function getFlowStrokeWidth(value: number, maxValue: number) {
  if (maxValue <= 0) {
    return 8;
  }

  return Math.max(8, Math.min(30, 8 + (value / maxValue) * 22));
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
  };
}

function getSyncLabel(status: SyncStatus) {
  switch (status) {
    case "synced":
      return "Base de datos";
    case "syncing":
      return "Guardando";
    case "loading":
      return "Cargando";
    case "error":
      return "Error";
    default:
      return "";
  }
}

function MissingSupabase() {
  return (
    <main className="shell">
      <section className="panel missing-supabase" aria-label="Configuracion requerida">
        <h1>Falta configurar Supabase</h1>
        <p>
          Anade en <code>.env.local</code>: <code>NEXT_PUBLIC_SUPABASE_URL</code> y{" "}
          <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>. Reinicia el servidor despues de guardar.
        </p>
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
  const [activeView, setActiveView] = useState<ActiveView>("period");
  const [activeChart, setActiveChart] = useState<ActiveChart>("flow");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [supabaseUserId, setSupabaseUserId] = useState<string | null>(null);
  const [bootstrapNonce, setBootstrapNonce] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<TransactionType>("expense");
  const [category, setCategory] = useState("General");
  const [movementDate, setMovementDate] = useState(() =>
    getDefaultMovementDate(initialPeriod, initialPaydayDay),
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setSyncStatus("loading");

      try {
        const sessionResult = await db.auth.getSession();
        let userId = sessionResult.data.session?.user.id;

        if (!userId) {
          const signInResult = await db.auth.signInAnonymously();

          if (signInResult.error) {
            throw signInResult.error;
          }

          userId = signInResult.data.user?.id;
        }

        if (!userId) {
          throw new Error("No Supabase user id");
        }

        if (cancelled) {
          return;
        }

        setSupabaseUserId(userId);

        const settingsResult = await db
          .from("finance_settings")
          .select("payday_day, selected_period")
          .eq("user_id", userId)
          .maybeSingle();

        if (settingsResult.error) {
          throw settingsResult.error;
        }

        const nextPaydayDay = clampPaydayDay(settingsResult.data?.payday_day ?? 1);
        const remoteSelectedPeriod = settingsResult.data?.selected_period;
        const nextPeriod = isMonthKey(remoteSelectedPeriod) ? remoteSelectedPeriod : currentMonth();

        if (cancelled) {
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
            selected_period: nextPeriod,
          });

          if (settingsUpsert.error) {
            throw settingsUpsert.error;
          }
        }

        const transactionsResult = await db
          .from("finance_transactions")
          .select("id, description, amount, type, category, period, transaction_date")
          .eq("user_id", userId)
          .order("transaction_date", { ascending: false })
          .order("id", { ascending: false });

        if (transactionsResult.error) {
          throw transactionsResult.error;
        }

        const remoteTransactions = (transactionsResult.data ?? []).map((row) =>
          mapTransactionRow(row as FinanceTransactionRow),
        );

        if (cancelled) {
          return;
        }

        if (remoteTransactions.length > 0) {
          setTransactions(normalizeTransactions(remoteTransactions, nextPaydayDay));
        } else {
          setTransactions([]);
        }

        if (!cancelled) {
          setSyncStatus("synced");
        }
      } catch {
        if (!cancelled) {
          setSupabaseUserId(null);
          setSyncStatus("error");
        }
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [bootstrapNonce]);

  const periodTransactions = useMemo(() => {
    return transactions.filter(
      (transaction) => getPeriodKeyForDate(transaction.date, paydayDay) === selectedPeriod,
    );
  }, [paydayDay, selectedPeriod, transactions]);

  const totals = useMemo(() => {
    return createSummary(periodTransactions);
  }, [periodTransactions]);

  const globalTotals = useMemo(() => {
    return createSummary(transactions);
  }, [transactions]);

  const visibleTotals = activeView === "global" ? globalTotals : totals;
  const visibleTransactions = activeView === "global" ? transactions : periodTransactions;

  const flowItems = useMemo(() => {
    return createFlowItems(visibleTransactions, visibleTotals);
  }, [visibleTotals, visibleTransactions]);

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

  const trendMaxValue = useMemo(() => {
    return Math.max(
      ...trendChartItems.flatMap(({ summary }) => [
        summary.income,
        summary.expense,
        Math.abs(summary.balance),
      ]),
      1,
    );
  }, [trendChartItems]);

  const categoryChartItems = useMemo(() => {
    return groupExpensesBy(visibleTransactions, (transaction) => transaction.category);
  }, [visibleTransactions]);

  const categoryMaxValue = useMemo(() => {
    return Math.max(...categoryChartItems.map((item) => item.total), 1);
  }, [categoryChartItems]);

  const topExpenseItems = useMemo(() => {
    return groupExpensesBy(visibleTransactions, (transaction) => transaction.description).slice(0, 5);
  }, [visibleTransactions]);

  const topExpenseMaxValue = useMemo(() => {
    return Math.max(...topExpenseItems.map((item) => item.total), 1);
  }, [topExpenseItems]);

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
        selected_period: nextPeriod,
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

  async function addTransaction(event: FormEvent<HTMLFormElement>) {
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

    const pendingTransaction: Transaction = {
      id: 0,
      description: cleanDescription,
      amount: parsedAmount,
      type,
      category: category.trim() || "General",
      month: transactionPeriod,
      date: movementDate,
    };

    setSyncStatus("syncing");

    const insertResult = await db
      .from("finance_transactions")
      .insert(createTransactionPayload(pendingTransaction, supabaseUserId))
      .select("id, description, amount, type, category, period, transaction_date")
      .single();

    if (insertResult.error) {
      setSyncStatus("error");
      return;
    }

    const savedTransaction = mapTransactionRow(insertResult.data as FinanceTransactionRow);
    setTransactions((current) => [savedTransaction, ...current]);

    setSelectedPeriod(transactionPeriod);
    setDraftSelectedPeriod(transactionPeriod);
    setDescription("");
    setAmount("");
    setCategory("General");
    setMovementDate(getDefaultMovementDate(transactionPeriod, paydayDay));

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
    setSyncStatus("synced");
  }

  const interactive = syncStatus === "synced";

  return (
    <main className="shell">
      <section className="topbar" aria-label="Resumen principal">
        <div className="title-block">
          <div className="title-block-status">
            <p className="eyebrow">Panel personal / {getSyncLabel(syncStatus)}</p>
            {syncStatus === "error" ? (
              <button className="retry-bootstrap" type="button" onClick={() => setBootstrapNonce((n) => n + 1)}>
                Reintentar conexion
              </button>
            ) : null}
          </div>
          <h1>Finanzas</h1>
        </div>
        <div className="topbar-tools">
          <div className={`balance ${visibleTotals.balance >= 0 ? "positive" : "negative"}`}>
            <div className="balance-icon">
              <Wallet aria-hidden="true" size={23} />
            </div>
            <div>
              <small>{activeView === "global" ? "Balance global" : "Balance del periodo"}</small>
              <span>{currency.format(visibleTotals.balance)}</span>
              <em>{activeView === "global" ? "Todos los periodos" : formatPeriod(selectedPeriod, paydayDay)}</em>
            </div>
          </div>
        </div>
      </section>

      <section className="toolbar-stack" aria-label="Vista y periodo">
        <div className="tabs toolbar-tabs" role="tablist" aria-label="Vista de finanzas">
          <button
            aria-selected={activeView === "period"}
            className={activeView === "period" ? "active" : ""}
            role="tab"
            type="button"
            onClick={() => setActiveView("period")}
          >
            Periodo
          </button>
          <button
            aria-selected={activeView === "global"}
            className={activeView === "global" ? "active" : ""}
            role="tab"
            type="button"
            onClick={() => setActiveView("global")}
          >
            Global
          </button>
        </div>
        <div className="period-controls period-controls--stacked" aria-label="Configuracion del periodo">
          <div className="period-controls-fields">
            <label className="control-field month-control">
              <CalendarDays aria-hidden="true" size={18} />
              <span>Periodo</span>
              <input
                disabled={!interactive}
                type="month"
                value={draftSelectedPeriod}
                onChange={(event) => setDraftSelectedPeriod(event.target.value)}
              />
            </label>
            <label className="control-field payday-control">
              <Banknote aria-hidden="true" size={18} />
              <span>Día de cobro</span>
              <input
                disabled={!interactive}
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
            onClick={() => void savePeriodSettings()}
          >
            <Save aria-hidden="true" size={17} />
            Guardar
          </button>
        </div>
      </section>

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

      <section className="panel charts-panel" aria-label="Graficas utiles">
        <div className="charts-header">
          <div>
            <h2>Graficas</h2>
            <span>
              {activeView === "global" ? "Todos los periodos" : formatPeriod(selectedPeriod, paydayDay)}
            </span>
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
            Evolucion
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
              <div className="trend-chart-scroll">
                <div
                  className="trend-chart"
                  style={{
                    gridTemplateColumns: `repeat(${Math.max(trendChartItems.length, 1)}, minmax(56px, 1fr))`,
                  }}
                >
                  {trendChartItems.map(({ period, summary }) => (
                    <article className="trend-column" key={period}>
                      <div className="trend-bars" aria-hidden="true">
                        <span
                          className="trend-bar income-bar"
                          style={{ height: getBarWidth(summary.income, trendMaxValue) }}
                        />
                        <span
                          className="trend-bar expense-bar"
                          style={{ height: getBarWidth(summary.expense, trendMaxValue) }}
                        />
                        <span
                          className={summary.balance >= 0 ? "trend-bar saving-bar" : "trend-bar gap-bar"}
                          style={{ height: getBarWidth(Math.abs(summary.balance), trendMaxValue) }}
                        />
                      </div>
                      <strong>{formatPeriodCompact(period)}</strong>
                    </article>
                  ))}
                </div>
              </div>

              <div className="chart-key">
                <span><i className="income-dot" />Ingresos</span>
                <span><i className="expense-dot" />Gastos</span>
                <span><i className="saving-dot" />Ahorro</span>
              </div>
            </>
          )}

          {activeChart === "category" && (
            <div className="bar-list">
              {categoryChartItems.length === 0 ? (
                <p className="empty-state">No hay gastos para comparar.</p>
              ) : (
                categoryChartItems.map((item) => (
                  <article className="bar-row" key={item.id}>
                    <div className="bar-row-copy">
                      <strong>{item.label}</strong>
                      <span>{item.count} movimientos</span>
                    </div>
                    <strong>{currency.format(item.total)}</strong>
                    <div className="bar-track">
                      <span
                        className="bar-fill expense-fill"
                        style={{ width: getBarWidth(item.total, categoryMaxValue) }}
                      />
                    </div>
                  </article>
                ))
              )}
            </div>
          )}

          {activeChart === "top" && (
            <div className="bar-list">
              {topExpenseItems.length === 0 ? (
                <p className="empty-state">No hay gastos registrados.</p>
              ) : (
                topExpenseItems.map((item) => (
                  <article className="bar-row" key={item.id}>
                    <div className="bar-row-copy">
                      <strong>{item.label}</strong>
                      <span>{item.count} veces</span>
                    </div>
                    <strong>{currency.format(item.total)}</strong>
                    <div className="bar-track">
                      <span
                        className="bar-fill muted-fill"
                        style={{ width: getBarWidth(item.total, topExpenseMaxValue) }}
                      />
                    </div>
                  </article>
                ))
              )}
            </div>
          )}
        </div>
      </section>

      {activeView === "period" ? (
        <>
          <section className="workspace">
            <form className="panel form-panel" onSubmit={addTransaction}>
              <div className="panel-heading">
                <h2>Nuevo movimiento</h2>
              </div>

              <fieldset className="form-fieldset" disabled={!interactive}>
              <div className="segmented" role="group" aria-label="Tipo de movimiento">
                <button
                  className={type === "expense" ? "active" : ""}
                  type="button"
                  onClick={() => setType("expense")}
                >
                  <ArrowDownCircle aria-hidden="true" size={18} />
                  Gasto
                </button>
                <button
                  className={type === "income" ? "active" : ""}
                  type="button"
                  onClick={() => setType("income")}
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
                <label>
                  Fecha
                  <input
                    type="date"
                    value={movementDate}
                    onChange={(event) => setMovementDate(event.target.value)}
                  />
                </label>
              </div>

              <label>
                Categoria
                <input
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  placeholder="General"
                />
              </label>

              <button className="primary-action" type="submit">
                <Plus aria-hidden="true" size={18} />
                Anadir movimiento
              </button>
              </fieldset>
            </form>

            <section className="panel list-panel" aria-label="Listado de movimientos">
              <div className="panel-heading">
                <h2>Movimientos</h2>
                <span>{formatPeriod(selectedPeriod, paydayDay)}</span>
              </div>

              <div className="transactions">
                {periodTransactions.length === 0 ? (
                  <p className="empty-state">No hay movimientos en este periodo.</p>
                ) : (
                  periodTransactions.map((transaction) => (
                    <article className="transaction" key={transaction.id}>
                      <div className={`icon ${transaction.type}`}>
                        {transaction.type === "income" ? (
                          <ArrowUpCircle aria-hidden="true" size={20} />
                        ) : (
                          <ArrowDownCircle aria-hidden="true" size={20} />
                        )}
                      </div>
                      <div className="transaction-copy">
                        <strong>{transaction.description}</strong>
                        <span>
                          {transaction.category} - {transaction.date}
                        </span>
                      </div>
                      <strong className={transaction.type}>
                        {transaction.type === "income" ? "+" : "-"}
                        {currency.format(transaction.amount)}
                      </strong>
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
                    </article>
                  ))
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
        <section className="global-grid" aria-label="Resumen global agrupado">
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
