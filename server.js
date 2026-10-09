
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
const LIVE_FETCH_INTERVAL_MS = 3000;

let liveCache = {
    setIndex: '--',
    value: '--',
    live2D: '--',
    adminResults: null,
    schedule: null,
    notice: '2D Live အချက်အလက်များ ချိတ်ဆက်နေပါသည်။',
    time: '--',
    updatedAt: 0
};

let liveFetchRunning = false;
let boundaryCaptureRunning = false;

const MONGO_URI = process.env.MONGO_URI ||
    'mongodb+srv://clean2duser:cleanpass123@cluster0.aqs0zyr.mongodb.net/my2dapp?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB successfully connected!'))
    .catch(err => console.error('MongoDB connection error:', err));

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

let chatMessages = [
    {
        user: 'System',
        text: '2D Live Market App သို့ ကြိုဆိုပါသည်။'
    }
];

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
    if (isWeekendMyanmar(date)) return 'closed';

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

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;

    if (password === '2dpro153791') {
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

        if (password !== '2dpro153791') {
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

        res.json({
            success: true,
            message: `${session} ဇယားကွက် အချက်အလက်များ အောင်မြင်စွာ သိမ်းဆည်းပြီး Lock ချလိုက်ပါပြီ။`,
            adminResults: results
        });
    } catch (err) {
        console.error(err);

        res.status(500).json({
            success: false,
            message: 'Server error occurred'
        });
    }
});

