const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const { getPool, initializeDatabase } = require('./config/db');
const { authenticateToken, requireRole } = require('./middleware/auth');
const { calculateResultData } = require('./utils/resultCalculator');

const app = express();
const PORT = Number(process.env.PORT || 5000);
const JWT_SECRET = process.env.JWT_SECRET || 'student_result_system_secret';

const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:8080')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
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
  })
);
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

    const token = jwt.sign(
      { id: admin.id, email: admin.email, name: admin.full_name, role: 'ADMIN' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    return res.json({
      message: 'Login successful',
      token,
      admin: { id: admin.id, email: admin.email, name: admin.full_name, role: 'ADMIN' },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Something went wrong while logging in.' });
  }
});

app.get('/api/auth/me', authenticateToken, requireRole('ADMIN'), async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  try {
    const [rows] = await pool.query('SELECT id, email, full_name AS name FROM admins WHERE id = ? LIMIT 1', [req.user.id]);
    if (!rows.length) {
      return res.status(404).json({ message: 'Admin not found.' });
    }

    return res.json({ admin: { id: rows[0].id, email: rows[0].email, name: rows[0].name, role: 'ADMIN' } });
  } catch (error) {
    console.error('Fetch admin profile error:', error);
    return res.status(500).json({ message: 'Could not fetch admin profile.' });
  }
});

app.post('/api/auth/student/signup', async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  const {
    full_name,
    email,
    password,
    confirm_password,
    phone,
    roll_no,
    section,
    course,
    semester,
  } = req.body;

  if (!full_name || !email || !password || !confirm_password || !phone || !roll_no || !section || !course || !semester) {
    return res.status(400).json({ message: 'All student fields are required.' });
  }

  if (password !== confirm_password) {
    return res.status(400).json({ message: 'Passwords do not match.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
  }

  const safeEmail = String(email).trim().toLowerCase();
  const safeFullName = String(full_name).trim();
  const safePhone = String(phone).trim();
  const safeRoll = String(roll_no).trim();
  const safeSection = String(section).trim();
  const safeCourse = String(course).trim();
  const safeSemester = String(semester).trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) {
    return res.status(400).json({ message: 'Please enter a valid email address.' });
  }

  try {
    const [emailRows] = await pool.query('SELECT id FROM students WHERE email = ? LIMIT 1', [safeEmail]);
    if (emailRows.length > 0) {
      return res.status(409).json({ message: 'A student account with this email already exists.' });
    }

    const [rollRows] = await pool.query('SELECT id FROM students WHERE roll_no = ? LIMIT 1', [safeRoll]);
    if (rollRows.length > 0) {
      return res.status(409).json({ message: 'A student with this roll number already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      `INSERT INTO students (roll_no, name, email, password_hash, phone, section, course, semester, role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'STUDENT')`,
      [safeRoll, safeFullName, safeEmail, passwordHash, safePhone, safeSection, safeCourse, safeSemester]
    );

    return res.status(201).json({
      message: 'Student signup successful.',
      student: {
        id: result.insertId,
        name: safeFullName,
        email: safeEmail,
        roll_no: safeRoll,
        role: 'STUDENT',
      },
    });
  } catch (error) {
    console.error('Student signup error:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Duplicate email or roll number detected.' });
    }
    return res.status(500).json({ message: 'Could not create student account.' });
  }
});

