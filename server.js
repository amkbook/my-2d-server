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
const LIVE_FETCH_INTERVAL_MS = 15000;

// Hot Numbers Memory State
let hotNumbers = {
  morning: "--",
  evening: "--",
  lastResetDate: ""
};
let liveCache = {
    setIndex: '--',
    setValue: '--',
    live2D: '--',
    adminResults: null,
    schedule: null,
    notice: '2D Live အချက်အလက်များ ချိတ်ဆက်နေပါသည်။',
    time: '--',
    updatedAt: 0
};

let liveFetchRunning = false;
let boundaryCaptureRunning = false;

const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!MONGO_URI) {
    console.error('ERROR: MONGO_URI environment variable is missing.');
}

if (!ADMIN_PASSWORD) {
    console.error('ERROR: ADMIN_PASSWORD environment variable is missing.');
}

if (MONGO_URI) {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('MongoDB successfully connected!'))
        .catch(err => console.error('MongoDB connection error:', err.message));
}

const defaultSchedule = () => ({
    '09:30 AM': {
        modern: '--',
        internet: '--',
        tw: '--',
        isLocked: false
    },
    '12:01 PM': {
        modern: '--',
        internet: '--',
        tw: '--',
        isLocked: false,
        isAuto: true
    },
    '02:00 PM': {
        modern: '--',
        internet: '--',
        tw: '--',
        isLocked: false
    },
    '04:30 PM': {
        modern: '--',
        internet: '--',
        tw: '--',
        isLocked: false,
        isAuto: true
    }
});

const dataSchema = new mongoose.Schema({
    dateStr: {
        type: String,
        required: true,
        unique: true
    },
    dateFormatted: String,
    t1201: {
        type: String,
        default: '--'
    },
    t430: {
        type: String,
        default: '--'
    },
    setIndex1201: {
        type: String,
        default: '--'
    },
    value1201: {
        type: String,
        default: '--'
    },
    setIndex430: {
        type: String,
        default: '--'
    },
    value430: {
        type: String,
        default: '--'
    },
    schedule: {
        type: Object,
        default: defaultSchedule
    }
});

const DayData = mongoose.model('DayData', dataSchema);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// =====================================================

// GOLD PRICE SCHEMA & MODEL (ရွှေဈေး သီးသန့် Schema)

// =====================================================

const goldSchema = new mongoose.Schema({

dateStr: { type: String, required: true, unique: true }, // DD/MM/YYYY

dateFormatted: String,

globalGold: { type: String, default: "--" },

globalGoldHistory: { type: Object, default: { "09:00 AM": "--", "12:00 PM": "--", "04:00 PM": "--" } },

sessions: {

type: Object,

default: {

"09:00 AM": {

p15: { price: "--", change: "--" },

akhot: { price: "--", change: "--" },

isLocked: false

},

"12:00 PM": {

p15: { price: "--", change: "--" },

akhot: { price: "--", change: "--" },

isLocked: false

},

"04:00 PM": {

p15: { price: "--", change: "--" },

akhot: { price: "--", change: "--" },

isLocked: false

}

}

},

createdAt: { type: Date, default: Date.now }

});



const GoldData = mongoose.model('GoldData', goldSchema);

app.get('/api/gold', async (req, res) => {
    try {
        const goldRecord = await getTodayGoldRecord();
        res.json({
            success: true,
            dateFormatted: goldRecord.dateFormatted,
            globalGold: goldRecord.globalGold,
            globalGoldHistory: goldRecord.globalGoldHistory,
            sessions: goldRecord.sessions
        });
    } catch (err) {
        console.error('Error fetching gold data for app:', err);
        res.status(500).json({ success: false, message: "Server error" });
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
                
                if (goldRecord.sessions[session].p15.price !== "--" || goldRecord.sessions[session].akhot.price !== "--") {
                    goldRecord.sessions[session].isLocked = true;
                }
                goldRecord.markModified('sessions');
            } else {
                return res.status(400).json({ success: false, message: "မှားယွင်းနေသော ရွှေစျေး Session ဖြစ်ပါသည်။" });
            }
        }

        await goldRecord.save();
        res.json({ success: true, message: "ရွှေစျေး အချက်အလက်များ အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။", globalGold: goldRecord.globalGold, sessions: goldRecord.sessions });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server error occurred" });
    }
});

