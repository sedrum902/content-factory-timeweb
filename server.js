import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import multer from "multer";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
dotenv.config({ path: "timeweb-env-ready.env" });

process.on("uncaughtException", (err) => {
  console.error("КРИТИЧЕСКАЯ ОШИБКА ПРИ СТАРТЕ:", err);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const DEFAULT_AI_MODEL = process.env.DEFAULT_MODEL || process.env.DEFAULT_AI_MODEL || "timeweb-agent";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 200);
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 180000);
const AI_MAX_TOKENS = Number(process.env.AI_MAX_TOKENS || 8000);

const TIMEWEB_API_KEY = process.env.TIMEWEB_API_KEY || process.env.TIMEWEB_KEY || "";
const TIMEWEB_AGENT_ID = process.env.TIMEWEB_AGENT_ID || "";

let DATA_DIR = process.env.DATA_DIR;

if (!DATA_DIR) {
  const localDataDir = path.join(process.cwd(), "data");
  try {
    if (!fs.existsSync(localDataDir)) {
      fs.mkdirSync(localDataDir, { recursive: true });
    }
    // Проверяем возможность записи в эту папку
    const testFile = path.join(localDataDir, ".write_test");
    fs.writeFileSync(testFile, "test", "utf8");
    fs.unlinkSync(testFile);
    DATA_DIR = localDataDir;
  } catch (e) {
    // Если папка read-only (как на Timeweb без смонтированного диска), откатываемся на /tmp
    console.warn("Локальная папка data недоступна для записи, используем /tmp/content-factory-data:", e.message);
    DATA_DIR = path.join("/tmp", "content-factory-data");
  }
}

const usersFile = path.join(DATA_DIR, "users.json");
const uploadsDir = path.join(DATA_DIR, "uploads");

for (const dir of [DATA_DIR, uploadsDir]) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.error("Ошибка создания папки:", dir, e.message);
  }
}

// Автоматическая генерация и сохранение надежного секрета сессий при первом запуске
let APP_SECRET = process.env.APP_SECRET;
if (!APP_SECRET) {
  const secretFile = path.join(DATA_DIR, "secret.key");
  try {
    if (fs.existsSync(secretFile)) {
      APP_SECRET = fs.readFileSync(secretFile, "utf8").trim();
    } else {
      APP_SECRET = crypto.randomBytes(32).toString("hex");
      fs.writeFileSync(secretFile, APP_SECRET, "utf8");
    }
  } catch (e) {
    console.error("Не удалось прочитать или записать secret.key, используем временный секрет:", e.message);
    APP_SECRET = "temp_fallback_secret_string_not_secure";
  }
}

const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((item) => item.trim()).filter(Boolean)
  : true;

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(uploadsDir));

const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeRegex = /^(image|video)\//i;
    const allowedExts = [
      ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".heic",
      ".mp4", ".mov", ".avi", ".webm", ".mkv", ".mpeg", ".mpg", ".3gp"
    ];
    
    const ext = path.extname(file.originalname || "").toLowerCase();
    const isMimeValid = allowedMimeRegex.test(file.mimetype || "");
    const isExtValid = allowedExts.includes(ext);

    if (isMimeValid && isExtValid) {
      cb(null, true);
    } else {
      cb(new Error("Недопустимый тип файла. Разрешены только изображения и видео."));
    }
  }
});

function baseUrlFromRequest(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  return `${proto}://${req.get("host")}`;
}

function loadStore() {
  try {
    if (!fs.existsSync(usersFile)) return { users: [] };
    const raw = fs.readFileSync(usersFile, "utf8");
    const data = JSON.parse(raw || "{}");
    return { users: Array.isArray(data.users) ? data.users : [] };
  } catch (error) {
    console.error("Ошибка чтения users.json:", error);
    return { users: [] };
  }
}

