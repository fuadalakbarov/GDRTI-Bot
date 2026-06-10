const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const VERIFY_TOKEN = "gdrti2024";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GROQ_KEY = process.env.GROQ_KEY;

const conversations = {};
const agentMode = {};

app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    res.send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    if (!entry?.messages) return;
    const msg = entry.messages[0];
    const from = msg.from;
    if (!["text", "audio"].includes(msg.type)) return;

    let userText = msg.type === "text"
      ? msg.text.body
      : "[Vətəndaş səsli mesaj göndərdi. Zəhmət olmasa yazılı da bildirin]";

    if (agentMode[from]) return;

    if (!conversations[from]) conversations[from] = [];
    conversations[from].push({ role: "user", content: userText });
    if (conversations[from].length > 10) conversations[from] = conversations[from].slice(-10);

    const aiReply = await getGroqReply(conversations[from]);
    conversations[from].push({ role: "assistant", content: aiReply });

    await sendWhatsApp(from, aiReply);

    if (shouldEscalate(userText, conversations[from])) {
      await sendWhatsApp(from, "⚡ Sizi canlı əməkdaşımıza keçirirəm. Bir az gözləyin 🙏");
      agentMode[from] = true;
      console.log(`🚨 ESKALASIYA: ${from}`);
    }
  } catch (e) {
    console.error("Xəta:", e.message);
  }
});

async function getGroqReply(history) {
  const systemMsg = {
    role: "system",
    content: `Sən Gəncə-Daşkəsən Regional Təhsil İdarəsinin rəsmi WhatsApp köməkçisisən.
Vətəndaşlara yalnız təhsillə bağlı məsələlərdə kömək edirsən.
Hansı dildə yazılıbsa (Azərbaycan, Rus, İngilis) həmin dildə cavab ver.

İdarə haqqında rəsmi məlumat:
- Tam adı: Gəncə-Daşkəsən Regional Təhsil İdarəsi
- Ünvan: Gəncə şəhəri, Atatürk prospekti və M.Hacıyev küçəsinin kəsişməsi
- Telefon: 146-0-2
- WhatsApp: (050) 347 87 02
- E-poçt: info@ganja.edu.gov.az
- Veb sayt: ganja.edu.gov.az
- İş saatları: Bazar ertəsi - Cümə, 09:00 - 18:00
- Müdirin qəbul günü: Çərşənbə, 15:00 - 17:00

Xidmətlər:
- Məktəbə qeydiyyat və şagird köçürməsi
- Müəllim işə qəbulu və sənəd təqdimi
- Məktəbəqədər təhsil müəssisələri
- Buraxılış və imtahan məlumatları
- Şikayət və təkliflər
- Psixoloji dəstək xidməti
- Gənclərin çağırışaqədərki hazırlığı

Qaydalar:
- Yalnız təhsil mövzusunda cavab ver
- Qısa, aydın və nəzakətli cavab ver (maks 4 cümlə)
- Bilmədiyin məsələdə: "Bu barədə ətraflı məlumat üçün 146-0-2 nömrəsinə zəng edin və ya info@ganja.edu.gov.az ünvanına yazın" de
- Heç vaxt uydurma məlumat vermə`
  };

  const resp = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: "llama-3.1-8b-instant",
      messages: [systemMsg, ...history],
      max_tokens: 400
    },
    {
      headers: {
        Authorization: `Bearer ${GROQ_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );
  return resp.data.choices[0].message.content;
}

function shouldEscalate(text, history) {
  const triggers = ["insan", "agent", "əməkdaş", "canlı", "işçi", "operator",
                    "человек", "оператор", "живой", "human", "operator", "!!!"];
  if (triggers.some(t => text.toLowerCase().includes(t))) return true;
  if (history.length >= 8) return true;
  return false;
}

async function sendWhatsApp(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    { messaging_product: "whatsapp", to, type: "text", text: { body: text } },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
  );
}

app.get("/conversations", (req, res) => {
  res.json(Object.entries(conversations).map(([phone, msgs]) => ({
    phone, isAgent: !!agentMode[phone],
    lastMessage: msgs[msgs.length - 1]?.content?.slice(0, 60),
    count: msgs.length
  })));
});

app.post("/agent-reply", async (req, res) => {
  const { phone, message } = req.body;
  await sendWhatsApp(phone, `👤 Əməkdaş: ${message}`);
  res.json({ ok: true });
});

app.post("/agent-done", (req, res) => {
  agentMode[req.body.phone] = false;
  res.json({ ok: true });
});

app.get("/", (req, res) => res.send("GDRTI Bot işləyir ✅"));
app.listen(3000, () => console.log("Bot 3000-də işləyir"));
