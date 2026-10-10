const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20kb' }));

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!MONGO_URI) console.error('ERROR: MONGO_URI environment variable is missing.');
if (!ADMIN_PASSWORD) console.error('ERROR: ADMIN_PASSWORD environment variable is missing.');

mongoose.connect(MONGO_URI || '')
    .then(() => console.log('MongoDB successfully connected!'))
    .catch(err => console.error('MongoDB connection error:', err.message));

const dataSchema = new mongoose.Schema({
    dateStr: { type: String, required: true, unique: true },
    dateFormatted: String,
    t1201: { type: String, default: '--' },
    t430: { type: String, default: '--' },
    setIndex1201: { type: String, default: '--' },
    value1201: { type: String, default: '--' },
    setIndex430: { type: String, default: '--' },
    value430: { type: String, default: '--' },
    schedule: {
        type: Object,
        default: {
            '09:30 AM': { modern: '--', internet: '--', tw: '--', isLocked: false },
            '12:01 PM': { modern: '--', internet: '--', tw: '--', isLocked: false, isAuto: true },
            '02:00 PM': { modern: '--', internet: '--', tw: '--', isLocked: false },
            '04:30 PM': { modern: '--', internet: '--', tw: '--', isLocked: false, isAuto: true }
        }
    }
});

const DayData = mongoose.model('DayData', dataSchema);

const chatSchema = new mongoose.Schema({
    guestId: { type: String, required: true, index: true },
    user: { type: String, required: true, maxlength: 30 },
    text: { type: String, required: true, maxlength: 500 },
    createdAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

chatSchema.index({ createdAt: -1 });
const ChatMessage = mongoose.model('ChatMessage', chatSchema);

const CHAT_MAX_MESSAGES = 1000;
const CHAT_MIN_INTERVAL_MS = 2000;
const CHAT_MAX_PER_MINUTE = 15;
const chatRateLimits = new Map();
const processedChatClosures = new Set();
const BURMESE_TIME_ZONE = 'Asia/Yangon';

function getMyanmarParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: BURMESE_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        weekday: 'short'
    }).formatToParts(date);

    return Object.fromEntries(
        parts
            .filter(p => p.type !== 'literal')
            .map(p => [p.type, p.value])
    );
}

function getChatScheduleState(date = new Date()) {
    const p = getMyanmarParts(date);
    const day = new Date(
        `${p.year}-${p.month}-${p.day}T00:00:00Z`
    ).getUTCDay();

    const weekday = day >= 1 && day <= 5;
    const minutes = Number(p.hour) * 60 + Number(p.minute);

    const open = weekday && (
        (minutes >= 660 && minutes < 730) ||
        (minutes >= 930 && minutes < 1000)
    );

    const dateKey = `${p.year}-${p.month}-${p.day}`;

    const closeKey =
        weekday && minutes >= 730 && minutes < 930
            ? `${dateKey}-1210`
            : weekday && minutes >= 1000
                ? `${dateKey}-1640`
                : null;

    return {
        open,
        weekday,
        minutes,
        dateKey,
        closeKey,
        time: `${p.hour}:${p.minute}:${p.second}`
    };
}

async function enforceChatClosure() {
    const state = getChatScheduleState();

    if (state.closeKey && !processedChatClosures.has(state.closeKey)) {
        await ChatMessage.deleteMany({});
        processedChatClosures.add(state.closeKey);
    }

    if (processedChatClosures.size > 20) {
        processedChatClosures.clear();
    }

    return state;
}

