# Student Result Management System

A professional Full Stack Student Result Management System built with Node.js, Express.js, MySQL, HTML, CSS, and JavaScript.

## Features

- Admin login with JWT authentication
- Dashboard with real statistics
- Student management with add, edit, delete, search, and filter
- Subject management with default subjects
- Marks entry with validation
- Result calculation and grade logic
- Search by roll number or student name
- Professional responsive UI

## Tech Stack

- Backend: Node.js + Express.js
- Database: MySQL
- Frontend: HTML5, CSS3, Vanilla JavaScript
- Security: JWT + bcryptjs

## Project Structure

- `backend/` – Express.js API, database config, JWT auth, result logic, SQL schema
- `frontend/` – HTML, CSS, and JavaScript client pages
- `package.json` – root scripts for starting backend and frontend separately

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the backend environment file and update it with your local MySQL settings:

   ```bash
   cp backend/.env.example backend/.env
   ```

3. Start the backend:

   ```bash
   npm run backend
   ```

4. Start the frontend separately:

   ```bash
   npx http-server frontend -p 8080
   ```

5. Open: http://localhost:8080

## Default Admin Login

- Email: admin@studentresult.com
- Password: admin123

## Render Deployment

This project includes a `render.yaml` file for quick deployment on Render.

### Render settings

- Build Command: `npm install`
- Start Command: `npm start`

After deployment, set environment variables in Render using values from `backend/.env.example`.

## Notes

- On first run, the app creates the required database and tables automatically.
- The app seeds default subjects automatically.
- Results are calculated on the backend to prevent manipulation from the frontend.
