const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const dotenv = require('dotenv');
const db = require('./config/db');

dotenv.config();

const app = express();
const upload = multer({ dest: path.join(__dirname, 'uploads/') });
let pool;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'secret-change-me';

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ message: 'Unauthorized' });
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
}

function getOptionalUser(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.split(' ')[1];
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

function isOwnerOrBroker(user) {
  return user.role === 'owner' || user.role === 'broker';
}

function isAdmin(user) {
  return user.role === 'admin';
}

app.post('/api/register', async (req, res) => {
  try {
    const { name, email, phone, password, role, national_id } = req.body;
    if (!name || !email || !phone || !password || !role) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    const existing = await pool.query('SELECT id FROM users WHERE email = $1 OR phone = $2', [email, phone]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Email or phone already registered' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, phone, password, role, national_id, verified, broker_verified, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP) RETURNING id',
      [name, email, phone, hashed, role, national_id || null, role === 'broker' ? false : true, false]
    );
    const userId = result.rows[0].id;
    const token = jwt.sign({ id: userId, role }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, user: { id: userId, name, email, role, verified: role !== 'broker' } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Registration failed' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const rows = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (rows.rows.length === 0) return res.status(401).json({ message: 'Invalid credentials' });
    const user = rows.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, verified: user.verified, broker_verified: user.broker_verified } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Login failed' });
  }
});

app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const rows = await pool.query('SELECT id, name, email, phone, role, verified, broker_verified, national_id FROM users WHERE id = $1', [req.user.id]);
    if (rows.rows.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json({ user: rows.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to load profile' });
  }
});

app.get('/api/user/listings', authMiddleware, async (req, res) => {
  try {
    const rows = await pool.query('SELECT * FROM listings WHERE owner_id = $1 ORDER BY created_at DESC', [req.user.id]);
    res.json({ listings: rows.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to load your listings' });
  }
});

app.get('/api/user/favorites', authMiddleware, async (req, res) => {
  try {
    const rows = await pool.query('SELECT l.* FROM favorites f JOIN listings l ON f.listing_id = l.id WHERE f.user_id = $1 ORDER BY f.created_at DESC', [req.user.id]);
    res.json({ favorites: rows.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to load favorites' });
  }
});

app.post('/api/favorites', authMiddleware, async (req, res) => {
  try {
    const { listing_id } = req.body;
    if (!listing_id) return res.status(400).json({ message: 'Missing listing id' });
    await pool.query('INSERT INTO favorites (user_id, listing_id, created_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING', [req.user.id, listing_id]);
    res.json({ message: 'Listing added to favorites' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to add favorite' });
  }
});

app.delete('/api/favorites/:listingId', authMiddleware, async (req, res) => {
  try {
    const { listingId } = req.params;
    await pool.query('DELETE FROM favorites WHERE user_id = $1 AND listing_id = $2', [req.user.id, listingId]);
    res.json({ message: 'Favorite removed' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to remove favorite' });
  }
});

app.post('/api/reviews', authMiddleware, async (req, res) => {
  try {
    const { listing_id, rating, comment } = req.body;
    if (!listing_id || !rating) return res.status(400).json({ message: 'Missing review details' });
    await pool.query('INSERT INTO reviews (user_id, listing_id, rating, comment, created_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)', [req.user.id, listing_id, rating, comment || null]);
    res.json({ message: 'Review submitted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to submit review' });
  }
});

app.get('/api/admin/pending-brokers', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin only' });
  try {
    const rows = await pool.query('SELECT id, name, email, phone, national_id, broker_verified, created_at FROM users WHERE role = \'broker\' ORDER BY created_at DESC');
    res.json({ brokers: rows.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to load brokers' });
  }
});

app.get('/api/admin/reports', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin only' });
  try {
    const rows = await pool.query('SELECT r.*, l.title AS listing_title, u.name AS reporter_name FROM reports r JOIN listings l ON r.listing_id = l.id JOIN users u ON r.user_id = u.id ORDER BY r.created_at DESC');
    res.json({ reports: rows.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to load reports' });
  }
});

app.get('/api/listings', async (req, res) => {
  try {
    const user = getOptionalUser(req);
    const { city, area, minPrice, maxPrice, rooms, type } = req.query;
    let sql = 'SELECT * FROM listings WHERE available = true';
    const params = [];
    let paramIndex = 1;
    if (user && user.role === 'admin') {
      // Admin can view all available listings
    } else if (user) {
      sql += ` AND (status = 'approved' OR owner_id = $${paramIndex})`;
      params.push(user.id);
      paramIndex++;
    } else {
      sql += ` AND status = 'approved'`;
    }
    if (city) {
      sql += ` AND city ILIKE $${paramIndex}`;
      params.push(`%${city}%`);
      paramIndex++;
    }
    if (area) {
      sql += ` AND area ILIKE $${paramIndex}`;
      params.push(`%${area}%`);
      paramIndex++;
    }
    if (minPrice) {
      sql += ` AND price >= $${paramIndex}`;
      params.push(minPrice);
      paramIndex++;
    }
    if (maxPrice) {
      sql += ` AND price <= $${paramIndex}`;
      params.push(maxPrice);
      paramIndex++;
    }
    if (rooms) {
      sql += ` AND rooms = $${paramIndex}`;
      params.push(rooms);
      paramIndex++;
    }
    if (type) {
      sql += ` AND type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }
    sql += ' ORDER BY featured DESC, created_at DESC LIMIT 100';
    const listings = await pool.query(sql, params);
    res.json({ listings: listings.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to load listings' });
  }
});

app.post('/api/listings', authMiddleware, upload.array('photos', 6), async (req, res) => {
  try {
    if (!isOwnerOrBroker(req.user)) {
      return res.status(403).json({ message: 'Only owner and broker accounts can post listings' });
    }
    const { title, description, city, area, price, rooms, type } = req.body;
    const priceValue = Number(price);
    if (!title || !city || !area || !price || !rooms || !type) {
      return res.status(400).json({ message: 'Missing listing information' });
    }
    if (Number.isNaN(priceValue) || priceValue < 5000 || priceValue > 30000) {
      return res.status(400).json({ message: 'Price must be between 5000 and 30000 ETB' });
    }
    const photos = (req.files || []).map(file => file.filename).join(',');
    const result = await pool.query(
      'INSERT INTO listings (owner_id, title, description, city, area, price, rooms, type, photos, available, status, verified, featured, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, \'pending\', false, false, CURRENT_TIMESTAMP) RETURNING id',
      [req.user.id, title, description, city, area, priceValue, rooms, type, photos]
    );
    res.json({ message: 'Listing saved and awaiting admin approval', listingId: result.rows[0].id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to create listing' });
  }
});

app.patch('/api/listings/:id', authMiddleware, upload.array('photos', 6), async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await pool.query('SELECT * FROM listings WHERE id = $1', [id]);
    if (rows.rows.length === 0) return res.status(404).json({ message: 'Listing not found' });
    const listing = rows.rows[0];
    if (listing.owner_id !== req.user.id) return res.status(403).json({ message: 'Not allowed to update this listing' });

    const fields = [];
    const params = [];
    let paramIndex = 1;
    const allowed = ['title', 'description', 'city', 'area', 'price', 'rooms', 'type', 'available'];
    allowed.forEach(key => {
      if (req.body[key] !== undefined) {
        if (key === 'price') {
          const priceValue = Number(req.body.price);
          if (Number.isNaN(priceValue) || priceValue < 5000 || priceValue > 30000) {
            return res.status(400).json({ message: 'Price must be between 5000 and 30000 ETB' });
          }
          fields.push(`${key} = $${paramIndex}`);
          params.push(priceValue);
        } else if (key === 'available') {
          fields.push(`${key} = $${paramIndex}`);
          params.push(req.body[key] === true || req.body[key] === '1' || req.body[key] === 1);
        } else {
          fields.push(`${key} = $${paramIndex}`);
          params.push(req.body[key]);
        }
        paramIndex++;
      }
    });
    if (req.files && req.files.length > 0) {
      const photos = req.files.map(file => file.filename).join(',');
      fields.push(`photos = $${paramIndex}`);
      params.push(photos);
      paramIndex++;
    }
    if (!fields.length) {
      return res.status(400).json({ message: 'No changes provided' });
    }
    params.push(id);
    await pool.query(`UPDATE listings SET ${fields.join(', ')} WHERE id = $${paramIndex}`, params);
    res.json({ message: 'Listing updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to update listing' });
  }
});

app.delete('/api/listings/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await pool.query('SELECT * FROM listings WHERE id = $1', [id]);
    if (rows.rows.length === 0) return res.status(404).json({ message: 'Listing not found' });
    const listing = rows.rows[0];
    if (listing.owner_id !== req.user.id && !isAdmin(req.user)) return res.status(403).json({ message: 'Not allowed to delete this listing' });
    await pool.query('DELETE FROM listings WHERE id = $1', [id]);
    res.json({ message: 'Listing deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to delete listing' });
  }
});

app.post('/api/reports', authMiddleware, async (req, res) => {
  try {
    const { listing_id, message } = req.body;
    if (!listing_id || !message) return res.status(400).json({ message: 'Missing report details' });
    await pool.query('INSERT INTO reports (user_id, listing_id, message, status, created_at) VALUES ($1, $2, $3, \'pending\', CURRENT_TIMESTAMP)', [req.user.id, listing_id, message]);
    res.json({ message: 'Report submitted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to submit report' });
  }
});

app.get('/api/admin/pending-listings', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin only' });
  const rows = await pool.query('SELECT * FROM listings WHERE status = \'pending\' ORDER BY created_at DESC');
  res.json({ pending: rows.rows });
});

app.post('/api/admin/approve-listing', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin only' });
  const { listing_id, approve } = req.body;
  if (!listing_id) return res.status(400).json({ message: 'Missing listing id' });
  const status = approve ? 'approved' : 'rejected';
  await pool.query('UPDATE listings SET status = $1 WHERE id = $2', [status, listing_id]);
  res.json({ message: `Listing ${status}` });
});

app.post('/api/admin/verify-broker', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ message: 'Admin only' });
  const { broker_id, verify } = req.body;
  if (!broker_id) return res.status(400).json({ message: 'Missing broker id' });
  await pool.query('UPDATE users SET broker_verified = $1, verified = $2 WHERE id = $3 AND role = \'broker\'', [verify, verify, broker_id]);
  res.json({ message: `Broker verification updated` });
});

app.patch('/api/reports/:id', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ message: 'Admin only' });
  const { id } = req.params;
  const { status } = req.body;
  if (!['pending','reviewed','closed'].includes(status)) return res.status(400).json({ message: 'Invalid status' });
  await pool.query('UPDATE reports SET status = $1 WHERE id = $2', [status, id]);
  res.json({ message: 'Report status updated' });
});

app.get('/api/admin/statistics', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ message: 'Admin only' });
  const total_users = await pool.query('SELECT COUNT(*) AS total_users FROM users');
  const total_listings = await pool.query('SELECT COUNT(*) AS total_listings FROM listings');
  const pending_listings = await pool.query('SELECT COUNT(*) AS pending_listings FROM listings WHERE status = \'pending\'');
  const pending_reports = await pool.query('SELECT COUNT(*) AS pending_reports FROM reports WHERE status = \'pending\'');
  res.json({ 
    total_users: parseInt(total_users.rows[0].total_users),
    total_listings: parseInt(total_listings.rows[0].total_listings),
    pending_listings: parseInt(pending_listings.rows[0].pending_listings),
    pending_reports: parseInt(pending_reports.rows[0].pending_reports)
  });
});

app.get('/api/listings/:id', async (req, res) => {
  try {
    const rows = await pool.query(
      'SELECT l.*, u.name AS owner_name, u.email AS owner_email, u.phone AS owner_phone, u.role AS owner_role, u.broker_verified AS owner_broker_verified FROM listings l JOIN users u ON l.owner_id = u.id WHERE l.id = $1',
      [req.params.id]
    );
    if (rows.rows.length === 0) return res.status(404).json({ message: 'Listing not found' });
    const listing = rows.rows[0];
    const photos = listing.photos ? listing.photos.split(',').filter(Boolean) : [];
    listing.photoList = photos;
    res.json({ listing });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to load listing' });
  }
});

app.get('/api/listings/:id/reviews', async (req, res) => {
  try {
    const reviews = await pool.query(
      'SELECT r.id, r.rating, r.comment, r.created_at, u.name AS user_name FROM reviews r JOIN users u ON r.user_id = u.id WHERE r.listing_id = $1 ORDER BY r.created_at DESC',
      [req.params.id]
    );
    res.json({ reviews: reviews.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to load reviews' });
  }
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

async function startServer() {
  await db.initDatabase();
  pool = db.getPool();
  const port = process.env.PORT || 4000;
  app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
  });
}
app.get('/create-admin-once', async (req, res) => {
  try {
    const createAdmin = require('./scripts/create-admin');
    await createAdmin();
    res.send('Admin created successfully');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creating admin: ' + err.message);
  }
});

startServer().catch(error => {
  console.error('Unable to start server:', error);
  process.exit(1);
});
// test save check
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
