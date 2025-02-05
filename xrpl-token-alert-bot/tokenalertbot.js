const TelegramBot = require("node-telegram-bot-api");
const WebSocket = require("ws");
const axios = require("axios");
require("dotenv").config();

// Bot configuration
const token = process.env.TELEGRAM_BOT_TOKEN;
const REQUIRED_CHANNEL_ID = process.env.REQUIRED_CHANNEL_ID;
const REQUIRED_CHANNEL_URL = "https://t.me/NorthernLabs";

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is not defined in environment variables");
}

const bot = new TelegramBot(token, { polling: true });

// Track the last checked ledger
let lastCheckedLedger = 0;

// Store subscribed users
const subscribers = new Set();

// Add membership check function
const checkChannelMembership = async (bot, userId) => {
  try {
    console.log(
      `Checking membership for user ${userId} in channel ${REQUIRED_CHANNEL_ID}`
    );
    const chatMember = await bot.getChatMember(REQUIRED_CHANNEL_ID, userId);
    console.log("Chat member status:", chatMember.status);

    const isMember = ["member", "administrator", "creator"].includes(
      chatMember.status
    );
    console.log(`Is member: ${isMember}, Status: ${chatMember.status}`);

    return isMember;
  } catch (error) {
    console.error("Error checking membership:", {
      error: error.message,
      userId,
      channelId: REQUIRED_CHANNEL_ID,
      response: error.response?.body,
    });
    throw error;
  }
};

// Bot commands with membership checks
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Skip if message is in group chat
  if (msg.chat.type !== "private") return;

  try {
    const isMember = await checkChannelMembership(bot, userId);

    if (!isMember) {
      await bot.sendMessage(
        chatId,
        "👋 *Welcome to XRPL Token Alert Bot!*\n\n" +
          "🧪 *BETA TESTING PHASE*\n" +
          "We're currently in beta testing. You might experience occasional delays or updates.\n\n" +
          "This bot monitors the XRPL for:\n" +
          "• New token creations\n" +
          "• Initial trustline setups\n" +
          "• Early token movements\n" +
          "• Basic risk assessment\n\n" +
          "To use this bot, you need to:\n" +
          "1️⃣ Join our channel using the button below\n" +
          "2️⃣ Return here and send /start to subscribe\n\n" +
          "Once subscribed, you'll receive real-time alerts about new tokens on the XRPL!",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "Join Our Channel", url: REQUIRED_CHANNEL_URL }],
            ],
          },
        }
      );
      return;
    }

    // Add user to subscribers only if they're a channel member
    subscribers.add(chatId);
    await bot.sendMessage(
      chatId,
      "🎉 *Successfully subscribed to XRPL Token Alerts!*\n\n" +
        "🧪 *BETA TESTING NOTICE*\n" +
        "We're currently in beta testing phase. Your feedback helps us improve!\n\n" +
        "You'll receive alerts when:\n" +
        "• New tokens are created on XRPL\n" +
        "• Initial trustlines are established\n" +
        "• Significant token movements occur\n\n" +
        "⚠️ *Please Note*:\n" +
        "• This is an automated monitoring service\n" +
        "• Always DYOR before interacting with new tokens\n" +
        "• Alert timing may vary based on network activity\n\n" +
        "Use /stop to unsubscribe at any time.",
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("Error in start command:", error);
    await bot.sendMessage(
      chatId,
      "❌ An error occurred. Please try again later.",
      { parse_mode: "Markdown" }
    );
  }
});

bot.onText(/\/stop/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (msg.chat.type !== "private") return;

  try {
    const isMember = await checkChannelMembership(bot, userId);

    if (!isMember) {
      await bot.sendMessage(
        chatId,
        "⚠️ *You need to join our channel to use this bot*\n\nPlease join using the button below.",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "Join Our Channel", url: REQUIRED_CHANNEL_URL }],
            ],
          },
        }
      );
      return;
    }

    subscribers.delete(chatId);
    await bot.sendMessage(
      chatId,
      "✅ You've successfully unsubscribed from token alerts.\n\nSend /start to subscribe again.",
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("Error in stop command:", error);
    await bot.sendMessage(
      chatId,
      "❌ An error occurred. Please try again later.",
      { parse_mode: "Markdown" }
    );
  }
});

