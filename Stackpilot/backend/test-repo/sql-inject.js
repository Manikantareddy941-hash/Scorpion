const express = require('express');
const app = express();

app.get('/user', (req, res) => {
  const id = req.query.id;
  // Deliberate SQL injection vulnerability
  const query = "SELECT * FROM users WHERE id = " + id;
  db.query(query);
});