const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

// MongoDB သို့ ချိတ်ဆက်ခြင်း (Render ပေါ်တွင် ဒေတာ အမြဲသိမ်းရန်)
const MONGO_URI = 'mongodb+srv://amkbook9_db_user:IJVUDOG7XoE1R1GZ@cluster0.aqs0zyr.mongodb.net/my2dapp?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB successfully connected!'))
    .catch(err => console.error('MongoDB connection error:', err));

// MongoDB Schema & Model for Day Data (Admin results & History)
const dataSchema = new mongoose.Schema({
    dateStr: { type: String, required: true, unique: true }, 
    dateFormatted: String,
    t1201: { type: String, default: "--" },
    t430: { type: String, default: "--" },
    setIndex1201: { type: String, default: "--" },
    value1201: { type: String, default: "--" },
    setIndex430: { type: String, default: "--" },
    value430: { type: String, default: "--" },
    schedule: {
        type: Object,
        default: {
            "09:30 AM": { modern: "--", internet: "--", tw: "--", isLocked: false },
            "12:01 PM": { modern: "--", internet: "--", tw: "--", isLocked: false, isAuto: true },
            "02:00 PM": { modern: "--", internet: "--", tw: "--", isLocked: false },
            "04:30 PM": { modern: "--", internet: "--", tw: "--", isLocked: false, isAuto: true }
        }
    }
});

const DayData = mongoose.model('DayData', dataSchema);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

let chatMessages = [
    { user: "System", text: "2D Live Market App သို့ ကြိုဆိုပါသည်။" }
];

function getMyanmarTime() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * 6.5));
}

// ယနေ့အတွက် ဒေတာကို Database မှ ရယူရန် (သို့မဟုတ် အသစ်ဖန်တီးရန်) Helper Function
async function getTodayAdminResults() {
    const myanmarTime = getMyanmarTime();
    const todayDateStr = myanmarTime.toLocaleDateString('en-GB');

    let record = await DayData.findOne({ dateStr: todayDateStr });
    if (!record) {
        record = new DayData({
            dateStr: todayDateStr,
            dateFormatted: todayDateStr,
            schedule: {
                "09:30 AM": { modern: "--", internet: "--", tw: "--", isLocked: false },
                "12:01 PM": { modern: "--", internet: "--", tw: "--", isLocked: false, isAuto: true },
                "02:00 PM": { modern: "--", internet: "--", tw: "--", isLocked: false },
                "04:30 PM": { modern: "--", internet: "--", tw: "--", isLocked: false, isAuto: true }
            }
        });
        await record.save();
    }
    return record;
}

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === '2dpro153791') {
        res.json({ success: true, message: "Login successful" });
    } else {
        res.status(401).json({ success: false, message: "စကားဝှက် (Password) မှားယွင်းနေပါသည်။" });
    }
});