async function trimChatMessages() {
    const count = await ChatMessage.countDocuments();

    if (count > CHAT_MAX_MESSAGES) {
        const oldest = await ChatMessage.find()
            .sort({ createdAt: 1, _id: 1 })
            .limit(count - CHAT_MAX_MESSAGES)
            .select('_id')
            .lean();

        if (oldest.length) {
            await ChatMessage.deleteMany({
                _id: { $in: oldest.map(m => m._id) }
            });
        }
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

function getMyanmarTime() {
    const p = getMyanmarParts();

    return new Date(Date.UTC(
        Number(p.year),
        Number(p.month) - 1,
        Number(p.day),
        Number(p.hour),
        Number(p.minute),
        Number(p.second)
    ));
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
                '09:30 AM': { modern: '--', internet: '--', tw: '--', isLocked: false },
                '12:01 PM': { modern: '--', internet: '--', tw: '--', isLocked: false, isAuto: true },
                '02:00 PM': { modern: '--', internet: '--', tw: '--', isLocked: false },
                '04:30 PM': { modern: '--', internet: '--', tw: '--', isLocked: false, isAuto: true }
            }
        });

        await record.save();
    }

    return record;
}

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;

    if (ADMIN_PASSWORD && password === ADMIN_PASSWORD) {
        res.json({ success: true, message: 'Login successful' });
    } else {
        res.status(401).json({
            success: false,
            message: 'စကားဝှက် (Password) မှားယွင်းနေပါသည်။'
        });
    }
});

app.post('/api/admin/save', async (req, res) => {
    try {
        const { password, session, modern, internet, tw } = req.body;

        if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
            return res.status(401).json({
                success: false,
                message: 'ခွင့်ပြုချက်မရှိပါ (Unauthorized)'
            });
        }

        const todayRecord = await getTodayAdminResults();
        const adminResults = todayRecord.schedule;

        if (session && adminResults[session]) {
            if (adminResults[session].isLocked) {
                return res.status(400).json({
                    success: false,
                    message: `${session} အတွက် ယနေ့တွင် သိမ်းဆည်းပြီးဖြစ်၍ ပြင်ဆင်ခွင့်မရှိပါ။`
                });
            }

            if (modern !== undefined && modern !== '') {
                adminResults[session].modern = modern;
            }

            if (internet !== undefined && internet !== '') {
                adminResults[session].internet = internet;
            }

            if (tw !== undefined && tw !== '') {
                adminResults[session].tw = tw;
            }

            if (
                adminResults[session].modern !== '--' ||
                adminResults[session].internet !== '--' ||
                adminResults[session].tw !== '--'
            ) {
                adminResults[session].isLocked = true;
            }

            todayRecord.schedule = adminResults;
            todayRecord.markModified('schedule');
            await todayRecord.save();

            return res.json({
                success: true,
                message: `${session} အချက်အလက်များ သိမ်းဆည်းပြီးပါပြီ။`,
                adminResults
            });
        }

        res.status(400).json({
            success: false,
            message: 'မှားယွင်းနေသော Session ဖြစ်ပါသည်။'
        });
    } catch (err) {
        console.error('Admin save error:', err.message);
        res.status(500).json({
            success: false,
            message: 'Server error occurred'
        });
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
            message: 'Server error'
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
            message: 'Server error'
        });
    }
});

