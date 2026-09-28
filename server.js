const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// အချိန်နှင့်အမျှ အလိုအလျောက် ပြောင်းလဲမည့် Live API ပုံစံ
app.get('/api/live', (req, res) => {
    // ဥပမာအနေဖြင့် ဂဏန်းအပြောင်းအလဲကို စမ်းသပ်ရန်
    const randomLive = Math.floor(Math.random() * 90 + 10).toString();
    const currentTime = new Date().toLocaleTimeString();

    res.json({
        success: true,
        live2D: randomLive,
        setIndex: "1,250.55",
        value: "38,382.54",
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
