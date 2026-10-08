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

/*
===========================================================
LIVE SETTINGS
===========================================================
*/

// ပုံမှန် Live data fetch
const LIVE_FETCH_INTERVAL_MS = 3000;

// Scheduler သည် 12:01:00 PM / 04:30:00 PM ကို
// မြန်မာစံတော်ချိန်အတိုင်း ဖမ်းမည်။
const MORNING_CAPTURE_HOUR = 12;
const MORNING_CAPTURE_MINUTE = 1;

const AFTERNOON_CAPTURE_HOUR = 16;
const AFTERNOON_CAPTURE_MINUTE = 30;


/*
===========================================================
LIVE CACHE
===========================================================
*/

let liveCache = {
    setIndex: "--",
    value: "--",
    live2D: "--",
    adminResults: null,
    schedule: null,
    notice: "2D Live အချက်အလက်များ ချိတ်ဆက်နေပါသည်။",
    time: "--",
    updatedAt: 0
};

let liveFetchRunning = false;


/*
===========================================================
MONGODB
===========================================================
*/

const MONGO_URI =
    process.env.MONGO_URI ||
    'mongodb+srv://clean2duser:cleanpass123@cluster0.aqs0zyr.mongodb.net/my2dapp?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('MongoDB successfully connected!');
    })
    .catch(err => {
        console.error(
            'MongoDB connection error:',
            err
        );
    });


/*
===========================================================
MONGODB SCHEMA
===========================================================
*/

const dataSchema = new mongoose.Schema({
    dateStr: {
        type: String,
        required: true,
        unique: true
    },

    dateFormatted: String,

    t1201: {
        type: String,
        default: "--"
    },

    t430: {
        type: String,
        default: "--"
    },

    setIndex1201: {
        type: String,
        default: "--"
    },

    value1201: {
        type: String,
        default: "--"
    },

    setIndex430: {
        type: String,
        default: "--"
    },

    value430: {
        type: String,
        default: "--"
    },

    schedule: {
        type: Object,

        default: {
            "09:30 AM": {
                modern: "--",
                internet: "--",
                tw: "--",
                isLocked: false
            },

            "12:01 PM": {
                modern: "--",
                internet: "--",
                tw: "--",
                isLocked: false,
                isAuto: true
            },

            "02:00 PM": {
                modern: "--",
                internet: "--",
                tw: "--",
                isLocked: false
            },

            "04:30 PM": {
                modern: "--",
                internet: "--",
                tw: "--",
                isLocked: false,
                isAuto: true
            }
        }
    }
});

const DayData =
    mongoose.model('DayData', dataSchema);


/*
===========================================================
ROUTES
===========================================================
*/

app.get('/', (req, res) => {
    res.sendFile(
        path.join(__dirname, 'index.html')
    );
});

app.get('/admin', (req, res) => {
    res.sendFile(
        path.join(__dirname, 'admin.html')
    );
});


/*
===========================================================
CHAT
===========================================================
*/

let chatMessages = [
    {
        user: "System",
        text: "2D Live Market App သို့ ကြိုဆိုပါသည်။"
    }
];


/*
===========================================================
MYANMAR TIME
===========================================================

Asia/Yangon ကို တိုက်ရိုက်သုံးထားသည်။

Render server timezone UTC ဖြစ်နေရင်လည်း
မြန်မာအချိန်မှန်အောင် အလုပ်လုပ်မည်။
===========================================================
*/

function getMyanmarParts() {

    const now = new Date();

    const formatter = new Intl.DateTimeFormat(
        'en-GB',
        {
            timeZone: 'Asia/Yangon',

            year: 'numeric',
            month: '2-digit',
            day: '2-digit',

            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',

            hourCycle: 'h23',

            weekday: 'long'
        }
    );

    const parts =
        formatter.formatToParts(now);

    const result = {};

    for (const part of parts) {
        if (part.type !== 'literal') {
            result[part.type] = part.value;
        }
    }

    return {
        year: Number(result.year),
        month: Number(result.month),
        day: Number(result.day),

        hour: Number(result.hour),
        minute: Number(result.minute),
        second: Number(result.second),

        weekday: result.weekday
    };
}


