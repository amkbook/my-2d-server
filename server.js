const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// မြန်မာစံတော်ချိန် အတိအကျပြသရန် API
app.get('/api/live', (req, res) => {
    const randomLive = Math.floor(Math.random() * 90 + 10).toString();
    const randomSet = (1250 + Math.random() * 5).toFixed(2);
    const randomVal = (38382.00 + Math.random() * 2).toFixed(2);
    
    // UTC အချိန်ကို မြန်မာပြည်အချိန် (UTC +6:30) သို့ တိုက်ရိုက် တွက်ချက်ခြင်း
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const myanmarTime = new Date(utc + (3600000 * 6.5));
    
    const currentTime = myanmarTime.toLocaleTimeString('en-US', {
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
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// SET Live ဒေတာကို ထုတ်ပေးမယ့် API Endpoint
app.get('/api/set-live', async (req, res) => {
    try {
        // ထိုင်းစတော့ဈေးကွက် ဒေတာများကို ဤနေရာတွင် ရယူမည်
        const setIndex = "1,350.25"; // ဥပမာပြထားသော တန်ဖိုး
        const value = "၃၈,၃၈၂.၅၄";      // တန်ဖိုး (Value)

        res.json({
            success: true,
            setIndex: setIndex,
            value: value,
            updatedAt: new Date().toLocaleTimeString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Live ဒေတာ ဆွဲထုတ်၍ မရပါ",
            error: error.message
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
<<<<<<< HEAD
<<<<<<< HEAD
});
=======
});
>>>>>>> 9cce5d8dd9ae35bf88f8ddab0885f3fb30bf11e0
=======
});
>>>>>>> 9cce5d8dd9ae35bf88f8ddab0885f3fb30bf11e0
