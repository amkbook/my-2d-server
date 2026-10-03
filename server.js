const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Chat messages သိမ်းဆည်းရန် Array
let chatMessages = [
    { user: "System", text: "2D Live Market App သို့ ကြိုဆိုပါသည်။" }
];

// SET market data ကို တိုက်ရိုက် Scrape လုပ်မည့် Endpoint
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

        // 1. SET Index ကို ရှာဖွေခြင်း
        $('.mkt-info-value, .value, h3, span').each((i, el) => {
            const text = $(el).text().trim();
            if (text.includes('.') && text.length >= 6 && text.length <= 10 && !setIndex) {
                if (!isNaN(text.replace(/,/g, ''))) {
                    setIndex = text;
                }
            }
        });

        // 2. ပင်မ SET တန်း၏ Value (M.Baht) ကို တိကျစွာ ရှာဖွေခြင်း
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

        // မြန်မာစံတော်ချိန် (UTC +6:30)
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
            setIndex: setIndex || "--",
            value: marketValue || "--",
            live2D: calculated2D,
            notice: "2D Live အချက်အလက်များ ချိတ်ဆက်နေပါသည်။",
            time: currentTime
        });

    } catch (error) {
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const myanmarTime = new Date(utc + (3600000 * 6.5));
        const currentTime = myanmarTime.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });

        res.json({
            success: true,
            setIndex: "--",
            value: "--",
            live2D: "--",
            notice: "ဈေးကွက်ပိတ်ထားသည် (သို့) ချိတ်ဆက်မှု စောင့်ဆိုင်းနေသည်...",
            time: currentTime
        });
    }
});

// Chat GET Endpoint
app.get('/api/chat', (req, res) => {
    res.json({
        success: true,
        messages: chatMessages
    });
});

// Chat POST Endpoint
app.post('/api/chat', express.json(), (req, res) => {
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