app.get('/api/admin/data', async (req, res) => {
    try {
        const record = await getTodayAdminResults();

        res.json({
            success: true,
            adminResults: record.schedule
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
        const rows = await DayData.find()
            .sort({ _id: -1 })
            .limit(100)
            .lean();

        const history = rows.map(item => ({
            ...item,
            schedule: {
                t0930: item.schedule?.['09:30 AM'] || {
                    modern: '--',
                    internet: '--',
                    tw: '--'
                },
                t1201: item.schedule?.['12:01 PM'] || {
                    modern: '--',
                    internet: '--',
                    tw: '--'
                },
                t1400: item.schedule?.['02:00 PM'] || {
                    modern: '--',
                    internet: '--',
                    tw: '--'
                },
                t1630: item.schedule?.['04:30 PM'] || {
                    modern: '--',
                    internet: '--',
                    tw: '--'
                }
            }
        }));

        res.json({
            success: true,
            history
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// -------------------------------------------------------------
// SET Index / Value ကို သီးခြားခွဲပြီး ဖတ်ယူရန်
// -------------------------------------------------------------

function normalizeNumber(value) {
    return String(value || '')
        .replace(/,/g, '')
        .replace(/\s/g, '')
        .trim();
}

function getDecimalNumberCandidates(text) {
    return String(text || '').match(
        /(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}/g
    ) || [];
}

// Label (Index / Value) နဲ့ အနီးဆုံးဆက်စပ်နေတဲ့ ဂဏန်းကို ရှာမယ်။
// ဂဏန်းတစ်ခုတည်းပါတဲ့ အနီးဆုံး parent ကိုသာ လက်ခံမယ်။
function findNumberNearLabel($, labelType) {
    let found = '';

    $('*').each((i, el) => {
        if (found) return;

        const node = $(el);
        const directText = node
            .contents()
            .filter((index, child) => child.type === 'text')
            .text()
            .replace(/\s+/g, ' ')
            .trim();

        const fullText = node
            .text()
            .replace(/\s+/g, ' ')
            .trim();

        const labelText = directText || fullText;
        let matchesLabel = false;

        if (labelType === 'index') {
            matchesLabel = /^(?:SET\s*)?INDEX\b/i.test(labelText);
        } else if (labelType === 'value') {
            matchesLabel = /^VALUE\b/i.test(labelText);
        }

        if (!matchesLabel) return;

        let parent = node;

        for (let level = 0; level < 6; level++) {
            parent = parent.parent();

            if (!parent || !parent.length) break;

            const candidates = getDecimalNumberCandidates(
                parent.text()
            );

            const uniqueCandidates = [
                ...new Set(candidates.map(item => item.trim()))
            ];

            if (uniqueCandidates.length === 1) {
                found = uniqueCandidates[0];
                return;
            }

            // အနီးဆုံး parent မှာ ဂဏန်းအများကြီးရှိနေပါက
            // ပိုကြီးတဲ့ parent ကို မလိုက်တော့ပါ။
            if (uniqueCandidates.length > 1) {
                break;
            }
        }
    });

    return found;
}

async function fetchCurrentSET() {
    let setIndex = '';
    let marketValue = '';
    let calculated2D = '--';

    const url = 'https://www.set.or.th/en/home';

    const { data } = await axios.get(url, {
        timeout: 8000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    });

    const $ = cheerio.load(data);

    // ပထမဦးစွာ label နဲ့တွဲထားတဲ့ Index ကို ရှာမယ်။
    setIndex = findNumberNearLabel($, 'index');

    // Label ဖတ်မရတဲ့အခါ ယခင် selector ကို fallback အဖြစ်သုံးမယ်။
    if (!setIndex) {
        $('.mkt-info-value, .value, h3, span').each((i, el) => {
            if (setIndex) return;

            const text = $(el).text().trim();

            if (
                text.includes('.') &&
                text.length >= 6 &&
                text.length <= 10 &&
                !isNaN(text.replace(/,/g, ''))
            ) {
                setIndex = text;
            }
        });
    }

    // အရေးကြီးသောပြင်ဆင်ချက် —
    // Value label နဲ့ဆက်စပ်တဲ့ဂဏန်းကို အရင်ရှာမယ်။
    // Index ကို Value အဖြစ် ပြန်မရွေးမိအောင် သီးခြားခွဲထားမယ်။
    marketValue = findNumberNearLabel($, 'value');

    // Value label က DOM ထဲမှာ မတွေ့နိုင်တဲ့အခါ
    // SET အတန်းထဲက ဂဏန်းများကို စစ်ပြီး Index နဲ့မတူတဲ့ဂဏန်းကို ရွေးမယ်။
    if (!marketValue) {
        const candidates = [];

        $('tr, div, li').each((i, el) => {
            const rowText = $(el)
                .text()
                .replace(/\s+/g, ' ')
                .trim();

            const startsWithSET = /^SET\b/i.test(rowText);

            const isOtherIndex =
                /\bSET\s*50\b/i.test(rowText) ||
                /\bSETTRI\b/i.test(rowText) ||
                /\bSETCLMV\b/i.test(rowText) ||
                /\bSETHD\b/i.test(rowText) ||
                /\bSETESG\b/i.test(rowText);

            if (!startsWithSET || isOtherIndex) return;

            const numbers = getDecimalNumberCandidates(rowText);

            for (const number of numbers) {
                // Index နဲ့ တူညီတဲ့ဂဏန်းကို Value အဖြစ် မယူရ။
                if (
                    setIndex &&
                    normalizeNumber(number) === normalizeNumber(setIndex)
                ) {
                    continue;
                }

                candidates.push(number);
            }
        });

        marketValue = candidates[0] || '';
    }

    // နှစ်ခုလုံး အောင်မြင်စွာဖတ်ရမှ 2D တွက်မယ်။
    let digit1 = '--';
    let digit2 = '--';

    if (setIndex.includes('.')) {
        const decimalPart = setIndex.split('.')[1];
        digit1 = decimalPart.slice(-1);
    }

    if (marketValue.includes('.')) {
        const integerPart = marketValue
            .split('.')[0]
            .replace(/,/g, '');

        digit2 = integerPart.slice(-1);
    }

    if (
        digit1 !== '--' &&
        digit2 !== '--' &&
        digit1 !== '' &&
        digit2 !== ''
    ) {
        calculated2D = digit1 + digit2;
    }

    console.log(
        `SET FETCH | Index=${setIndex || '--'} | Value=${marketValue || '--'} | 2D=${calculated2D}`
    );

    return {
        setIndex: setIndex || '--',
        marketValue: marketValue || '--',
        calculated2D
    };
}

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
        return;
    }

    if (
        result2D === '--' ||
        resultIndex === '--' ||
        resultValue === '--'
    ) {
        liveCache.adminResults = record.schedule;
        liveCache.schedule = getScheduleObject(record.schedule);
        return;
    }

    liveCache.setIndex = resultIndex;
    liveCache.value = resultValue;
    liveCache.live2D = result2D;
    liveCache.adminResults = record.schedule;
    liveCache.schedule = getScheduleObject(record.schedule);
    liveCache.time = fixedTime;
    liveCache.updatedAt = Date.now();
}

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

        if (session === '12:01 PM' && record.t1201 && record.t1201 !== '--') {
            return true;
        }

        if (session === '04:30 PM' && record.t430 && record.t430 !== '--') {
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
            `${myanmarTime.toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            })}`;

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
        } else {
            console.log(
                `Boundary skipped: ${target.session} (Myanmar weekend)`
            );
        }

        scheduleNextBoundaryCapture();
    }, delay);
}

async function fetchAndUpdateLiveCache() {
    if (liveFetchRunning) return;

    liveFetchRunning = true;

    try {
        const phaseStart = getMarketPhase();
        const record = await getTodayAdminResults();

        // နေ့လယ် Freeze၊ ညနေ Freeze နဲ့ Weekend မှာ
        // Live data ကို ဆက်မဆွဲပါ။
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

        // Fetch လုပ်နေစဉ် Freeze အချိန်ရောက်သွားပါက
        // ရလာတဲ့ data ကို Live cache ထဲ မထည့်ပါ။
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
            value: result.marketValue,
            live2D: result.calculated2D,
            adminResults: record.schedule,
            schedule: getScheduleObject(record.schedule),
            notice: '2D Live အချက်အလက်များ ချိတ်ဆက်နေပါသည်။',
            time: formatCurrentTime(timeAfterFetch),
            updatedAt: Date.now()
        };
    } catch (err) {
        console.error(
            'Live data fetch error:',
            err.message
        );

        try {
            const record = await getTodayAdminResults();
            const phase = getMarketPhase();

            if (
                phase === 'midday-freeze' ||
                phase === 'after-market-freeze'
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

app.get('/api/live', (req, res) => {
    res.set('Cache-Control', 'no-store');

    res.json({
        success: true,
        setIndex: liveCache.setIndex,
        value: liveCache.value,
        live2D: liveCache.live2D,
        adminResults: liveCache.adminResults || {},
        schedule: liveCache.schedule || {},
        notice: liveCache.notice,
        time: liveCache.time
    });
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
        chatMessages.push({
            user: user || 'User',
            text
        });

        if (chatMessages.length > 50) {
            chatMessages.shift();
        }
    }

    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Myanmar Timezone: Asia/Yangon');
    console.log('Morning boundary: 12:01:00 PM Myanmar Time');
    console.log('Afternoon boundary: 04:30:00 PM Myanmar Time');
});