const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// မြန်မာစံတော်ချိန် (Myanmar Time) အမှန်အတိုင်း ပြသရန် API
app.get('/api/live', (req, res) => {
    const randomLive = Math.floor(Math.random() * 90 + 10).toString();
    const randomSet = (1250 + Math.random() * 5).toFixed(2);
    const randomVal = (38382.00 + Math.random() * 2).toFixed(2);
    
    // မြန်မာစံတော်ချိန် (Asia/Yangon) အတူ အချိန်ဆွဲထုတ်ခြင်း
    const currentTime = new Date().toLocaleTimeString('en-US', {
        timeZone: 'Asia/Yangon',
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

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
