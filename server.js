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

// SET Live data ကို server တစ်ခုတည်းက 3 စက္ကန့်တစ်ကြိမ် fetch လုပ်မည်။
const LIVE_FETCH_INTERVAL_MS = 3000;

// Myanmar Time boundary များ — 12:01:00 PM နှင့် 04:30:00 PM အတိ။
const MORNING_BOUNDARY = { hour: 12, minute: 1, second: 0, key: '1201' };
const AFTERNOON_BOUNDARY = { hour: 16, minute: 30, second: 0, key: '1630' };

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

// MongoDB သို့ ချိတ်ဆက်ခြင်း
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://clean2duser:cleanpass123@cluster0.aqs0zyr.mongodb.net/my2dapp?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB successfully connected!'))
    .catch(err => console.error('MongoDB connection error:', err));

const dataSchema = new mongoose.Schema({
    dateStr: { type: String, required: true, unique: true },
    dateFormatted: String,

    // History big result boxes — 12:01 / 04:30 အတိရလဒ် 2D တစ်ခုတည်းသာ သိမ်းမည်။
    t1201: { type: String, default: '--' },
    t430: { type: String, default: '--' },

    setIndex1201: { type: String, default: '--' },
    value1201: { type: String, default: '--' },
    setIndex430: { type: String, default: '--' },
    value430: { type: String, default: '--' },

    schedule: {
        type: Object,
        default: {
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
    {
        user: 'System',
        text: '2D Live Market App သို့ ကြိုဆိုပါသည်။'
    }
];

function getMyanmarTime() {
    const now = new Date();

    const utc =
        now.getTime() +
        (now.getTimezoneOffset() * 60000);

    return new Date(
        utc + (3600000 * 6.5)
    );
}

function getMyanmarDateKey(
    date = getMyanmarTime()
) {
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

async function getTodayAdminResults() {
    const myanmarTime =
        getMyanmarTime();

    const todayDateStr =
        getMyanmarDateKey(myanmarTime);

    let record =
        await DayData.findOne({
            dateStr: todayDateStr
        });

    if (!record) {
        record = new DayData({
            dateStr: todayDateStr,
            dateFormatted: todayDateStr,
            schedule: {
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
            }
        });

        await record.save();
    }

    // Old records may not have the newer schedule keys.
    if (!record.schedule) {
        record.schedule = {};
    }

    const defaults = {
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
    };

    for (const key of Object.keys(defaults)) {
        if (!record.schedule[key]) {
            record.schedule[key] = {
                ...defaults[key]
            };
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
        res.json({
            success: true,
            message: 'Login successful'
        });
    } else {
        res.status(401).json({
            success: false,
            message:
                'စကားဝှက် (Password) မှားယွင်းနေပါသည်။'
        });
    }
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
                message:
                    'ခွင့်ပြုချက်မရှိပါ (Unauthorized)'
            });
        }

        const todayRecord =
            await getTodayAdminResults();

        const adminResults =
            todayRecord.schedule;

        if (
            session &&
            adminResults[session]
        ) {
            if (
                adminResults[session].isLocked
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        `${session} အတွက် ဂဏန်းများကို ယနေ့တွင် သိမ်းဆည်းပြီးဖြစ်၍ ထပ်မံပြင်ဆင်ခွင့်မရှိပါ (Locked ဖြစ်နေပါသည်။)`
                });
            }

            if (
                modern !== undefined &&
                modern !== ''
            ) {
                adminResults[session].modern =
                    modern;
            }

            if (
                internet !== undefined &&
                internet !== ''
            ) {
                adminResults[session].internet =
                    internet;
            }

            if (
                tw !== undefined &&
                tw !== ''
            ) {
                adminResults[session].tw =
                    tw;
            }

            if (
                adminResults[session].modern !== '--' ||
                adminResults[session].internet !== '--' ||
                adminResults[session].tw !== '--'
            ) {
                adminResults[session].isLocked =
                    true;
            }

            todayRecord.schedule =
                adminResults;

            todayRecord.markModified(
                'schedule'
            );

            await todayRecord.save();

            return res.json({
                success: true,
                message:
                    `${session} ဇယားကွက် အချက်အလက်များ အောင်မြင်စွာ သိမ်းဆည်းပြီး Lock ချလိုက်ပါပြီ။`,
                adminResults
            });
        }

        res.status(400).json({
            success: false,
            message:
                'မှားယွင်းနေသော Session ဖြစ်ပါသည်။'
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
        const todayRecord =
            await getTodayAdminResults();

        res.json({
            success: true,
            adminResults:
                todayRecord.schedule
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
        const historyRecords =
            await DayData.find()
                .sort({ _id: -1 })
                .limit(100)
                .lean();

        const history =
            historyRecords.map(item => ({
                ...item,

                schedule: {
                    t0930:
                        item.schedule?.[
                            '09:30 AM'
                        ] || {
                            modern: '--',
                            internet: '--',
                            tw: '--'
                        },

                    t1201:
                        item.schedule?.[
                            '12:01 PM'
                        ] || {
                            modern: '--',
                            internet: '--',
                            tw: '--'
                        },

                    t1400:
                        item.schedule?.[
                            '02:00 PM'
                        ] || {
                            modern: '--',
                            internet: '--',
                            tw: '--'
                        },

                    t1630:
                        item.schedule?.[
                            '04:30 PM'
                        ] || {
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
// SET website မှ လက်ရှိ SET Index / Value ကို fetch ပြီး 2D တွက်ရန်
// -------------------------------------------------------------

async function fetchCurrentSET() {
    let setIndex = '';
    let marketValue = '';
    let calculated2D = '--';

    const url =
        'https://www.set.or.th/en/home';

    const { data } =
        await axios.get(url, {
            timeout: 8000,

            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

                'Accept-Language':
                    'en-US,en;q=0.9'
            }
        });

    const $ =
        cheerio.load(data);

    $('.mkt-info-value, .value, h3, span')
        .each((i, el) => {
            const text =
                $(el).text().trim();

            if (
                text.includes('.') &&
                text.length >= 6 &&
                text.length <= 10 &&
                !setIndex
            ) {
                if (
                    !isNaN(
                        text.replace(
                            /,/g,
                            ''
                        )
                    )
                ) {
                    setIndex = text;
                }
            }
        });

    $('tr, div, li')
        .each((i, el) => {
            const rowText =
                $(el).text().trim();

            if (
                (
                    rowText.startsWith('SET') ||
                    rowText.includes('SET \n') ||
                    rowText.includes('SET\t')
                ) &&
                !rowText.includes('SET50') &&
                !rowText.includes('SETTRI') &&
                !rowText.includes('SETCLMV') &&
                !rowText.includes('SETHD') &&
                !rowText.includes('SETESG')
            ) {
                const items =
                    $(el).find(
                        'td, span, div'
                    );

                items.each((j, subEl) => {
                    const t =
                        $(subEl)
                            .text()
                            .trim();

                    if (
                        t.includes(',') &&
                        t.length >= 7 &&
                        t.length <= 12
                    ) {
                        const clean =
                            t.replace(
                                /,/g,
                                ''
                            );

                        const num =
                            parseFloat(clean);

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

    let digit1 = '--';
    let digit2 = '--';

    if (setIndex.includes('.')) {
        const indexParts =
            setIndex.split('.');

        digit1 =
            indexParts[1].slice(-1);
    }

    if (marketValue.includes('.')) {
        const valueParts =
            marketValue.split('.');

        const valueInteger =
            valueParts[0]
                .replace(/,/g, '');

        digit2 =
            valueInteger.slice(-1);
    }

    if (
        digit1 !== '--' &&
        digit2 !== '--'
    ) {
        calculated2D =
            digit1 + digit2;
    }

    return {
        setIndex:
            setIndex || '--',

        marketValue:
            marketValue || '--',

        calculated2D
    };
}

function isWeekendMyanmar(
    date = getMyanmarTime()
) {
    const day =
        date.getDay();

    return (
        day === 0 ||
        day === 6
    );
}

function formatCurrentTime(
    date = getMyanmarTime()
) {
    return date.toLocaleTimeString(
        'en-US',
        {
            hour12: true,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }
    );
}

// -------------------------------------------------------------
// အရေးကြီးသော ပြင်ဆင်ချက်
//
// 12:01 PM big box = 12:01 PM အတိတွင်ရသော 2D တစ်ခုတည်း
//
// 04:30 PM big box = 04:30 PM အတိတွင်ရသော 2D တစ်ခုတည်း
//
// 09:30 / 02:00 Admin ဂဏန်းများကို big box ထဲ မပေါင်းတော့ပါ။
// -------------------------------------------------------------

async function captureBoundaryResult(
    session
) {
    if (boundaryCaptureRunning) {
        return false;
    }

    if (
        session !== '12:01 PM' &&
        session !== '04:30 PM'
    ) {
        return false;
    }

    if (isWeekendMyanmar()) {
        return false;
    }

    boundaryCaptureRunning = true;

    try {
        const myanmarTime =
            getMyanmarTime();

        const todayRecord =
            await getTodayAdminResults();

        // တစ်ရက်တစ်ကြိမ်သာ lock လုပ်ရန်။
        if (
            session === '12:01 PM' &&
            todayRecord.t1201 &&
            todayRecord.t1201 !== '--'
        ) {
            return true;
        }

        if (
            session === '04:30 PM' &&
            todayRecord.t430 &&
            todayRecord.t430 !== '--'
        ) {
            return true;
        }

        // Boundary အချိန်ရောက်မှ SET ကို fetch လုပ်ပြီး
        // အဲဒီ fetch မှရသော 2D ကိုသာ သိမ်းမည်။
        const result =
            await fetchCurrentSET();

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

            // History big box:
            // 12:01 အဖြေတစ်ခုတည်းသာ။
            todayRecord.t1201 =
                result.calculated2D;

            todayRecord.setIndex1201 =
                result.setIndex;

            todayRecord.value1201 =
                result.marketValue;

            // Schedule 12:01 row:
            // live result တစ်ခုတည်းကို auto-lock။
            todayRecord.schedule[
                '12:01 PM'
            ].modern =
                result.calculated2D;

            todayRecord.schedule[
                '12:01 PM'
            ].internet =
                result.calculated2D;

            todayRecord.schedule[
                '12:01 PM'
            ].tw =
                result.calculated2D;

            todayRecord.schedule[
                '12:01 PM'
            ].isLocked =
                true;

            todayRecord.schedule[
                '12:01 PM'
            ].isAuto =
                true;
        }

        if (session === '04:30 PM') {

            // History big box:
            // 04:30 အဖြေတစ်ခုတည်းသာ။
            todayRecord.t430 =
                result.calculated2D;

            todayRecord.setIndex430 =
                result.setIndex;

            todayRecord.value430 =
                result.marketValue;

            // Schedule 04:30 row:
            // live result တစ်ခုတည်းကို auto-lock။
            todayRecord.schedule[
                '04:30 PM'
            ].modern =
                result.calculated2D;

            todayRecord.schedule[
                '04:30 PM'
            ].internet =
                result.calculated2D;

            todayRecord.schedule[
                '04:30 PM'
            ].tw =
                result.calculated2D;

            todayRecord.schedule[
                '04:30 PM'
            ].isLocked =
                true;

            todayRecord.schedule[
                '04:30 PM'
            ].isAuto =
                true;
        }

        const dayOfWeek =
            myanmarTime.toLocaleDateString(
                'en-US',
                {
                    weekday: 'long'
                }
            );

        const daysMap = {
            Sunday: 'တနင်္ဂနွေ',
            Monday: 'တနင်္လာ',
            Tuesday: 'အင်္ဂါ',
            Wednesday: 'ဗုဒ္ဓဟူး',
            Thursday: 'ကြာသပတေး',
            Friday: 'သောကြာ',
            Saturday: 'စနေ'
        };

        const myanmarDay =
            daysMap[dayOfWeek] ||
            dayOfWeek;

        const dateString =
            myanmarTime.toLocaleDateString(
                'en-GB',
                {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                }
            );

        todayRecord.dateFormatted =
            `${myanmarDay}\n${dateString}`;

        todayRecord.markModified(
            'schedule'
        );

        await todayRecord.save();

        console.log(
            `BOUNDARY CAPTURED | Myanmar ${session} | 2D=${result.calculated2D} | SET=${result.setIndex} | VALUE=${result.marketValue}`
        );

        // live cache ကိုလည်း boundary result ဖြင့် update လုပ်ထားမည်။
        liveCache.setIndex =
            result.setIndex;

        liveCache.value =
            result.marketValue;

        liveCache.live2D =
            result.calculated2D;

        liveCache.adminResults =
            todayRecord.schedule;

        liveCache.schedule =
            getScheduleObject(
                todayRecord.schedule
            );

        liveCache.time =
            formatCurrentTime(
                myanmarTime
            );

        liveCache.updatedAt =
            Date.now();

        return true;

    } catch (error) {
        console.error(
            `${session} boundary capture error:`,
            error.message
        );

        return false;

    } finally {
        boundaryCaptureRunning =
            false;
    }
}

// -------------------------------------------------------------
// Myanmar time ကို အခြေခံပြီး နောက် boundary အချိန်ကို
// တိတိကျကျ setTimeout လုပ်သည်။
//
// Node timer သည် millisecond အတိအကျ guarantee မပေးနိုင်သော်လည်း
// boundary ရောက်ချိန်တွင် fetch ကို စတင်ရန် ရည်ရွယ်ထားသည်။
// -------------------------------------------------------------

function scheduleNextBoundaryCapture() {

    const now =
        getMyanmarTime();

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

        const candidate =
            new Date(now);

        candidate.setHours(
            t.hour,
            t.minute,
            t.second,
            0
        );

        if (
            candidate.getTime() >
            now.getTime()
        ) {
            target = {
                ...t,
                date: candidate
            };

            break;
        }
    }

    if (!target) {

        const candidate =
            new Date(now);

        candidate.setDate(
            candidate.getDate() + 1
        );

        candidate.setHours(
            12,
            1,
            0,
            0
        );

        target = {
            ...targets[0],
            date: candidate
        };
    }

    const delay =
        Math.max(
            0,
            target.date.getTime() -
            now.getTime()
        );

    console.log(
        `Next Myanmar boundary: ${target.session} | in ${Math.round(delay / 1000)} seconds`
    );

    setTimeout(
        async () => {

            // Server timer fires at the Myanmar boundary.
            if (!isWeekendMyanmar()) {

                await captureBoundaryResult(
                    target.session
                );

            } else {

                console.log(
                    `Boundary skipped: ${target.session} (Myanmar weekend)`
                );
            }

            scheduleNextBoundaryCapture();

        },
        delay
    );
}

// -------------------------------------------------------------
// Live cache updater
//
// User အများကြီးက /api/live ခေါ်လည်း SET website ကို
// server တစ်ခုတည်းကသာ 3 seconds တစ်ကြိမ် fetch လုပ်မည်။
// -------------------------------------------------------------

async function fetchAndUpdateLiveCache() {

    if (liveFetchRunning) {
        return;
    }

    liveFetchRunning = true;

    try {

        const result =
            await fetchCurrentSET();

        const myanmarTime =
            getMyanmarTime();

        const todayRecord =
            await getTodayAdminResults();

        liveCache = {

            setIndex:
                result.setIndex,

            value:
                result.marketValue,

            live2D:
                result.calculated2D,

            adminResults:
                todayRecord.schedule,

            schedule:
                getScheduleObject(
                    todayRecord.schedule
                ),

            notice:
                '2D Live အချက်အလက်များ ချိတ်ဆက်နေပါသည်။',

            time:
                formatCurrentTime(
                    myanmarTime
                ),

            updatedAt:
                Date.now()
        };

    } catch (error) {

        console.error(
            'Live data fetch error:',
            error.message
        );

        try {

            const myanmarTime =
                getMyanmarTime();

            const todayRecord =
                await getTodayAdminResults();

            const adminResults =
                todayRecord.schedule;

            // Cache မရှိသေးလျှင် သိမ်းပြီးသား boundary result ကို
            // fallback အဖြစ် ပြမည်။
            if (!liveCache.updatedAt) {

                let fallback2D =
                    '--';

                let fallbackSetIndex =
                    '--';

                let fallbackValue =
                    '--';

                const currentHour =
                    myanmarTime.getHours();

                const currentMinute =
                    myanmarTime.getMinutes();

                if (
                    currentHour >= 12 &&
                    currentHour < 14
                ) {

                    fallback2D =
                        todayRecord.t1201 !== '--'
                            ? todayRecord.t1201
                            : '--';

                    fallbackSetIndex =
                        todayRecord.setIndex1201 ||
                        '--';

                    fallbackValue =
                        todayRecord.value1201 ||
                        '--';

                } else if (

                    currentHour >= 16 ||

                    currentHour < 9 ||

                    (
                        currentHour === 9 &&
                        currentMinute < 30
                    ) ||

                    (
                        currentHour >= 14 &&
                        currentHour < 16
                    )

                ) {

                    if (
                        todayRecord.t430 &&
                        todayRecord.t430 !== '--'
                    ) {

                        fallback2D =
                            todayRecord.t430;

                        fallbackSetIndex =
                            todayRecord.setIndex430 ||
                            '--';

                        fallbackValue =
                            todayRecord.value430 ||
                            '--';

                    } else if (

                        todayRecord.t1201 &&
                        todayRecord.t1201 !== '--'

                    ) {

                        fallback2D =
                            todayRecord.t1201;

                        fallbackSetIndex =
                            todayRecord.setIndex1201 ||
                            '--';

                        fallbackValue =
                            todayRecord.value1201 ||
                            '--';
                    }
                }

                liveCache = {

                    setIndex:
                        fallbackSetIndex,

                    value:
                        fallbackValue,

                    live2D:
                        fallback2D,

                    adminResults:
                        adminResults,

                    schedule:
                        getScheduleObject(
                            adminResults
                        ),

                    notice:
                        '2D Live အချက်အလက်များ ချိတ်ဆက်နေပါသည်။',

                    time:
                        formatCurrentTime(
                            myanmarTime
                        ),

                    updatedAt:
                        0
                };

            } else {

                liveCache.adminResults =
                    adminResults;

                liveCache.schedule =
                    getScheduleObject(
                        adminResults
                    );
            }

        } catch (fallbackError) {

            console.error(
                'Live fallback error:',
                fallbackError.message
            );
        }

    } finally {

        liveFetchRunning =
            false;
    }
}

setInterval(
    fetchAndUpdateLiveCache,
    LIVE_FETCH_INTERVAL_MS
);

fetchAndUpdateLiveCache();

scheduleNextBoundaryCapture();

app.get('/api/live', (req, res) => {

    res.set(
        'Cache-Control',
        'no-store'
    );

    res.json({

        success: true,

        setIndex:
            liveCache.setIndex,

        value:
            liveCache.value,

        live2D:
            liveCache.live2D,

        adminResults:
            liveCache.adminResults || {},

        schedule:
            liveCache.schedule || {},

        notice:
            liveCache.notice,

        time:
            liveCache.time
    });
});

app.get('/api/chat', (req, res) => {

    res.json({

        success: true,

        messages:
            chatMessages
    });
});

app.post('/api/chat', (req, res) => {

    const {
        user,
        text
    } = req.body;

    if (text) {

        chatMessages.push({

            user:
                user || 'User',

            text
        });

        if (
            chatMessages.length > 50
        ) {
            chatMessages.shift();
        }
    }

    res.json({
        success: true
    });
});

app.listen(PORT, () => {

    console.log(
        `Server is running on port ${PORT}`
    );

    console.log(
        'Myanmar Timezone: Asia/Yangon'
    );

    console.log(
        'Morning boundary: 12:01:00 PM Myanmar Time'
    );

    console.log(
        'Afternoon boundary: 04:30:00 PM Myanmar Time'
    );
});