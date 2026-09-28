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

// Live 2D ဒေတာနှင့် ဈေးကွက် အချက်အလက်များ တိုက်ရိုက်ချိတ်ဆက်ရန် API
app.get('/api/live', (req, res) => {
    // ဤနေရာတွင် တိုက်ရိုက် Live ဒေတာများကို ထည့်သွင်းနိုင်သည် (ဥပမာ- Settrade သို့မဟုတ် အခြား API များ)
    res.json({
        success: true,
        live: "58",           // အဓိက Live 2D ဂဏန်း
        result: "58",         // အရန် Result ဂဏန်း (undefined မဖြစ်စေရန်)
        setIndex: "1,250.00", // SET Index တန်ဖိုး
        value: "38,382.54",   // Value တန်ဖိုး
        time: new Date().toLocaleTimeString() // လက်ရှိအချိန်အလိုက် အလိုအလျောက်ပြောင်းရန်
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
