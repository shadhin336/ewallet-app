const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Render Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Database Tables Initialization
const initDb = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(20) UNIQUE NOT NULL,
        ref_code VARCHAR(20) UNIQUE NOT NULL,
        referred_by VARCHAR(20),
        balance DECIMAL DEFAULT 0.00,
        total_deposit DECIMAL DEFAULT 0.00,
        total_withdraw DECIMAL DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(20) NOT NULL,
        type VARCHAR(20) NOT NULL,
        method VARCHAR(20) NOT NULL,
        amount DECIMAL NOT NULL,
        trx_id VARCHAR(100),
        status VARCHAR(20) DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Database initialized successfully!");
  } catch (err) {
    console.error("Database Init Error:", err);
  }
};
initDb();

// 1. Get User Profile Data
app.get('/api/user/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    let user = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    
    if (user.rows.length === 0) {
      const refCode = 'REF' + Math.floor(100000 + Math.random() * 900000);
      user = await pool.query(
        'INSERT INTO users (phone, ref_code) VALUES ($1, $2) RETURNING *',
        [phone, refCode]
      );
    }
    
    const referrals = await pool.query('SELECT COUNT(*) FROM users WHERE referred_by = $1', [user.rows[0].ref_code]);
    const txns = await pool.query('SELECT * FROM transactions WHERE phone = $1 ORDER BY id DESC', [phone]);

    res.json({
      user: user.rows[0],
      total_referrals: parseInt(referrals.rows[0].count),
      transactions: txns.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Submit Deposit Request
app.post('/api/deposit', async (req, res) => {
  try {
    const { phone, method, amount, trx_id } = req.body;
    await pool.query(
      'INSERT INTO transactions (phone, type, method, amount, trx_id) VALUES ($1, $2, $3, $4, $5)',
      [phone, 'Deposit', method, amount, trx_id]
    );
    res.json({ success: true, message: 'ডিপোজিট রিকোয়েস্ট সফলভাবে পাঠানো হয়েছে!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Admin: Get All Pending Deposits
app.get('/api/admin/pending', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM transactions WHERE status = 'Pending' ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Admin: Approve Deposit Request
app.post('/api/admin/approve', async (req, res) => {
  try {
    const { txn_id, phone, amount } = req.body;
    await pool.query("UPDATE transactions SET status = 'Approved' WHERE id = $1", [txn_id]);
    await pool.query(
      "UPDATE users SET balance = balance + $1, total_deposit = total_deposit + $1 WHERE phone = $2",
      [amount, phone]
    );
    res.json({ success: true, message: 'ডিপোজিট ওকে করা হয়েছে!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