// Add periodic membership verification for subscribers
setInterval(async () => {
  for (const chatId of subscribers) {
    try {
      const isMember = await checkChannelMembership(bot, chatId);
      if (!isMember) {
        subscribers.delete(chatId);
        await bot.sendMessage(
          chatId,
          "⚠️ *Your subscription has been paused*\n\nYou need to be a member of our channel to receive alerts.\n\nJoin the channel and send /start to reactivate your subscription.",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "Join Our Channel", url: REQUIRED_CHANNEL_URL }],
              ],
            },
          }
        );
      }
    } catch (error) {
      console.error(`Error checking membership for ${chatId}:`, error);
    }
  }
}, 24 * 60 * 60 * 1000); // Check once per day

// Function to monitor new tokens
const monitorNewTokens = async () => {
  const ws = new WebSocket("wss://xrplcluster.com/");

  ws.on("open", () => {
    // Subscribe to ledger stream
    ws.send(
      JSON.stringify({
        command: "subscribe",
        streams: ["ledger"],
      })
    );
  });

  ws.on("message", async (data) => {
    const message = JSON.parse(data);

    if (message.type === "ledgerClosed") {
      const currentLedger = message.ledger_index;

      if (lastCheckedLedger === 0) {
        lastCheckedLedger = currentLedger;
        return;
      }

      // Check for new tokens in the ledger range
      await checkNewTokens(lastCheckedLedger, currentLedger);
      lastCheckedLedger = currentLedger;
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    // Reconnect after error
    setTimeout(monitorNewTokens, 5000);
  });

  ws.on("close", () => {
    console.log("WebSocket closed, reconnecting...");
    setTimeout(monitorNewTokens, 5000);
  });
};

// Function to check for new tokens
const checkNewTokens = async (startLedger, endLedger) => {
  try {
    const ws = new WebSocket("wss://xrplcluster.com/");

    // Get transactions in the ledger range
    const transactions = await new Promise((resolve, reject) => {
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            command: "tx_history",
            start: startLedger,
            end: endLedger,
          })
        );
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        resolve(data.transactions || []);
        ws.close();
      };

      ws.onerror = (error) => {
        reject(error);
        ws.close();
      };
    });

    // Filter for TrustSet transactions that might indicate new tokens
    for (const tx of transactions) {
      if (tx.TransactionType === "TrustSet") {
        await analyzeNewToken(tx);
      }
    }
  } catch (error) {
    console.error("Error checking new tokens:", error);
  }
};

// Function to analyze a potential new token
const analyzeNewToken = async (transaction) => {
  try {
    const issuer = transaction.LimitAmount.issuer;
    const currency = transaction.LimitAmount.currency;

    // Get token information
    const tokenInfo = await getTokenInfo(issuer, currency);

    if (tokenInfo.isNew) {
      // Alert subscribers
      const message = formatTokenAlert(tokenInfo);
      for (const userId of subscribers) {
        try {
          await bot.sendMessage(userId, message, {
            parse_mode: "Markdown",
            disable_web_page_preview: true,
          });
        } catch (error) {
          console.error(`Error sending alert to user ${userId}:`, error);
        }
      }
    }
  } catch (error) {
    console.error("Error analyzing token:", error);
  }
};

// Function to get token information
const getTokenInfo = async (issuer, currency) => {
  // Implementation similar to your scanner bot
  // but focused on new token detection
  // ...
};

// Function to format token alert message
const formatTokenAlert = (tokenInfo) => {
  return `
🆕 *New Token Detected!*
━━━━━━━━━━━━━━━━━━━━
${tokenInfo.name ? `\n📝 Name: ${tokenInfo.name}` : ""}
🔹 Currency: ${tokenInfo.currency}
👤 Issuer: ${tokenInfo.issuer}

💰 Initial Supply: ${tokenInfo.supply || "Unknown"}
💧 Initial Liquidity: ${tokenInfo.liquidity || "Not yet available"}

⚠️ *DYOR - This is an automated alert*

🔗 View on:
• XRPL: https://livenet.xrpl.org/accounts/${tokenInfo.issuer}
• XRPScan: https://xrpscan.com/account/${tokenInfo.issuer}
━━━━━━━━━━━━━━━━━━━━`;
};

// Start monitoring
monitorNewTokens();

// Add detailed startup logging
console.log("=================================");
console.log("🚀 XRPL Token Alert Bot Started!");
console.log("=================================");
console.log("✓ Channel ID:", REQUIRED_CHANNEL_ID);
console.log("✓ Channel URL:", REQUIRED_CHANNEL_URL);
console.log("✓ WebSocket Connected");
console.log("✓ Monitoring for new tokens...");
console.log("=================================");
