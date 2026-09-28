const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// SET Index နဲ့ Value တွေပါ အချိန်နဲ့အမျှ အလိုအလျောက် ပြောင်းလဲမည့် API
app.get('/api/live', (req, res) => {
    const randomLive = Math.floor(Math.random() * 90 + 10).toString();
    
    // SET Index ကို အတက်အကျဖြစ်စေရန် ကျပန်းဖန်တီးခြင်း
    const randomSet = (1250 + Math.random() * 5).toFixed(2);
    // Value ကို အတက်အကျဖြစ်စေရန် ကျပန်းဖန်တီးခြင်း (တောင်းဆိုထားသော 38,382.54 အနီးစပ်ဆုံး)
    const randomVal = (38382.00 + Math.random() * 2).toFixed(2);
    
    const currentTime = new Date().toLocaleTimeString();

    res.json({
        success: true,
        live2D: randomLive,
        setIndex: randomSet,
        value: randomVal,
        time: currentTime,
        notice: "ဈေးကွက် ပုံမှန် အလုပ်လုပ်နေပါသည်။"
    });
});

app.get('/api/chat', (req, res) => {
    res.json({
        success: true,
        messages: [{ user: "System", text: "Welcome" }]
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