function getMyanmarTime() {

    const parts = getMyanmarParts();

    /*
      Date object တစ်ခုအဖြစ် ပြန်တည်ဆောက်ထားသည်။
      Myanmar time display အတွက်သာ အသုံးပြုမည်။
    */

    return new Date(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second
    );
}


function getMyanmarTimeText() {

    const parts =
        getMyanmarParts();

    const displayDate =
        new Date(
            2000,
            0,
            1,
            parts.hour,
            parts.minute,
            parts.second
        );

    return displayDate.toLocaleTimeString(
        'en-US',
        {
            hour12: true,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }
    );
}


/*
===========================================================
GET TODAY ADMIN RESULTS
===========================================================
*/

async function getTodayAdminResults() {

    const parts =
        getMyanmarParts();

    const todayDateStr =
        String(parts.day).padStart(2, '0') +
        '/' +
        String(parts.month).padStart(2, '0') +
        '/' +
        parts.year;

    let record =
        await DayData.findOne({
            dateStr: todayDateStr
        });

    if (!record) {

        record = new DayData({
            dateStr: todayDateStr,

            dateFormatted: todayDateStr,

            schedule: {
                "09:30 AM": {
                    modern: "--",
                    internet: "--",
                    tw: "--",
                    isLocked: false
                },

                "12:01 PM": {
                    modern: "--",
                    internet: "--",
                    tw: "--",
                    isLocked: false,
                    isAuto: true
                },

                "02:00 PM": {
                    modern: "--",
                    internet: "--",
                    tw: "--",
                    isLocked: false
                },

                "04:30 PM": {
                    modern: "--",
                    internet: "--",
                    tw: "--",
                    isLocked: false,
                    isAuto: true
                }
            }
        });

        await record.save();
    }

    return record;
}


/*
===========================================================
ADMIN LOGIN
===========================================================
*/

app.post('/api/admin/login', (req, res) => {

    const { password } =
        req.body;

    const adminPassword =
        process.env.ADMIN_PASSWORD ||
        '2dpro153791';

    if (
        password === adminPassword
    ) {

        return res.json({
            success: true,
            message: "Login successful"
        });
    }

    res.status(401).json({
        success: false,
        message:
            "စကားဝှက် (Password) မှားယွင်းနေပါသည်။"
    });
});


/*
===========================================================
ADMIN SAVE
===========================================================
*/

app.post('/api/admin/save', async (req, res) => {

    try {

        const {
            password,
            session,
            modern,
            internet,
            tw
        } = req.body;

        const adminPassword =
            process.env.ADMIN_PASSWORD ||
            '2dpro153791';

        if (
            password !== adminPassword
        ) {

            return res.status(401).json({
                success: false,
                message:
                    "ခွင့်ပြုချက်မရှိပါ (Unauthorized)"
            });
        }

        let todayRecord =
            await getTodayAdminResults();

        let adminResults =
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
                modern !== ""
            ) {
                adminResults[session].modern =
                    modern;
            }

            if (
                internet !== undefined &&
                internet !== ""
            ) {
                adminResults[session].internet =
                    internet;
            }

            if (
                tw !== undefined &&
                tw !== ""
            ) {
                adminResults[session].tw =
                    tw;
            }

            if (
                adminResults[session].modern !== "--" ||
                adminResults[session].internet !== "--" ||
                adminResults[session].tw !== "--"
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
                "မှားယွင်းနေသော Session ဖြစ်ပါသည်။"
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            message:
                "Server error occurred"
        });
    }
});


/*
===========================================================
ADMIN DATA
===========================================================
*/

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
            message:
                "Server error"
        });
    }
});


/*
===========================================================
HISTORY
===========================================================
*/

app.get('/api/history', async (req, res) => {

    try {

        const historyRecords =
            await DayData.find()
                .sort({ _id: -1 })
                .limit(100);

        res.json({
            success: true,
            history: historyRecords
        });

    } catch (err) {

        res.status(500).json({
            success: false,
            message:
                "Server error"
        });
    }
});


/*
===========================================================
SET WEBSITE FETCH
===========================================================

ဒီ function က SET website ကနေ
လက်ရှိ SET Index / Value / 2D ကို ရယူသည်။

IMPORTANT:
ဒီ function ထဲမှာ 12:01 / 04:30 lock မလုပ်တော့ပါ။

Lock ကို scheduler က boundary အတိအကျမှာသာ လုပ်မည်။
===========================================================
*/

