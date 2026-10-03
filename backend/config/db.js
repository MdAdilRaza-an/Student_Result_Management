const mysql = require('mysql2/promise');
require('dotenv').config();

const dbName = process.env.DB_NAME || 'student_result_management';

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: dbName,

  // TiDB Cloud Public Endpoint requires TLS
  ...(process.env.DB_SSL === 'true'
    ? {
        ssl: {
          minVersion: 'TLSv1.2',
          rejectUnauthorized: true,
        },
      }
    : {}),

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

let pool = null;
let dbReady = false;

function getPool() {
  if (!pool && dbReady) {
    pool = mysql.createPool(dbConfig);
  }

  return pool;
}

async function initializeDatabase() {
  dbReady = false;

  try {
    // Initial connection for creating the database
    const initConnection = await mysql.createConnection({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,

      // TiDB Cloud TLS support
      ...(process.env.DB_SSL === 'true'
        ? {
            ssl: {
              minVersion: 'TLSv1.2',
              rejectUnauthorized: true,
            },
          }
        : {}),

      multipleStatements: true,
    });

    await initConnection.execute(
      `CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\``
    );

    await initConnection.end();

    // Connection using selected database
    const connection = await mysql.createConnection(dbConfig);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS admins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(150) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(150) NOT NULL DEFAULT 'Admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS students (
        id INT AUTO_INCREMENT PRIMARY KEY,
        roll_no VARCHAR(50) NOT NULL UNIQUE,
        name VARCHAR(150) NOT NULL,
        email VARCHAR(150) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        section VARCHAR(50) NOT NULL,
        course VARCHAR(100) NOT NULL,
        semester VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS subjects (
        id INT AUTO_INCREMENT PRIMARY KEY,
        subject_code VARCHAR(50) NOT NULL UNIQUE,
        subject_name VARCHAR(150) NOT NULL UNIQUE,
        max_marks DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS marks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL,
        subject_id INT NOT NULL,
        marks_obtained DECIMAL(10,2) NOT NULL,
        max_marks DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_student_subject (student_id, subject_id),
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
        FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
      )
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL UNIQUE,
        total_marks DECIMAL(10,2) NOT NULL DEFAULT 0,
        max_marks DECIMAL(10,2) NOT NULL DEFAULT 0,
        percentage DECIMAL(10,2) NOT NULL DEFAULT 0,
        grade VARCHAR(10) NOT NULL DEFAULT 'F',
        result_status ENUM('PASS', 'FAIL') NOT NULL DEFAULT 'FAIL',
        calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
      )
    `);

    // Default subjects
    const defaultSubjects = [
      ['JAVA101', 'Java', 100],
      ['HTML101', 'HTML', 100],
      ['CSS101', 'CSS', 100],
      ['JS101', 'JavaScript', 100],
      ['DB101', 'Database', 100],
    ];

    for (const [code, name, maxMarks] of defaultSubjects) {
      await connection.execute(
        `INSERT INTO subjects
          (subject_code, subject_name, max_marks)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE subject_code = subject_code`,
        [code, name, maxMarks]
      );
    }

    // Default admin
    const adminEmail =
      process.env.ADMIN_EMAIL || 'admin@studentresult.com';

    const adminPassword =
      process.env.ADMIN_PASSWORD || 'admin123';

    const passwordHash = require('bcryptjs').hashSync(
      adminPassword,
      10
    );

    // Create or update default admin
    await connection.execute(
      `INSERT INTO admins
        (email, password_hash, full_name)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         password_hash = ?,
         full_name = ?`,
      [
        adminEmail,
        passwordHash,
        'System Admin',
        passwordHash,
        'System Admin'
      ]
    );

    // Create connection pool
    pool = mysql.createPool(dbConfig);
    dbReady = true;

    await connection.end();

    return true;
  } catch (error) {
    pool = null;
    dbReady = false;

    console.error(
      'Database initialization failed:',
      error.message
    );

    return false;
  }
}

module.exports = {
  getPool,
  initializeDatabase,
  dbConfig,
};