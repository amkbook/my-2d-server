const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json({ limit: '16kb' }));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('MONGO_URI environment variable is missing.');
} else {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('MongoDB successfully connected!'))
        .catch(err => console.error('MongoDB connection error:', err.message));
}

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

const goldSchema = new mongoose.Schema({
    dateStr: { type: String, required: true, unique: true },
    dateFormatted: String,
    globalGold: { type: String, default: "--" },
    globalGoldHistory: { type: Object, default: { "09:00 AM": "--", "12:00 PM": "--", "04:00 PM": "--" } },
    sessions: {
        type: Object,
        default: {
            "09:00 AM": { p15: { price: "--", change: "--" }, akhot: { price: "--", change: "--" }, isLocked: false },
            "12:00 PM": { p15: { price: "--", change: "--" }, akhot: { price: "--", change: "--" }, isLocked: false },
            "04:00 PM": { p15: { price: "--", change: "--" }, akhot: { price: "--", change: "--" }, isLocked: false }
        }
    },
    createdAt: { type: Date, default: Date.now }
});

const GoldData = mongoose.model('GoldData', goldSchema);

const chatMessageSchema = new mongoose.Schema({
    guestId: { type: String, required: true, maxlength: 80 },
    user: { type: String, default: 'Guest', maxlength: 30 },
    text: { type: String, required: true, maxlength: 500 },
    createdAt: { type: Date, default: Date.now }
});

chatMessageSchema.index({ createdAt: -1 });
const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

function getMyanmarTime() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * 6.5));
}

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

async function getTodayGoldRecord() {
    const myanmarTime = getMyanmarTime();
    const todayDateStr = myanmarTime.toLocaleDateString('en-GB');

    let record = await GoldData.findOne({ dateStr: todayDateStr });

    if (!record) {
        record = new GoldData({
            dateStr: todayDateStr,
            dateFormatted: todayDateStr,
            globalGold: "--",
            globalGoldHistory: { "09:00 AM": "--", "12:00 PM": "--", "04:00 PM": "--" },
            sessions: {
                "09:00 AM": { p15: { price: "--", change: "--" }, akhot: { price: "--", change: "--" }, isLocked: false },
                "12:00 PM": { p15: { price: "--", change: "--" }, akhot: { price: "--", change: "--" }, isLocked: false },
                "04:00 PM": { p15: { price: "--", change: "--" }, akhot: { price: "--", change: "--" }, isLocked: false }
            }
        });
        await record.save();

        const count = await GoldData.countDocuments();
        if (count > 120) {
            const excess = count - 120;
            const oldestRecords = await GoldData.find().sort({ _id: 1 }).limit(excess).select('_id').lean();
            if (oldestRecords.length > 0) {
                await GoldData.deleteMany({ _id: { $in: oldestRecords.map(r => r._id) } });
            }
        }
    }

    return record;
}

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;

    if (process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD) {
        res.json({ success: true, message: "Login successful" });
    } else {
        res.status(401).json({
            success: false,
            message: "စကားဝှက် (Password) မှားယွင်းနေပါသည်။"
        });
    }
});

app.post('/api/admin/save', async (req, res) => {
    try {
        const { password, session, modern, internet, tw } = req.body;

        if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
            return res.status(401).json({
                success: false,
                message: "ခွင့်ပြုချက်မရှိပါ (Unauthorized)"
            });
        }

        let todayRecord = await getTodayAdminResults();
        let adminResults = todayRecord.schedule;

        if (session && adminResults[session]) {
            if (adminResults[session].isLocked) {
                return res.status(400).json({
                    success: false,
                    message: `${session} အတွက် ဂဏန်းများကို ယနေ့တွင် သိမ်းဆည်းပြီးဖြစ်၍ ထပ်မံပြင်ဆင်ခွင့်မရှိပါ (Locked ဖြစ်နေပါသည်။)`
                });
            }

            if (modern !== undefined && modern !== "") {
                adminResults[session].modern = modern;
            }

            if (internet !== undefined && internet !== "") {
                adminResults[session].internet = internet;
            }

            if (tw !== undefined && tw !== "") {
                adminResults[session].tw = tw;
            }

            if (
                adminResults[session].modern !== "--" ||
                adminResults[session].internet !== "--" ||
                adminResults[session].tw !== "--"
            ) {
                adminResults[session].isLocked = true;
            }

            todayRecord.schedule = adminResults;
            todayRecord.markModified('schedule');
            await todayRecord.save();

            return res.json({
                success: true,
                message: `${session} ဇယားကွက် အချက်အလက်များ အောင်မြင်စွာ သိမ်းဆည်းပြီး Lock ချလိုက်ပါပြီ။`,
                adminResults
            });
        }

        res.status(400).json({
            success: false,
            message: "မှားယွင်းနေသော Session ဖြစ်ပါသည်။"
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            message: "Server error occurred"
        });
    }
});

