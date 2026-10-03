const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const { getPool, initializeDatabase } = require('./config/db');
const { authenticateToken } = require('./middleware/auth');
const { calculateResultData } = require('./utils/resultCalculator');

const app = express();
const PORT = Number(process.env.PORT || 5000);
const JWT_SECRET = process.env.JWT_SECRET || 'student_result_system_secret';

const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:8080')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    const isLocalhost = /^http:\/\/localhost(:\d+)?$/.test(origin) || /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);
    if (isLocalhost) {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Student Result Management backend is running.' });
});

async function recalculateStudentResult(studentId) {
  const pool = getPool();
  if (!pool) return null;

  const [markRows] = await pool.query(
    `SELECT m.marks_obtained, m.max_marks
     FROM marks m
     WHERE m.student_id = ?`,
    [studentId]
  );

  const result = calculateResultData({ marks: markRows });

  const [existingResult] = await pool.query('SELECT id FROM results WHERE student_id = ?', [studentId]);

  if (existingResult.length > 0) {
    await pool.query(
      `UPDATE results
       SET total_marks = ?, max_marks = ?, percentage = ?, grade = ?, result_status = ?, calculated_at = NOW()
       WHERE student_id = ?`,
      [result.totalMarks, result.maxMarks, result.percentage, result.grade, result.resultStatus, studentId]
    );
  } else {
    await pool.query(
      `INSERT INTO results (student_id, total_marks, max_marks, percentage, grade, result_status, calculated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [studentId, result.totalMarks, result.maxMarks, result.percentage, result.grade, result.resultStatus]
    );
  }

  return result;
}

function sendDatabaseUnavailable(res) {
  return res.status(503).json({
    message: 'Database is unavailable. Please make sure MySQL is running and the backend environment variables are configured.',
  });
}

app.post('/api/auth/login', async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    const [rows] = await pool.query('SELECT * FROM admins WHERE email = ? LIMIT 1', [email]);
    if (!rows.length) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const admin = rows[0];
    const isValidPassword = await bcrypt.compare(password, admin.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const token = jwt.sign({ id: admin.id, email: admin.email, name: admin.full_name }, JWT_SECRET, { expiresIn: '8h' });

    return res.json({
      message: 'Login successful',
      token,
      admin: { id: admin.id, email: admin.email, name: admin.full_name },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Something went wrong while logging in.' });
  }
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  return res.json({ admin: req.user });
});

app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  try {
    const [totalStudentsRows] = await pool.query('SELECT COUNT(*) AS total_students FROM students');
    const [totalSubjectsRows] = await pool.query('SELECT COUNT(*) AS total_subjects FROM subjects');
    const [totalResultsRows] = await pool.query('SELECT COUNT(*) AS total_results FROM results');
    const [passedRows] = await pool.query("SELECT COUNT(*) AS passed_students FROM results WHERE result_status = 'PASS'");
    const [failedRows] = await pool.query("SELECT COUNT(*) AS failed_students FROM results WHERE result_status = 'FAIL'");
    const [averageRows] = await pool.query('SELECT COALESCE(ROUND(AVG(percentage), 2), 0) AS average_percentage FROM results');

    return res.json({
      totalStudents: totalStudentsRows[0].total_students,
      totalSubjects: totalSubjectsRows[0].total_subjects,
      totalResults: totalResultsRows[0].total_results,
      passedStudents: passedRows[0].passed_students,
      failedStudents: failedRows[0].failed_students,
      averagePercentage: Number(averageRows[0].average_percentage || 0),
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return res.status(500).json({ message: 'Could not fetch dashboard statistics.' });
  }
});

app.get('/api/students', authenticateToken, async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  try {
    const search = (req.query.search || '').trim();
    const section = (req.query.section || '').trim();
    const course = (req.query.course || '').trim();
    const semester = (req.query.semester || '').trim();

    let sql = 'SELECT * FROM students WHERE 1 = 1';
    const values = [];

    if (search) {
      sql += ' AND (roll_no LIKE ? OR name LIKE ? OR email LIKE ?)';
      const term = `%${search}%`;
      values.push(term, term, term);
    }

    if (section) {
      sql += ' AND section = ?';
      values.push(section);
    }

    if (course) {
      sql += ' AND course = ?';
      values.push(course);
    }

    if (semester) {
      sql += ' AND semester = ?';
      values.push(semester);
    }

    sql += ' ORDER BY id DESC';
    const [rows] = await pool.query(sql, values);
    return res.json(rows);
  } catch (error) {
    console.error('Fetch students error:', error);
    return res.status(500).json({ message: 'Could not fetch students.' });
  }
});

app.post('/api/students', authenticateToken, async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  const { roll_no, name, email, phone, section, course, semester } = req.body;
  if (!roll_no || !name || !email || !phone || !section || !course || !semester) {
    return res.status(400).json({ message: 'All student fields are required.' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO students (roll_no, name, email, phone, section, course, semester) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [roll_no, name, email, phone, section, course, semester]
    );

    return res.status(201).json({ message: 'Student added successfully.', studentId: result.insertId });
  } catch (error) {
    console.error('Create student error:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'A student with the same roll number already exists.' });
    }
    return res.status(500).json({ message: 'Could not add student.' });
  }
});

app.put('/api/students/:id', authenticateToken, async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  const { id } = req.params;
  const { roll_no, name, email, phone, section, course, semester } = req.body;
  if (!roll_no || !name || !email || !phone || !section || !course || !semester) {
    return res.status(400).json({ message: 'All student fields are required.' });
  }

  try {
    await pool.query(
      'UPDATE students SET roll_no = ?, name = ?, email = ?, phone = ?, section = ?, course = ?, semester = ? WHERE id = ?',
      [roll_no, name, email, phone, section, course, semester, id]
    );
    return res.json({ message: 'Student updated successfully.' });
  } catch (error) {
    console.error('Update student error:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'A student with the same roll number already exists.' });
    }
    return res.status(500).json({ message: 'Could not update student.' });
  }
});

app.delete('/api/students/:id', authenticateToken, async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  try {
    await pool.query('DELETE FROM marks WHERE student_id = ?', [req.params.id]);
    await pool.query('DELETE FROM results WHERE student_id = ?', [req.params.id]);
    await pool.query('DELETE FROM students WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Student deleted successfully.' });
  } catch (error) {
    console.error('Delete student error:', error);
    return res.status(500).json({ message: 'Could not delete student.' });
  }
});

app.get('/api/subjects', authenticateToken, async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  try {
    const [rows] = await pool.query('SELECT * FROM subjects ORDER BY id ASC');
    return res.json(rows);
  } catch (error) {
    console.error('Fetch subjects error:', error);
    return res.status(500).json({ message: 'Could not fetch subjects.' });
  }
});

app.post('/api/subjects', authenticateToken, async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  const { subject_code, subject_name, max_marks } = req.body;
  if (!subject_code || !subject_name || !max_marks) {
    return res.status(400).json({ message: 'Subject code, subject name and maximum marks are required.' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO subjects (subject_code, subject_name, max_marks) VALUES (?, ?, ?)',
      [subject_code, subject_name, max_marks]
    );
    return res.status(201).json({ message: 'Subject added successfully.', subjectId: result.insertId });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Subject code or name already exists.' });
    }
    return res.status(500).json({ message: 'Could not add subject.' });
  }
});

app.put('/api/subjects/:id', authenticateToken, async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  const { id } = req.params;
  const { subject_code, subject_name, max_marks } = req.body;
  if (!subject_code || !subject_name || !max_marks) {
    return res.status(400).json({ message: 'Subject code, subject name and maximum marks are required.' });
  }

  try {
    await pool.query(
      'UPDATE subjects SET subject_code = ?, subject_name = ?, max_marks = ? WHERE id = ?',
      [subject_code, subject_name, max_marks, id]
    );
    await pool.query('UPDATE marks SET max_marks = ? WHERE subject_id = ?', [max_marks, id]);
    const [students] = await pool.query('SELECT DISTINCT student_id FROM marks WHERE subject_id = ?', [id]);
    for (const item of students) {
      await recalculateStudentResult(item.student_id);
    }
    return res.json({ message: 'Subject updated successfully.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Subject code or name already exists.' });
    }
    return res.status(500).json({ message: 'Could not update subject.' });
  }
});

app.delete('/api/subjects/:id', authenticateToken, async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  try {
    const [students] = await pool.query('SELECT DISTINCT student_id FROM marks WHERE subject_id = ?', [req.params.id]);
    await pool.query('DELETE FROM marks WHERE subject_id = ?', [req.params.id]);
    await pool.query('DELETE FROM subjects WHERE id = ?', [req.params.id]);

    for (const item of students) {
      await recalculateStudentResult(item.student_id);
    }

    return res.json({ message: 'Subject deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ message: 'Could not delete subject.' });
  }
});

app.get('/api/marks', authenticateToken, async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  try {
    const [rows] = await pool.query(`
      SELECT m.id, m.student_id, s.roll_no, st.name AS student_name, m.subject_id, sb.subject_name,
             m.marks_obtained, m.max_marks,
             ROUND((m.marks_obtained / m.max_marks) * 100, 2) AS percentage
      FROM marks m
      JOIN students s ON s.id = m.student_id
      JOIN subjects sb ON sb.id = m.subject_id
      JOIN students st ON st.id = m.student_id
      ORDER BY m.id DESC
    `);
    return res.json(rows);
  } catch (error) {
    console.error('Fetch marks error:', error);
    return res.status(500).json({ message: 'Could not fetch marks.' });
  }
});

app.post('/api/marks', authenticateToken, async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  const { student_id, subject_id, marks_obtained } = req.body;
  if (!student_id || !subject_id || marks_obtained === undefined || marks_obtained === null) {
    return res.status(400).json({ message: 'Student, subject and marks are required.' });
  }

  if (Number(marks_obtained) < 0) {
    return res.status(400).json({ message: 'Marks cannot be negative.' });
  }

  try {
    const [subjectRows] = await pool.query('SELECT max_marks FROM subjects WHERE id = ?', [subject_id]);
    if (!subjectRows.length) {
      return res.status(404).json({ message: 'Selected subject does not exist.' });
    }

    const maxMarks = Number(subjectRows[0].max_marks);
    if (Number(marks_obtained) > maxMarks) {
      return res.status(400).json({ message: `Marks cannot be greater than ${maxMarks}.` });
    }

    const [studentRows] = await pool.query('SELECT id FROM students WHERE id = ?', [student_id]);
    if (!studentRows.length) {
      return res.status(404).json({ message: 'Selected student does not exist.' });
    }

    const [existingRows] = await pool.query(
      'SELECT id FROM marks WHERE student_id = ? AND subject_id = ?',
      [student_id, subject_id]
    );
    if (existingRows.length > 0) {
      return res.status(409).json({ message: 'Marks for this student and subject already exist.' });
    }

    await pool.query(
      'INSERT INTO marks (student_id, subject_id, marks_obtained, max_marks) VALUES (?, ?, ?, ?)',
      [student_id, subject_id, marks_obtained, maxMarks]
    );
    await recalculateStudentResult(student_id);
    return res.status(201).json({ message: 'Marks added successfully.' });
  } catch (error) {
    console.error('Create marks error:', error);
    return res.status(500).json({ message: 'Could not add marks.' });
  }
});

app.put('/api/marks/:id', authenticateToken, async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  const { marks_obtained } = req.body;
  if (marks_obtained === undefined || marks_obtained === null) {
    return res.status(400).json({ message: 'Marks are required.' });
  }

  if (Number(marks_obtained) < 0) {
    return res.status(400).json({ message: 'Marks cannot be negative.' });
  }

  try {
    const [markRows] = await pool.query('SELECT * FROM marks WHERE id = ?', [req.params.id]);
    if (!markRows.length) {
      return res.status(404).json({ message: 'Marks record not found.' });
    }

    const subjectMax = Number(markRows[0].max_marks);
    if (Number(marks_obtained) > subjectMax) {
      return res.status(400).json({ message: `Marks cannot be greater than ${subjectMax}.` });
    }

    await pool.query('UPDATE marks SET marks_obtained = ? WHERE id = ?', [marks_obtained, req.params.id]);
    await recalculateStudentResult(markRows[0].student_id);
    return res.json({ message: 'Marks updated successfully.' });
  } catch (error) {
    console.error('Update marks error:', error);
    return res.status(500).json({ message: 'Could not update marks.' });
  }
});

app.delete('/api/marks/:id', authenticateToken, async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  try {
    const [markRows] = await pool.query('SELECT student_id FROM marks WHERE id = ?', [req.params.id]);
    if (!markRows.length) {
      return res.status(404).json({ message: 'Marks record not found.' });
    }

    await pool.query('DELETE FROM marks WHERE id = ?', [req.params.id]);
    await recalculateStudentResult(markRows[0].student_id);
    return res.json({ message: 'Marks deleted successfully.' });
  } catch (error) {
    console.error('Delete marks error:', error);
    return res.status(500).json({ message: 'Could not delete marks.' });
  }
});

app.get('/api/results', authenticateToken, async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  const search = (req.query.search || '').trim();

  try {
    const values = [];
    let studentSql = 'SELECT * FROM students WHERE 1 = 1';

    if (search) {
      studentSql += ' AND (roll_no LIKE ? OR name LIKE ?)';
      values.push(`%${search}%`, `%${search}%`);
    }

    studentSql += ' ORDER BY id DESC';
    const [students] = await pool.query(studentSql, values);
    const response = [];

    for (const student of students) {
      const [marksData] = await pool.query(
        `SELECT s.subject_name, m.marks_obtained, m.max_marks,
                ROUND((m.marks_obtained / m.max_marks) * 100, 2) AS percentage
         FROM marks m
         JOIN subjects s ON s.id = m.subject_id
         WHERE m.student_id = ?
         ORDER BY s.subject_name ASC`,
        [student.id]
      );

      const [resultRows] = await pool.query('SELECT * FROM results WHERE student_id = ? LIMIT 1', [student.id]);
      response.push({ student, marks: marksData, result: resultRows[0] || null });
    }

    return res.json(response);
  } catch (error) {
    console.error('Result search error:', error);
    return res.status(500).json({ message: 'Could not load results.' });
  }
});

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found.' });
});

async function startServer() {
  const ready = await initializeDatabase();
  if (!ready) {
    console.log('MySQL is not configured yet. The backend will keep running and return 503 until the database connection is valid.');
  } else {
    console.log('MySQL database initialized successfully.');
  }

  app.listen(PORT, () => {
    console.log(`Backend API running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
