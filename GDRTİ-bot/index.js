const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const VERIFY_TOKEN = "gdrti2024";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_KEY = process.env.GEMINI_KEY;

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
    conversations[from].push({ role: "user", parts: [{ text: userText }] });
    if (conversations[from].length > 10) conversations[from] = conversations[from].slice(-10);

    const aiReply = await getGeminiReply(conversations[from]);
    conversations[from].push({ role: "model", parts: [{ text: aiReply }] });

    await sendWhatsApp(from, aiReply);

    if (shouldEscalate(userText, conversations[from])) {
      await sendWhatsApp(from, "⚡ Sizi canlı əməkdaşımıza keçirirəm. Bir az gözləyin 🙏");
      agentMode[from] = true;
    }
  } catch (e) {
    console.error("Xəta:", e.message);
  }
});

async function getGeminiReply(history) {
  const systemText = `Sən Gəncə-Daşkəsən Regional Təhsil İdarəsinin WhatsApp köməkçisisən.
Hansı dildə yazılıbsa (Azərbaycan/Rus/İngilis) həmin dildə cavab ver.
Mövzular: məktəb qeydiyyatı, müəllim müraciətləri, imtahan məlumatları, şikayətlər.
Ünvan: Gəncə şəh., İstiqlaliyyət küç. 2. İş saatları: B.e-Cümə 09:00-18:00.
Qısa və nəzakətli cavab ver (maks 3 cümlə).`;

  const resp = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      system_instruction: { parts: [{ text: systemText }] },
      contents: history,
      generationConfig: { maxOutputTokens: 300 }
    }
  );
  return resp.data.candidates[0].content.parts[0].text;
}

function shouldEscalate(text, history) {
  const triggers = ["insan", "agent", "əməkdaş", "canlı", "человек", "оператор", "human", "operator", "!!!"];
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
    lastMessage: msgs[msgs.length - 1]?.parts?.[0]?.text?.slice(0, 60),
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
