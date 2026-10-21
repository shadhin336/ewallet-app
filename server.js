const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(express.json());

// Allow CORS for Vercel
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const initDb = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(20) UNIQUE NOT NULL,
        pin VARCHAR(10) NOT NULL,
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

      CREATE TABLE IF NOT EXISTS user_gateways (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(20) NOT NULL,
        method VARCHAR(20) NOT NULL,
        account_no VARCHAR(30) NOT NULL,
        status VARCHAR(10) DEFAULT 'Active',
        UNIQUE(phone, method)
      );
    `);
    console.log("Database initialized successfully!");
  } catch (err) {
    console.error("Database Init Error:", err);
  }
};
initDb();

// Base Test API
app.get('/', (req, res) => {
  res.send('API Server is Live and Running!');
});

// Register API
app.post('/api/register', async (req, res) => {
  try {
    const { phone, pin, ref_by } = req.body;
    if (!phone || !pin) {
      return res.status(400).json({ success: false, message: 'মোবাইল নম্বর ও পিন বাধ্যতামূলক!' });
    }

    let userCheck = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'এই নম্বর দিয়ে ইতিমধ্যে একটি অ্যাকাউন্ট রয়েছে!' });
    }

    const refCode = 'REF' + Math.floor(100000 + Math.random() * 900000);
    const newUser = await pool.query(
      'INSERT INTO users (phone, pin, ref_code, referred_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [phone, pin, refCode, ref_by || null]
    );
    res.json({ success: true, message: 'সফলভাবে অ্যাকাউন্ট তৈরি হয়েছে!', user: newUser.rows[0] });
  } catch (err) {
    console.error("Register Error:", err);
    res.status(500).json({ success: false, message: 'রেজিস্ট্রেশন প্রক্রিয়ায় ব্যাকএন্ড সমস্যা হয়েছে!' });
  }
});

// Login API
app.post('/api/login', async (req, res) => {
  try {
    const { phone, pin } = req.body;
    const user = await pool.query('SELECT * FROM users WHERE phone = $1 AND pin = $2', [phone, pin]);
    
    if (user.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'ভুল মোবাইল নম্বর অথবা পিন কোড!' });
    }
    res.json({ success: true, message: 'লগইন সফল হয়েছে!', user: user.rows[0] });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ success: false, message: 'লগইন প্রক্রিয়ায় ব্যাকএন্ড সমস্যা হয়েছে!' });
  }
});

// Get User Data & Gateways
app.get('/api/user/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const user = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const referrals = await pool.query('SELECT COUNT(*) FROM users WHERE referred_by = $1', [user.rows[0].ref_code]);
    const txns = await pool.query('SELECT * FROM transactions WHERE phone = $1 ORDER BY id DESC', [phone]);
    const gateways = await pool.query('SELECT * FROM user_gateways WHERE phone = $1', [phone]);

    res.json({
      user: user.rows[0],
      total_referrals: parseInt(referrals.rows[0].count),
      transactions: txns.rows,
      gateways: gateways.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save Gateway
app.post('/api/gateway/save', async (req, res) => {
  try {
    const { phone, method, account_no, status } = req.body;
    await pool.query(`
      INSERT INTO user_gateways (phone, method, account_no, status) 
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (phone, method) 
      DO UPDATE SET account_no = $3, status = $4
    `, [phone, method, account_no, status]);
    res.json({ success: true, message: 'গেটওয়ে তথ্য সংরক্ষিত হয়েছে!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Deposit Request
app.post('/api/deposit', async (req, res) => {
  try {
    const { phone, method, amount, trx_id } = req.body;
    await pool.query(
      'INSERT INTO transactions (phone, type, method, amount, trx_id) VALUES ($1, $2, $3, $4, $5)',
      [phone, 'Deposit', method, amount, trx_id]
    );
    res.json({ success: true, message: 'ডিপোজিট রিকোয়েস্ট সফলভাবে জমা হয়েছে!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Withdraw Request
app.post('/api/withdraw', async (req, res) => {
  try {
    const { phone, method, amount, account_no } = req.body;
    const user = await pool.query('SELECT balance FROM users WHERE phone = $1', [phone]);
    
    if(user.rows[0].balance < amount) {
      return res.status(400).json({ success: false, message: 'আপনার অ্যাকাউন্টে পর্যাপ্ত ব্যালেন্স নেই!' });
    }

    await pool.query('UPDATE users SET balance = balance - $1 WHERE phone = $2', [amount, phone]);
    await pool.query(
      'INSERT INTO transactions (phone, type, method, amount, trx_id) VALUES ($1, $2, $3, $4, $5)',
      [phone, 'Withdraw', method, amount, `To: ${account_no}`]
    );
    res.json({ success: true, message: 'উইথড্র রিকোয়েস্ট সফলভাবে পাঠানো হয়েছে!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin Pending Transactions
app.get('/api/admin/pending', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM transactions WHERE status = 'Pending' ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Approve Transaction
app.post('/api/admin/approve', async (req, res) => {
  try {
    const { txn_id, phone, amount, type } = req.body;
    await pool.query("UPDATE transactions SET status = 'Approved' WHERE id = $1", [txn_id]);
    
    if (type === 'Deposit') {
      await pool.query(
        "UPDATE users SET balance = balance + $1, total_deposit = total_deposit + $1 WHERE phone = $2",
        [amount, phone]
      );
    } else if (type === 'Withdraw') {
      await pool.query(
        "UPDATE users SET total_withdraw = total_withdraw + $1 WHERE phone = $2",
        [amount, phone]
      );
    }
    res.json({ success: true, message: 'সফলভাবে এপ্রুভ করা হয়েছে!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
