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

// MongoDB URI ကို Render Environment Variables မှ ယူမည်။
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('MONGO_URI environment variable is missing.');
} else {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('MongoDB successfully connected!'))
        .catch(err => console.error('MongoDB connection error:', err.message));
}

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

// Chat စာများကို MongoDB တွင် သိမ်းမည်။
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

// လက်ရှိမြန်မာစံတော်ချိန် helper
function getMyanmarTime() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * 6.5));
}

// ယနေ့ Admin ရလဒ်များကို Database မှ ရယူရန်
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

// Admin Login — Render ရှိ ADMIN_PASSWORD ကို အသုံးပြုမည်။
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

// Admin ရလဒ်သိမ်းဆည်းခြင်း
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

// Admin ရလဒ်များ ရယူခြင်း
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

// History ရယူခြင်း
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

// =====================================================
// SCRAPING & CACHING CORE LOGIC (PROMISE-BASED LOCK & PRE-FETCH)
// =====================================================
let cachedLiveData = null;
let lastFetchTime = 0;
const CACHE_DURATION = 3000;
let fetchPromise = null; // Promise-based Lock ဖြင့် တောင်းဆိုမှုထပ်နေခြင်းကို ကာကွယ်မည်

async function fetchLiveMarketData(isTargetCapture = false) {
    if (fetchPromise) return fetchPromise;

    fetchPromise = (async () => {
        let setIndex = '';
        let marketValue = '';
        let calculated2D = '--';

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
            const isWeekend = (dayOfWeekIndex === 0 || dayOfWeekIndex === 6);

            let todayRecord = await getTodayAdminResults();
            let adminResults = todayRecord.schedule;

            // Target Capture အချိန်ရောက်မှသာ Database သို့ တိကျစွာ သိမ်းဆည်းမည်
            if (isTargetCapture) {
                if (currentHour === 12 && currentMinute === 1) {
                    if (!isWeekend && calculated2D !== "--") {
                        if (adminResults["12:01 PM"].modern === "--" && !adminResults["12:01 PM"].isLocked) {
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
                        if (adminResults["04:30 PM"].modern === "--" && !adminResults["04:30 PM"].isLocked) {
                            adminResults["04:30 PM"].modern = calculated2D;
                            adminResults["04:30 PM"].internet = calculated2D;
                            adminResults["04:30 PM"].tw = calculated2D;
                            adminResults["04:30 PM"].isLocked = true;
                        }
                    }
                    if (!isWeekend && setIndex !== "--" && marketValue !== "--") {
                        if (!todayRecord.t430 || todayRecord.t430 === "--") {
                            todayRecord.t430 = calculated2D; // ၄:၃၀ ရလဒ်သီးသန့်
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

            cachedLiveData = {
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
            };
            lastFetchTime = Date.now();

            return cachedLiveData;
        } finally {
            fetchPromise = null;
        }
    })();

    return fetchPromise;
}

// မူလ Live Market API (Caching ပါဝင်သည်)
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

        // တိကျသော Fallback အချိန်စစ်ဆေးမှုများ
        if ((currentHour === 12 && currentMinute >= 1) || (currentHour > 12 && currentHour < 14)) {
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

// =====================================================
// ROBUST BACKGROUND PRE-FETCH & AUTO-CAPTURE TIMER
// =====================================================
setInterval(async () => {
    try {
        const myanmarTime = getMyanmarTime();
        const hour = myanmarTime.getHours();
        const minute = myanmarTime.getMinutes();
        const second = myanmarTime.getSeconds();
        const day = myanmarTime.getDay();

        if (day === 0 || day === 6) return;

        // ၁။ ၃ စက္ကန့်ကြိုတင် Pre-fetch လုပ်ရန် (၁၂:၀၀:၅၇ နှင့် ၄:၂၉:၅၇)
        const isPreFetchTime = 
            (hour === 12 && minute === 0 && second >= 57) || 
            (hour === 16 && minute === 29 && second >= 57);

        // ၂။ အတိအကျ ရလဒ်ဖမ်းရန်အချိန် (၁၂:၀၁:၀၀ နှင့် ၄:၃၀:၀၀ တွင် တစ်ကြိမ်တည်း)
        const isTargetCaptureTime = 
            (hour === 12 && minute === 1 && second === 0) || 
            (hour === 16 && minute === 30 && second === 0);

        if (isPreFetchTime) {
            await fetchLiveMarketData(false); // Cache သာ တင်မည်
        } else if (isTargetCaptureTime) {
            await fetchLiveMarketData(true); // Database သို့ အတိအကျ သိမ်းမည်
            console.log(`[Auto-Capture Success] Locked and recorded at ${hour}:${minute}:${second}`);
        }
    } catch (e) {
        console.error("[Auto-Capture Error]:", e.message);
    }
}, 1000);

// =====================================================
// Chatbox သီးသန့်အပိုင်း ( நேரဇုန် ပြဿနာကင်းရှင်းစေရန် new Date() ကိုသာ အသုံးပြုမည် )
// =====================================================
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

// Background Timer ဖြင့် ပိတ်ချိန်ရောက်သည်နှင့် Chat များကို ချက်ချင်းရှင်းလင်းပေးရန် (new Date() ကိုသာ အသုံးပြုခြင်း)
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