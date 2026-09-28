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

// Live 2D ဒေတာအတွက် API (index.html နှင့် ကိုက်ညီသော live2D key ဖြင့် ပြင်ဆင်ထားသည်)
app.get('/api/live', (req, res) => {
    res.json({
        success: true,
        live2D: "58",         // index.html မှ တောင်းဆိုနေသော နာမည်နှင့် တိုက်ဆိုင်စေရန်
        live: "58",           
        result: "58",         
        setIndex: "1,250.00", 
        value: "38,382.54",   
        time: "12:00 PM",
        notice: "2D Live မှ ကြိုဆိုပါသည်။"
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