app.get('/api/live', async (req, res) => {
    let setIndex = '';
    let marketValue = '';
    let calculated2D = '--';

    try {
        const url = 'https://www.set.or.th/en/home';

        const { data } = await axios.get(url, {
            timeout: 8000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
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
                $(el).find('td, span, div').each((j, subEl) => {
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

        let digit1 = '--';
        let digit2 = '--';

        if (setIndex.includes('.')) {
            const indexParts = setIndex.split('.');
            digit1 = indexParts[1].slice(-1);
        }

        if (marketValue.includes('.')) {
            const valueParts = marketValue.split('.');
            const valueInteger = valueParts[0].replace(/,/g, '');
            digit2 = valueInteger.slice(-1);
        }

        if (digit1 !== '--' && digit2 !== '--') {
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
            Sunday: 'တနင်္ဂနွေ',
            Monday: 'တနင်္လာ',
            Tuesday: 'အင်္ဂါ',
            Wednesday: 'ဗုဒ္ဓဟူး',
            Thursday: 'ကြာသပတေး',
            Friday: 'သောကြာ',
            Saturday: 'စနေ'
        };

        const myanmarDay = daysMap[dayOfWeek] || dayOfWeek;
        const isWeekend = dayOfWeekIndex === 0 || dayOfWeekIndex === 6;

        const todayRecord = await getTodayAdminResults();
        const adminResults = todayRecord.schedule;

        if ((currentHour === 12 && currentMinute >= 1) || currentHour > 12) {
            if (!isWeekend && calculated2D !== '--') {
                if (
                    adminResults['12:01 PM'].modern === '--' &&
                    !adminResults['12:01 PM'].isLocked
                ) {
                    adminResults['12:01 PM'].modern = calculated2D;
                    adminResults['12:01 PM'].internet = calculated2D;
                    adminResults['12:01 PM'].tw = calculated2D;
                    adminResults['12:01 PM'].isLocked = true;
                }
            }

            if (!isWeekend && setIndex !== '--' && marketValue !== '--') {
                if (todayRecord.t1201 === '--') {
                    todayRecord.t1201 = calculated2D;
                    todayRecord.setIndex1201 = setIndex;
                    todayRecord.value1201 = marketValue;
                    todayRecord.dateFormatted = `${myanmarDay}\n${dateString}`;
                }
            }
        }

        if (currentHour > 16 || (currentHour === 16 && currentMinute >= 30)) {
            if (!isWeekend && calculated2D !== '--') {
                if (
                    adminResults['04:30 PM'].modern === '--' &&
                    !adminResults['04:30 PM'].isLocked
                ) {
                    adminResults['04:30 PM'].modern = calculated2D;
                    adminResults['04:30 PM'].internet = calculated2D;
                    adminResults['04:30 PM'].tw = calculated2D;
                    adminResults['04:30 PM'].isLocked = true;
                }
            }

            if (!isWeekend && setIndex !== '--' && marketValue !== '--') {
                if (todayRecord.t430 === '--') {
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

        res.json({
            success: true,
            setIndex: setIndex || '--',
            value: marketValue || '--',
            live2D: calculated2D,
            adminResults,
            schedule: {
                t0930: adminResults['09:30 AM'],
                t1201: adminResults['12:01 PM'],
                t1400: adminResults['02:00 PM'],
                t1630: adminResults['04:30 PM']
            },
            notice: '2D Live အချက်အလက်များ ချိတ်ဆက်နေပါသည်။',
            time: currentTime
        });
    } catch (error) {
        console.error('Live fetch error:', error.message);

        const myanmarTime = getMyanmarTime();
        const currentTime = myanmarTime.toLocaleTimeString('en-US', {
            hour12: true,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        const todayRecord = await getTodayAdminResults();
        const adminResults = todayRecord.schedule;

        let fallback2D = '--';
        let fallbackSetIndex = '--';
        let fallbackValue = '--';

        const currentHour = myanmarTime.getHours();
        const currentMinute = myanmarTime.getMinutes();

        if ((currentHour >= 12 && currentHour < 14) ||
            (currentHour === 12 && currentMinute >= 1)) {
            fallback2D = todayRecord.t1201 !== '--'
                ? todayRecord.t1201
                : (adminResults['12:01 PM'].modern || '--');

            fallbackSetIndex = todayRecord.setIndex1201 || '--';
            fallbackValue = todayRecord.value1201 || '--';
        } else if (
            currentHour >= 16 ||
            currentHour < 9 ||
            (currentHour === 9 && currentMinute < 30) ||
            (currentHour >= 14 && currentHour < 16)
        ) {
            if (todayRecord.t430 && todayRecord.t430 !== '--') {
                fallback2D = todayRecord.t430;
                fallbackSetIndex = todayRecord.setIndex430 || '--';
                fallbackValue = todayRecord.value430 || '--';
            } else if (
                adminResults['04:30 PM'].modern &&
                adminResults['04:30 PM'].modern !== '--'
            ) {
                fallback2D = adminResults['04:30 PM'].modern;
            } else if (todayRecord.t1201 && todayRecord.t1201 !== '--') {
                fallback2D = todayRecord.t1201;
                fallbackSetIndex = todayRecord.setIndex1201 || '--';
                fallbackValue = todayRecord.value1201 || '--';
            }
        }

        res.json({
            success: true,
            setIndex: fallbackSetIndex,
            value: fallbackValue,
            live2D: fallback2D,
            adminResults,
            schedule: {
                t0930: adminResults['09:30 AM'],
                t1201: adminResults['12:01 PM'],
                t1400: adminResults['02:00 PM'],
                t1630: adminResults['04:30 PM']
            },
            notice: '2D Live အချက်အလက်များ ချိတ်ဆက်နေပါသည်။',
            time: currentTime
        });
    }
});

app.get('/api/chat', async (req, res) => {
    try {
        const state = await enforceChatClosure();

        if (!state.open) {
            return res.json({
                success: true,
                open: false,
                messages: [],
                message: 'Chatbox ပိတ်ထားပါသည်။'
            });
        }

        const messages = await ChatMessage.find()
            .sort({ createdAt: -1, _id: -1 })
            .limit(CHAT_MAX_MESSAGES)
            .lean();

        messages.reverse();

        res.json({ success: true, open: true, messages });
    } catch (err) {
        console.error('Chat fetch error:', err.message);
        res.status(500).json({
            success: false,
            message: 'Chat ကို ရယူ၍မရပါ။'
        });
    }
});

app.post('/api/chat', async (req, res) => {
    try {
        const state = await enforceChatClosure();

        if (!state.open) {
            return res.status(403).json({
                success: false,
                open: false,
                message: 'Chatbox ဖွင့်ချိန် မဟုတ်သေးပါ။'
            });
        }

        const guestId = String(req.body.guestId || '').trim();
        const text = String(req.body.text || '').trim();
        const requestedName = String(req.body.user || '').trim();

        if (!/^[a-zA-Z0-9_-]{12,80}$/.test(guestId)) {
            return res.status(400).json({
                success: false,
                message: 'Guest ID မမှန်ပါ။ စာမျက်နှာကို refresh လုပ်ပါ။'
            });
        }

        if (!text) {
            return res.status(400).json({
                success: false,
                message: 'စာသားထည့်ပါ။'
            });
        }

        if (text.length > 500) {
            return res.status(400).json({
                success: false,
                message: 'စာလုံး ၅၀၀ ထက် မကျော်ရပါ။'
            });
        }

        const now = Date.now();
        const previous = chatRateLimits.get(guestId) || {
            lastAt: 0,
            timestamps: []
        };

        const recent = previous.timestamps.filter(t => now - t < 60000);

        if (now - previous.lastAt < CHAT_MIN_INTERVAL_MS) {
            return res.status(429).json({
                success: false,
                message: 'စာတစ်စောင်နှင့်တစ်စောင် အနည်းဆုံး ၂ စက္ကန့်ခြားပါ။'
            });
        }

        if (recent.length >= CHAT_MAX_PER_MINUTE) {
            return res.status(429).json({
                success: false,
                message: 'တစ်မိနစ်အတွင်း စာပို့နှုန်း ကန့်သတ်ချက် ပြည့်နေပါသည်။'
            });
        }

        const user = requestedName
            ? requestedName.slice(0, 30)
            : `Guest-${guestId.slice(-4)}`;

        await ChatMessage.create({
            guestId,
            user,
            text,
            createdAt: new Date(now)
        });

        chatRateLimits.set(guestId, {
            lastAt: now,
            timestamps: [...recent, now]
        });

        await trimChatMessages();

        if (chatRateLimits.size > 20000) {
            for (const [id, info] of chatRateLimits) {
                if (now - info.lastAt > 10 * 60 * 1000) {
                    chatRateLimits.delete(id);
                }

                if (chatRateLimits.size <= 15000) break;
            }
        }

        res.json({ success: true, message: 'စာပို့ပြီးပါပြီ။' });
    } catch (err) {
        console.error('Chat send error:', err.message);
        res.status(500).json({
            success: false,
            message: 'စာပို့၍မရပါ။'
        });
    }
});

setInterval(() => {
    enforceChatClosure().catch(err =>
        console.error('Chat closure error:', err.message)
    );
}, 15000);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});