app.get('/api/gold/history', async (req, res) => {
    try {
        const records = await GoldData.find().sort({ _id: -1 }).limit(120).lean();
        res.json({ success: true, history: records });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});
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
// --------------------------------------------------
// Live Chatbox
// --------------------------------------------------

const chatSchema = new mongoose.Schema({
    guestId: {
        type: String,
        required: true,
        index: true
    },
    user: {
        type: String,
        required: true,
        maxlength: 30
    },
    text: {
        type: String,
        required: true,
        maxlength: 500
    },
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    }
}, {
    versionKey: false
});

chatSchema.index({ createdAt: -1 });

const ChatMessage = mongoose.models.ChatMessage ||
    mongoose.model('ChatMessage', chatSchema);

const CHAT_MAX_MESSAGES = 1000;
const CHAT_MIN_INTERVAL_MS = 2000;
const CHAT_MAX_PER_MINUTE = 15;
const chatRateLimits = new Map();
const processedChatClosures = new Set();
const CHAT_TIME_ZONE = 'Asia/Yangon';

function getMyanmarParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: CHAT_TIME_ZONE,
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date);

    const out = Object.fromEntries(
        parts.map(p => [p.type, p.value])
    );

    return {
        year: Number(out.year),
        month: Number(out.month),
        day: Number(out.day),
        hour: Number(out.hour),
        minute: Number(out.minute),
        second: Number(out.second),
        weekday: out.weekday
    };
}