app.get('/api/admin/gold', async (req, res) => {
    try {
        const goldRecord = await getTodayGoldRecord();
        res.json({
            success: true,
            globalGold: goldRecord.globalGold,
            globalGoldHistory: goldRecord.globalGoldHistory,
            sessions: goldRecord.sessions
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

app.post('/api/admin/gold/save', async (req, res) => {
    try {
        const { password, type, session, globalGoldPrice, p15Price, p15Change, akhotPrice, akhotChange } = req.body;

        if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
            return res.status(401).json({ success: false, message: "ခွင့်ပြုချက်မရှိပါ (Unauthorized)" });
        }

        let goldRecord = await getTodayGoldRecord();

        if (type === 'global') {
            if (globalGoldPrice !== undefined) {
                goldRecord.globalGold = globalGoldPrice;
                const myanmarTime = getMyanmarTime();
                const hr = myanmarTime.getHours();
                let slotKey = "09:00 AM";
                if (hr >= 12 && hr < 16) slotKey = "12:00 PM";
                else if (hr >= 16) slotKey = "04:00 PM";
                
                goldRecord.globalGoldHistory[slotKey] = globalGoldPrice;
                goldRecord.markModified('globalGoldHistory');
            }
        } else if (type === 'session') {
            if (session && goldRecord.sessions[session]) {
                if (p15Price !== undefined) goldRecord.sessions[session].p15.price = p15Price;
                if (p15Change !== undefined) goldRecord.sessions[session].p15.change = p15Change;
                if (akhotPrice !== undefined) goldRecord.sessions[session].akhot.price = akhotPrice;
                if (akhotChange !== undefined) goldRecord.sessions[session].akhot.change = akhotChange;

                if (
                    goldRecord.sessions[session].p15.price !== "--" ||
                    goldRecord.sessions[session].akhot.price !== "--"
                ) {
                    goldRecord.sessions[session].isLocked = true;
                }

                goldRecord.markModified('sessions');
            } else {
                return res.status(400).json({ success: false, message: "မှားယွင်းနေသော ရွှေစျေး Session ဖြစ်ပါသည်။" });
            }
        }

        await goldRecord.save();
        res.json({
            success: true,
            message: "ရွှေစျေး အချက်အလက်များ အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။",
            globalGold: goldRecord.globalGold,
            sessions: goldRecord.sessions
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server error occurred" });
    }
});

app.get('/api/gold/history', async (req, res) => {
    try {
        const records = await GoldData.find().sort({ _id: -1 }).limit(120).lean();
        res.json({
            success: true,
            history: records
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
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
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

app.get('/api/history', async (req, res) => {
    try {
        const historyRecords = await DayData.find()
            .sort({ _id: -1 })
            .limit(100);

        res.json({
            success: true,
            history: historyRecords
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

let cachedLiveData = null;
let lastFetchTime = 0;
const CACHE_DURATION = 1000; // Cache သက်တမ်းကို 1 စက္ကန့်သို့ ပြောင်းထားသည်
let fetchPromise = null;

async function fetchLiveMarketData(isTargetCapture = false) {
    if (fetchPromise) return fetchPromise;

    fetchPromise = (async () => {
        let setIndex = '';
        let marketValue = '';
        let calculated2D = '--';

        try {
            const myanmarTime = getMyanmarTime();
            const currentHour = myanmarTime.getHours();
            const currentMinute = myanmarTime.getMinutes();
            const dayOfWeekIndex = myanmarTime.getDay();
            const isWeekend = (dayOfWeekIndex === 0 || dayOfWeekIndex === 6);

            let todayRecord = await getTodayAdminResults();
            let adminResults = todayRecord.schedule;

            const totalMinutes = currentHour * 60 + currentMinute;
            const middayStart = 12 * 60 + 1;  // 12:01 PM (မိနစ် ၇၂၁)
            const afternoonStart = 14 * 60;   // 02:00 PM (မိနစ် ၈၄၀)

            // နေ့လည် ၁၂:၀၁ မှ ညနေ ၂:၀၀ တိတိအထိသာ Lock ချမည် (၂:၀၀ နာရီရောက်လျှင် ချက်ချင်းဖွင့်ပေးမည်)
            if (!isTargetCapture && !isWeekend && totalMinutes >= middayStart && totalMinutes < afternoonStart) {
                let locked2D = (todayRecord.t1201 && todayRecord.t1201 !== "--") ? todayRecord.t1201 : (adminResults["12:01 PM"]?.modern !== "--" ? adminResults["12:01 PM"].modern : "--");
                let lockedSetIndex = todayRecord.setIndex1201 || "--";
                let lockedValue = todayRecord.value1201 || "--";
                
                const currentTime = myanmarTime.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });

                cachedLiveData = {
                    success: true,
                    setIndex: lockedSetIndex,
                    value: lockedValue,
                    live2D: locked2D,
                    adminResults: adminResults,
                    schedule: {
                        t0930: adminResults["09:30 AM"],
                        t1201: adminResults["12:01 PM"],
                        t1400: adminResults["02:00 PM"],
                        t1630: adminResults["04:30 PM"]
                    },
                    notice: "2D Live အချက်အလက်များ ချိတ်ဆက်နေပါသည်။",
                    time: currentTime
                };
                lastFetchTime = Date.now();
                return cachedLiveData;
            }

            const url = 'https://www.set.or.th/en/home';

            const { data } = await axios.get(url, {
                timeout: 8000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            });

            const $ = cheerio.load(data);

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

                if (
                    (rowText.startsWith('SET') ||
                     rowText.includes('SET \n') ||
                     rowText.includes('SET\t')) &&
                    !rowText.includes('SET50') &&
                    !rowText.includes('SETTRI') &&
                    !rowText.includes('SETCLMV') &&
                    !rowText.includes('SETHD') &&
                    !rowText.includes('SETESG')
                ) {
                    const items = $(el).find('td, span, div');

                    items.each((j, subEl) => {
                        const t = $(subEl).text().trim();

                        if (t.includes(',') && t.length >= 7 && t.length <= 12) {
                            const clean = t.replace(/,/g, '');
                            const num = parseFloat(clean);

                            if (
                                !isNaN(num) &&
                                num >= 10000 &&
                                num < 200000 &&
                                !marketValue
                            ) {
                                marketValue = t;
                            }
                        }
                    });
                }
            });

            let digit1 = "--";
            let digit2 = "--";

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

            const currentTime = myanmarTime.toLocaleTimeString('en-US', {
                hour12: true,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            const dateString = myanmarTime.toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });

            const dayOfWeek = myanmarTime.toLocaleDateString('en-US', {
                weekday: 'long'
            });

            const daysMap = {
                "Sunday": "တနင်္ဂနွေ",
                "Monday": "တနင်္လာ",
                "Tuesday": "အင်္ဂါ",
                "Wednesday": "ဗုဒ္ဓဟူး",
                "Thursday": "ကြာသပတေး",
                "Friday": "သောကြာ",
                "Saturday": "စနေ"
            };

            const myanmarDay = daysMap[dayOfWeek] || dayOfWeek;

            if (isTargetCapture) {
                if (currentHour === 12 && currentMinute === 1) {
                    if (!isWeekend && calculated2D !== "--") {
                        if (!adminResults["12:01 PM"].isLocked) {
                            adminResults["12:01 PM"].modern = calculated2D;
                            adminResults["12:01 PM"].internet = calculated2D;
                            adminResults["12:01 PM"].tw = calculated2D;
                            adminResults["12:01 PM"].isLocked = true;
                        }
                    }
                    if (!isWeekend && setIndex !== "--" && marketValue !== "--") {
                        if (!todayRecord.t1201 || todayRecord.t1201 === "--") {
                            todayRecord.t1201 = calculated2D;
                            todayRecord.setIndex1201 = setIndex;
                            todayRecord.value1201 = marketValue;
                            todayRecord.dateFormatted = `${myanmarDay}\n${dateString}`;
                        }
                    }
                }

                if (currentHour === 16 && currentMinute === 30) {
                    if (!isWeekend && calculated2D !== "--") {
                        if (!adminResults["04:30 PM"].isLocked) {
                            adminResults["04:30 PM"].modern = calculated2D;
                            adminResults["04:30 PM"].internet = calculated2D;
                            adminResults["04:30 PM"].tw = calculated2D;
                            adminResults["04:30 PM"].isLocked = true;
                        }
                    }
                    if (!isWeekend && setIndex !== "--" && marketValue !== "--") {
                        if (!todayRecord.t430 || todayRecord.t430 === "--") {
                            todayRecord.t430 = calculated2D;
                            todayRecord.setIndex430 = setIndex;
                            todayRecord.value430 = marketValue;
                            todayRecord.dateFormatted = `${myanmarDay}\n${dateString}`;
                        }
                    }
                }

                todayRecord.schedule = adminResults;
                todayRecord.markModified('schedule');
                await todayRecord.save();
            }

            let displayLive2D = calculated2D;
            let displaySetIndex = setIndex;
            let displayValue = marketValue;

            if (totalMinutes >= middayStart && totalMinutes < afternoonStart) {
                if (todayRecord.t1201 && todayRecord.t1201 !== "--") {
                    displayLive2D = todayRecord.t1201;
                    displaySetIndex = todayRecord.setIndex1201 || setIndex;
                    displayValue = todayRecord.value1201 || marketValue;
                } else if (adminResults["12:01 PM"]?.modern !== "--") {
                    displayLive2D = adminResults["12:01 PM"].modern;
                }
            } else if ((currentHour === 16 && currentMinute >= 30) || currentHour > 16) {
                if (todayRecord.t430 && todayRecord.t430 !== "--") {
                    displayLive2D = todayRecord.t430;
                    displaySetIndex = todayRecord.setIndex430 || setIndex;
                    displayValue = todayRecord.value430 || marketValue;
                } else if (adminResults["04:30 PM"]?.modern !== "--") {
                    displayLive2D = adminResults["04:30 PM"].modern;
                }
            }

            cachedLiveData = {
                success: true,
                setIndex: displaySetIndex || "--",
                value: displayValue || "--",
                live2D: displayLive2D,
                adminResults: adminResults,
                schedule: {
                    t0930: adminResults["09:30 AM"],
                    t1201: adminResults["12:01 PM"],
                    t1400: adminResults["02:00 PM"],
                    t1630: adminResults["04:30 PM"]
                },
                notice: "2D Live အချက်အလက်များ ချိတ်ဆက်နေပါသည်။",
                time: currentTime
            };
            lastFetchTime = Date.now();

            return cachedLiveData;
        } finally {
            fetchPromise = null;
        }
    })();

    return fetchPromise;
}

app.get('/api/live', async (req, res) => {
    const now = Date.now();
    
    if (cachedLiveData && (now - lastFetchTime < CACHE_DURATION)) {
        return res.json(cachedLiveData);
    }

    try {
        const data = await fetchLiveMarketData(false);
        return res.json(data);
    } catch (error) {
        const myanmarTime = getMyanmarTime();
        const currentTime = myanmarTime.toLocaleTimeString('en-US', {
            hour12: true,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        let todayRecord = await getTodayAdminResults();
        let adminResults = todayRecord.schedule;

        let fallback2D = "--";
        let fallbackSetIndex = "--";
        let fallbackValue = "--";

        const currentHour = myanmarTime.getHours();
        const currentMinute = myanmarTime.getMinutes();
        const totalMinutes = currentHour * 60 + currentMinute;
        const middayStart = 12 * 60 + 1;
        const afternoonStart = 14 * 60;

        if (totalMinutes >= middayStart && totalMinutes < afternoonStart) {
            fallback2D = (todayRecord.t1201 && todayRecord.t1201 !== "--") ? todayRecord.t1201 : (adminResults["12:01 PM"]?.modern !== "--" ? adminResults["12:01 PM"].modern : "--");
            fallbackSetIndex = todayRecord.setIndex1201 || "--";
            fallbackValue = todayRecord.value1201 || "--";
        } else if ((currentHour === 16 && currentMinute >= 30) || currentHour > 16) {
            fallback2D = (todayRecord.t430 && todayRecord.t430 !== "--") ? todayRecord.t430 : (adminResults["04:30 PM"]?.modern !== "--" ? adminResults["04:30 PM"].modern : "--");
            fallbackSetIndex = todayRecord.setIndex430 || "--";
            fallbackValue = todayRecord.value430 || "--";
        }

        return res.json({
            success: true,
            setIndex: fallbackSetIndex,
            value: fallbackValue,
            live2D: fallback2D,
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
    }
});

setInterval(async () => {
    try {
        const myanmarTime = getMyanmarTime();
        const hour = myanmarTime.getHours();
        const minute = myanmarTime.getMinutes();
        const second = myanmarTime.getSeconds();
        const day = myanmarTime.getDay();

        if (day === 0 || day === 6) return;

        const isPreFetchTime = 
            (hour === 12 && minute === 0 && second >= 57) || 
            (hour === 16 && minute === 29 && second >= 57);

        const isTargetCaptureTime = 
            (hour === 12 && minute === 1 && second === 0) || 
            (hour === 16 && minute === 30 && second === 0);

        if (isPreFetchTime) {
            await fetchLiveMarketData(false);
        } else if (isTargetCaptureTime) {
            await fetchLiveMarketData(true);
            console.log(`[Auto-Capture Success] Locked and recorded at ${hour}:${minute}:${second}`);
        }

        if (hour === 16 && minute === 31 && second === 0) {
            console.log(`[Day Complete] Daily history finalized at 4:31 PM.`);
        }
    } catch (e) {
        console.error("[Auto-Capture Error]:", e.message);
    }
}, 1000);

function getChatScheduleState(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Yangon',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(now);

    const get = (type) => parts.find(part => part.type === type)?.value;

    const weekday = get('weekday');
    const hour = Number(get('hour'));
    const minute = Number(get('minute'));
    const minutes = hour * 60 + minute;

    const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);
    const morningOpen = minutes >= 11 * 60 && minutes < 12 * 60 + 10;
    const afternoonOpen = minutes >= 15 * 60 + 30 && minutes < 16 * 60 + 40;
    const open = isWeekday && (morningOpen || afternoonOpen);

    let message = 'Chat ပိတ်ထားသည်။';

    if (!isWeekday) {
        message = 'စနေ၊ တနင်္ဂနွေတွင် Chat ပိတ်ထားသည်။';
    } else if (minutes < 11 * 60) {
        message = 'Chat ကို မြန်မာစံတော်ချိန် မနက် ၁၁:၀၀ တွင် ဖွင့်ပါမည်။';
    } else if (minutes < 12 * 60 + 10) {
        message = 'Chat ကို နေ့လယ် ၁၂:၁၀ တွင် ပိတ်ပါမည်။';
    } else if (minutes < 15 * 60 + 30) {
        message = 'Chat ကို ညနေ ၃:၃၀ တွင် ပြန်ဖွင့်ပါမည်။';
    } else if (minutes < 16 * 60 + 40) {
        message = 'Chat ကို ညနေ ၄:၄၀ တွင် ပိတ်ပါမည်။';
    } else {
        message = 'ယနေ့ Chat အချိန်ပြီးဆုံးပါပြီ။';
    }

    const dateKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Yangon',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(now);

    const closureKey = !isWeekday
        ? `${dateKey}-weekend`
        : (
            minutes >= 12 * 60 + 10 && minutes < 15 * 60 + 30
                ? `${dateKey}-morning`
                : minutes >= 16 * 60 + 40
                    ? `${dateKey}-afternoon`
                    : null
        );

    return { open, message, closureKey };
}

const processedChatClosures = new Set();
const guestLastMessageAt = new Map();
const guestMessageTimes = new Map();

async function clearChatAtClosure(state) {
    if (state.closureKey && !processedChatClosures.has(state.closureKey)) {
        await ChatMessage.deleteMany({});
        processedChatClosures.add(state.closureKey);

        if (processedChatClosures.size > 14) {
            processedChatClosures.clear();
        }
    }
}

setInterval(async () => {
    try {
        const state = getChatScheduleState(new Date());
        await clearChatAtClosure(state);
    } catch (e) {
        console.error("Chat closure timer error:", e.message);
    }
}, 10000);

app.get('/api/chat', async (req, res) => {
    try {
        const state = getChatScheduleState(new Date());
        await clearChatAtClosure(state);

        const messages = state.open
            ? await ChatMessage.find()
                .sort({ createdAt: 1 })
                .limit(1000)
                .lean()
            : [];

        res.json({
            success: true,
            open: state.open,
            message: state.message,
            messages
        });

    } catch (err) {
        console.error('Chat read error:', err.message);

        res.status(500).json({
            success: false,
            open: false,
            message: 'Chat server အမှားဖြစ်နေပါသည်။',
            messages: []
        });
    }
});

app.post('/api/chat', async (req, res) => {
    try {
        const state = getChatScheduleState(new Date());
        await clearChatAtClosure(state);

        if (!state.open) {
            return res.status(403).json({
                success: false,
                open: false,
                message: state.message
            });
        }

        const guestId = String(req.body?.guestId || '').trim();
        const user = String(req.body?.user || 'Guest').trim().slice(0, 30) || 'Guest';
        const text = String(req.body?.text || '').trim();

        if (!/^[a-zA-Z0-9_-]{12,80}$/.test(guestId)) {
            return res.status(400).json({
                success: false,
                open: true,
                message: 'Guest ID မမှန်ပါ။ စာမျက်နှာကို ပြန်ဖွင့်ကြည့်ပါ။'
            });
        }

        if (!text) {
            return res.status(400).json({
                success: false,
                open: true,
                message: 'စာသားထည့်ပါ။'
            });
        }

        if (text.length > 500) {
            return res.status(400).json({
                success: false,
                open: true,
                message: 'စာလုံး ၅၀၀ ထက် မကျော်ရပါ။'
            });
        }

        const now = Date.now();
        const last = guestLastMessageAt.get(guestId) || 0;

        if (now - last < 2000) {
            return res.status(429).json({
                success: false,
                open: true,
                message: 'စာတစ်စောင်နှင့် တစ်စောင် အနည်းဆုံး ၂ စက္ကန့်ခြားပါ။'
            });
        }

        const recent = (guestMessageTimes.get(guestId) || [])
            .filter(time => now - time < 60000);

        if (recent.length >= 15) {
            guestMessageTimes.set(guestId, recent);

            return res.status(429).json({
                success: false,
                open: true,
                message: 'တစ်မိနစ်အတွင်း စာ ၁၅ စောင်သာ ပို့နိုင်ပါသည်။'
            });
        }

        await ChatMessage.create({
            guestId,
            user,
            text,
            createdAt: new Date(now)
        });

        guestLastMessageAt.set(guestId, now);
        recent.push(now);
        guestMessageTimes.set(guestId, recent);

        const count = await ChatMessage.countDocuments();

        if (count > 1000) {
            const excess = count - 1000;

            const oldest = await ChatMessage.find()
                .sort({ createdAt: 1 })
                .limit(excess)
                .select('_id')
                .lean();

            if (oldest.length) {
                await ChatMessage.deleteMany({
                    _id: { $in: oldest.map(item => item._id) }
                });
            }
        }

        res.json({ success: true, open: true });

    } catch (err) {
        console.error('Chat send error:', err.message);

        res.status(500).json({
            success: false,
            open: false,
            message: 'စာပို့၍မရပါ။ Server ကို စစ်ဆေးပါ။'
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Chat timezone: Asia/Yangon');
});