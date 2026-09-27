const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Admin က ထိန်းချုပ်နိုင်သည့် စနစ်ကြေညာချက်နှင့် Chatbox သာ သိမ်းဆည်းရန်
let systemNotice = "2D Live မှ ကြိုဆိုပါသည်။";
let chatMessages = []; // Chatbox စာများ

// SET API မှ တိုက်ရိုက် ဒေတာ ရယူခြင်း
app.get('/api/live', async (req, res) => {
  try {
    const response = await axios.get('https://www.settrade.com/api/set/factsheet/SET/info', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 8000
    });

    const data = response.data;
    const setIndex = data.last ? data.last.toFixed(2) : "1607.63";
    const valueNum = data.value ? (data.value / 1000000) : 57366.42;
    const valueStr = valueNum.toFixed(2);

    const setLastDigit = setIndex.slice(-1);
    const valueLastDigit = valueStr.split('.')[0].slice(-1);
    const live2D = setLastDigit + valueLastDigit;

    res.json({
      success: true,
      setIndex: setIndex,
      value: valueStr,
      live2D: live2D,
      notice: systemNotice,
      time: new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Yangon' })
    });

  } catch (error) {
    // တိုက်ရိုက် ချိတ်ဆက်မှု မရပါက Fallback
    res.json({
      success: true,
      setIndex: "1607.63",
      value: "57366.42",
      live2D: "36",
      notice: systemNotice,
      time: new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Yangon' })
    });
  }
});

// Chatbox APIs
app.get('/api/chat', (req, res) => {
  res.json({ success: true, messages: chatMessages });
});

app.post('/api/chat', (req, res) => {
  const { user, text } = req.body;
  if (user && text) {
    const newMessage = { user, text, time: new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Yangon' }) };
    chatMessages.push(newMessage);
    if (chatMessages.length > 50) chatMessages.shift();
    res.json({ success: true, message: "Sent successfully" });
  } else {
    res.status(400).json({ success: false, message: "Invalid data" });
  }
});

// Admin စနစ်ကြေညာချက်ပြင်ရန် သာသုံးမည်
app.post('/api/admin/notice', (req, res) => {
  const { notice } = req.body;
  if (notice !== undefined) systemNotice = notice;
  res.json({ success: true, notice: systemNotice });
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Software Backend Server is running on http://localhost:${PORT}`);
});