function saveStore(store) {
  const tmp = `${usersFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, usersFile);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || "").split(":");
  if (!salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function encryptionKey() {
  return crypto.createHash("sha256").update(APP_SECRET).digest();
}

function encryptSecret(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptSecret(value) {
  const raw = String(value || "");
  if (!raw) return "";
  if (!raw.startsWith("enc:v1:")) return raw;

  try {
    const [, , ivRaw, tagRaw, encryptedRaw] = raw.split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivRaw, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final()
    ]);
    return decrypted.toString("utf8");
  } catch (error) {
    console.error("Ошибка расшифровки секрета:", error.message);
    return "";
  }
}

function defaultUserSettings() {
  return {
    openaiApiKeyEnc: "",
    model: DEFAULT_AI_MODEL,
    telegramBotTokenEnc: "",
    telegramChatId: ""
  };
}

function getPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt
  };
}

function getUserSettingsForServer(user) {
  const settings = { ...defaultUserSettings(), ...(user.settings || {}) };
  return {
    openaiApiKey: TIMEWEB_API_KEY,
    model: settings.model || DEFAULT_AI_MODEL,
    telegramBotToken: decryptSecret(settings.telegramBotTokenEnc) || process.env.TELEGRAM_BOT_TOKEN || "",
    telegramChatId: settings.telegramChatId || process.env.TELEGRAM_CHAT_ID || ""
  };
}

function getUserSettingsForClient(user) {
  const serverSettings = getUserSettingsForServer(user);
  
  const maskKey = (key) => {
    if (!key) return "";
    if (key.length <= 8) return "***";
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  };

  return {
    openaiApiKey: maskKey(serverSettings.openaiApiKey),
    model: serverSettings.model,
    telegramBotToken: maskKey(serverSettings.telegramBotToken),
    telegramChatId: serverSettings.telegramChatId
  };
}

let resolvedTimewebAgentId = "";

async function resolveTimewebAgentId(apiKey, agentId) {
  const rawAgentId = String(agentId || "").trim();
  if (!rawAgentId) return rawAgentId;
  if (resolvedTimewebAgentId) return resolvedTimewebAgentId;

  // Timeweb management API returns both an internal numeric id and access_id.
  // The call endpoint expects access_id, so we resolve common wrong values once.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawAgentId)) {
    resolvedTimewebAgentId = rawAgentId;
    return resolvedTimewebAgentId;
  }

  try {
    const response = await fetch("https://api.timeweb.cloud/api/v1/cloud-ai/agents", {
      headers: {
        "Authorization": `Bearer ${apiKey}`
      }
    });
    if (!response.ok) return rawAgentId;

    const data = await response.json();
    const agents = Array.isArray(data?.agents) ? data.agents : [];
    const found = agents.find((agent) => {
      const id = String(agent.id || "");
      const accessId = String(agent.access_id || "");
      const name = String(agent.name || "");
      return rawAgentId === id || rawAgentId === accessId || rawAgentId === name || rawAgentId.includes(name);
    });

    if (found?.access_id) {
      resolvedTimewebAgentId = String(found.access_id);
      return resolvedTimewebAgentId;
    }
  } catch (error) {
    console.warn("Не удалось получить access_id агента Timeweb:", error.message);
  }

  return rawAgentId;
}

async function callTimewebAgentApi(apiKey, agentId, payload, options = {}) {
  const activeAgentId = await resolveTimewebAgentId(apiKey, agentId);
  const url = `https://api.timeweb.cloud/api/v1/cloud-ai/agents/${encodeURIComponent(activeAgentId)}/call`;
  const messages = payload.messages || [];
  
  // Собираем системные инструкции и пользовательский промпт в единый текст для агента
  let combinedPrompt = "";
  for (const msg of messages) {
    if (msg.role === "system") {
      combinedPrompt += `[Системная инструкция]\n${msg.content}\n\n`;
    } else if (msg.role === "user") {
      combinedPrompt += `[Запрос пользователя]\n${msg.content}\n`;
    } else {
      combinedPrompt += `${msg.content}\n`;
    }
  }

  const body = {
    message: combinedPrompt
  };

  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };

  const fetchPromise = fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(body)
  }).then(async (response) => {
    const errText = await response.text();
    let parsedData;
    try {
      parsedData = JSON.parse(errText);
    } catch {
      parsedData = { error: { message: errText } };
    }

    if (!response.ok) {
      throw new Error(parsedData?.error?.message || parsedData?.message || `Ошибка API Timeweb (${response.status})`);
    }
    return parsedData;
  });

  const data = await withTimeout(
    fetchPromise,
    AI_TIMEOUT_MS,
    `Timeweb Cloud AI Agent (${agentId})`
  );

  const text = data?.message || "";
  if (!text) {
    throw new Error("Timeweb Cloud AI Agent не вернул текстовый ответ");
  }

  return {
    completion: {
      choices: [
        {
          message: {
            content: text
          }
        }
      ]
    },
    provider: "Timeweb Cloud AI Agent",
    model: activeAgentId
  };
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", APP_SECRET)
    .update(body)
    .digest("base64url");

  return `${body}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes(".")) return null;

  const [body, signature] = token.split(".");
  const expected = crypto
    .createHmac("sha256", APP_SECRET)
    .update(body)
    .digest("base64url");

  try {
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function createUserToken(user) {
  return signToken({
    sub: user.id,
    email: user.email,
    role: "user",
    iat: Date.now(),
    exp: Date.now() + 1000 * 60 * 60 * 24 * 14
  });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = verifyToken(token);

  if (!payload?.sub) {
    return res.status(401).json({
      error: "Нет доступа. Войди заново."
    });
  }

  const store = loadStore();
  const user = store.users.find((item) => item.id === payload.sub);

  if (!user) {
    return res.status(401).json({
      error: "Аккаунт не найден. Войди заново."
    });
  }

  req.user = user;
  req.store = store;
  next();
}

function stripAiReasoning(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .trim();
}

function tryParseJson(value) {
  if (!value) return null;

  let text = stripAiReasoning(value)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const attempts = [
    text,
    text.replace(/,\s*([}\]])/g, "$1"),
    text.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'")
  ];

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {}
  }

  return null;
}

function balancedJsonCandidates(text) {
  const source = stripAiReasoning(text);
  const candidates = [];
  const openers = new Set(["{", "["]);
  const closers = { "{": "}", "[": "]" };

  for (let start = 0; start < source.length; start++) {
    const first = source[start];
    if (!openers.has(first)) continue;

    const stack = [closers[first]];
    let inString = false;
    let escaped = false;

    for (let i = start + 1; i < source.length; i++) {
      const ch = source[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (openers.has(ch)) {
        stack.push(closers[ch]);
        continue;
      }

      if (ch === stack[stack.length - 1]) {
        stack.pop();
        if (!stack.length) {
          candidates.push(source.slice(start, i + 1));
          break;
        }
      }
    }
  }

  return candidates;
}

function extractJson(text) {
  const cleaned = stripAiReasoning(text);

  const direct = tryParseJson(cleaned);
  if (direct) return direct;

  const fencedBlocks = [...cleaned.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1]);
  for (const block of fencedBlocks) {
    const parsed = tryParseJson(block);
    if (parsed) return parsed;
  }

  for (const candidate of balancedJsonCandidates(cleaned)) {
    const parsed = tryParseJson(candidate);
    if (parsed) return parsed;
  }

  throw new Error("AI вернул не JSON. Сервер не нашёл JSON-объект в ответе модели.");
}

function safeScore(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(100, Math.round(number)));
}

function normalizeIdeas(data) {
  const ideas = Array.isArray(data)
    ? data
    : Array.isArray(data?.ideas)
      ? data.ideas
      : Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.contentIdeas)
          ? data.contentIdeas
          : [];

  return ideas.map((item, index) => {
    const title = String(item.title || item.hook || item.headline || item.name || `Идея ${index + 1}`).trim();
    const angle = String(item.angle || item.type || "AI-угол").trim();
    const score = safeScore(item.score, 90 - index);
    const pillar = String(item.pillar || item.category || item.rubric || "Контент").trim();
    const rawFormats = item.formats || {};
    const rawTelegram = rawFormats.telegram || item.telegram || {};
    const rawInstagram = rawFormats.instagram || item.instagram || item.reels || {};
    const rawYoutube = rawFormats.youtube || item.youtube || item.shorts || {};
    const body = String(item.body || item.text || item.description || item.explanation || "").trim();
    const tags = String(item.tags || "").trim();

    const formats = {
      telegram: {
        format: String(rawTelegram.format || "Пост").trim(),
        headline: String(rawTelegram.headline || rawTelegram.title || title).trim(),
        body: String(rawTelegram.body || rawTelegram.text || body || title).trim(),
        tags: String(rawTelegram.tags || tags || "").trim()
      },
      instagram: {
        format: String(rawInstagram.format || "Reels, 30-45 секунд").trim(),
        headline: String(rawInstagram.headline || rawInstagram.title || title).trim(),
        body: String(rawInstagram.body || rawInstagram.text || body || `Сценарий: ${title}`).trim(),
        tags: String(rawInstagram.tags || tags || "").trim()
      },
      youtube: {
        format: String(rawYoutube.format || "Shorts, 30-45 секунд").trim(),
        headline: String(rawYoutube.headline || rawYoutube.title || title).trim(),
        body: String(rawYoutube.body || rawYoutube.text || body || `Сценарий: ${title}`).trim(),
        tags: String(rawYoutube.tags || tags || "").trim()
      }
    };

    return {
      title,
      angle,
      score,
      pillar,
      status: "Готово",
      formats
    };
  }).filter((item) => item.title && item.title !== "Идея");
}

function uniqueTexts(list) {
  const seen = new Set();
  return list.filter((item) => {
    const key = item.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fallbackIdeasFromText(text, ideaCount, project = {}) {
  const cleaned = stripAiReasoning(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[{}\[\]"]/g, " ")
    .replace(/\r/g, "\n");

  const rawLines = cleaned
    .split(/\n+/)
    .map((line) => line
      .replace(/^\s*(?:[-*•]|\d+[.)]|#+)\s*/g, "")
      .replace(/^(title|headline|hook|идея|хук|заголовок)\s*[:\u2014-]\s*/i, "")
      .trim())
    .filter((line) => line.length >= 12 && line.length <= 180)
    .filter((line) => !/^(json|формат|rules|правила|```)/i.test(line));

  const titles = uniqueTexts(rawLines).slice(0, ideaCount);
  const seed = [
    project.pain ? `Почему ${project.pain} и где бизнес теряет деньги` : "Почему контент не приводит заявки",
    project.offer ? `Как работает связка: ${project.offer}` : "Как собрать контент, который ведёт к заявке",
    project.common ? `Главная ошибка в теме: ${project.common}` : "Главная ошибка в воронке контента",
    project.proof ? `Что доказывает результат: ${project.proof}` : "Какие доказательства нужны аудитории перед заявкой",
    project.audience ? `Что важно показать аудитории: ${project.audience}` : "Что показать клиенту до первого контакта"
  ];

  const finalTitles = uniqueTexts([...titles, ...seed]).slice(0, Math.max(1, Math.min(ideaCount, 20)));

  return finalTitles.map((title, index) => {
    const body = [
      `Хук: ${title}.`,
      project.pain ? `Проблема: ${project.pain}.` : "Проблема: человек не видит конкретной причины доверять и оставлять заявку.",
      project.proof ? `Механизм: ${project.proof}.` : "Механизм: показать боль, причину потери денег и понятный следующий шаг.",
      project.offer ? `Переход к офферу: ${project.offer}.` : "Переход к офферу: предложить расчёт, разбор или подбор решения."
    ].join("\n");

    return {
      title,
      angle: index % 2 ? "Разбор ошибки" : "Боль клиента",
      score: 90 - index,
      pillar: project.common || "Контент",
      status: "Собрано из ответа AI",
      formats: {
        telegram: {
          format: "Пост",
          headline: title,
          body,
          tags: ""
        },
        instagram: {
          format: "Reels, 30-45 секунд",
          headline: title,
          body: `Кадр 1: ${title}\nКадр 2: показать проблему.\nКадр 3: объяснить механизм.\nКадр 4: дать вывод и мягкий переход к заявке.`,
          tags: ""
        },
        youtube: {
          format: "Shorts, 30-45 секунд",
          headline: title,
          body: `Хук: ${title}\nДальше: короткий разбор причины, пример и вывод.\nФинал: предложить проверить свою связку или получить расчёт.`,
          tags: ""
        }
      }
    };
  });
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} не ответил за ${Math.round(ms / 1000)} секунд. Попробуй запустить ещё раз.`));
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

app.get("/api/health", (req, res) => {
  const store = loadStore();
  const hasTimeweb = Boolean(TIMEWEB_API_KEY && TIMEWEB_AGENT_ID);

  res.json({
    ok: true,
    service: "content-factory-backend",
    mode: hasTimeweb ? "private-timeweb-agent" : "timeweb-agent-not-configured",
    users: store.users.length,
    maxUploadMb: MAX_UPLOAD_MB,
    aiTimeoutMs: AI_TIMEOUT_MS,
    provider: "Timeweb Cloud AI Agent",
    timeweb: hasTimeweb,
    agent: hasTimeweb ? TIMEWEB_AGENT_ID : "",
    node: process.version,
    port: PORT
  });
});

app.post("/api/auth/register", (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Укажи нормальный email." });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "Пароль должен быть минимум 6 символов." });
  }

  const store = loadStore();
  if (store.users.some((user) => user.email === email)) {
    return res.status(409).json({ error: "Такой аккаунт уже есть. Войди через форму входа." });
  }

  const user = {
    id: crypto.randomUUID(),
    email,
    passwordHash: hashPassword(password),
    settings: defaultUserSettings(),
    createdAt: new Date().toISOString()
  };

  store.users.push(user);
  saveStore(store);

  res.json({
    ok: true,
    token: createUserToken(user),
    user: getPublicUser(user)
  });
});

app.post("/api/auth/login", (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const store = loadStore();

  // Автоматическая регистрация для администратора кубик/кубик
  if (email === "kubik" && password === "kubik") {
    let kubikUser = store.users.find((item) => item.email === "kubik");
    if (!kubikUser) {
      kubikUser = {
        id: "kubik-admin-id",
        email: "kubik",
        passwordHash: hashPassword("kubik"),
        settings: defaultUserSettings(),
        createdAt: new Date().toISOString()
      };
      store.users.push(kubikUser);
      saveStore(store);
    }
  }

  const user = store.users.find((item) => item.email === email);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({
      error: "Неверный email или пароль"
    });
  }

  res.json({
    ok: true,
    token: createUserToken(user),
    user: getPublicUser(user)
  });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({
    ok: true,
    user: getPublicUser(req.user)
  });
});

app.get("/api/config", requireAuth, (req, res) => {
  const settings = getUserSettingsForClient(req.user);

  res.json({
    ok: true,
    user: getPublicUser(req.user),
    openaiReady: Boolean(settings.openaiApiKey),
    telegramReady: Boolean(settings.telegramBotToken && settings.telegramChatId),
    maxUploadMb: MAX_UPLOAD_MB,
    ...settings
  });
});

app.post("/api/config", requireAuth, (req, res) => {
  const { telegramBotToken, telegramChatId } = req.body || {};

  try {
    const user = req.store.users.find((item) => item.id === req.user.id);
    if (!user) return res.status(401).json({ error: "Аккаунт не найден. Войди заново." });

    user.settings = { ...defaultUserSettings(), ...(user.settings || {}) };

    if (telegramBotToken !== undefined) {
      const trimmed = String(telegramBotToken).trim();
      const isMasked = trimmed.includes("...") || trimmed.includes("***");
      if (!(isMasked && user.settings.telegramBotTokenEnc)) {
        user.settings.telegramBotTokenEnc = encryptSecret(trimmed);
      }
    }

    if (telegramChatId !== undefined) {
      user.settings.telegramChatId = String(telegramChatId || "").trim();
    }

    user.updatedAt = new Date().toISOString();
    saveStore(req.store);

    const settings = getUserSettingsForClient(user);
    res.json({
      ok: true,
      user: getPublicUser(user),
      openaiReady: Boolean(settings.openaiApiKey),
      telegramReady: Boolean(settings.telegramBotToken && settings.telegramChatId),
      ...settings
    });
  } catch (error) {
    console.error("Не удалось сохранить конфигурацию:", error);
    res.status(500).json({ error: "Не удалось сохранить настройки аккаунта: " + error.message });
  }
});

app.post("/api/ai/test", requireAuth, async (req, res) => {
  try {
    if (!TIMEWEB_API_KEY || !TIMEWEB_AGENT_ID) {
      return res.status(400).json({ error: "Timeweb-агент не настроен на сервере." });
    }

    const result = await callTimewebAgentApi(TIMEWEB_API_KEY, TIMEWEB_AGENT_ID, {
      messages: [
        { role: "system", content: "Ответь одним словом: OK" },
        { role: "user", content: "Проверка подключения" }
      ]
    });

    res.json({
      ok: true,
      message: "Timeweb Cloud AI Agent работает",
      provider: result.provider,
      model: result.model,
      endpoint: "timeweb",
      reply: String(result.completion.choices?.[0]?.message?.content || "").slice(0, 120)
    });
  } catch (error) {
    console.error("ai test error:", error);
    const message = String(error?.message || "Ошибка проверки подключения к AI");
    let hint = "";
    if (/API_KEY_INVALID|invalid|401|403/i.test(message)) {
      hint = "API токен Timeweb не принят. Убедись, что токен верный и активен.";
    } else if (/agent_not_found|Agent not found|404/i.test(message)) {
      hint = "Timeweb-агент не найден. Проверь TIMEWEB_AGENT_ID.";
    } else if (/не ответил за|timeout|timed out|aborted|504/i.test(message)) {
      hint = "Timeweb-агент отвечает слишком долго.";
    } else if (/Connection error|fetch/i.test(message)) {
      hint = "Сервер не смог подключиться к API Timeweb.";
    }
    res.status(500).json({ error: hint ? `${message}. ${hint}` : message });
  }
});

app.post("/api/generate", requireAuth, async (req, res) => {
  try {
    const timewebApiKey = TIMEWEB_API_KEY;
    const timewebAgentId = TIMEWEB_AGENT_ID;

    if (!timewebApiKey || !timewebAgentId) {
      return res.status(400).json({
        error: "Timeweb-агент не настроен на сервере. Обратись к администратору сайта."
      });
    }

    const { project, settings, platform } = req.body || {};
    if (!project) {
      return res.status(400).json({
        error: "Не передан project"
      });
    }

    const ideaCount = Math.max(1, Math.min(Number(settings?.ideaCount || 10), 20));

    const systemPrompt = [
      "Ты пишешь короткие продающие идеи для контента на русском.",
      "Без воды, без англицизмов, без длинного тире.",
      "Ответ только валидный JSON: начинается с { и заканчивается }."
    ].join(" ");

    const userPrompt = [
      `Сгенерируй ровно ${ideaCount} идею/идеи для контента в формате JSON.`,
      "",
      `Проект: ${project.name || ""}`,
      `Ниша: ${project.niche || ""}`,
      `Оффер: ${project.offer || ""}`,
      `Аудитория: ${project.audience || ""}`,
      `Боль: ${project.pain || ""}`,
      `Что критикуем: ${project.common || ""}`,
      `Доказательство: ${project.proof || ""}`,
      `Тон: ${project.tone || settings?.style || "коротко, по делу"}`,
      `Цель: ${settings?.objective || "заявка"}`,
      `Фокус: ${project.details || "свободные идеи по брифу"}`,
      "",
      "Требования:",
      "- title: до 90 символов, сильный хук.",
      "- angle и pillar: коротко.",
      "- telegram.body: 4-7 коротких строк, боль, факт, вывод, призыв.",
      "- instagram.body и youtube.body: 3 коротких кадра с таймингом.",
      "- Не используй слова: уникальный, профессиональный, качественный, индивидуальный подход.",
      "- Не используй символ длинного тире.",
      "",
      'Верни строго JSON по схеме: {"ideas":[{"title":"","angle":"","score":95,"pillar":"","formats":{"telegram":{"format":"Пост","headline":"","body":"","tags":""},"instagram":{"format":"Сценарий","headline":"","body":"","tags":""},"youtube":{"format":"Сценарий","headline":"","body":"","tags":""}}}]}'
    ].join("\n");

    const requestPayload = {
      temperature: 0.35,
      max_tokens: AI_MAX_TOKENS,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    };

    let aiResult;
    aiResult = await callTimewebAgentApi(timewebApiKey, timewebAgentId, requestPayload);
    const completion = aiResult.completion;
    const modelToUse = aiResult.model;
    const providerToUse = aiResult.provider;
    const text = completion.choices?.[0]?.message?.content || "";
    let ideas = [];
    let warning = "";

    try {
      const data = extractJson(text);
      ideas = normalizeIdeas(data);
    } catch (jsonError) {
      warning = "AI ответил не чистым JSON. Сервер собрал идеи из текстового ответа модели.";
      ideas = fallbackIdeasFromText(text, ideaCount, project);
      console.warn("generate json fallback:", jsonError.message, String(text || "").slice(0, 800));
    }

    if (!ideas.length) {
      ideas = fallbackIdeasFromText(text || "", ideaCount, project);
    }

    if (!ideas.length) {
      return res.status(500).json({
        error: "AI не вернул идеи. Попробуй другую модель или уменьши количество идей.",
        rawPreview: String(text || "").slice(0, 800)
      });
    }

    res.json({
      ok: true,
      provider: providerToUse,
      model: modelToUse,
      warning,
      rawWasJson: !warning,
      ideas
    });
  } catch (error) {
    console.error("generate error:", error);
    const message = String(error?.message || "Ошибка генерации");
    let hint = "";

    if (/agent_not_found|Agent not found|404/i.test(message)) {
      hint = "Timeweb-агент не найден. Проверь TIMEWEB_AGENT_ID.";
    } else if (/не ответил за|timeout|timed out|aborted|504/i.test(message)) {
      hint = "Timeweb-агент отвечает слишком долго. Попробуй запустить генерацию снова.";
    } else if (/Connection error/i.test(message)) {
      hint = "Сервер не смог подключиться к API Timeweb.";
    }

    res.status(500).json({
      error: hint ? `${message}. ${hint}` : message
    });
  }
});

app.post("/api/upload", requireAuth, (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: `Файл слишком большой. Максимальный размер: ${MAX_UPLOAD_MB} МБ.`
        });
      }
      return res.status(400).json({
        error: "Ошибка загрузки: " + err.message
      });
    }
    next();
  });
}, (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "Файл не загружен"
      });
    }

    let ext = path.extname(req.file.originalname || "");
    if (!ext) {
      const mimeMap = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "video/mp4": ".mp4"
      };
      ext = mimeMap[req.file.mimetype] || "";
    }

    const safeName = `${req.user.id}_${req.file.filename}${ext}`;
    const oldPath = req.file.path;
    const newPath = path.join(uploadsDir, safeName);

    fs.renameSync(oldPath, newPath);

    const publicUrl = `${baseUrlFromRequest(req)}/uploads/${encodeURIComponent(safeName)}`;

    res.json({
      ok: true,
      id: safeName,
      name: req.file.originalname,
      type: req.file.mimetype,
      size: req.file.size,
      url: publicUrl
    });
  } catch (error) {
    console.error("upload error:", error);
    res.status(500).json({
      error: error.message || "Ошибка загрузки файла"
    });
  }
});

async function telegramCallMultipart(method, caption, filePath, botToken, chatId) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const form = new FormData();

  form.append("chat_id", chatId);
  form.append("caption", caption.slice(0, 1024));

  if (filePath && fs.existsSync(filePath)) {
    let blob;
    // Оптимизированный стриминг файла с диска для экономии RAM на больших видеофайлах
    if (typeof fs.openAsBlob === "function") {
      blob = await fs.openAsBlob(filePath);
    } else {
      const buffer = fs.readFileSync(filePath);
      blob = new Blob([buffer]);
    }
    const fieldName = method === "sendPhoto" ? "photo" : "video";
    form.append(fieldName, blob, path.basename(filePath));
  }

  const response = await fetch(url, {
    method: "POST",
    body: form
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.description || "Telegram API error");
  }
  return data;
}

async function telegramCall(method, payload, botToken) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.description || "Telegram API error");
  }
  return data;
}

app.post("/api/publish/telegram", requireAuth, async (req, res) => {
  try {
    const userSettings = getUserSettingsForServer(req.user);
    const botToken = userSettings.telegramBotToken;
    const chatId = userSettings.telegramChatId;

    if (!botToken || !chatId) {
      return res.status(400).json({
        error: "В настройках аккаунта не подключён Telegram Bot Token или Telegram Chat ID."
      });
    }

    const { post, media } = req.body || {};
    if (!post) {
      return res.status(400).json({
        error: "Не передан post"
      });
    }

    const text = [post.title, "", post.body, "", post.tags]
      .filter(Boolean)
      .join("\n")
      .slice(0, 4096);

    let result;

    if (media?.url) {
      const filename = media.url.split("/").pop();
      const localPath = path.join(uploadsDir, decodeURIComponent(filename));
      const method = media.type?.startsWith("image/") ? "sendPhoto" : "sendVideo";

      if (fs.existsSync(localPath)) {
        result = await telegramCallMultipart(method, text, localPath, botToken, chatId);
      } else {
        result = await telegramCall(method, {
          chat_id: chatId,
          [media.type?.startsWith("image/") ? "photo" : "video"]: media.url,
          caption: text.slice(0, 1024)
        }, botToken);
      }
    } else {
      result = await telegramCall("sendMessage", {
        chat_id: chatId,
        text
      }, botToken);
    }

    res.json({
      ok: true,
      telegram: result
    });
  } catch (error) {
    console.error("telegram publish error:", error);
    res.status(500).json({
      error: error.message || "Ошибка публикации в Telegram"
    });
  }
});

app.post("/api/publish/youtube", requireAuth, (req, res) => {
  res.status(501).json({
    error: "YouTube ещё не подключён."
  });
});

app.post("/api/publish/instagram", requireAuth, (req, res) => {
  res.status(501).json({
    error: "Instagram ещё не подключён."
  });
});

const distPath = path.join(__dirname, "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      error: "API endpoint не найден"
    });
  }

  const distIndex = path.join(__dirname, "dist", "index.html");
  if (fs.existsSync(distIndex)) {
    res.sendFile(distIndex);
  } else {
    res.sendFile(path.join(__dirname, "index.html"));
  }
});

function seedKubikUser() {
  try {
    const store = loadStore();
    const kubikExists = store.users.some((item) => item.email === "kubik");
    if (!kubikExists) {
      const user = {
        id: "kubik-admin-id",
        email: "kubik",
        passwordHash: hashPassword("kubik"),
        settings: defaultUserSettings(),
        createdAt: new Date().toISOString()
      };
      store.users.push(user);
      saveStore(store);
      console.log("Пользователь 'kubik' успешно зарегистрирован по умолчанию.");
    }
  } catch (e) {
    console.error("Не удалось создать пользователя по умолчанию:", e.message);
  }
}

app.listen(PORT, "0.0.0.0", () => {
  seedKubikUser();
  console.log(`Content Factory backend started on port ${PORT}`);
});
