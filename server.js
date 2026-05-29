import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

dotenv.config();
dotenv.config({ path: "timeweb-env-ready.env" });

function loadPackedEnvVariable(name) {
  const raw = process.env[name];
  if (!raw) return;

  const parsed = dotenv.parse(raw);
  for (const [key, value] of Object.entries(parsed)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadPackedEnvVariable("logi");
loadPackedEnvVariable("LOGI");
loadPackedEnvVariable("TIMEWEB_ENV");

const APP_BUILD = "2026-05-20-env-autodetect";
const FALLBACK_TIMEWEB_AGENT_ID = "40f010e8-9dd7-473c-812f-81b65aba981f";

function extractJwt(value) {
  const text = String(value || "").trim();
  const match = text.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
  return match ? match[0] : "";
}

function extractUuid(value) {
  const text = String(value || "").trim();
  const match = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0] : "";
}

function resolveTimewebEnv() {
  const keyNames = ["TIMEWEB_API_KEY", "TIMEWEB_KEY", "logi", "LOGI", "TIMEWEB_ENV", "API_KEY", "KEY"];
  const agentNames = ["TIMEWEB_AGENT_ID", "TIMEWEB_ENV", "logi", "LOGI", "AGENT_ID"];

  for (const name of keyNames) {
    const key = extractJwt(process.env[name]);
    if (key) {
      const agentFromSameValue = extractUuid(process.env[name]);
      return {
        apiKey: key,
        apiKeySource: name,
        agentId: extractUuid(process.env.TIMEWEB_AGENT_ID) || agentFromSameValue || FALLBACK_TIMEWEB_AGENT_ID,
        agentIdSource: process.env.TIMEWEB_AGENT_ID ? "TIMEWEB_AGENT_ID" : agentFromSameValue ? name : "fallback"
      };
    }
  }

  for (const [name, value] of Object.entries(process.env)) {
    const key = extractJwt(value);
    if (key) {
      let agentId = "";
      let agentIdSource = "";

      for (const agentName of agentNames) {
        agentId = extractUuid(process.env[agentName]);
        if (agentId) {
          agentIdSource = agentName;
          break;
        }
      }

      return {
        apiKey: key,
        apiKeySource: name,
        agentId: agentId || FALLBACK_TIMEWEB_AGENT_ID,
        agentIdSource: agentIdSource || "fallback"
      };
    }
  }

  return {
    apiKey: "",
    apiKeySource: "",
    agentId: extractUuid(process.env.TIMEWEB_AGENT_ID) || FALLBACK_TIMEWEB_AGENT_ID,
    agentIdSource: process.env.TIMEWEB_AGENT_ID ? "TIMEWEB_AGENT_ID" : "fallback"
  };
}

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
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 300000);
const AI_MAX_TOKENS = Number(process.env.AI_MAX_TOKENS || 8000);
const ENABLE_DEMO_LOGIN = process.env.ENABLE_DEMO_LOGIN !== "false";
const DEMO_EMAIL = process.env.DEMO_EMAIL || "kubik";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "kubik";
const CLIENT_DEMO_EMAIL = process.env.CLIENT_DEMO_EMAIL || "client";
const CLIENT_DEMO_PASSWORD = process.env.CLIENT_DEMO_PASSWORD || "client123";
const TEST_DEMO_EMAIL = process.env.TEST_DEMO_EMAIL || "test2";
const TEST_DEMO_PASSWORD = process.env.TEST_DEMO_PASSWORD || "test123";
const CLIENT_SHARED_WORKSPACE = process.env.CLIENT_SHARED_WORKSPACE !== "false";
const CLIENT_DAILY_GENERATION_LIMIT = Number(process.env.CLIENT_DAILY_GENERATION_LIMIT || 5);
const DEBUG_HEALTH = process.env.DEBUG_HEALTH === "true";
const DEBUG_LOGS = process.env.DEBUG_LOGS === "true";
const AUTH_RATE_LIMIT_WINDOW_MS = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX || 20);
const AI_RATE_LIMIT_WINDOW_MS = Number(process.env.AI_RATE_LIMIT_WINDOW_MS || 60 * 60 * 1000);
const AI_RATE_LIMIT_MAX = Number(process.env.AI_RATE_LIMIT_MAX || 60);
const PUBLISH_RATE_LIMIT_WINDOW_MS = Number(process.env.PUBLISH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const PUBLISH_RATE_LIMIT_MAX = Number(process.env.PUBLISH_RATE_LIMIT_MAX || 60);

// YouTube OAuth2 config (Google Cloud Console)
const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID || "";
const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET || "";

const TIMEWEB_ENV = resolveTimewebEnv();
const TIMEWEB_API_KEY = TIMEWEB_ENV.apiKey;
const TIMEWEB_AGENT_ID = TIMEWEB_ENV.agentId;

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
  : process.env.NODE_ENV === "production" ? false : true;

app.use(cors({ origin: corsOrigin, credentials: true }));
app.set("trust proxy", 1);
app.disable("etag");
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use((req, res, next) => {
  const isHtmlRequest =
    req.method === "GET" &&
    (req.path === "/" ||
      req.path.endsWith(".html") ||
      (req.headers.accept || "").includes("text/html"));

  if (isHtmlRequest) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
  }
  next();
});
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(uploadsDir));

const authLimiter = rateLimit({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  limit: AUTH_RATE_LIMIT_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Слишком много попыток входа. Подожди немного и попробуй снова." }
});

const aiLimiter = rateLimit({
  windowMs: AI_RATE_LIMIT_WINDOW_MS,
  limit: AI_RATE_LIMIT_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Слишком много запросов к ИИ. Подожди немного и попробуй снова." }
});

const publishLimiter = rateLimit({
  windowMs: PUBLISH_RATE_LIMIT_WINDOW_MS,
  limit: PUBLISH_RATE_LIMIT_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Слишком много запросов на публикацию или загрузку. Подожди немного и попробуй снова." }
});