async function fetchSetData() {

    let setIndex = '';
    let marketValue = '';
    let calculated2D = '--';

    const url =
        'https://www.set.or.th/en/home';

    const { data } =
        await axios.get(
            url,
            {
                timeout: 8000,

                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

                    'Accept-Language':
                        'en-US,en;q=0.9'
                }
            }
        );

    const $ =
        cheerio.load(data);


    /*
    ---------------------------------------------------------
    SET INDEX
    ---------------------------------------------------------
    */

    $('.mkt-info-value, .value, h3, span')
        .each((i, el) => {

            const text =
                $(el)
                    .text()
                    .trim();

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


    /*
    ---------------------------------------------------------
    MARKET VALUE
    ---------------------------------------------------------
    */

    $('tr, div, li')
        .each((i, el) => {

            const rowText =
                $(el)
                    .text()
                    .trim();

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

                items.each(
                    (j, subEl) => {

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
                    }
                );
            }
        });


    /*
    ---------------------------------------------------------
    CALCULATE 2D
    ---------------------------------------------------------
    */

    let digit1 = "--";
    let digit2 = "--";

    if (
        setIndex.includes('.')
    ) {

        const indexParts =
            setIndex.split('.');

        digit1 =
            indexParts[1].slice(-1);
    }

    if (
        marketValue.includes('.')
    ) {

        const valueParts =
            marketValue.split('.');

        const valueInteger =
            valueParts[0]
                .replace(/,/g, '');

        digit2 =
            valueInteger.slice(-1);
    }

    if (
        digit1 !== "--" &&
        digit2 !== "--"
    ) {

        calculated2D =
            digit1 + digit2;
    }

    return {
        setIndex:
            setIndex || "--",

        marketValue:
            marketValue || "--",

        calculated2D
    };
}


/*
===========================================================
NORMAL LIVE CACHE UPDATE
===========================================================

3 seconds တစ်ကြိမ် run မည်။

ဒါပေမယ့် 12:01 / 04:30 history lock ကို
ဒီ function က မလုပ်တော့ပါ။
===========================================================
*/

async function fetchAndUpdateLiveCache() {

    if (liveFetchRunning) {
        return;
    }

    liveFetchRunning = true;

    try {

        const result =
            await fetchSetData();

        const setIndex =
            result.setIndex;

        const marketValue =
            result.marketValue;

        const calculated2D =
            result.calculated2D;

        const currentTime =
            getMyanmarTimeText();

        const todayRecord =
            await getTodayAdminResults();

        const adminResults =
            todayRecord.schedule;


        /*
        -----------------------------------------------------
        NORMAL LIVE CACHE
        -----------------------------------------------------
        */

        liveCache = {

            setIndex:
                setIndex || "--",

            value:
                marketValue || "--",

            live2D:
                calculated2D,

            adminResults,

            schedule: {

                t0930:
                    adminResults["09:30 AM"],

                t1201:
                    adminResults["12:01 PM"],

                t1400:
                    adminResults["02:00 PM"],

                t1630:
                    adminResults["04:30 PM"]
            },

            notice:
                "2D Live အချက်အလက်များ ချိတ်ဆက်နေပါသည်။",

            time:
                currentTime,

            updatedAt:
                Date.now()
        };

    } catch (error) {

        console.error(
            "Live data fetch error:",
            error.message
        );

        /*
        -----------------------------------------------------
        KEEP LAST SUCCESSFUL CACHE
        -----------------------------------------------------
        */

        try {

            const todayRecord =
                await getTodayAdminResults();

            const adminResults =
                todayRecord.schedule;

            liveCache.adminResults =
                adminResults;

            liveCache.schedule = {

                t0930:
                    adminResults["09:30 AM"],

                t1201:
                    adminResults["12:01 PM"],

                t1400:
                    adminResults["02:00 PM"],

                t1630:
                    adminResults["04:30 PM"]
            };

        } catch (fallbackError) {

            console.error(
                "Live fallback error:",
                fallbackError.message
            );
        }

    } finally {

        liveFetchRunning = false;
    }
}


