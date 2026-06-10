const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const VERIFY_TOKEN = "gdrti2024";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

// Söhbət yaddaşı
const conversations = {};
// Agent modu
const agentMode = {};

// ── Webhook yoxlama ──────────────────────────────────────────
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    res.send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

// ── Gələn mesajlar ───────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    if (!entry?.messages) return;

    const msg = entry.messages[0];
    const from = msg.from;
    const msgType = msg.type;

    // Yalnız mətn və səs mesajları
    if (!["text", "audio"].includes(msgType)) return;

    let userText = "";

    if (msgType === "text") {
      userText = msg.text.body;
    } else if (msgType === "audio") {
      // Səsli mesaj — transkript bildirişi
      userText = "[Vətəndaş səsli mesaj göndərdi. Zəhmət olmasa yazılı da bildirin]";
    }

    // Agent modu aktiv isə AI cavab verməsin
    if (agentMode[from]) return;

    // Söhbət tarixçəsi
    if (!conversations[from]) conversations[from] = [];
    conversations[from].push({ role: "user", content: userText });

    // Son 10 mesajı saxla
    if (conversations[from].length > 10) {
      conversations[from] = conversations[from].slice(-10);
    }

    // AI cavab al
    const aiReply = await getAIReply(from, conversations[from]);

    // Cavabı yadda saxla
    conversations[from].push({ role: "assistant", content: aiReply });

    // WhatsApp-a göndər
    await sendWhatsApp(from, aiReply);

    // Eskalasiya yoxla
    if (shouldEscalate(userText, conversations[from])) {
      await sendWhatsApp(from,
        "⚡ Sizi canlı əməkdaşımıza keçirirəm. Bir az gözləyin, tezliklə sizinlə əlaqə saxlanılacaq. 🙏"
      );
      agentMode[from] = true;
      // TODO: agent-ə bildiriş göndər (email/SMS)
      console.log(`🚨 ESKALASIYA: ${from} — agent lazımdır!`);
    }

  } catch (e) {
    console.error("Xəta:", e.message);
  }
});

// ── AI cavab funksiyası ──────────────────────────────────────
async function getAIReply(from, history) {
  const systemPrompt = `Sən Gəncə-Daşkəsən Regional Təhsil İdarəsinin rəsmi WhatsApp köməkçisisən.
Vətəndaşlara Azərbaycan, Rus və İngilis dillərində kömək edirsən.
Hansı dildə yazılıbsa, həmin dildə cavab ver.

Mövzular:
- Məktəb qeydiyyatı və köçürməsi
- Müəllim müraciətləri və sənədlər  
- İmtahan məlumatları (BİM, buraxılış)
- Şikayət və təkliflər
- Ünvan: Gəncə şəh., İstiqlaliyyət küç. 2
- İş saatları: B.e–Cümə, 09:00–18:00
- Telefon: (022) XXX-XX-XX

Qaydalar:
- Qısa və aydın cavab ver (maks 3 cümlə)
- Həmişə nəzakətli ol
- Bilmirsənsə "Bu barədə ətraflı məlumat üçün idarəmizə müraciət edin" de
- Heç vaxt yanlış məlumat vermə`;

  const resp = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: systemPrompt,
      messages: history,
    },
    {
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
    }
  );
  return resp.data.content[0].text;
}

// ── Eskalasiya məntiqi ───────────────────────────────────────
function shouldEscalate(text, history) {
  const triggers = [
    "insan", "agent", "əməkdaş", "canlı", "real",
    "человек", "оператор", "живой",
    "human", "agent", "person", "operator",
    "!!!", "kömək etmir", "anlamır", "olmur"
  ];
  const lowerText = text.toLowerCase();
  // Trigger sözü varsa
  if (triggers.some(t => lowerText.includes(t))) return true;
  // 5+ mesajdan sonra hələ həll olmayıbsa
  if (history.length >= 8) return true;
  return false;
}

// ── WhatsApp mesaj göndər ────────────────────────────────────
async function sendWhatsApp(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// ── Agent paneli üçün API ────────────────────────────────────
app.get("/conversations", (req, res) => {
  const list = Object.entries(conversations).map(([phone, msgs]) => ({
    phone,
    isAgent: !!agentMode[phone],
    lastMessage: msgs[msgs.length - 1]?.content?.slice(0, 60),
    count: msgs.length,
  }));
  res.json(list);
});

app.post("/agent-reply", async (req, res) => {
  const { phone, message } = req.body;
  await sendWhatsApp(phone, `👤 Əməkdaş: ${message}`);
  res.json({ ok: true });
});

app.post("/agent-done", (req, res) => {
  const { phone } = req.body;
  agentMode[phone] = false;
  res.json({ ok: true });
});

app.get("/", (req, res) => res.send("GDRTI Bot işləyir ✅"));

app.listen(3000, () => console.log("Bot port 3000-də işləyir"));