function isLimitedDemoEmail(email) {
  const normalized = normalizeEmail(email);
  return [CLIENT_DEMO_EMAIL, TEST_DEMO_EMAIL]
    .map(normalizeEmail)
    .filter(Boolean)
    .includes(normalized);
}

function debugLog(...args) {
  if (DEBUG_LOGS) console.log(...args);
}

for (const iconFile of [
  "favicon.ico",
  "favicon.png",
  "favicon-32x32.png",
  "favicon-16x16.png",
  "apple-touch-icon.png",
  "favicon-v2.png",
  "favicon-v2-32x32.png",
  "favicon-v2-16x16.png",
  "apple-touch-icon-v2.png"
]) {
  app.get(`/${iconFile}`, (req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.join(__dirname, iconFile));
  });
}

const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeRegex = /^(image|video)\//i;
    const allowedExts = [
      ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic",
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
    try {
      if (fs.existsSync(usersFile)) {
        const brokenFile = `${usersFile}.broken-${Date.now()}`;
        fs.copyFileSync(usersFile, brokenFile);
        console.error("Поврежденный users.json сохранен как:", brokenFile);
      }
    } catch (backupError) {
      console.error("Не удалось сохранить копию поврежденного users.json:", backupError.message);
    }
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

function cleanText(value, maxLength = 2000) {
  return String(value ?? "").replace(/\0/g, "").trim().slice(0, maxLength);
}

function cleanOptionalText(value, maxLength = 2000) {
  if (value === undefined || value === null) return undefined;
  return cleanText(value, maxLength);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateAuthBody(body = {}, mode = "login") {
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const isConfiguredDemoLogin = mode === "login" && (
    email === normalizeEmail(DEMO_EMAIL) ||
    email === normalizeEmail(CLIENT_DEMO_EMAIL) ||
    email === normalizeEmail(TEST_DEMO_EMAIL)
  );

  if (!isValidEmail(email) && !isConfiguredDemoLogin) {
    return { error: "Укажи нормальный email." };
  }

  if (mode === "register" && password.length < 6) {
    return { error: "Пароль должен быть минимум 6 символов." };
  }

  if (mode === "login" && !password) {
    return { error: "Укажи пароль." };
  }

  return { email, password };
}

function validateConfigBody(body = {}) {
  const allowed = {
    telegramBotToken: 120,
    telegramChatId: 160,
    instagramAccessToken: 600,
    instagramUserId: 160
  };
  const output = {};

  for (const [key, maxLength] of Object.entries(allowed)) {
    const value = cleanOptionalText(body[key], maxLength);
    if (value !== undefined) output[key] = value;
  }

  return output;
}

function uploadPathFromUrl(fileUrl) {
  const raw = String(fileUrl || "");
  if (!raw) return "";

  let filename = "";
  try {
    const parsed = new URL(raw, PUBLIC_BASE_URL || "http://localhost");
    filename = decodeURIComponent(path.basename(parsed.pathname));
  } catch {
    filename = decodeURIComponent(path.basename(raw.split("?")[0]));
  }

  if (!filename || filename.includes("/") || filename.includes("\\")) return "";
  const localPath = path.resolve(uploadsDir, filename);
  const root = path.resolve(uploadsDir) + path.sep;
  return localPath.startsWith(root) ? localPath : "";
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
    telegramChatId: "",
    // Instagram Graph API
    instagramAccessTokenEnc: "",
    instagramUserId: "",
    // YouTube OAuth2
    youtubeRefreshTokenEnc: "",
    youtubeChannelId: ""
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
    telegramChatId: settings.telegramChatId || process.env.TELEGRAM_CHAT_ID || "",
    instagramAccessToken: decryptSecret(settings.instagramAccessTokenEnc) || "",
    instagramUserId: settings.instagramUserId || "",
    youtubeRefreshToken: decryptSecret(settings.youtubeRefreshTokenEnc) || "",
    youtubeChannelId: settings.youtubeChannelId || ""
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
    telegramChatId: serverSettings.telegramChatId,
    instagramAccessToken: maskKey(serverSettings.instagramAccessToken),
    instagramUserId: serverSettings.instagramUserId,
    instagramReady: Boolean(serverSettings.instagramAccessToken && serverSettings.instagramUserId),
    youtubeConnected: Boolean(serverSettings.youtubeRefreshToken),
    youtubeChannelId: serverSettings.youtubeChannelId,
    youtubeOAuthEnabled: Boolean(YOUTUBE_CLIENT_ID && YOUTUBE_CLIENT_SECRET)
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

function ensureDemoUser(store, email, password, id) {
  let user = store.users.find((item) => item.email === email);
  let changed = false;

  if (!user) {
    user = {
      id,
      email,
      passwordHash: hashPassword(password),
      settings: defaultUserSettings(),
      createdAt: new Date().toISOString()
    };
    store.users.push(user);
    changed = true;
  } else if (!verifyPassword(password, user.passwordHash)) {
    user.passwordHash = hashPassword(password);
    user.updatedAt = new Date().toISOString();
    changed = true;
  }

  return { user, changed };
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

  // Редирект рабочего пространства для гостевого/клиентского входа
  const isClient = user.email === CLIENT_DEMO_EMAIL;
  if (isClient && CLIENT_SHARED_WORKSPACE) {
    const adminUser = store.users.find((item) => item.email === DEMO_EMAIL);
    if (adminUser) {
      req.workspaceUser = adminUser;
    } else {
      req.workspaceUser = user;
    }
  } else {
    req.workspaceUser = user;
  }

  next();
}

function enforceGenerationLimit(req, res, next) {
  // Лимит применяется только к тестовым демо-аккаунтам.
  if (req.user && isLimitedDemoEmail(req.user.email)) {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    // Ищем пользователя в store для мутации и сохранения
    const dbUser = req.store.users.find((u) => u.id === req.user.id);
    if (dbUser) {
      // Очищаем старые метки времени
      dbUser.generationTimestamps = (dbUser.generationTimestamps || []).filter((t) => t > oneDayAgo);

      if (dbUser.generationTimestamps.length >= CLIENT_DAILY_GENERATION_LIMIT) {
        return res.status(429).json({
          error: `Превышен суточный лимит генераций. Демо-аккаунт ограничен ${CLIENT_DAILY_GENERATION_LIMIT} генерациями в день.`
        });
      }

      // Записываем метку
      dbUser.generationTimestamps.push(now);
      saveStore(req.store);
    }
  }
  next();
}

function getLimitInfo(req) {
  const info = {
    limit: CLIENT_DAILY_GENERATION_LIMIT,
    remaining: CLIENT_DAILY_GENERATION_LIMIT,
    isUnlimited: true
  };

  if (req.user && isLimitedDemoEmail(req.user.email)) {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const dbUser = req.store.users.find((u) => u.id === req.user.id);
    if (dbUser) {
      dbUser.generationTimestamps = (dbUser.generationTimestamps || []).filter((t) => t > oneDayAgo);
      info.remaining = Math.max(0, CLIENT_DAILY_GENERATION_LIMIT - dbUser.generationTimestamps.length);
      info.isUnlimited = false;
    }
  }

  return info;
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
    const angle = String(item.angle || item.type || "ИИ-угол").trim();
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
      status: "Собрано из ответа ИИ",
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

function defaultWorkspace() {
  return {
    activeProjectId: "p_1",
    activePlatform: "telegram",
    selectedIdeaId: "",
    selectedMediaId: "",
    planner: {
      placement: "Telegram",
      goal: "получить заявку",
      reason: "",
      formatNote: ""
    },
    projects: [
      {
        id: "p_1",
        name: "Новый проект",
        briefText: "",
        status: "активный"
      }
    ],
    ideas: [],
    media: [],
    queue: [],
    logs: []
  };
}

function sanitizeWorkspace(input = {}) {
  const base = defaultWorkspace();
  const workspace = {
    activeProjectId: String(input.activeProjectId || base.activeProjectId),
    activePlatform: ["telegram", "instagram", "youtube"].includes(input.activePlatform)
      ? input.activePlatform
      : base.activePlatform,
    selectedIdeaId: String(input.selectedIdeaId || ""),
    selectedMediaId: String(input.selectedMediaId || ""),
    planner: {
      ...base.planner,
      ...(input.planner && typeof input.planner === "object" ? input.planner : {})
    },
    projects: Array.isArray(input.projects) && input.projects.length ? input.projects : base.projects,
    ideas: Array.isArray(input.ideas) ? input.ideas.slice(0, 50) : [],
    media: Array.isArray(input.media) ? input.media.slice(0, 300) : [],
    queue: Array.isArray(input.queue) ? input.queue.slice(0, 300) : [],
    logs: Array.isArray(input.logs) ? input.logs.slice(0, 120) : []
  };

  workspace.queue = workspace.queue.map((post) => {
    const media = workspace.media.find((item) => item.id && item.id === post.mediaId) || {};
    const publishDate = post.publishDate || datePartServer(post.scheduledAt);
    const publishTime = post.publishTime || timePartServer(post.scheduledAt);
    return {
      ...post,
      id: String(post.id || crypto.randomUUID()),
      platform: ["telegram", "instagram", "youtube"].includes(post.platform) ? post.platform : "telegram",
      status: post.status || (post.state === "Опубликовано" ? "published" : "scheduled"),
      state: post.state || statusLabel(post.status || "scheduled"),
      publishDate,
      publishTime,
      scheduledAt: post.scheduledAt || [publishDate, publishTime].filter(Boolean).join("T"),
      mediaUrl: post.mediaUrl || media.url || "",
      mediaType: post.mediaType || media.type || ""
    };
  });

  return workspace;
}

function datePartServer(value) {
  return String(value || "").slice(0, 10);
}

function timePartServer(value) {
  const text = String(value || "");
  return text.includes("T") ? text.split("T")[1]?.slice(0, 5) || "" : "";
}

function statusLabel(status) {
  const map = {
    draft: "Черновик",
    scheduled: "Запланировано",
    publishing: "Публикуется",
    published: "Опубликовано",
    error: "Ошибка"
  };
  return map[status] || "Запланировано";
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

  const payload = {
    ok: true,
    service: "content-factory-backend",
    appBuild: APP_BUILD,
    mode: hasTimeweb ? "private-timeweb-agent" : "timeweb-agent-not-configured",
    maxUploadMb: MAX_UPLOAD_MB,
    aiTimeoutMs: AI_TIMEOUT_MS,
    provider: "Timeweb Cloud AI Agent",
    timeweb: hasTimeweb,
    demoLoginEnabled: ENABLE_DEMO_LOGIN
  };

  if (DEBUG_HEALTH) {
    payload.users = store.users.length;
    payload.agent = hasTimeweb ? TIMEWEB_AGENT_ID : "";
    payload.env = {
      keyFound: Boolean(TIMEWEB_API_KEY),
      keySource: TIMEWEB_ENV.apiKeySource || "",
      agentFound: Boolean(TIMEWEB_AGENT_ID),
      agentSource: TIMEWEB_ENV.agentIdSource || "",
      hasLogi: Boolean(process.env.logi || process.env.LOGI),
      hasTimewebApiKey: Boolean(process.env.TIMEWEB_API_KEY)
    };
    payload.node = process.version;
    payload.port = PORT;
  }

  res.json(payload);
});

app.post("/api/auth/register", authLimiter, (req, res) => {
  const auth = validateAuthBody(req.body, "register");
  if (auth.error) return res.status(400).json({ error: auth.error });
  const { email, password } = auth;

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

app.post("/api/auth/login", authLimiter, (req, res) => {
  const auth = validateAuthBody(req.body, "login");
  if (auth.error) return res.status(400).json({ error: auth.error });
  const { email, password } = auth;
  const store = loadStore();

  if (ENABLE_DEMO_LOGIN) {
    let demoChanged = false;

    if (email === DEMO_EMAIL && password === DEMO_PASSWORD) {
      const result = ensureDemoUser(store, DEMO_EMAIL, DEMO_PASSWORD, "kubik-admin-id");
      demoChanged = demoChanged || result.changed;
    } else if (email === CLIENT_DEMO_EMAIL && password === CLIENT_DEMO_PASSWORD) {
      const result = ensureDemoUser(store, CLIENT_DEMO_EMAIL, CLIENT_DEMO_PASSWORD, "client-demo-id");
      demoChanged = demoChanged || result.changed;
    } else if (email === TEST_DEMO_EMAIL && password === TEST_DEMO_PASSWORD) {
      const result = ensureDemoUser(store, TEST_DEMO_EMAIL, TEST_DEMO_PASSWORD, "test-demo-2-id");
      demoChanged = demoChanged || result.changed;
    }

    if (demoChanged) {
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
  const settings = getUserSettingsForClient(req.workspaceUser);

  res.json({
    ok: true,
    user: getPublicUser(req.user),
    openaiReady: Boolean(settings.openaiApiKey),
    telegramReady: Boolean(settings.telegramBotToken && settings.telegramChatId),
    instagramReady: settings.instagramReady,
    youtubeConnected: settings.youtubeConnected,
    youtubeOAuthEnabled: settings.youtubeOAuthEnabled,
    maxUploadMb: MAX_UPLOAD_MB,
    limitInfo: getLimitInfo(req),
    ...settings
  });
});

app.get("/api/workspace", requireAuth, (req, res) => {
  const workspace = sanitizeWorkspace(req.workspaceUser.workspace || {
    projects: req.workspaceUser.projects,
    ideas: req.workspaceUser.ideas,
    media: req.workspaceUser.media,
    queue: req.workspaceUser.queue
  });

  res.json({
    ok: true,
    workspace
  });
});

app.put("/api/workspace", requireAuth, (req, res) => {
  try {
    const user = req.store.users.find((item) => item.id === req.workspaceUser.id);
    if (!user) return res.status(401).json({ error: "Аккаунт не найден. Войди заново." });

    if (!isPlainObject(req.body?.workspace)) {
      return res.status(400).json({ error: "Не передано рабочее пространство." });
    }

    const workspace = sanitizeWorkspace(req.body?.workspace || {});
    user.workspace = workspace;
    user.queue = workspace.queue;
    user.updatedAt = new Date().toISOString();
    saveStore(req.store);

    res.json({
      ok: true,
      workspace
    });
  } catch (error) {
    console.error("workspace save error:", error);
    res.status(500).json({ error: "Не удалось сохранить рабочее пространство: " + error.message });
  }
});

app.post("/api/queue", requireAuth, (req, res) => {
  try {
    const user = req.store.users.find((item) => item.id === req.workspaceUser.id);
    if (!user) return res.status(401).json({ error: "Аккаунт не найден. Войди заново." });

    const workspace = sanitizeWorkspace(user.workspace || {});
    const post = sanitizeWorkspace({
      ...workspace,
      queue: [req.body?.post || {}]
    }).queue[0];

    workspace.queue = [post, ...workspace.queue.filter((item) => item.id !== post.id)].slice(0, 300);
    user.workspace = workspace;
    user.queue = workspace.queue;
    user.updatedAt = new Date().toISOString();
    saveStore(req.store);

    res.json({
      ok: true,
      post,
      queue: workspace.queue
    });
  } catch (error) {
    console.error("queue save error:", error);
    res.status(500).json({ error: "Не удалось сохранить публикацию: " + error.message });
  }
});

app.post("/api/config", requireAuth, (req, res) => {
  const { telegramBotToken, telegramChatId, instagramAccessToken, instagramUserId } = validateConfigBody(req.body || {});

  try {
    const user = req.store.users.find((item) => item.id === req.workspaceUser.id);
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

    if (instagramAccessToken !== undefined) {
      const trimmed = String(instagramAccessToken).trim();
      const isMasked = trimmed.includes("...") || trimmed.includes("***");
      if (!(isMasked && user.settings.instagramAccessTokenEnc)) {
        user.settings.instagramAccessTokenEnc = encryptSecret(trimmed);
      }
    }

    if (instagramUserId !== undefined) {
      user.settings.instagramUserId = String(instagramUserId || "").trim();
    }

    user.updatedAt = new Date().toISOString();
    saveStore(req.store);

    const settings = getUserSettingsForClient(user);
    res.json({
      ok: true,
      user: getPublicUser(req.user),
      openaiReady: Boolean(settings.openaiApiKey),
      telegramReady: Boolean(settings.telegramBotToken && settings.telegramChatId),
      instagramReady: settings.instagramReady,
      youtubeConnected: settings.youtubeConnected,
      youtubeOAuthEnabled: settings.youtubeOAuthEnabled,
      ...settings
    });
  } catch (error) {
    console.error("Не удалось сохранить конфигурацию:", error);
    res.status(500).json({ error: "Не удалось сохранить настройки аккаунта: " + error.message });
  }
});

app.post("/api/ai/test", requireAuth, aiLimiter, async (req, res) => {
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

app.post("/api/generate", requireAuth, aiLimiter, enforceGenerationLimit, async (req, res) => {
  try {
    const timewebApiKey = TIMEWEB_API_KEY;
    const timewebAgentId = TIMEWEB_AGENT_ID;

    if (!timewebApiKey || !timewebAgentId) {
      return res.status(400).json({
        error: "Timeweb-агент не настроен на сервере. Обратись к администратору сайта."
      });
    }

    const { project, settings, platform, planner } = req.body || {};
    if (!isPlainObject(project)) {
      return res.status(400).json({
        error: "Не передан project"
      });
    }

    const ideaCount = Math.max(1, Math.min(Number(settings?.ideaCount || 10), 20));
    const safeProject = {
      name: cleanText(project.name, 180),
      briefText: cleanText(project.briefText, 12000)
    };
    const safeSettings = {
      objective: cleanText(settings?.objective || "заявка", 240),
      style: cleanText(settings?.style || "коротко, по делу", 240)
    };
    const safePlanner = {
      placement: cleanText(planner?.placement || "", 120),
      publishDate: cleanText(planner?.publishDate || "", 40),
      publishTime: cleanText(planner?.publishTime || "", 40),
      goal: cleanText(planner?.goal || "", 240),
      reason: cleanText(planner?.reason || "", 1000),
      formatNote: cleanText(planner?.formatNote || "", 1000)
    };

    const platformLabel = {
      telegram: "Telegram-канал",
      instagram: "Instagram Reels",
      youtube: "YouTube Shorts"
    }[platform] || "все площадки";

    let platformRequirements = "";
    let jsonSchema = "";

    if (platform === "telegram") {
      platformRequirements = "- telegram.body: готовый, полноценный и вовлекающий пост для канала на 3-5 абзацев с разметкой абзацев и списков. Должен содержать: сильный хук, раскрытие боли/проблемы, конкретный факт или механику решения, экспертные выводы и мягкий призыв к действию. Пост должен быть глубоким и содержательным, а не состоять из пары сухих строк.";
      jsonSchema = '{"ideas":[{"title":"","angle":"","score":95,"pillar":"","formats":{"telegram":{"format":"Пост","headline":"","body":"","tags":""}}}]}';
    } else if (platform === "instagram") {
      platformRequirements = "- instagram.body: сценарий Reels на 20-35 секунд: 4-5 кадров с таймингом, что в кадре, текст на экране, голос.";
      jsonSchema = '{"ideas":[{"title":"","angle":"","score":95,"pillar":"","formats":{"instagram":{"format":"Сценарий","headline":"","body":"","tags":""}}}]}';
    } else if (platform === "youtube") {
      platformRequirements = "- youtube.body: сценарий Shorts на 20-35 секунд: хук 0-3 сек, быстрый пример, вывод, призыв.";
      jsonSchema = '{"ideas":[{"title":"","angle":"","score":95,"pillar":"","formats":{"youtube":{"format":"Сценарий","headline":"","body":"","tags":""}}}]}';
    } else {
      platformRequirements = [
        "- telegram.body: готовый, полноценный и вовлекающий пост для канала на 3-5 абзацев с разметкой абзацев и списков. Должен содержать: сильный хук, раскрытие боли/проблемы, конкретный факт или механику решения, экспертные выводы и мягкий призыв к действию.",
        "- instagram.body: сценарий Reels на 20-35 секунд: 4-5 кадров с таймингом, что в кадре, текст на экране, голос.",
        "- youtube.body: сценарий Shorts на 20-35 секунд: хук 0-3 сек, быстрый пример, вывод, призыв."
      ].join("\n");
      jsonSchema = '{"ideas":[{"title":"","angle":"","score":95,"pillar":"","formats":{"telegram":{"format":"Пост","headline":"","body":"","tags":""},"instagram":{"format":"Сценарий","headline":"","body":"","tags":""},"youtube":{"format":"Сценарий","headline":"","body":"","tags":""}}}]}';
    }

    const systemPrompt = [
      "Ты контент-стратег и редактор продающего контента на русском.",
      `Твоя задача - превращать бриф в готовые материалы только для выбранной площадки (${platformLabel}).`,
      "Пиши емко, конкретно, без воды, без англицизмов, без длинного тире.",
      "Не придумывай несуществующие факты. Если факта нет, используй аккуратную формулировку без цифр.",
      "Ответ только валидный JSON: начинается с { и заканчивается }."
    ].join(" ");

    const userPrompt = [
      `Сгенерируй ровно ${ideaCount} идею/идеи для контента в формате JSON.`,
      "",
      `Проект: ${safeProject.name || ""}`,
      `Вводные данные (Бриф):`,
      safeProject.briefText ? safeProject.briefText : "Нет подробного брифа.",
      `Цель: ${safeSettings.objective}`,
      `Тон: ${safeSettings.style}`,
      "",
      "План публикации:",
      `Основная площадка сейчас: ${platformLabel}`,
      `Куда публикуем: ${safePlanner.placement || platformLabel}`,
      `Дата: ${safePlanner.publishDate}`,
      `Время: ${safePlanner.publishTime}`,
      `Зачем публикуем: ${safePlanner.goal || safeSettings.objective}`,
      `Почему это должно сработать: ${safePlanner.reason}`,
      `Особые требования: ${safePlanner.formatNote}`,
      "",
      "Требования:",
      "- title: до 90 символов, сильный хук.",
      "- angle и pillar: коротко.",
      platformRequirements,
      "- Каждый формат должен быть самостоятельным, а не копией одного текста.",
      "- Учитывай площадку: Telegram читают (поэтому пиши развернуто и интересно), Reels и Shorts смотрят без долгого вступления.",
      "- Не используй слова: уникальный, профессиональный, качественный, надежный, индивидуальный подход.",
      "- Не используй символ длинного тире.",
      "",
      `Верни строго JSON по схеме: ${jsonSchema}`
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
      ideas = fallbackIdeasFromText(text, ideaCount, safeProject);
      console.warn("generate json fallback:", jsonError.message, String(text || "").slice(0, 800));
    }

    if (!ideas.length) {
      ideas = fallbackIdeasFromText(text || "", ideaCount, safeProject);
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
      ideas,
      limitInfo: getLimitInfo(req)
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

app.post("/api/upload", requireAuth, publishLimiter, (req, res, next) => {
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

    const safeName = `${req.workspaceUser.id}_${req.file.filename}${ext}`;
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

async function enhancePromptWithAi(userPrompt) {
  if (!TIMEWEB_API_KEY || !TIMEWEB_AGENT_ID) {
    debugLog("enhancePromptWithAi: no Timeweb credentials, using original prompt.");
    return userPrompt;
  }
  try {
    const systemPrompt = `You are a professional prompt engineer for AI image generators (like Midjourney, Stable Diffusion, Pollinations).
Your task is to take a description of an image in Russian (or any other language) and translate/expand it into a highly detailed, professional, photography-centric prompt in English.
Make it vivid, state the style (e.g., professional commercial photography, cinematic lighting, 8k, highly detailed, realistic, award-winning composition), details, lighting, and camera settings.
Do not include any chat prefix, introduction, or markdown styling. Just output the final English prompt string.`;

    const requestPayload = {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Expand this prompt: "${userPrompt}"` }
      ]
    };
    
    const result = await callTimewebAgentApi(TIMEWEB_API_KEY, TIMEWEB_AGENT_ID, requestPayload);
    const enhanced = result?.completion?.choices?.[0]?.message?.content?.trim();
    if (enhanced) {
      debugLog("enhancePromptWithAi: prompt enhanced.");
      return enhanced;
    }
  } catch (err) {
    console.error("Failed to enhance prompt with AI agent:", err);
  }
  return userPrompt;
}

async function callImageGenerator(prompt) {
  const seed = Math.floor(Math.random() * 1000000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}&private=true`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Ошибка генерации изображения: ${response.statusText} (${response.status})`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

app.post("/api/generate-image", requireAuth, aiLimiter, enforceGenerationLimit, async (req, res) => {
  try {
    const prompt = cleanText(req.body?.prompt, 2000);
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ error: "Не передан текст промпта" });
    }

    debugLog("POST /api/generate-image: request accepted.");

    // 1. Улучшение промпта с помощью ИИ
    const enhancedPrompt = await enhancePromptWithAi(prompt.trim());

    // 2. Генерация изображения
    const buffer = await callImageGenerator(enhancedPrompt);

    // 3. Сохранение файла на диск в uploadsDir
    const fileId = `${req.workspaceUser.id}_gen_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.jpg`;
    const newPath = path.join(uploadsDir, fileId);
    
    fs.writeFileSync(newPath, buffer);
    debugLog("POST /api/generate-image: generated image saved.");

    // 4. Формирование публичной ссылки и ответ
    const publicUrl = `${baseUrlFromRequest(req)}/uploads/${encodeURIComponent(fileId)}`;

    // Имя для библиотеки
    const truncatedPrompt = prompt.slice(0, 30).trim() + (prompt.length > 30 ? "..." : "");
    const originalName = `ИИ_${truncatedPrompt}.jpg`;

    res.json({
      ok: true,
      id: fileId,
      name: originalName,
      type: "image/jpeg",
      size: buffer.length,
      url: publicUrl,
      limitInfo: getLimitInfo(req)
    });
  } catch (error) {
    console.error("POST /api/generate-image error:", error);
    res.status(500).json({
      error: error.message || "Не удалось сгенерировать изображение"
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

app.post("/api/publish/telegram", requireAuth, publishLimiter, async (req, res) => {
  try {
    const userSettings = getUserSettingsForServer(req.workspaceUser);
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
      const localPath = uploadPathFromUrl(media.url);
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

// ─────────────────────────────────────────────────────────────
// INSTAGRAM PUBLISHING
// ─────────────────────────────────────────────────────────────
async function instagramPublishReel(accessToken, userId, videoUrl, caption) {
  const baseUrl = "https://graph.instagram.com/v19.0";

  // Step 1: Create media container
  const containerRes = await fetch(`${baseUrl}/${userId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "REELS",
      video_url: videoUrl,
      caption: caption.slice(0, 2200),
      access_token: accessToken
    })
  });
  const containerData = await containerRes.json();
  if (!containerRes.ok || containerData.error) {
    throw new Error(containerData.error?.message || `Instagram API error (container): ${containerRes.status}`);
  }
  const containerId = containerData.id;
  if (!containerId) throw new Error("Instagram: не получен ID контейнера");

  // Step 2: Poll until FINISHED (max 120s)
  let ready = false;
  for (let attempt = 0; attempt < 24; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));
    const statusRes = await fetch(`${baseUrl}/${containerId}?fields=status_code&access_token=${accessToken}`);
    const statusData = await statusRes.json();
    if (statusData.status_code === "FINISHED") { ready = true; break; }
    if (statusData.status_code === "ERROR") throw new Error("Instagram: ошибка обработки видео на серверах Meta");
  }
  if (!ready) throw new Error("Instagram: видео не обработалось за 120 секунд. Попробуй снова.");

  // Step 3: Publish
  const publishRes = await fetch(`${baseUrl}/${userId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: containerId, access_token: accessToken })
  });
  const publishData = await publishRes.json();
  if (!publishRes.ok || publishData.error) {
    throw new Error(publishData.error?.message || `Instagram API error (publish): ${publishRes.status}`);
  }
  return publishData;
}

app.post("/api/publish/instagram", requireAuth, publishLimiter, async (req, res) => {
  try {
    const userSettings = getUserSettingsForServer(req.workspaceUser);
    const { instagramAccessToken, instagramUserId } = userSettings;

    if (!instagramAccessToken || !instagramUserId) {
      return res.status(400).json({
        error: "Instagram не подключён. Добавь токен доступа и ID пользователя в настройках."
      });
    }

    const { post, media } = req.body || {};
    if (!post) return res.status(400).json({ error: "Не передан post" });

    if (!media?.url || !media.type?.startsWith("video/")) {
      return res.status(400).json({
        error: "Для публикации в Instagram Reels нужно видео. Прикрепи видеофайл к посту."
      });
    }

    const caption = [post.title, "", post.body, "", post.tags]
      .filter(Boolean).join("\n").slice(0, 2200);

    const result = await instagramPublishReel(instagramAccessToken, instagramUserId, media.url, caption);

    res.json({ ok: true, instagram: result });
  } catch (error) {
    console.error("instagram publish error:", error);
    res.status(500).json({ error: error.message || "Ошибка публикации в Instagram" });
  }
});

// ─────────────────────────────────────────────────────────────
// YOUTUBE OAUTH + PUBLISHING
// ─────────────────────────────────────────────────────────────
function makeYouTubeOAuth(redirectUri) {
  return new google.auth.OAuth2(YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, redirectUri);
}

app.get("/api/auth/youtube", requireAuth, publishLimiter, (req, res) => {
  if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) {
    return res.status(400).json({
      error: "YouTube OAuth не настроен. Добавь YOUTUBE_CLIENT_ID и YOUTUBE_CLIENT_SECRET в .env."
    });
  }

  const redirectUri = `${baseUrlFromRequest(req)}/api/auth/youtube/callback`;
  const oauth2Client = makeYouTubeOAuth(redirectUri);

  // Embed userId in state so callback knows which user to update
  const state = Buffer.from(JSON.stringify({ userId: req.workspaceUser.id })).toString("base64url");

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly"
    ],
    state
  });

  res.redirect(url);
});

app.get("/api/auth/youtube/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.send(`<h2>Ошибка: ${String(error)}</h2><p>Закрой эту вкладку и попробуй снова.</p>`);
    }

    if (!code || !state) {
      return res.status(400).send("<h2>Нет кода авторизации</h2>");
    }

    let userId;
    try {
      userId = JSON.parse(Buffer.from(String(state), "base64url").toString("utf8")).userId;
    } catch {
      return res.status(400).send("<h2>Неверный state</h2>");
    }

    const redirectUri = `${baseUrlFromRequest(req)}/api/auth/youtube/callback`;
    const oauth2Client = makeYouTubeOAuth(redirectUri);
    const { tokens } = await oauth2Client.getToken(String(code));

    if (!tokens.refresh_token) {
      return res.send("<h2>YouTube не вернул refresh_token.</h2><p>Отзови доступ приложению в настройках Google и попробуй снова.</p>");
    }

    // Get channel info
    oauth2Client.setCredentials(tokens);
    const yt = google.youtube({ version: "v3", auth: oauth2Client });
    const channelRes = await yt.channels.list({ part: "snippet", mine: true });
    const channel = channelRes.data.items?.[0];

    const store = loadStore();
    const user = store.users.find((u) => u.id === userId);
    if (!user) return res.status(404).send("<h2>Пользователь не найден</h2>");

    user.settings = { ...defaultUserSettings(), ...(user.settings || {}) };
    user.settings.youtubeRefreshTokenEnc = encryptSecret(tokens.refresh_token);
    user.settings.youtubeChannelId = channel?.id || "";
    user.updatedAt = new Date().toISOString();
    saveStore(store);

    const channelTitle = channel?.snippet?.title || "канал";
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>YouTube подключён</title><style>body{font-family:sans-serif;display:grid;place-items:center;min-height:100vh;background:#0b0d18;color:#fff;margin:0}.card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:24px;padding:32px 40px;text-align:center;max-width:400px}h2{margin:0 0 12px;font-size:24px}p{color:rgba(255,255,255,.7);margin:0 0 20px}button{background:#45d3ff;color:#07101a;border:none;border-radius:12px;padding:12px 24px;font-weight:900;font-size:15px;cursor:pointer}</style></head><body><div class="card"><h2>✅ YouTube подключён</h2><p>Канал: <b>${channelTitle}</b></p><button onclick="window.close()">Закрыть</button></div></body></html>`);
  } catch (error) {
    console.error("YouTube OAuth callback error:", error);
    res.status(500).send(`<h2>Ошибка OAuth: ${String(error.message)}</h2>`);
  }
});

app.post("/api/auth/youtube/disconnect", requireAuth, publishLimiter, (req, res) => {
  try {
    const store = loadStore();
    const user = store.users.find((u) => u.id === req.workspaceUser.id);
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });

    user.settings = { ...defaultUserSettings(), ...(user.settings || {}) };
    user.settings.youtubeRefreshTokenEnc = "";
    user.settings.youtubeChannelId = "";
    user.updatedAt = new Date().toISOString();
    saveStore(store);

    res.json({ ok: true, youtubeConnected: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/publish/youtube", requireAuth, publishLimiter, async (req, res) => {
  try {
    const userSettings = getUserSettingsForServer(req.workspaceUser);
    const { youtubeRefreshToken } = userSettings;

    if (!youtubeRefreshToken) {
      return res.status(400).json({
        error: "YouTube не подключён. Нажми \"Подключить YouTube\" в настройках."
      });
    }

    if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) {
      return res.status(400).json({
        error: "YouTube OAuth не настроен на сервере. Добавь YOUTUBE_CLIENT_ID и YOUTUBE_CLIENT_SECRET в .env."
      });
    }

    const { post, media, scheduledAt } = req.body || {};
    if (!post) return res.status(400).json({ error: "Не передан post" });

    if (!media?.url || !media.type?.startsWith("video/")) {
      return res.status(400).json({
        error: "Для загрузки YouTube Shorts нужно видео. Прикрепи видеофайл к посту."
      });
    }

    const oauth2Client = makeYouTubeOAuth("");
    oauth2Client.setCredentials({ refresh_token: youtubeRefreshToken });
    const yt = google.youtube({ version: "v3", auth: oauth2Client });

    // Get video file from local uploads
    const localPath = uploadPathFromUrl(media.url);

    if (!fs.existsSync(localPath)) {
      return res.status(400).json({ error: "Файл не найден на сервере. Загрузи видео через Медиа." });
    }

    const title = String(post.title || "Видео").slice(0, 100);
    const description = [post.body, "", post.tags].filter(Boolean).join("\n").slice(0, 5000);

    // If scheduledAt is in the future, set publishAt
    const publishAt = scheduledAt && new Date(scheduledAt) > new Date()
      ? new Date(scheduledAt).toISOString()
      : null;

    const insertRes = await yt.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title,
          description,
          categoryId: "22" // People & Blogs
        },
        status: {
          privacyStatus: "private",
          ...(publishAt ? { publishAt } : {}),
          selfDeclaredMadeForKids: false
        }
      },
      media: {
        body: fs.createReadStream(localPath)
      }
    });

    const videoId = insertRes.data.id;
    res.json({
      ok: true,
      youtube: {
        videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        scheduledAt: publishAt,
        status: publishAt ? "scheduled" : "uploaded_private"
      }
    });
  } catch (error) {
    console.error("youtube publish error:", error);
    const msg = error?.response?.data?.error?.message || error.message || "Ошибка загрузки на YouTube";
    res.status(500).json({ error: msg });
  }
});

// ─────────────────────────────────────────────────────────────
// Планировщик автопостинга из очереди, каждые 60 секунд
// ─────────────────────────────────────────────────────────────
let schedulerRunning = false;

async function runScheduledPublishing() {
  if (schedulerRunning) {
    console.warn("[Scheduler] Предыдущий запуск ещё не завершён, пропускаем тик.");
    return;
  }

  schedulerRunning = true;
  try {
    const store = loadStore();
    const now = new Date();

    for (const user of store.users) {
      const queue = Array.isArray(user.queue) ? user.queue : [];
      let changed = false;

      for (const post of queue) {
        if (!post.status) post.status = post.state === "Опубликовано" ? "published" : "scheduled";
        if (post.status !== "scheduled" || !post.scheduledAt) continue;
        const postTime = new Date(post.scheduledAt);
        if (postTime > now) continue; // Not yet time

        const platform = post.platform || "telegram";
        const userSettings = getUserSettingsForServer(user);

        try {
          if (platform === "telegram") {
            const { telegramBotToken, telegramChatId } = userSettings;
            if (!telegramBotToken || !telegramChatId) { post.status = "error"; post.lastError = "Telegram не настроен"; changed = true; continue; }

            const text = [post.title, "", post.body, "", post.tags].filter(Boolean).join("\n").slice(0, 4096);
            await telegramCall("sendMessage", { chat_id: telegramChatId, text }, telegramBotToken);
            post.status = "published"; post.state = statusLabel(post.status); post.publishedAt = new Date().toISOString();

          } else if (platform === "instagram") {
            const { instagramAccessToken, instagramUserId } = userSettings;
            if (!instagramAccessToken || !instagramUserId) { post.status = "error"; post.lastError = "Instagram не настроен"; changed = true; continue; }
            if (!post.mediaUrl || !post.mediaType?.startsWith("video/")) { post.status = "error"; post.lastError = "Нет видео для Instagram Reels"; changed = true; continue; }

            const caption = [post.title, "", post.body, "", post.tags].filter(Boolean).join("\n").slice(0, 2200);
            await instagramPublishReel(instagramAccessToken, instagramUserId, post.mediaUrl, caption);
            post.status = "published"; post.state = statusLabel(post.status); post.publishedAt = new Date().toISOString();

          } else if (platform === "youtube") {
            const { youtubeRefreshToken } = userSettings;
            if (!youtubeRefreshToken || !YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) { post.status = "error"; post.lastError = "YouTube не настроен"; changed = true; continue; }
            if (!post.mediaUrl || !post.mediaType?.startsWith("video/")) { post.status = "error"; post.lastError = "Нет видео для YouTube Shorts"; changed = true; continue; }

            const oauth2Client = makeYouTubeOAuth("");
            oauth2Client.setCredentials({ refresh_token: youtubeRefreshToken });
            const yt = google.youtube({ version: "v3", auth: oauth2Client });

            const localPath = uploadPathFromUrl(post.mediaUrl);
            if (!fs.existsSync(localPath)) { post.status = "error"; post.lastError = "Файл не найден"; changed = true; continue; }

            await yt.videos.insert({
              part: ["snippet", "status"],
              requestBody: {
                snippet: { title: String(post.title || "Видео").slice(0, 100), description: String(post.body || "").slice(0, 5000), categoryId: "22" },
                status: { privacyStatus: "public", selfDeclaredMadeForKids: false }
              },
              media: { body: fs.createReadStream(localPath) }
            });
            post.status = "published"; post.state = statusLabel(post.status); post.publishedAt = new Date().toISOString();
          }

          changed = true;
          console.log(`[Scheduler] ${platform} published for user ${user.email}: ${post.title}`);
        } catch (pubErr) {
          post.status = "error";
          post.state = statusLabel(post.status);
          post.lastError = String(pubErr.message || "Ошибка публикации");
          changed = true;
          console.error(`[Scheduler] ${platform} error for user ${user.email}:`, pubErr.message);
        }
      }

      if (changed) {
        user.queue = queue;
      }
    }

    saveStore(store);
  } catch (err) {
    console.error("[Scheduler] Ошибка планировщика:", err.message);
  } finally {
    schedulerRunning = false;
  }
}

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

function seedDemoUsers() {
  try {
    if (!ENABLE_DEMO_LOGIN) return;
    const store = loadStore();
    let changed = false;

    // Seed admin
    const adminResult = ensureDemoUser(store, DEMO_EMAIL, DEMO_PASSWORD, "kubik-admin-id");
    if (adminResult.changed) {
      changed = true;
      console.log(`Пользователь администратора '${DEMO_EMAIL}' успешно зарегистрирован по умолчанию.`);
    }

    // Seed client
    if (CLIENT_DEMO_EMAIL) {
      const clientResult = ensureDemoUser(store, CLIENT_DEMO_EMAIL, CLIENT_DEMO_PASSWORD, "client-demo-id");
      if (clientResult.changed) {
        changed = true;
        console.log(`Пользователь клиента '${CLIENT_DEMO_EMAIL}' успешно зарегистрирован по умолчанию.`);
      }
    }

    // Seed second limited test account
    if (TEST_DEMO_EMAIL) {
      const testResult = ensureDemoUser(store, TEST_DEMO_EMAIL, TEST_DEMO_PASSWORD, "test-demo-2-id");
      if (testResult.changed) {
        changed = true;
        console.log(`Тестовый пользователь '${TEST_DEMO_EMAIL}' успешно зарегистрирован по умолчанию.`);
      }
    }

    if (changed) {
      saveStore(store);
    }
  } catch (e) {
    console.error("Не удалось создать пользователей по умолчанию:", e.message);
  }
}

app.listen(PORT, "0.0.0.0", () => {
  seedDemoUsers();
  console.log(`Content Factory backend started on port ${PORT}`);

  // Запускаем планировщик автопостинга каждые 60 секунд
  setInterval(runScheduledPublishing, 60 * 1000);
  console.log("[Scheduler] Планировщик автопостинга запущен (интервал: 60 сек)");
});