/*
===========================================================
EXACT BOUNDARY CAPTURE
===========================================================

ဒီ function ကို scheduler က

12:01:00 PM
04:30:00 PM

အချိန်ရောက်တဲ့အချိန်မှာ ခေါ်မည်။

အဓိကအချက်:
- Database ထဲက locked result ရှိပြီးသားဆို မပြောင်း
- ပထမဆုံး boundary capture ကိုသာ lock
- 3-second polling နောက်ပိုင်းမှာ မပြောင်းနိုင်
===========================================================
*/

let morningCaptureRunning = false;
let afternoonCaptureRunning = false;


async function captureMorningBoundary() {

    if (morningCaptureRunning) {
        return;
    }

    morningCaptureRunning = true;

    try {

        const myanmar =
            getMyanmarParts();

        /*
        Weekend မဖမ်းပါ။
        */

        if (
            myanmar.weekday === 'Saturday' ||
            myanmar.weekday === 'Sunday'
        ) {

            return;
        }


        /*
        -----------------------------------------------------
        SET ကို Boundary အချိန်မှာ fetch
        -----------------------------------------------------
        */

        const result =
            await fetchSetData();

        const setIndex =
            result.setIndex;

        const marketValue =
            result.marketValue;

        const calculated2D =
            result.calculated2D;


        if (
            calculated2D === "--"
        ) {

            console.error(
                "12:01 boundary capture failed: 2D result unavailable."
            );

            return;
        }


        const todayRecord =
            await getTodayAdminResults();

        const adminResults =
            todayRecord.schedule;


        /*
        -----------------------------------------------------
        12:01 PM AUTO LOCK
        -----------------------------------------------------
        */

        if (
            adminResults["12:01 PM"].modern === "--" &&
            !adminResults["12:01 PM"].isLocked
        ) {

            adminResults["12:01 PM"].modern =
                calculated2D;

            adminResults["12:01 PM"].internet =
                calculated2D;

            adminResults["12:01 PM"].tw =
                calculated2D;

            adminResults["12:01 PM"].isLocked =
                true;

            adminResults["12:01 PM"].isAuto =
                true;
        }


        /*
        -----------------------------------------------------
        HISTORY
        -----------------------------------------------------
        */

        if (
            todayRecord.t1201 === "--"
        ) {

            const admin0930 =
                adminResults["09:30 AM"].modern !== "--"
                    ? adminResults["09:30 AM"].modern
                    : (
                        adminResults["09:30 AM"].internet !== "--"
                            ? adminResults["09:30 AM"].internet
                            : "--"
                    );

            todayRecord.t1201 =
                `${admin0930} / ${calculated2D}`;

            todayRecord.setIndex1201 =
                setIndex;

            todayRecord.value1201 =
                marketValue;
        }


        /*
        -----------------------------------------------------
        DATE
        -----------------------------------------------------
        */

        const dayMap = {

            Sunday:
                "တနင်္ဂနွေ",

            Monday:
                "တနင်္လာ",

            Tuesday:
                "အင်္ဂါ",

            Wednesday:
                "ဗုဒ္ဓဟူး",

            Thursday:
                "ကြာသပတေး",

            Friday:
                "သောကြာ",

            Saturday:
                "စနေ"
        };

        const myanmarDay =
            dayMap[myanmar.weekday] ||
            myanmar.weekday;

        const dateString =
            `${myanmar.day} ${new Date(
                2000,
                myanmar.month - 1,
                1
            ).toLocaleString(
                'en-US',
                { month: 'long' }
            )} ${myanmar.year}`;

        todayRecord.dateFormatted =
            `${myanmarDay}\n${dateString}`;

        todayRecord.schedule =
            adminResults;

        todayRecord.markModified(
            'schedule'
        );

        await todayRecord.save();


        /*
        -----------------------------------------------------
        UPDATE CACHE
        -----------------------------------------------------
        */

        liveCache.adminResults =
            adminResults;

        liveCache.schedule = {

            t0930:
                adminResults["09:30 AM"],

            t1201:
                adminResults["12:01 PM"],

            t1400:
                adminResults["02:00 PM"],

            t1630:
                adminResults["04:30 PM"]
        };


        console.log(
            `[12:01:00 Myanmar Time] Morning result locked: ${calculated2D}`
        );

    } catch (error) {

        console.error(
            "12:01 boundary capture error:",
            error.message
        );

    } finally {

        morningCaptureRunning =
            false;
    }
}


