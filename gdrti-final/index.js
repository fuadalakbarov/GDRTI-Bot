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
      await sendWhatsApp(from, "Sizi canlı əməkdaşımıza keçirirəm. Bir az gözləyin.");
      agentMode[from] = true;
      console.log("ESKALASIYA: " + from);
    }
  } catch (e) {
    console.error("Xeta:", e.message);
  }
});

async function getGroqReply(history) {
  const systemMsg = {
    role: "system",
    content: `Sen Gence-Daskesen Regional Tehsil Idaresinin resmi WhatsApp komekcisisən.
Vetendaslara yalniz tehsille bagli meselelerde komek edirsən.
Hansi dilde yazilib (Azerbaycan, Rus, İngilis) hemin dilde cavab ver.
Azerbaycan dilinde yazilsa, Azerbaycan dilinde cavab ver.

IDARE HAQQINDA:
- Tam adi: Gence-Daskesen Regional Tehsil Idaresi  
- Unvan: Gence seheri, Ataturk prospekti ve M.Haciyev kucesinin kesismesi
- Telefon: 146-0-2
- WhatsApp: (050) 347 87 02
- E-pocht: info@ganja.edu.gov.az
- Web sayt: ganja.edu.gov.az
- Is saatlari: Bazar ertesi - Cume, 09:00-18:00
- Mudirin qebul gunu: Cersembe, 15:00-17:00

MEXTEBLE QEBUL (1-ci sinif):
- Elektron qebul portali: www.mektebeqebul.edu.az
- 7 yasini tamam eden usaqlar qebul olunur
- Mextebehazirliq qrupundaki usaqlar avtomatik I sinfe kecir
- Qeydiyyat ucun usagin sexsiyyet vesiqesi lazimdir
- Azerbaycan bolmesi ucun: 6 may - 5 iyun arasinda muraciet

MUELLIM ISE QEBUL:
- Muellim sertifikasiya imtahani teleb olunur
- Elanlar: ganja.edu.gov.az saytinda
- Muraciet: idarenin karguzarliq seksiyasina

SIKAYET VE MURACIETLER:
- WhatsApp: (050) 347 87 02
- Elektron: info@ganja.edu.gov.az  
- Sexsi qebul: Cersembe 15:00-17:00
- Telefonla: 146-0-2

QAYDALAR:
- Qisa, aydın ve nezaketli cavab ver (max 3-4 cumlə)
- Bilmediyinde: "Bu barede 146-0-2 nomresine zeng edin ve ya info@ganja.edu.gov.az unvanina yazin" de
- Hec vaxt uydurmaca melumat verme
- Mudaxile etme, yalniz tehsille bagli sualara cavab ver`
  };

  const resp = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: "llama-3.3-70b-versatile",
      messages: [systemMsg, ...history],
      max_tokens: 400,
      temperature: 0.3
    },
    {
      headers: {
        Authorization: "Bearer " + GROQ_KEY,
        "Content-Type": "application/json"
      }
    }
  );
  return resp.data.choices[0].message.content;
}

function shouldEscalate(text, history) {
  const triggers = ["insan", "agent", "emedcas", "canli", "isci", "operator",
                    "chelovek", "operator", "zhivoy", "human", "live", "!!!",
                    "komeyek etmir", "anlamır", "olmur", "bacarmır"];
  if (triggers.some(t => text.toLowerCase().includes(t))) return true;
  if (history.length >= 8) return true;
  return false;
}

async function sendWhatsApp(to, text) {
  await axios.post(
    "https://graph.facebook.com/v19.0/" + PHONE_NUMBER_ID + "/messages",
    { messaging_product: "whatsapp", to, type: "text", text: { body: text } },
    { headers: { Authorization: "Bearer " + WHATSAPP_TOKEN, "Content-Type": "application/json" } }
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
  await sendWhatsApp(phone, "Emedcas: " + message);
  res.json({ ok: true });
});

app.post("/agent-done", (req, res) => {
  agentMode[req.body.phone] = false;
  res.json({ ok: true });
});

app.get("/", (req, res) => res.send("GDRTI Bot isleyir"));
app.listen(3000, () => console.log("Bot 3000-de isleyir"));