app.post('/api/auth/student/login', async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT * FROM students WHERE email = ? LIMIT 1`,
      [String(email).trim().toLowerCase()]
    );

    if (!rows.length) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const student = rows[0];
    const isValidPassword = await bcrypt.compare(password, student.password_hash || '');
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: student.id, email: student.email, name: student.name, role: 'STUDENT' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    return res.json({
      message: 'Student login successful',
      token,
      student: {
        id: student.id,
        email: student.email,
        name: student.name,
        role: 'STUDENT',
      },
    });
  } catch (error) {
    console.error('Student login error:', error);
    return res.status(500).json({ message: 'Something went wrong while logging in.' });
  }
});

app.get('/api/auth/student/me', authenticateToken, requireRole('STUDENT'), async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  try {
    const [rows] = await pool.query(
      `SELECT id, roll_no, name, email, phone, section, course, semester, role
       FROM students
       WHERE id = ? LIMIT 1`,
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    return res.json({ student: rows[0] });
  } catch (error) {
    console.error('Fetch student profile error:', error);
    return res.status(500).json({ message: 'Could not fetch student profile.' });
  }
});

app.get('/api/dashboard/stats', authenticateToken, requireRole('ADMIN'), async (req, res) => {
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

app.get('/api/students', authenticateToken, requireRole('ADMIN'), async (req, res) => {
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

app.post('/api/students', authenticateToken, requireRole('ADMIN'), async (req, res) => {
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

app.put('/api/students/:id', authenticateToken, requireRole('ADMIN'), async (req, res) => {
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

app.delete('/api/students/:id', authenticateToken, requireRole('ADMIN'), async (req, res) => {
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

app.get('/api/subjects', authenticateToken, requireRole('ADMIN'), async (req, res) => {
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

app.post('/api/subjects', authenticateToken, requireRole('ADMIN'), async (req, res) => {
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

app.put('/api/subjects/:id', authenticateToken, requireRole('ADMIN'), async (req, res) => {
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

app.delete('/api/subjects/:id', authenticateToken, requireRole('ADMIN'), async (req, res) => {
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

app.get('/api/marks', authenticateToken, requireRole('ADMIN'), async (req, res) => {
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

app.post('/api/marks', authenticateToken, requireRole('ADMIN'), async (req, res) => {
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

app.put('/api/marks/:id', authenticateToken, requireRole('ADMIN'), async (req, res) => {
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

app.delete('/api/marks/:id', authenticateToken, requireRole('ADMIN'), async (req, res) => {
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

app.get('/api/results', authenticateToken, requireRole('ADMIN'), async (req, res) => {
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

app.get('/api/student/dashboard', authenticateToken, requireRole('STUDENT'), async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.name, s.roll_no, s.email, s.phone, s.section, s.course, s.semester,
              COUNT(m.id) AS total_subjects,
              COALESCE(SUM(m.marks_obtained), 0) AS total_marks,
              COALESCE(SUM(m.max_marks), 0) AS maximum_marks,
              COALESCE(r.percentage, 0) AS percentage,
              COALESCE(r.grade, 'F') AS grade,
              COALESCE(r.result_status, 'FAIL') AS result_status
       FROM students s
       LEFT JOIN marks m ON m.student_id = s.id
       LEFT JOIN results r ON r.student_id = s.id
       WHERE s.id = ?
       GROUP BY s.id, r.percentage, r.grade, r.result_status
       LIMIT 1`,
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Student profile not found.' });
    }

    const student = rows[0];
    return res.json({
      id: student.id,
      name: student.name,
      roll_no: student.roll_no,
      email: student.email,
      phone: student.phone,
      course: student.course,
      section: student.section,
      semester: student.semester,
      total_subjects: Number(student.total_subjects || 0),
      total_marks: Number(student.total_marks || 0),
      maximum_marks: Number(student.maximum_marks || 0),
      percentage: Number(student.percentage || 0),
      grade: student.grade || 'F',
      result_status: student.result_status || 'FAIL',
    });
  } catch (error) {
    console.error('Student dashboard error:', error);
    return res.status(500).json({ message: 'Could not fetch student dashboard data.' });
  }
});

app.get('/api/student/profile', authenticateToken, requireRole('STUDENT'), async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  try {
    const [rows] = await pool.query(
      `SELECT id, roll_no, name, email, phone, section, course, semester, role
       FROM students
       WHERE id = ? LIMIT 1`,
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    return res.json(rows[0]);
  } catch (error) {
    console.error('Student profile fetch error:', error);
    return res.status(500).json({ message: 'Could not fetch profile.' });
  }
});

