const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;

// Serve static files from the current directory
app.use(express.static(__dirname));

// Send index.html when user visits '/'
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Live 2D ဒေတာအတွက် API
app.get('/api/live', (req, res) => {
    res.json({
        success: true,
        live: "--",
        set: "----.--",
        value: "38,382.54",
        times: { t9: "--", t12: "--", t2: "--", t4: "--" }
    });
});

// Chat အတွက် API
app.get('/api/chat', (req, res) => {
    res.json({
        success: true,
        messages: [{ user: "System", text: "Welcome" }]
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