function getChatScheduleState(date = new Date()) {
    const t = getMyanmarParts(date);
    const minuteOfDay = t.hour * 60 + t.minute;
    const isWeekday = !['Sat', 'Sun'].includes(t.weekday);

    const morningOpen =
        isWeekday &&
        minuteOfDay >= 11 * 60 &&
        minuteOfDay < 12 * 60 + 10;

    const afternoonOpen =
        isWeekday &&
        minuteOfDay >= 15 * 60 + 30 &&
        minuteOfDay < 16 * 60 + 40;

    let session = null;

    if (morningOpen) {
        session = 'morning';
    } else if (afternoonOpen) {
        session = 'afternoon';
    }

    const dateKey =
        `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;

    let closureKey = null;

    if (
        isWeekday &&
        minuteOfDay >= 12 * 60 + 10 &&
        minuteOfDay < 15 * 60 + 30
    ) {
        closureKey = `${dateKey}-morning`;
    }

    if (isWeekday && minuteOfDay >= 16 * 60 + 40) {
        closureKey = `${dateKey}-afternoon`;
    }

    if (!isWeekday) {
        closureKey = `${dateKey}-weekend`;
    }

    return {
        open: Boolean(session),
        session,
        closureKey,
        message: 'Chat ကို မြန်မာစံတော်ချိန် နံနက် 11:00–12:10 နှင့် ညနေ 3:30–4:40 အတွင်းသာ အသုံးပြုနိုင်ပါသည်။'
    };
}

async function enforceChatClosure() {
    if (mongoose.connection.readyState !== 1) {
        return;
    }

    const state = getChatScheduleState();

    if (
        !state.open &&
        state.closureKey &&
        !processedChatClosures.has(state.closureKey)
    ) {
        try {
            await ChatMessage.deleteMany({});
            processedChatClosures.add(state.closureKey);

            if (processedChatClosures.size > 20) {
                processedChatClosures.clear();
            }

            console.log(
                `Live Chatbox closed and messages cleared (${state.closureKey}).`
            );
        } catch (err) {
            console.error('Chat closure cleanup error:', err.message);
        }
    }
}

setInterval(enforceChatClosure, 15000);
// စျေးကွက်ဖွင့်ရက် (တနင်္လာ-သောကြာ) နံနက် 9:30 အတိတွင် ဟော့ထိပ်ဂဏန်းများ Auto-Reset လုပ်ရန်
function checkAndResetHotNumbers() {
    const mmTime = getMyanmarTime();
    const day = mmTime.getDay(); // 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
    const hours = mmTime.getHours();
    const minutes = mmTime.getMinutes();

    // နံနက် 9:30 AM အတိ ရောက်ရှိချိန် (hours === 9 && minutes === 30)
    if (hours === 9 && minutes === 30) {
        // စနေ (6) နှင့် တနင်္ဂနွေ (0) မဟုတ်ပါက (စျေးကွက်ဖွင့်ရက် တနင်္လာ မှ သောကြာ ဖြစ်ပါက) ရှင်းလင်းမည်
        if (day !== 0 && day !== 6) {
            hotNumbers = { morning: "--", evening: "--" };
            if (liveCache.hotNumbers) {
                liveCache.hotNumbers = { morning: "--", evening: "--" };
            }
            console.log('Trading day 9:30 AM reached: Hot numbers reset successfully.');
        } else {
            console.log('Weekend 9:30 AM: Hot numbers retained (No reset on Sat/Sun).');
        }
    }
}

// တစ်မိနစ်လျှင် တစ်ကြိမ် အချိန်ကိုက် စစ်ဆေးပေးခြင်း
setInterval(checkAndResetHotNumbers, 60000);

// --------------------------------------------------
// Myanmar time and market schedule helpers
// --------------------------------------------------

function getMyanmarTime() {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;

    return new Date(utc + 3600000 * 6.5);
}

function getMyanmarDateKey(date = getMyanmarTime()) {
    return date.toLocaleDateString('en-GB');
}

function getScheduleObject(schedule) {
    return {
        t0930: schedule['09:30 AM'],
        t1201: schedule['12:01 PM'],
        t1400: schedule['02:00 PM'],
        t1630: schedule['04:30 PM']
    };
}

function isWeekendMyanmar(date = getMyanmarTime()) {
    return date.getDay() === 0 || date.getDay() === 6;
}

function formatCurrentTime(date = getMyanmarTime()) {
    return date.toLocaleTimeString('en-US', {
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function getMarketPhase(date = getMyanmarTime()) {
    if (isWeekendMyanmar(date)) {
        return 'closed';
    }

    const seconds =
        date.getHours() * 3600 +
        date.getMinutes() * 60 +
        date.getSeconds();

    const startAM = 9 * 3600 + 30 * 60;
    const endAM = 12 * 3600 + 60;
    const startPM = 14 * 3600;
    const endPM = 16 * 3600 + 30 * 60;

    if (seconds >= startAM && seconds < endAM) {
        return 'morning-live';
    }

    if (seconds >= startPM && seconds < endPM) {
        return 'afternoon-live';
    }

    if (seconds >= endAM && seconds < startPM) {
        return 'midday-freeze';
    }

    return 'after-market-freeze';
}

async function getTodayAdminResults() {
    const dateStr = getMyanmarDateKey();

    let record = await DayData.findOne({ dateStr });

    if (!record) {
        record = new DayData({
            dateStr,
            dateFormatted: dateStr,
            schedule: defaultSchedule()
        });

        await record.save();
    }

    if (!record.schedule) {
        record.schedule = {};
    }

    const defaults = defaultSchedule();

    for (const key of Object.keys(defaults)) {
        if (!record.schedule[key]) {
            record.schedule[key] = { ...defaults[key] };
        } else {
            record.schedule[key].modern ??= '--';
            record.schedule[key].internet ??= '--';
            record.schedule[key].tw ??= '--';
            record.schedule[key].isLocked ??= false;
        }
    }

    return record;
}

// --------------------------------------------------
// Admin login and manual 2D result saving
// --------------------------------------------------

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;

    if (ADMIN_PASSWORD && password === ADMIN_PASSWORD) {
        return res.json({
            success: true,
            message: 'Login successful'
        });
    }

    return res.status(401).json({
        success: false,
        message: 'စကားဝှက် (Password) မှားယွင်းနေပါသည်။'
    });
});

app.post('/api/admin/save', async (req, res) => {
    try {
        const {
            password,
            session,
            modern,
            internet,
            tw
        } = req.body;

        if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
            return res.status(401).json({
                success: false,
                message: 'ခွင့်ပြုချက်မရှိပါ (Unauthorized)'
            });
        }

        const record = await getTodayAdminResults();
        const results = record.schedule;

        if (!session || !results[session]) {
            return res.status(400).json({
                success: false,
                message: 'မှားယွင်းနေသော Session ဖြစ်ပါသည်။'
            });
        }

        if (results[session].isLocked) {
            return res.status(400).json({
                success: false,
                message: `${session} အတွက် ဂဏန်းများကို ယနေ့တွင် သိမ်းဆည်းပြီးဖြစ်၍ ထပ်မံပြင်ဆင်ခွင့်မရှိပါ (Locked ဖြစ်နေပါသည်။)`
            });
        }

        if (modern !== undefined && modern !== '') {
            results[session].modern = modern;
        }

        if (internet !== undefined && internet !== '') {
            results[session].internet = internet;
        }

        if (tw !== undefined && tw !== '') {
            results[session].tw = tw;
        }

        if (
            results[session].modern !== '--' ||
            results[session].internet !== '--' ||
            results[session].tw !== '--'
        ) {
            results[session].isLocked = true;
        }

        record.schedule = results;
        record.markModified('schedule');

        await record.save();

        return res.json({
            success: true,
            message: `${session} ဇယားကွက် အချက်အလက်များ အောင်မြင်စွာ သိမ်းဆည်းပြီး Lock ချလိုက်ပါပြီ။`,
            adminResults: results
        });
    } catch (err) {
        console.error('Admin save error:', err.message);

        return res.status(500).json({
            success: false,
            message: 'Server error occurred'
        });
    }
});

// Admin မှ Hot Numbers ထည့်သွင်းရန် API
app.post('/api/admin/hot-numbers', (req, res) => {
    try {
        const { password, morning, evening } = req.body;
        
        if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
            return res.status(401).json({ success: false, message: "ခွင့်ပြုချက်မရှိပါ (Unauthorized)" });
        }

        // ဤနေရာတွင် liveCache ထဲသို့ တိုက်ရိုက် သိမ်းဆည်းစေခြင်း
        if (!liveCache.hotNumbers) {
            liveCache.hotNumbers = { morning: "--", evening: "--" };
        }

        if (morning !== undefined) {
            hotNumbers.morning = morning;
            liveCache.hotNumbers.morning = morning;
        }
        if (evening !== undefined) {
            hotNumbers.evening = evening;
            liveCache.hotNumbers.evening = evening;
        }

        return res.json({ success: true, message: "ဟော့ထိပ် အချက်အလက်များ အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။", hotNumbers });
    } catch (err) {
        console.error('Admin hot-numbers save error:', err.message);
        return res.status(500).json({ success: false, message: 'Server error occurred' });
    }
});
// Admin အတွက် လက်ရှိ Hot Numbers များကို ထုတ်ပေးရန် API
app.get('/api/admin/hot-numbers', (req, res) => {
    return res.json({
        success: true,
        hotNumbers: hotNumbers || { morning: "", evening: "" }
    });
});
// --------------------------------------------------
// Admin data API
// --------------------------------------------------

app.get('/api/admin/data', async (req, res) => {
    try {
        const record = await getTodayAdminResults();

        return res.json({
            success: true,
            adminResults: record ? (record.schedule || {}) : {},
            t1201: record ? (record.t1201 || '--') : '--',
            t430: record ? (record.t430 || '--') : '--',
            setIndex1201: record ? (record.setIndex1201 || '--') : '--',
            value1201: record ? (record.value1201 || '--') : '--',
            setIndex430: record ? (record.setIndex430 || '--') : '--',
            value430: record ? (record.value430 || '--') : '--'
        });
    } catch (err) {
        console.error('Admin data error:', err.message);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// --------------------------------------------------
// History API: 12:01 and 4:30 results
// --------------------------------------------------

app.get('/api/history', async (req, res) => {
    try {
        const rows = await DayData.find()
            .sort({ _id: -1 })
            .limit(100)
            .lean();

        const history = rows.map(item => {
            const rawSchedule = item.schedule || {};

            const midday = rawSchedule['12:01 PM'] || {
                modern: '--',
                internet: '--',
                tw: '--'
            };

            const close = rawSchedule['04:30 PM'] || {
                modern: '--',
                internet: '--',
                tw: '--'
            };

            // Older records may contain results only in schedule.
            const t1201 =
                item.t1201 && item.t1201 !== '--'
                    ? item.t1201
                    : (midday.modern || '--');

            const t430 =
                item.t430 && item.t430 !== '--'
                    ? item.t430
                    : (close.modern || '--');

            return {
                ...item,
                t1201,
                t430,
                schedule: {
                    t0930: rawSchedule['09:30 AM'] || {
                        modern: '--',
                        internet: '--',
                        tw: '--'
                    },
                    t1201: midday,
                    t1400: rawSchedule['02:00 PM'] || {
                        modern: '--',
                        internet: '--',
                        tw: '--'
                    },
                    t1630: close
                }
            };
        });

        return res.json({
            success: true,
            history
        });
    } catch (err) {
        console.error('History API error:', err.message);

        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// --------------------------------------------------
// Read current SET Index and Value
// --------------------------------------------------

async function fetchCurrentSET() {
    let setIndex = '--';
    let marketValue = '--';
    let calculated2D = '--';

    try {
        const { data } = await axios.get(
            'https://www.set.or.th/en/home',
            {
                timeout: 8000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            }
        );

        const $ = cheerio.load(data);

        // ဇယားကွက် (Table) ထဲရှိ အတန်းတိုင်းကို လိုက်စစ်ပြီး "SET" Row ကို တိုက်ရိုက်ယူသည်
        $('tr').each((i, el) => {
            const firstCol = $(el).find('td, th').first().text().trim();
            
            if (firstCol === 'SET') {
                const cols = $(el).find('td');
                if (cols.length >= 5) {
                    // cols[1] = Last (SET Index)
                    const indexVal = $(cols[1]).text().trim();
                    // cols[4] = Value (M.Baht)
                    const valueVal = $(cols[4]).text().trim().replace(/,/g, '');

                    if (indexVal && indexVal.includes('.')) {
                        setIndex = indexVal;
                    }
                    // valueVal ရှိပြီး အလွတ်မဟုတ်ပါက ယူမည် (comma မပါလည်း ဝင်စေရန် ပြင်ထားသည်)
                    if (valueVal && valueVal !== '') {
                        marketValue = valueVal;liveCache.setValue = valueVal;
                    }
                }
            }
        });

        let digit1 = '--';
        let digit2 = '--';

        // ၂၀၂၆ ခုနှစ်အတွက် တရားဝင်ပိတ်ရက်များစာရင်း[cite: 1]
        const marketHolidays = [
            '2026-10-13',
            '2026-10-23',
            '2026-12-07',
            '2026-12-10'
        ];

        const now = getMyanmarTime();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const currentDateStr = `${year}-${month}-${day}`;

        // ကြားရက် ပိတ်ရက်ဖြစ်ပါက calculated2D ကို OFF ဟု သတ်မှတ်မည်
        if (marketHolidays.includes(currentDateStr)) {
            calculated2D = 'OFF';
        } else {
            if (setIndex !== '--' && setIndex.includes('.')) {
                digit1 = setIndex.split('.')[1].slice(-1);
            }

            if (marketValue !== '--' && marketValue.includes('.')) {
                digit2 = marketValue
                    .split('.')[0]
                    .replace(/,/g, '')
                    .slice(-1);
            }

            if (digit1 !== '--' && digit2 !== '--') {
                calculated2D = digit1 + digit2;
            }
        }

    } catch (err) {
        console.error('fetchCurrentSET error:', err.message);
    }

    return {
        setIndex,
        marketValue,
        calculated2D
    };
}
// --------------------------------------------------
// Freeze the latest saved market snapshot
// --------------------------------------------------

function applyFrozenSnapshot(record, phase) {
    let result2D = '--';
    let resultIndex = '--';
    let resultValue = '--';

    let fixedTime =
        phase === 'midday-freeze'
            ? '12:01:00 PM'
            : '04:30:00 PM';

    if (phase === 'midday-freeze') {
        if (record.t1201 && record.t1201 !== '--') {
            result2D = record.t1201;
            resultIndex = record.setIndex1201 || '--';
            resultValue = record.value1201 || '--';
        }
    } else if (phase === 'after-market-freeze') {
        if (record.t430 && record.t430 !== '--') {
            result2D = record.t430;
            resultIndex = record.setIndex430 || '--';
            resultValue = record.value430 || '--';
        } else if (record.t1201 && record.t1201 !== '--') {
            result2D = record.t1201;
            resultIndex = record.setIndex1201 || '--';
            resultValue = record.value1201 || '--';
            fixedTime = '12:01:00 PM';
        }
    } else {
        // Weekend: preserve the last cached display without scraping SET.
        liveCache.adminResults = record.schedule;
        liveCache.schedule = getScheduleObject(record.schedule);
        liveCache.notice = 'စျေးကွက်ပိတ်ချိန်';
        return;
    }

    if (
        result2D === '--' ||
        resultIndex === '--' ||
        resultValue === '--'
    ) {
        // Keep the previous live values on screen until a boundary
        // capture has successfully saved the result.
        liveCache.adminResults = record.schedule;
        liveCache.schedule = getScheduleObject(record.schedule);
        liveCache.notice =
            phase === 'midday-freeze'
                ? 'နေ့လည်ပိုင်းစျေးကွက်အနားယူချိန်'
                : 'စျေးကွက်ပိတ်ချိန်';
        return;
    }

    liveCache.setIndex = resultIndex;
    liveCache.setValue = resultValue;
    liveCache.live2D = result2D;
    liveCache.adminResults = record.schedule;
    liveCache.schedule = getScheduleObject(record.schedule);
    liveCache.time = fixedTime;
    liveCache.updatedAt = Date.now();
    liveCache.notice =
        phase === 'midday-freeze'
            ? 'နေ့လည်ပိုင်းစျေးကွက်အနားယူချိန်'
            : 'စျေးကွက်ပိတ်ချိန်';
}

// --------------------------------------------------
// Capture automatic results at 12:01 and 4:30
// --------------------------------------------------

async function captureBoundaryResult(session) {
    if (boundaryCaptureRunning || isWeekendMyanmar()) {
        return false;
    }

    if (
        session !== '12:01 PM' &&
        session !== '04:30 PM'
    ) {
        return false;
    }

    boundaryCaptureRunning = true;

    try {
        const myanmarTime = getMyanmarTime();
        const record = await getTodayAdminResults();

        if (
            session === '12:01 PM' &&
            record.t1201 &&
            record.t1201 !== '--'
        ) {
            return true;
        }

        if (
            session === '04:30 PM' &&
            record.t430 &&
            record.t430 !== '--'
        ) {
            return true;
        }

        const result = await fetchCurrentSET();

        if (
            result.calculated2D === '--' ||
            result.setIndex === '--' ||
            result.marketValue === '--'
        ) {
            console.error(
                `${session} boundary capture: SET data incomplete.`
            );
            return false;
        }

        if (session === '12:01 PM') {
            record.t1201 = result.calculated2D;
            record.setIndex1201 = result.setIndex;
            record.value1201 = result.marketValue;
        } else {
            record.t430 = result.calculated2D;
            record.setIndex430 = result.setIndex;
            record.value430 = result.marketValue;
        }

        const key = session;

        record.schedule[key].modern = result.calculated2D;
        record.schedule[key].internet = result.calculated2D;
        record.schedule[key].tw = result.calculated2D;
        record.schedule[key].isLocked = true;
        record.schedule[key].isAuto = true;

        const weekday = myanmarTime.toLocaleDateString(
            'en-US',
            { weekday: 'long' }
        );

        const days = {
            Sunday: 'တနင်္ဂနွေ',
            Monday: 'တနင်္လာ',
            Tuesday: 'အင်္ဂါ',
            Wednesday: 'ဗုဒ္ဓဟူး',
            Thursday: 'ကြာသပတေး',
            Friday: 'သောကြာ',
            Saturday: 'စနေ'
        };

        record.dateFormatted =
            `${days[weekday] || weekday}\n` +
            myanmarTime.toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });

        record.markModified('schedule');
        await record.save();

        liveCache.setIndex = result.setIndex;
        liveCache.value = result.marketValue;
        liveCache.live2D = result.calculated2D;
        liveCache.adminResults = record.schedule;
        liveCache.schedule = getScheduleObject(record.schedule);
        liveCache.time =
            session === '12:01 PM'
                ? '12:01:00 PM'
                : '04:30:00 PM';
        liveCache.updatedAt = Date.now();
        liveCache.notice =
            session === '12:01 PM'
                ? 'နေ့လည်ပိုင်းစျေးကွက်အနားယူချိန်'
                : 'စျေးကွက်ပိတ်ချိန်';

        console.log(
            `BOUNDARY CAPTURED | Myanmar ${session} | ` +
            `2D=${result.calculated2D} | ` +
            `SET=${result.setIndex} | VALUE=${result.marketValue}`
        );

        return true;
    } catch (err) {
        console.error(
            `${session} boundary capture error:`,
            err.message
        );

        return false;
    } finally {
        boundaryCaptureRunning = false;
    }
}

function scheduleNextBoundaryCapture() {
    const now = getMyanmarTime();

    const targets = [
        {
            hour: 12,
            minute: 1,
            second: 0,
            session: '12:01 PM'
        },
        {
            hour: 16,
            minute: 30,
            second: 0,
            session: '04:30 PM'
        }
    ];

    let target = null;

    for (const t of targets) {
        const candidate = new Date(now);

        candidate.setHours(
            t.hour,
            t.minute,
            t.second,
            0
        );

        if (candidate.getTime() > now.getTime()) {
            target = {
                ...t,
                date: candidate
            };
            break;
        }
    }

    if (!target) {
        const candidate = new Date(now);

        candidate.setDate(candidate.getDate() + 1);
        candidate.setHours(12, 1, 0, 0);

        target = {
            ...targets[0],
            date: candidate
        };
    }

    const delay = Math.max(
        0,
        target.date.getTime() - now.getTime()
    );

    console.log(
        `Next Myanmar boundary: ${target.session} | ` +
        `in ${Math.round(delay / 1000)} seconds`
    );

    setTimeout(async () => {
        if (!isWeekendMyanmar()) {
            await captureBoundaryResult(target.session);

            // Retry once after a temporary network or scraping failure.
            setTimeout(async () => {
                try {
                    const record = await getTodayAdminResults();

                    const value =
                        target.session === '12:01 PM'
                            ? record.t1201
                            : record.t430;

                    if (!value || value === '--') {
                        await captureBoundaryResult(target.session);
                    }
                } catch (err) {
                    console.error(
                        'Boundary retry error:',
                        err.message
                    );
                }
            }, 5000);
        } else {
            console.log(
                `Boundary skipped: ${target.session} (Myanmar weekend)`
            );
        }

        scheduleNextBoundaryCapture();
    }, delay);
}

// --------------------------------------------------
// Live cache updater
// During midday/after close/weekends, no external
// SET website fetch is performed by this interval.
// --------------------------------------------------

async function fetchAndUpdateLiveCache() {
    if (liveFetchRunning) {
        return;
    }

    liveFetchRunning = true;

    // မနက် ၉:၃၀ Auto Reset Logic (Myanmar Timezone Safe)
        const nowTime = getMyanmarTime();
        const todayStr = getMyanmarDateKey(nowTime);
        const currentHour = nowTime.getHours();
        const currentMin = nowTime.getMinutes();
        const totalSec = currentHour * 3600 + currentMin * 60;
        const morningStartSec = 9 * 3600 + 30 * 60; // 9:30 AM

        if (totalSec >= morningStartSec && hotNumbers.lastResetDate !== todayStr) {
            hotNumbers.morning = "--";
            hotNumbers.evening = "--";
            hotNumbers.lastResetDate = todayStr;
        }
    try {
        const phaseStart = getMarketPhase();
        const record = await getTodayAdminResults();

        if (
            phaseStart === 'midday-freeze' ||
            phaseStart === 'after-market-freeze' ||
            phaseStart === 'closed'
        ) {
            applyFrozenSnapshot(record, phaseStart);
            return;
        }

        const result = await fetchCurrentSET();

        const timeAfterFetch = getMyanmarTime();
        const phaseAfterFetch = getMarketPhase(timeAfterFetch);

        // If the request crosses a market boundary, don't publish
        // the result fetched after the market should have frozen.
        if (
            phaseAfterFetch !== 'morning-live' &&
            phaseAfterFetch !== 'afternoon-live'
        ) {
            const latest = await getTodayAdminResults();

            applyFrozenSnapshot(latest, phaseAfterFetch);
            return;
        }

        liveCache = {
            setIndex: result.setIndex,
            setValue: result.marketValue,
            marketValue: result.marketValue,
            live2D: result.calculated2D,
            hotNumbers: hotNumbers,
            adminResults: record.schedule,
            schedule: getScheduleObject(record.schedule),
            notice: '2D Live အချက်အလက်များ ချိတ်ဆက်နေပါသည်။',
            time: formatCurrentTime(timeAfterFetch),
            updatedAt: Date.now()
        };
    } catch (err) {
        console.error('Live data fetch error:', err.message);

        try {
            const record = await getTodayAdminResults();
            const phase = getMarketPhase();

            if (
                phase === 'midday-freeze' ||
                phase === 'after-market-freeze' ||
                phase === 'closed'
            ) {
                applyFrozenSnapshot(record, phase);
            } else {
                liveCache.adminResults = record.schedule;
                liveCache.schedule = getScheduleObject(record.schedule);
            }
        } catch (fallbackError) {
            console.error(
                'Live fallback error:',
                fallbackError.message
            );
        }
    } finally {
        liveFetchRunning = false;
    }
}

setInterval(
    fetchAndUpdateLiveCache,
    LIVE_FETCH_INTERVAL_MS
);

fetchAndUpdateLiveCache();
scheduleNextBoundaryCapture();

// --------------------------------------------------
// Live API: serves cached data only; does not scrape
// the SET website when a browser polls this endpoint.
// --------------------------------------------------

app.get('/api/live', (req, res) => {
    res.set('Cache-Control', 'no-store');

    return res.json({
        success: true,
        setIndex: liveCache.setIndex,
       setValue: liveCache.setValue,
    marketValue: liveCache.setValue, 
    live2D: liveCache.live2D,
    adminResults: liveCache.adminResults || {},
    schedule: liveCache.schedule || {},
    notice: liveCache.notice,
    time: liveCache.time,
    hotNumbers: liveCache.hotNumbers || { morning: "--", evening: "--" }
    });
});

// --------------------------------------------------
// Chat API
// --------------------------------------------------

app.get('/api/chat', async (req, res) => {
    try {
        await enforceChatClosure();

        const state = getChatScheduleState();

        if (!state.open) {
            return res.json({
                success: true,
                open: false,
                messages: [],
                message: state.message
            });
        }

        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({
                success: false,
                open: true,
                messages: [],
                message: 'Chat database ချိတ်ဆက်နေဆဲဖြစ်ပါသည်။'
            });
        }

        const messages = await ChatMessage.find(
            {},
            {
                user: 1,
                text: 1,
                createdAt: 1,
                _id: 0
            }
        )
            .sort({ createdAt: 1 })
            .limit(CHAT_MAX_MESSAGES)
            .lean();

        return res.json({
            success: true,
            open: true,
            messages,
            message: state.message
        });
    } catch (err) {
        console.error('GET /api/chat error:', err.message);

        return res.status(500).json({
            success: false,
            message: 'Chat ကို ယခုဖွင့်မရသေးပါ။'
        });
    }
});

app.post('/api/chat', async (req, res) => {
    try {
        await enforceChatClosure();

        const state = getChatScheduleState();

        if (!state.open) {
            return res.status(403).json({
                success: false,
                open: false,
                message: state.message
            });
        }

        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({
                success: false,
                message: 'Chat database ချိတ်ဆက်နေဆဲဖြစ်ပါသည်။'
            });
        }

        const guestId = String(req.body?.guestId || '');

        const user =
            String(req.body?.user || 'Guest')
                .trim()
                .slice(0, 30) || 'Guest';

        const messageText =
            String(req.body?.text || '').trim();

        if (!/^[A-Za-z0-9_-]{12,80}$/.test(guestId)) {
            return res.status(400).json({
                success: false,
                message: 'Guest ID မမှန်ကန်ပါ။ စာမျက်နှာကို ပြန်ဖွင့်ကြည့်ပါ။'
            });
        }

        if (!messageText) {
            return res.status(400).json({
                success: false,
                message: 'စာသားကို ထည့်ပေးပါ။'
            });
        }

        if (messageText.length > 500) {
            return res.status(400).json({
                success: false,
                message: 'စာသားသည် အများဆုံး 500 လုံးအထိသာ ရပါမည်။'
            });
        }

        const now = Date.now();

        const previous = chatRateLimits.get(guestId) || {
            lastAt: 0,
            times: []
        };

        previous.times = previous.times.filter(
            ts => now - ts < 60000
        );

        if (now - previous.lastAt < CHAT_MIN_INTERVAL_MS) {
            return res.status(429).json({
                success: false,
                message: 'စာပို့တာ မြန်လွန်းနေပါသည်။ ခဏစောင့်ပြီး ထပ်ပို့ပါ။'
            });
        }

        if (previous.times.length >= CHAT_MAX_PER_MINUTE) {
            return res.status(429).json({
                success: false,
                message: 'တစ်မိနစ်အတွင်း စာ 15 ကြိမ်သာ ပို့နိုင်ပါသည်။'
            });
        }

        previous.lastAt = now;
        previous.times.push(now);
        chatRateLimits.set(guestId, previous);

        await ChatMessage.create({
            guestId,
            user,
            text: messageText
        });

        const count = await ChatMessage.countDocuments();

        if (count > CHAT_MAX_MESSAGES) {
            const excess = count - CHAT_MAX_MESSAGES;

            const oldest = await ChatMessage.find(
                {},
                { _id: 1 }
            )
                .sort({ createdAt: 1 })
                .limit(excess)
                .lean();

            if (oldest.length) {
                await ChatMessage.deleteMany({
                    _id: {
                        $in: oldest.map(m => m._id)
                    }
                });
            }
        }

        return res.json({
            success: true,
            message: 'စာပို့ပြီးပါပြီ။'
        });
    } catch (err) {
        console.error('POST /api/chat error:', err.message);

        return res.status(500).json({
            success: false,
            message: 'စာပို့ရာတွင် အမှားဖြစ်နေပါသည်။'
        });
    }
});


// --------------------------------------------------
// Start server
// --------------------------------------------------

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Myanmar Timezone: Asia/Yangon');
    console.log('Morning boundary: 12:01:00 PM Myanmar Time');
    console.log('Afternoon boundary: 04:30:00 PM Myanmar Time');
});