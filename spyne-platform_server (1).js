// server.js
const express      = require('express');
const cookieParser = require('cookie-parser');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const path         = require('path');
const db           = require('./db/database');

const app    = express();
const PORT   = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'spyne_tracker_secret_change_in_prod';

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth middleware ───────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.cookies.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ── Seed default admin if no users exist ─────────────────────────────────────
async function seedAdmin() {
  const existing = db.get('SELECT id FROM users LIMIT 1');
  if (!existing) {
    const hash = await bcrypt.hash('spyne2024', 10);
    db.run(
      `INSERT INTO users (id, name, email, password, role, avatar_color) VALUES (?,?,?,?,?,?)`,
      [uuid(), 'Admin', 'admin@spyne.ai', hash, 'admin', '#D94F04']
    );
    console.log('🔑 Default admin seeded: admin@spyne.ai / spyne2024');
  }
}

// ── AUTH ROUTES ───────────────────────────────────────────────────────────────

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = db.get('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email]);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 86400 * 1000, sameSite: 'lax' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar_color: user.avatar_color } });
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// GET /api/auth/me
app.get('/api/auth/me', auth, (req, res) => {
  const user = db.get('SELECT id, name, email, role, avatar_color FROM users WHERE id = ?', [req.user.id]);
  res.json(user);
});

// ── USER ROUTES (admin only) ──────────────────────────────────────────────────

// GET /api/users
app.get('/api/users', auth, (req, res) => {
  const users = db.all('SELECT id, name, email, role, avatar_color, created_at FROM users ORDER BY name');
  res.json(users);
});

// POST /api/users  (admin creates new user)
app.post('/api/users', auth, adminOnly, async (req, res) => {
  const { name, email, password, role, avatar_color } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'name, email, password, role required' });
  if (!['admin','content','design'].includes(role)) return res.status(400).json({ error: 'role must be admin|content|design' });

  const existing = db.get('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [email]);
  if (existing) return res.status(409).json({ error: 'Email already in use' });

  const hash = await bcrypt.hash(password, 10);
  const id   = uuid();
  db.run(
    'INSERT INTO users (id, name, email, password, role, avatar_color) VALUES (?,?,?,?,?,?)',
    [id, name, email, hash, role, avatar_color || '#D94F04']
  );
  res.json({ ok: true, id });
});