async function captureAfternoonBoundary() {

    if (afternoonCaptureRunning) {
        return;
    }

    afternoonCaptureRunning = true;

    try {

        const myanmar =
            getMyanmarParts();


        /*
        -----------------------------------------------------
        WEEKEND
        -----------------------------------------------------
        */

        if (
            myanmar.weekday === 'Saturday' ||
            myanmar.weekday === 'Sunday'
        ) {

            return;
        }


        /*
        -----------------------------------------------------
        SET BOUNDARY FETCH
        -----------------------------------------------------
        */

        const result =
            await fetchSetData();

        const setIndex =
            result.setIndex;

        const marketValue =
            result.marketValue;

        const calculated2D =
            result.calculated2D;


        if (
            calculated2D === "--"
        ) {

            console.error(
                "04:30 boundary capture failed: 2D result unavailable."
            );

            return;
        }


        const todayRecord =
            await getTodayAdminResults();

        const adminResults =
            todayRecord.schedule;


        /*
        -----------------------------------------------------
        04:30 PM AUTO LOCK
        -----------------------------------------------------
        */

        if (
            adminResults["04:30 PM"].modern === "--" &&
            !adminResults["04:30 PM"].isLocked
        ) {

            adminResults["04:30 PM"].modern =
                calculated2D;

            adminResults["04:30 PM"].internet =
                calculated2D;

            adminResults["04:30 PM"].tw =
                calculated2D;

            adminResults["04:30 PM"].isLocked =
                true;

            adminResults["04:30 PM"].isAuto =
                true;
        }


        /*
        -----------------------------------------------------
        HISTORY
        -----------------------------------------------------
        */

        if (
            todayRecord.t430 === "--"
        ) {

            const admin0200 =
                adminResults["02:00 PM"].modern !== "--"
                    ? adminResults["02:00 PM"].modern
                    : (
                        adminResults["02:00 PM"].internet !== "--"
                            ? adminResults["02:00 PM"].internet
                            : "--"
                    );

            todayRecord.t430 =
                `${admin0200} / ${calculated2D}`;

            todayRecord.setIndex430 =
                setIndex;

            todayRecord.value430 =
                marketValue;
        }


        /*
        -----------------------------------------------------
        DATE
        -----------------------------------------------------
        */

        const dayMap = {

            Sunday:
                "တနင်္ဂနွေ",

            Monday:
                "တနင်္လာ",

            Tuesday:
                "အင်္ဂါ",

            Wednesday:
                "ဗုဒ္ဓဟူး",

            Thursday:
                "ကြာသပတေး",

            Friday:
                "သောကြာ",

            Saturday:
                "စနေ"
        };

        const myanmarDay =
            dayMap[myanmar.weekday] ||
            myanmar.weekday;

        const dateString =
            `${myanmar.day} ${new Date(
                2000,
                myanmar.month - 1,
                1
            ).toLocaleString(
                'en-US',
                { month: 'long' }
            )} ${myanmar.year}`;

        todayRecord.dateFormatted =
            `${myanmarDay}\n${dateString}`;

        todayRecord.schedule =
            adminResults;

        todayRecord.markModified(
            'schedule'
        );

        await todayRecord.save();


        /*
        -----------------------------------------------------
        UPDATE CACHE
        -----------------------------------------------------
        */

        liveCache.adminResults =
            adminResults;

        liveCache.schedule = {

            t0930:
                adminResults["09:30 AM"],

            t1201:
                adminResults["12:01 PM"],

            t1400:
                adminResults["02:00 PM"],

            t1630:
                adminResults["04:30 PM"]
        };


        console.log(
            `[04:30:00 Myanmar Time] Afternoon result locked: ${calculated2D}`
        );

    } catch (error) {

        console.error(
            "04:30 boundary capture error:",
            error.message
        );

    } finally {

        afternoonCaptureRunning =
            false;
    }
}


/*
===========================================================
MYANMAR TIME SCHEDULER
===========================================================

Server clock ဘယ် timezone ဖြစ်နေပါစေ
Asia/Yangon အတိုင်း target UTC time တွက်မည်။

12:01:00 Myanmar
04:30:00 Myanmar
===========================================================
*/