app.post('/api/admin/save', async (req, res) => {
    try {
        const { password, session, modern, internet, tw } = req.body;
        
        if (password !== '2dpro153791') {
            return res.status(401).json({ success: false, message: "ခွင့်ပြုချက်မရှိပါ (Unauthorized)" });
        }

        let todayRecord = await getTodayAdminResults();
        let adminResults = todayRecord.schedule;

        if (session && adminResults[session]) {
            if (adminResults[session].isLocked) {
                return res.status(400).json({ 
                    success: false, 
                    message: `${session} အတွက် ဂဏန်းများကို ယနေ့တွင် သိမ်းဆည်းပြီးဖြစ်၍ ထပ်မံပြင်ဆင်ခွင့်မရှိပါ (Locked ဖြစ်နေပါသည်)။` 
                });
            }

            if (modern !== undefined && modern !== "") adminResults[session].modern = modern;
            if (internet !== undefined && internet !== "") adminResults[session].internet = internet;
            if (tw !== undefined && tw !== "") adminResults[session].tw = tw;

            if (adminResults[session].modern !== "--" || adminResults[session].internet !== "--" || adminResults[session].tw !== "--") {
                adminResults[session].isLocked = true;
            }

            todayRecord.markModified('schedule');
            await todayRecord.save();

            return res.json({ 
                success: true, 
                message: `${session} ဇယားကွက် အချက်အလက်များ အောင်မြင်စွာ သိမ်းဆည်းပြီး Lock ချလိုက်ပါပြီ။`, 
                adminResults 
            });
        }

        res.status(400).json({ success: false, message: "မှားယွင်းနေသော Session ဖြစ်ပါသည်။" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server error occurred" });
    }
});

app.get('/api/admin/data', async (req, res) => {
    try {
        const todayRecord = await getTodayAdminResults();
        res.json({
            success: true,
            adminResults: todayRecord.schedule
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

app.get('/api/history', async (req, res) => {
    try {
        const historyRecords = await DayData.find().sort({ _id: -1 }).limit(100);
        res.json({
            success: true,
            history: historyRecords
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

app.get('/api/live', async (req, res) => {
    try {
        const url = 'https://www.set.or.th/en/home';
        const { data } = await axios.get(url, {
            timeout: 8000,
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
        
        const $ = cheerio.load(data);

        let setIndex = '';
        let marketValue = '';

        $('.mkt-info-value, .value, h3, span').each((i, el) => {
            const text = $(el).text().trim();
            if (text.includes('.') && text.length >= 6 && text.length <= 10 && !setIndex) {
                if (!isNaN(text.replace(/,/g, ''))) {
                    setIndex = text;
                }
            }
        });

        $('tr, div, li').each((i, el) => {
            const rowText = $(el).text().trim();
            
            if ((rowText.startsWith('SET') || rowText.includes('SET \n') || rowText.includes('SET\t')) && 
                !rowText.includes('SET50') && 
                !rowText.includes('SETTRI') && 
                !rowText.includes('SETCLMV') && 
                !rowText.includes('SETHD') &&
                !rowText.includes('SETESG')) {
                
                const items = $(el).find('td, span, div');
                items.each((j, subEl) => {
                    const t = $(subEl).text().trim();
                    if (t.includes(',') && t.length >= 7 && t.length <= 12) {
                        const clean = t.replace(/,/g, '');
                        const num = parseFloat(clean);
                        
                        if (!isNaN(num) && num >= 10000 && num < 200000 && !marketValue) {
                            marketValue = t;
                        }
                    }
                });
            }
        });

        let digit1 = "--";
        let digit2 = "--";
        let calculated2D = "--";

        if (setIndex.includes('.')) {
            const indexParts = setIndex.split('.');
            const indexDecimal = indexParts[1]; 
            digit1 = indexDecimal.slice(-1);    
        }

        if (marketValue.includes('.')) {
            const valueParts = marketValue.split('.');
            const valueInteger = valueParts[0].replace(/,/g, ''); 
            digit2 = valueInteger.slice(-1); 
        }

        if (digit1 !== "--" && digit2 !== "--") {
            calculated2D = digit1 + digit2;
        }

        const myanmarTime = getMyanmarTime();
        const currentTime = myanmarTime.toLocaleTimeString('en-US', {
            hour12: true,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        const currentHour = myanmarTime.getHours();
        const currentMinute = myanmarTime.getMinutes();
        const dateString = myanmarTime.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
        const dayOfWeekIndex = myanmarTime.getDay();
        const dayOfWeek = myanmarTime.toLocaleDateString('en-US', { weekday: 'long' });
        
        const daysMap = {
            "Sunday": "တနင်္ဂနွေ", "Monday": "တနင်္လာ", "Tuesday": "အင်္ဂါ",
            "Wednesday": "ဗုဒ္ဓဟူး", "Thursday": "ကြာသပတေး", "Friday": "သောကြာ", "Saturday": "စနေ"
        };
        const myanmarDay = daysMap[dayOfWeek] || dayOfWeek;
        const isWeekend = (dayOfWeekIndex === 0 || dayOfWeekIndex === 6);

        let todayRecord = await getTodayAdminResults();
        let adminResults = todayRecord.schedule;

        // 12:01 PM အလိုအလျောက် ဇယားကွက်ထဲသို့ ဖြည့်သွင်းခြင်း
        if ((currentHour === 12 && currentMinute >= 1) || currentHour > 12) {
            if (!isWeekend && calculated2D !== "--") {
                if (adminResults["12:01 PM"].modern === "--" && !adminResults["12:01 PM"].isLocked) {
                    adminResults["12:01 PM"].modern = calculated2D;
                    adminResults["12:01 PM"].internet = calculated2D;
                    adminResults["12:01 PM"].tw = calculated2D;
                    adminResults["12:01 PM"].isLocked = true;
                }
            }

            if (!isWeekend && setIndex !== "--" && marketValue !== "--") {
                todayRecord.t1201 = calculated2D;
                todayRecord.setIndex1201 = setIndex;
                todayRecord.value1201 = marketValue;
                todayRecord.dateFormatted = `${myanmarDay}\n${dateString}`;
            }
        }

        // 4:30 PM အလိုအလျောက် ဇယားကွက်ထဲသို့ ဖြည့်သွင်းခြင်း
        if ((currentHour > 16 || (currentHour === 16 && currentMinute >= 30))) {
            if (!isWeekend && calculated2D !== "--") {
                if (adminResults["04:30 PM"].modern === "--" && !adminResults["04:30 PM"].isLocked) {
                    adminResults["04:30 PM"].modern = calculated2D;
                    adminResults["04:30 PM"].internet = calculated2D;
                    adminResults["04:30 PM"].tw = calculated2D;
                    adminResults["04:30 PM"].isLocked = true;
                }
            }

            if (!isWeekend && setIndex !== "--" && marketValue !== "--") {
                todayRecord.t430 = calculated2D;
                todayRecord.setIndex430 = setIndex;
                todayRecord.value430 = marketValue;
                todayRecord.dateFormatted = `${myanmarDay}\n${dateString}`;
            }
        }

        todayRecord.markModified('schedule');
        await todayRecord.save();

        res.json({
            success: true,
            setIndex: setIndex || "--",
            value: marketValue || "--",
            live2D: calculated2D,
            adminResults: adminResults,
            schedule: {
                t0930: adminResults["09:30 AM"],
                t1201: adminResults["12:01 PM"],
                t1400: adminResults["02:00 PM"],
                t1630: adminResults["04:30 PM"]
            },
            notice: "2D Live အချက်အလက်များ ချိတ်ဆက်နေပါသည်။",
            time: currentTime
        });

    } catch (error) {
        const myanmarTime = getMyanmarTime();
        const currentTime = myanmarTime.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        let adminResults = {
            "09:30 AM": { modern: "--", internet: "--", tw: "--", isLocked: false },
            "12:01 PM": { modern: "--", internet: "--", tw: "--", isLocked: false, isAuto: true },
            "02:00 PM": { modern: "--", internet: "--", tw: "--", isLocked: false },
            "04:30 PM": { modern: "--", internet: "--", tw: "--", isLocked: false, isAuto: true }
        };

        res.json({
            success: true,
            setIndex: "--",
            value: "--",
            live2D: "--",
            adminResults: adminResults,
            schedule: {
                t0930: adminResults["09:30 AM"],
                t1201: adminResults["12:01 PM"],
                t1400: adminResults["02:00 PM"],
                t1630: adminResults["04:30 PM"]
            },
            notice: "ဈေးကွက်ပိတ်ထားသည် (သို့) ချိတ်ဆက်မှု စောင့်ဆိုင်းနေသည်...",
            time: currentTime
        });
    }
});

app.get('/api/chat', (req, res) => {
    res.json({
        success: true,
        messages: chatMessages
    });
});

app.post('/api/chat', (req, res) => {
    const { user, text } = req.body;
    if (text) {
        chatMessages.push({ user: user || "User", text: text });
        if (chatMessages.length > 50) {
            chatMessages.shift();
        }
    }
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});