import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import AdmZip from "adm-zip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database("finance.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    type TEXT CHECK(type IN ('income', 'expense')) NOT NULL,
    date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS budgets (
    category TEXT PRIMARY KEY,
    amount REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recurring_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    type TEXT CHECK(type IN ('income', 'expense')) NOT NULL,
    day_of_month INTEGER NOT NULL,
    last_processed TEXT
  );

  CREATE TABLE IF NOT EXISTS investments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    type TEXT CHECK(type IN ('stock', 'crypto', 'bond', 'other')) NOT NULL,
    purchase_date TEXT NOT NULL,
    current_value REAL NOT NULL
  );
`);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/transactions", (req, res) => {
    const transactions = db.prepare("SELECT * FROM transactions ORDER BY date DESC").all();
    res.json(transactions);
  });

  app.post("/api/transactions", (req, res) => {
    const { amount, category, description, type, date } = req.body;
    const info = db.prepare(
      "INSERT INTO transactions (amount, category, description, type, date) VALUES (?, ?, ?, ?, ?)"
    ).run(amount, category, description, type, date);
    res.json({ id: info.lastInsertRowid });
  });

  app.delete("/api/transactions/:id", (req, res) => {
    db.prepare("DELETE FROM transactions WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.get("/api/budgets", (req, res) => {
    const budgets = db.prepare("SELECT * FROM budgets").all();
    res.json(budgets);
  });

  app.post("/api/budgets", (req, res) => {
    const { category, amount } = req.body;
    db.prepare("INSERT OR REPLACE INTO budgets (category, amount) VALUES (?, ?)").run(category, amount);
    res.json({ success: true });
  });

  app.get("/api/recurring", (req, res) => {
    const recurring = db.prepare("SELECT * FROM recurring_payments").all();
    res.json(recurring);
  });

  app.post("/api/recurring", (req, res) => {
    const { amount, category, description, type, day_of_month } = req.body;
    const info = db.prepare(
      "INSERT INTO recurring_payments (amount, category, description, type, day_of_month) VALUES (?, ?, ?, ?, ?)"
    ).run(amount, category, description, type, day_of_month);
    res.json({ id: info.lastInsertRowid });
  });

  app.delete("/api/recurring/:id", (req, res) => {
    db.prepare("DELETE FROM recurring_payments WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // Investment Routes
  app.get("/api/investments", (req, res) => {
    const investments = db.prepare("SELECT * FROM investments ORDER BY purchase_date DESC").all();
    res.json(investments);
  });

  app.post("/api/investments", (req, res) => {
    const { name, amount, type, purchase_date, current_value } = req.body;
    const result = db.prepare(`
      INSERT INTO investments (name, amount, type, purchase_date, current_value)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, amount, type, purchase_date, current_value || amount);
    res.json({ id: result.lastInsertRowid });
  });

  app.patch("/api/investments/:id", (req, res) => {
    const { current_value } = req.body;
    db.prepare("UPDATE investments SET current_value = ? WHERE id = ?").run(current_value, req.params.id);
    res.json({ success: true });
  });

  app.delete("/api/investments/:id", (req, res) => {
    db.prepare("DELETE FROM investments WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.get("/api/stats", (req, res) => {
    const stats = db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as totalIncome,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as totalExpenses
      FROM transactions
    `).get();

    // Monthly Trends
    const trends = db.prepare(`
      SELECT 
        strftime('%Y-%m', date) as month,
        SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expenses
      FROM transactions
      GROUP BY month
      ORDER BY month ASC
      LIMIT 12
    `).all();

    res.json({ ...stats, trends });
  });

  app.get("/api/export", (req, res) => {
    const transactions = db.prepare("SELECT * FROM transactions ORDER BY date DESC").all();
    
    let csv = "ID,Дата,Тип,Категория,Описание,Сумма\n";
    transactions.forEach((t: any) => {
      csv += `${t.id},${t.date},${t.type === 'income' ? 'Доход' : 'Расход'},${t.category},"${t.description || ''}",${t.amount}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=transactions.csv');
    res.status(200).send(csv);
  });

  app.get("/api/project/download", (req, res) => {
    try {
      const zip = new AdmZip();
      const ignoreDirs = ['node_modules', '.git', 'dist', '.next', 'out'];
      const ignoreFiles = ['finance.db', 'package-lock.json', '.env'];

      const addFilesToZip = (dir: string, zipPath: string = '') => {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const relPath = path.join(zipPath, item);
          
          if (ignoreDirs.includes(item) || ignoreFiles.includes(item)) continue;
          
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            addFilesToZip(fullPath, relPath);
          } else {
            zip.addFile(relPath, fs.readFileSync(fullPath));
          }
        }
      };

      addFilesToZip(__dirname);
      const buffer = zip.toBuffer();

      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', 'attachment; filename=ZenFinance-Project.zip');
      res.send(buffer);
    } catch (error: any) {
      console.error("Download Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Process recurring payments
  const processRecurring = () => {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    const dayOfMonth = today.getDate();
    const currentMonth = today.toISOString().slice(0, 7); // YYYY-MM

    const recurring = db.prepare("SELECT * FROM recurring_payments WHERE day_of_month = ?").all(dayOfMonth);
    
    for (const payment of recurring) {
      // Check if already processed this month
      if (payment.last_processed && payment.last_processed.startsWith(currentMonth)) continue;

      db.prepare(
        "INSERT INTO transactions (amount, category, description, type, date) VALUES (?, ?, ?, ?, ?)"
      ).run(payment.amount, payment.category, payment.description || 'Регулярный платеж', payment.type, dateStr);

      db.prepare("UPDATE recurring_payments SET last_processed = ? WHERE id = ?").run(dateStr, payment.id);
    }
  };

  // Run once on start and then every hour
  processRecurring();
  setInterval(processRecurring, 3600000);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