// PUT /api/users/:id  (admin edits, or user edits own profile)
app.put('/api/users/:id', auth, async (req, res) => {
  const isOwn  = req.user.id === req.params.id;
  const isAdmin= req.user.role === 'admin';
  if (!isOwn && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

  const { name, avatar_color, password, role } = req.body;
  const user = db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const newName  = name         || user.name;
  const newColor = avatar_color || user.avatar_color;
  const newRole  = (isAdmin && role) ? role : user.role;
  const newPw    = password ? await bcrypt.hash(password, 10) : user.password;

  db.run('UPDATE users SET name=?, avatar_color=?, role=?, password=? WHERE id=?',
    [newName, newColor, newRole, newPw, req.params.id]);
  res.json({ ok: true });
});

// DELETE /api/users/:id
app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ── CONTENT ITEM ROUTES ───────────────────────────────────────────────────────

function enrichItems(items) {
  const users = db.all('SELECT id, name, avatar_color, role FROM users');
  const userMap = {};
  users.forEach(u => { userMap[u.id] = u; });
  return items.map(item => ({
    ...item,
    writer:   userMap[item.content_writer_id]  || null,
    designer: userMap[item.design_assignee_id] || null,
    creator:  userMap[item.created_by]         || null,
  }));
}

// GET /api/items
app.get('/api/items', auth, (req, res) => {
  let sql    = 'SELECT * FROM content_items WHERE 1=1';
  const params = [];

  // Design team only sees their assigned items
  if (req.user.role === 'design') {
    sql += ' AND design_assignee_id = ?';
    params.push(req.user.id);
  }

  sql += ' ORDER BY created_at DESC';
  const items = db.all(sql, params);
  res.json(enrichItems(items));
});

// POST /api/items
app.post('/api/items', auth, (req, res) => {
  if (!['admin','content'].includes(req.user.role))
    return res.status(403).json({ error: 'Only content team or admin can add items' });

  const {
    keywords, type, category, cluster, ams,
    content_status, content_writer_id, content_delivery_date, seo_assigned_date,
    design_status, design_assignee_id, design_assign_date, design_delivery_date,
    overall_status, approved, live_url, new_content_link, notes
  } = req.body;

  if (!keywords) return res.status(400).json({ error: 'keywords is required' });

  const id = uuid();
  db.run(`
    INSERT INTO content_items
      (id, keywords, type, category, cluster, ams,
       content_status, content_writer_id, content_delivery_date, seo_assigned_date,
       design_status, design_assignee_id, design_assign_date, design_delivery_date,
       overall_status, approved, live_url, new_content_link, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, keywords, type, category, cluster, ams,
     content_status || 'Not Started', content_writer_id || null, content_delivery_date || null, seo_assigned_date || null,
     design_status || 'Not Assigned', design_assignee_id || null, design_assign_date || null, design_delivery_date || null,
     overall_status || 'In Progress', approved || null, live_url || null, new_content_link || null, notes || null,
     req.user.id]
  );

  // Log activity
  db.run('INSERT INTO activity_log (id, item_id, user_id, action, details) VALUES (?,?,?,?,?)',
    [uuid(), id, req.user.id, 'created', `Created "${keywords}"`]);

  const item = db.get('SELECT * FROM content_items WHERE id = ?', [id]);
  res.json(enrichItems([item])[0]);
});

// PUT /api/items/:id
app.put('/api/items/:id', auth, (req, res) => {
  const item = db.get('SELECT * FROM content_items WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  // Design team can only update design fields
  let allowed = {};
  if (req.user.role === 'design') {
    const { design_status, design_delivery_date, notes } = req.body;
    allowed = { design_status, design_delivery_date, notes };
    // Auto-set overall_status when design marks done
    if (design_status === 'Design Done') allowed.overall_status = 'Content Done';
  } else {
    allowed = req.body;
  }

  const fields = [
    'keywords','type','category','cluster','ams',
    'content_status','content_writer_id','content_delivery_date','seo_assigned_date',
    'design_status','design_assignee_id','design_assign_date','design_delivery_date',
    'overall_status','approved','live_url','new_content_link','notes'
  ];

  const sets   = [];
  const params = [];
  fields.forEach(f => {
    if (allowed[f] !== undefined) { sets.push(`${f} = ?`); params.push(allowed[f]); }
  });
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

  sets.push('updated_at = datetime(\'now\')');
  params.push(req.params.id);
  db.run(`UPDATE content_items SET ${sets.join(', ')} WHERE id = ?`, params);

  db.run('INSERT INTO activity_log (id, item_id, user_id, action, details) VALUES (?,?,?,?,?)',
    [uuid(), req.params.id, req.user.id, 'updated', JSON.stringify(allowed)]);

  const updated = db.get('SELECT * FROM content_items WHERE id = ?', [req.params.id]);
  res.json(enrichItems([updated])[0]);
});

// DELETE /api/items/:id  (admin only)
app.delete('/api/items/:id', auth, adminOnly, (req, res) => {
  db.run('DELETE FROM content_items WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// GET /api/items/:id/activity
app.get('/api/items/:id/activity', auth, (req, res) => {
  const logs = db.all(
    `SELECT a.*, u.name as user_name, u.avatar_color
     FROM activity_log a
     LEFT JOIN users u ON a.user_id = u.id
     WHERE a.item_id = ?
     ORDER BY a.created_at DESC`,
    [req.params.id]
  );
  res.json(logs);
});

// ── STATS ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', auth, (req, res) => {
  const total      = db.get('SELECT COUNT(*) as n FROM content_items')?.n || 0;
  const published  = db.get("SELECT COUNT(*) as n FROM content_items WHERE overall_status='Published'")?.n || 0;
  const designWip  = db.get("SELECT COUNT(*) as n FROM content_items WHERE design_status='In Progress'")?.n || 0;
  const designDone = db.get("SELECT COUNT(*) as n FROM content_items WHERE design_status='Design Done'")?.n || 0;
  const inProgress = db.get("SELECT COUNT(*) as n FROM content_items WHERE overall_status='In Progress'")?.n || 0;

  const byType = db.all("SELECT type, COUNT(*) as count FROM content_items WHERE type IS NOT NULL GROUP BY type ORDER BY count DESC");
  const byWriter = db.all(`
    SELECT u.name, COUNT(*) as count
    FROM content_items ci
    JOIN users u ON ci.content_writer_id = u.id
    GROUP BY u.id ORDER BY count DESC LIMIT 8
  `);

  res.json({ total, published, designWip, designDone, inProgress, byType, byWriter });
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ── Serve SPA ─────────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Boot ──────────────────────────────────────────────────────────────────────
db.init().then(async () => {
  await seedAdmin();
  app.listen(PORT, () => console.log(`🚀 Spyne Tracker on http://localhost:${PORT}`));
});