let morningSchedulerTimer = null;
let afternoonSchedulerTimer = null;


function getNextMyanmarBoundaryUTC(
    targetHour,
    targetMinute
) {

    const now =
        new Date();

    const myanmar =
        getMyanmarParts();


    /*
    Myanmar UTC offset = +06:30
    */

    const MYANMAR_OFFSET_MS =
        (6 * 60 * 60 * 1000) +
        (30 * 60 * 1000);


    /*
    ယနေ့ Myanmar calendar date ကို
    UTC midnight အဖြစ် တည်ဆောက်ပြီး
    + target time - 6:30 ကို ပြန်တွက်သည်။
    */

    let targetUTC =
        Date.UTC(
            myanmar.year,
            myanmar.month - 1,
            myanmar.day,
            targetHour,
            targetMinute,
            0,
            0
        ) - MYANMAR_OFFSET_MS;


    /*
    Target time ကျော်သွားပြီဆို
    နောက်နေ့ကို သွားမည်။
    */

    if (
        targetUTC <= now.getTime()
    ) {

        targetUTC =
            Date.UTC(
                myanmar.year,
                myanmar.month - 1,
                myanmar.day + 1,
                targetHour,
                targetMinute,
                0,
                0
            ) - MYANMAR_OFFSET_MS;
    }

    return targetUTC;
}


function scheduleMorningCapture() {

    if (
        morningSchedulerTimer
    ) {
        clearTimeout(
            morningSchedulerTimer
        );
    }

    const target =
        getNextMyanmarBoundaryUTC(
            MORNING_CAPTURE_HOUR,
            MORNING_CAPTURE_MINUTE
        );

    const delay =
        Math.max(
            1000,
            target - Date.now()
        );


    console.log(
        `Next 12:01 Myanmar capture scheduled in ${Math.round(delay / 1000)} seconds.`
    );


    morningSchedulerTimer =
        setTimeout(
            async () => {

                await captureMorningBoundary();

                /*
                နောက်တစ်နေ့ 12:01 အတွက်
                scheduler ပြန်တင်မည်။
                */

                scheduleMorningCapture();

            },
            delay
        );
}


function scheduleAfternoonCapture() {

    if (
        afternoonSchedulerTimer
    ) {
        clearTimeout(
            afternoonSchedulerTimer
        );
    }

    const target =
        getNextMyanmarBoundaryUTC(
            AFTERNOON_CAPTURE_HOUR,
            AFTERNOON_CAPTURE_MINUTE
        );

    const delay =
        Math.max(
            1000,
            target - Date.now()
        );


    console.log(
        `Next 04:30 Myanmar capture scheduled in ${Math.round(delay / 1000)} seconds.`
    );


    afternoonSchedulerTimer =
        setTimeout(
            async () => {

                await captureAfternoonBoundary();

                /*
                နောက်တစ်နေ့ 04:30 အတွက်
                scheduler ပြန်တင်မည်။
                */

                scheduleAfternoonCapture();

            },
            delay
        );
}


/*
===========================================================
NORMAL LIVE POLLING
===========================================================
*/

setInterval(
    fetchAndUpdateLiveCache,
    LIVE_FETCH_INTERVAL_MS
);


/*
===========================================================
SERVER START INITIAL FETCH
===========================================================
*/

fetchAndUpdateLiveCache();


/*
===========================================================
START EXACT MYANMAR BOUNDARY SCHEDULERS
===========================================================
*/

scheduleMorningCapture();

scheduleAfternoonCapture();


/*
===========================================================
API LIVE
===========================================================
*/

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


/*
===========================================================
CHAT GET
===========================================================
*/

app.get('/api/chat', (req, res) => {

    res.json({

        success: true,

        messages:
            chatMessages
    });
});


/*
===========================================================
CHAT POST
===========================================================
*/

app.post('/api/chat', (req, res) => {

    const {
        user,
        text
    } = req.body;

    if (text) {

        chatMessages.push({

            user:
                user || "User",

            text:
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


/*
===========================================================
SERVER START
===========================================================
*/

app.listen(
    PORT,
    () => {

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
    }
);