app.put('/api/student/profile', authenticateToken, requireRole('STUDENT'), async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  const allowedFields = ['name', 'email', 'phone', 'section', 'course', 'semester'];
  const updates = {};

  for (const field of allowedFields) {
    if (req.body[field] !== undefined && req.body[field] !== null && String(req.body[field]).trim() !== '') {
      updates[field] = String(req.body[field]).trim();
    }
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ message: 'Please provide at least one editable profile field.' });
  }

  if (updates.email) {
    const normalizedEmail = updates.email.toLowerCase();
    const [duplicateEmail] = await pool.query('SELECT id FROM students WHERE email = ? AND id != ? LIMIT 1', [normalizedEmail, req.user.id]);
    if (duplicateEmail.length) {
      return res.status(409).json({ message: 'Another student already uses this email address.' });
    }
    updates.email = normalizedEmail;
  }

  try {
    const fields = Object.keys(updates);
    const values = fields.map((key) => updates[key]);
    const assignments = fields.map((key) => `${key} = ?`).join(', ');

    await pool.query(
      `UPDATE students SET ${assignments} WHERE id = ?`,
      [...values, req.user.id]
    );

    return res.json({ message: 'Profile updated successfully.' });
  } catch (error) {
    console.error('Update student profile error:', error);
    return res.status(500).json({ message: 'Could not update profile.' });
  }
});

app.get('/api/student/subjects', authenticateToken, requireRole('STUDENT'), async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT sb.id, sb.subject_code, sb.subject_name, sb.max_marks
       FROM marks m
       JOIN subjects sb ON sb.id = m.subject_id
       WHERE m.student_id = ?
       ORDER BY sb.subject_name ASC`,
      [req.user.id]
    );

    return res.json(rows);
  } catch (error) {
    console.error('Student subjects error:', error);
    return res.status(500).json({ message: 'Could not fetch subject list.' });
  }
});

app.get('/api/student/marks', authenticateToken, requireRole('STUDENT'), async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  try {
    const [rows] = await pool.query(
      `SELECT m.id, sb.subject_code, sb.subject_name, sb.max_marks, m.marks_obtained,
              ROUND((m.marks_obtained / m.max_marks) * 100, 2) AS percentage
       FROM marks m
       JOIN subjects sb ON sb.id = m.subject_id
       WHERE m.student_id = ?
       ORDER BY sb.subject_name ASC`,
      [req.user.id]
    );

    return res.json(rows);
  } catch (error) {
    console.error('Student marks error:', error);
    return res.status(500).json({ message: 'Could not fetch marks.' });
  }
});

app.get('/api/student/result', authenticateToken, requireRole('STUDENT'), async (req, res) => {
  const pool = getPool();
  if (!pool) return sendDatabaseUnavailable(res);

  try {
    const [studentRows] = await pool.query(
      `SELECT s.name, s.roll_no, s.course, s.semester
       FROM students s
       WHERE s.id = ? LIMIT 1`,
      [req.user.id]
    );

    if (!studentRows.length) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    const [resultRows] = await pool.query(
      `SELECT total_marks, max_marks, percentage, grade, result_status
       FROM results
       WHERE student_id = ? LIMIT 1`,
      [req.user.id]
    );

    const [markRows] = await pool.query(
      `SELECT sb.subject_name, sb.max_marks, m.marks_obtained,
              ROUND((m.marks_obtained / m.max_marks) * 100, 2) AS percentage
       FROM marks m
       JOIN subjects sb ON sb.id = m.subject_id
       WHERE m.student_id = ?
       ORDER BY sb.subject_name ASC`,
      [req.user.id]
    );

    return res.json({
      student: studentRows[0],
      result: resultRows[0] || {
        total_marks: 0,
        max_marks: 0,
        percentage: 0,
        grade: 'F',
        result_status: 'FAIL',
      },
      marks: markRows,
    });
  } catch (error) {
    console.error('Student result error:', error);
    return res.status(500).json({ message: 'Could not fetch result.' });
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
