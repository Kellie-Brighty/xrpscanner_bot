const TelegramBot = require("node-telegram-bot-api");
const WebSocket = require("ws");
const axios = require("axios");
const cheerio = require("cheerio");
require("dotenv").config();

// Replace hardcoded token with environment variable
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is not defined in environment variables");
}
const bot = new TelegramBot(token, { polling: true });

// Add initial welcome message when bot starts
console.log("Bot is running...");
bot.setMyCommands([{ command: "/start", description: "Start the bot" }]);

// Update the constants at the top
const REQUIRED_CHANNEL_ID = process.env.REQUIRED_CHANNEL_ID; // Replace with your channel's ID (starts with -100)
const REQUIRED_CHANNEL_URL = "https://t.me/NorthernLabs";

// Modify the membership check function
const checkChannelMembership = async (bot, userId) => {
  try {
    console.log(
      `Checking membership for user ${userId} in channel ${REQUIRED_CHANNEL_ID}`
    );
    const chatMember = await bot.getChatMember(REQUIRED_CHANNEL_ID, userId);
    console.log("Chat member status:", chatMember.status);

    // Include 'left' in debug output
    const isMember = ["member", "administrator", "creator"].includes(
      chatMember.status
    );
    console.log(`Is member: ${isMember}, Status: ${chatMember.status}`);

    return isMember;
  } catch (error) {
    // More detailed error logging
    console.error("Error checking membership:", {
      error: error.message,
      userId,
      channelId: REQUIRED_CHANNEL_ID,
      response: error.response?.body,
    });

    // Throw the error instead of returning false
    throw error;
  }
};

// Send welcome message to any new chat with the bot
bot.on("new_chat_members", async (msg) => {
  const newMembers = msg.new_chat_members;
  const botUser = await bot.getMe();

  if (newMembers.some((member) => member.id === botUser.id)) {
    bot.sendMessage(
      msg.chat.id,
      `👋 Hello! I'm an XRP Token Scanner Bot.\n\nI can help you get detailed information about any XRP token. Simply paste an XRP address and I'll analyze it for you!\n\nType /start to begin.`,
      { parse_mode: "Markdown" }
    );
  }
});

// Modify the /start command handler
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
        "👋 *Welcome to XRP Scanner Bot!*\n\n" +
          "To use this bot, you need to:\n" +
          "1️⃣ Join our channel using the button below\n" +
          "2️⃣ Return here and send any XRP address to scan\n\n" +
          "Once you've joined, you can scan any XRP token address!",
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

    bot.sendMessage(
      chatId,
      "Welcome! Simply paste an XRP address and I'll scan it for you."
    );
  } catch (error) {
    console.error("Error in start command:", error);
  }
});

// Modify the message handler
bot.on("message", async (msg) => {
  const text = msg.text;
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Skip if message is in group chat
  if (msg.chat.type !== "private") return;

  try {
    console.log(`Checking membership for user ${userId}`);
    const isMember = await checkChannelMembership(bot, userId);
    console.log(`Membership check result: ${isMember}`);

    if (!isMember) {
      console.log(`User ${userId} is not a member, sending join message`);
      await bot.sendMessage(
        chatId,
        "⚠️ *You need to join our channel to use this bot*\n\nPlease join using the button below, then try your request again.",
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

    // Skip commands
    if (text.startsWith("/")) return;

    // Check if the message matches XRP address format
    if (text.match(/^r[1-9A-HJ-NP-Za-km-z]{25,34}$/)) {
      try {
        console.log(`Processing address: ${text}`);

        // Show typing state
        bot.sendChatAction(chatId, "typing");

        const tokenInfo = await fetchTokenInfo(text);
        console.log("Token info received:", tokenInfo);

        // If there's an image, send it with a brief caption
        if (tokenInfo.imageUrl) {
          console.log("Sending message with image:", tokenInfo.imageUrl);
          const briefCaption = `${tokenInfo.text
            .split("\n")
            .slice(0, 8)
            .join("\n")}`;

          try {
            await bot.sendPhoto(chatId, tokenInfo.imageUrl, {
              caption: briefCaption,
              parse_mode: "Markdown",
            });

            // Send the rest of the information as a separate message
            const remainingInfo = tokenInfo.text
              .split("\n")
              .slice(8)
              .join("\n");
            await bot.sendMessage(chatId, remainingInfo, {
              parse_mode: "Markdown",
              disable_web_page_preview: true,
            });
          } catch (photoError) {
            console.error("Error sending photo:", photoError);
            // Fallback to text-only if photo fails
            await bot.sendMessage(chatId, tokenInfo.text, {
              parse_mode: "Markdown",
              disable_web_page_preview: true,
            });
          }
        } else {
          console.log("Sending text-only message");
          await bot.sendMessage(chatId, tokenInfo.text, {
            parse_mode: "Markdown",
            disable_web_page_preview: true,
          });
        }
      } catch (error) {
        console.error("Error in message handler:", error);
        bot.sendMessage(
          chatId,
          "⚠️ *Error fetching token data.* Please check the address and try again.",
          { parse_mode: "Markdown" }
        );
      }
    }
  } catch (error) {
    console.error("Error in message handler:", {
      error: error.message,
      userId,
      chatId,
      responseBody: error.response?.body,
    });

    // More specific error handling
    if (
      error.response?.statusCode === 403 ||
      error.message.includes("bot was blocked")
    ) {
      await bot.sendMessage(
        chatId,
        "⚠️ *Unable to verify channel membership*\n\nPlease make sure:\n1. You've joined our channel\n2. You haven't blocked the bot\n3. Try leaving and rejoining the channel",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "Join Our Channel", url: REQUIRED_CHANNEL_URL }],
            ],
          },
        }
      );
    } else {
      await bot.sendMessage(
        chatId,
        "❌ An error occurred while checking membership. Please try again later.",
        { parse_mode: "Markdown" }
      );
    }
  }
});

const scrapeDexScreener = async (address) => {
  try {
    // First get the token currency code from the account_lines
    const ws = new WebSocket("wss://xrplcluster.com/");
    const currencyData = await new Promise((resolve, reject) => {
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            command: "account_lines",
            account: address,
            ledger_index: "validated",
            limit: 400,
          })
        );
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        resolve(data);
        ws.close();
      };

      ws.onerror = (error) => {
        reject(error);
        ws.close();
      };
    });

    if (!currencyData.result?.lines?.length) {
      return "";
    }

    // Get the first currency code
    const currency = currencyData.result.lines[0].currency;

    // Use DEXScreener API instead of web scraping
    const dexscreenerUrl = `https://api.dexscreener.com/latest/dex/tokens/${currency}.${address}`;

    // Log the DEXScreener URL being called
    console.log("Fetching from DEXScreener:", dexscreenerUrl);

    const response = await axios.get(dexscreenerUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    // Log the raw response data
    console.log(
      "DEXScreener Response:",
      JSON.stringify(response.data, null, 2)
    );

    const data = response.data;
    if (!data.pairs || data.pairs.length === 0) {
      console.log("No pairs found in DEXScreener response");
      return "\n⚠️ No trading pairs found on DEXScreener";
    }

    // Log the token data we're using
    const mainPair = data.pairs[0];
    const token = mainPair.baseToken;

    console.log("Token Data:", {
      name: token.name,
      symbol: token.symbol,
      totalSupply: token.totalSupply,
      holders: mainPair.holders,
      websites: mainPair.websites,
      socials: mainPair.socials,
    });

    // Send token image if available
    let imageUrl = null;
    if (mainPair.info?.imageUrl) {
      imageUrl = mainPair.info.imageUrl;
    } else if (mainPair.info?.openGraph?.image) {
      imageUrl = mainPair.info.openGraph.image;
    }

    // Get issuer's token balance from XRPL
    const ws2 = new WebSocket("wss://xrplcluster.com/");
    const issuerLines = await new Promise((resolve, reject) => {
      let timeout = setTimeout(() => {
        ws2.close();
        reject(new Error("WebSocket timeout"));
      }, 10000); // 10 second timeout

      ws2.onopen = () => {
        ws2.send(
          JSON.stringify({
            command: "account_lines",
            account: address,
            ledger_index: "validated",
            limit: 400,
          })
        );
      };

      ws2.onmessage = (event) => {
        clearTimeout(timeout);
        const data = JSON.parse(event.data);
        resolve(data);
        ws2.close();
      };

      ws2.onerror = (error) => {
        clearTimeout(timeout);
        reject(error);
        ws2.close();
      };
    });

    // Add debug logging
    console.log("Issuer Lines Response:", JSON.stringify(issuerLines, null, 2));

    let marketInfo = "\n Market Information (DEXScreener):\n";

    // Add token information with description if available
    marketInfo += `\n🪙 Token Info:\n`;
    marketInfo += `  • Name: ${token.name}\n`;
    marketInfo += `  • Symbol: ${token.symbol}\n`;

    if (token.totalSupply) {
      const totalSupply = Number(token.totalSupply);
      marketInfo += `  • Total Supply: ${totalSupply.toLocaleString()}\n`;

      // Calculate issuer balance from XRPL data
      if (issuerLines.result?.lines) {
        const issuerBalance = issuerLines.result.lines.reduce((total, line) => {
          console.log("Processing line:", line); // Debug log
          if (line.currency === token.symbol) {
            const balance = Math.abs(Number(line.balance));
            console.log(`Found matching currency. Balance: ${balance}`); // Debug log
            return total + balance;
          }
          return total;
        }, 0);

        console.log(`Total issuer balance: ${issuerBalance}`); // Debug log
        console.log(`Total supply: ${totalSupply}`); // Debug log

        if (issuerBalance > 0) {
          const devHoldingPercent = (issuerBalance / totalSupply) * 100;
          console.log(`Dev holding percentage: ${devHoldingPercent}%`); // Debug log
          marketInfo += `  • Dev Holdings: ${devHoldingPercent.toFixed(
            2
          )}% (${issuerBalance.toLocaleString()} tokens)\n`;
        } else {
          marketInfo += `  • Dev Holdings: 0%\n`;
        }
      }
    }

    if (mainPair.info?.openGraph?.description) {
      marketInfo += `  • Description: ${mainPair.info.openGraph.description}\n`;
    }

    // Add holder information if available
    if (mainPair.holders) {
      marketInfo += "\n👥 Top Holders:\n";
      if (mainPair.holders.top10Share) {
        marketInfo += `  • Top 10 Hold: ${mainPair.holders.top10Share}%\n`;
      }
      if (mainPair.holders.top20Share) {
        marketInfo += `  • Top 20 Hold: ${mainPair.holders.top20Share}%\n`;
      }
      if (mainPair.holders.top50Share) {
        marketInfo += `  • Top 50 Hold: ${mainPair.holders.top50Share}%\n`;
      }
      if (mainPair.holders.count) {
        marketInfo += `  • Total Holders: ${mainPair.holders.count.toLocaleString()}\n`;
      }
    }

    // Add price information
    marketInfo += `\n💰 Price & Volume:\n`;
    if (mainPair.priceUsd) {
      marketInfo += `  • Price USD: $${Number(mainPair.priceUsd).toLocaleString(
        undefined,
        { minimumFractionDigits: 2, maximumFractionDigits: 8 }
      )}\n`;
    }
    if (mainPair.priceNative) {
      marketInfo += `  • Price ${mainPair.quoteToken.symbol}: ${mainPair.priceNative}\n`;
    }
    if (mainPair.volume?.h24) {
      marketInfo += `  • 24h Volume: $${Number(
        mainPair.volume.h24
      ).toLocaleString()}\n`;
    }
    if (mainPair.liquidity?.usd) {
      marketInfo += `  • Liquidity: $${Number(
        mainPair.liquidity.usd
      ).toLocaleString()}\n`;
    }
    if (mainPair.fdv) {
      marketInfo += `  • FDV: $${Number(mainPair.fdv).toLocaleString()}\n`;
    }

    // Add price changes
    if (mainPair.priceChange) {
      marketInfo += "\n📊 Price Changes:\n";
      if (mainPair.priceChange.m5)
        marketInfo += `  • 5m: ${mainPair.priceChange.m5}%\n`;
      if (mainPair.priceChange.h1)
        marketInfo += `  • 1h: ${mainPair.priceChange.h1}%\n`;
      if (mainPair.priceChange.h6)
        marketInfo += `  • 6h: ${mainPair.priceChange.h6}%\n`;
      if (mainPair.priceChange.h24)
        marketInfo += `  • 24h: ${mainPair.priceChange.h24}%\n`;
      if (mainPair.priceChange.h7d)
        marketInfo += `  • 7d: ${mainPair.priceChange.h7d}%\n`;
    }

    // Add trading pairs
    if (data.pairs.length > 0) {
      marketInfo += "\n💱 Trading Pairs:\n";
      data.pairs.slice(0, 5).forEach((pair) => {
        marketInfo += `  • ${pair.baseToken.symbol}/${pair.quoteToken.symbol} on ${pair.dexId}\n`;
        marketInfo += `    Volume: $${Number(
          pair.volume?.h24 || 0
        ).toLocaleString()}\n`;
        marketInfo += `    Liquidity: $${Number(
          pair.liquidity?.usd || 0
        ).toLocaleString()}\n`;
      });
    }

    // Add social and other links with more detail
    const links = [];

    // Add website from websites array
    if (mainPair.info.websites && mainPair.info.websites.length > 0) {
      const website = mainPair.info.websites.find((w) => w.label === "Website");
      if (website) {
        links.push(`  • Website: ${website.url}`);
      }
    }

    if (mainPair.info.socials && mainPair.info.socials.length > 0) {
      mainPair.info.socials.forEach((social) => {
        switch (social.type) {
          case "twitter":
            links.push(`  • Twitter: ${social.url}`);
            break;
          case "telegram":
            links.push(`  • Telegram: ${social.url}`);
            break;
          case "discord":
            links.push(`  • Discord: ${social.url}`);
            break;
        }
      });
    }

    if (links.length > 0) {
      marketInfo += "\n🔗 Socials:\n";
      marketInfo += links.join("\n") + "\n";
    }

    // Add DEXScreener link
    const dexscreenerWebUrl = `https://dexscreener.com/xrpl/${currency}.${address}`;
    marketInfo += `\n🔍 View on DEXScreener: ${dexscreenerWebUrl}\n`;

    return {
      text: marketInfo,
      imageUrl: imageUrl,
    };
  } catch (error) {
    console.error("Error fetching DEXScreener info:", error);
    return {
      text: "\n⚠️ Unable to fetch DEXScreener information",
      imageUrl: null,
    };
  }
};

const fetchTokenInfo = async (issuerAddress) => {
  try {
    if (!issuerAddress.match(/^r[1-9A-HJ-NP-Za-km-z]{25,34}$/)) {
      return {
        text: "❌ Invalid issuer address format. Addresses start with 'r' and are 25-34 characters long.",
        imageUrl: null,
      };
    }

    const ws = new WebSocket("wss://xrplcluster.com/");

    // Get account info
    const accountData = await new Promise((resolve, reject) => {
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            command: "account_info",
            account: issuerAddress,
            ledger_index: "validated",
          })
        );
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        resolve(data);
        ws.close();
      };

      ws.onerror = (error) => {
        reject(error);
        ws.close();
      };
    });

    const accountInfo = accountData.result.account_data;
    const accountFlags = {
      requireAuth: (accountInfo.Flags & 0x00100000) !== 0,
      freezeEnabled: (accountInfo.Flags & 0x00200000) !== 0,
      globalFreeze: (accountInfo.Flags & 0x00400000) !== 0,
      noFreeze: (accountInfo.Flags & 0x00800000) !== 0,
    };

    // Get the DEXScreener information first
    const dexScreenerInfo = await scrapeDexScreener(issuerAddress);

    const baseText = `📄 XRPL Issuer Contract
━━━━━━━━━━━━━━━━━━━━
${dexScreenerInfo.text}

📍 Address: ${issuerAddress}

💰 Account Details:
  • Balance: ${accountInfo.Balance / 1000000} XRP
  • Sequence: ${accountInfo.Sequence}
  • Previous TxnID: ${accountInfo.PreviousTxnID}

🔒 Security Settings:
  • Requires Auth: ${accountFlags.requireAuth ? "Yes" : "No"}
  • Freeze Enabled: ${accountFlags.freezeEnabled ? "Yes" : "No"}
  • Global Freeze: ${accountFlags.globalFreeze ? "Yes" : "No"}
  • No Freeze: ${accountFlags.noFreeze ? "Yes" : "No"}

🔗 View Contract:
  • XRPL Explorer: https://livenet.xrpl.org/accounts/${issuerAddress}
  • XRPScan: https://xrpscan.com/account/${issuerAddress}
  • Bithomp: https://bithomp.com/explorer/${issuerAddress}

🔄 View Latest Transaction:
  • https://xrpscan.com/tx/${accountInfo.PreviousTxnID}
━━━━━━━━━━━━━━━━━━━━━`;

    return {
      text: baseText,
      imageUrl: dexScreenerInfo.imageUrl,
    };
  } catch (error) {
    console.error("Error fetching token info:", error);
    return {
      text: "❌ Error fetching contract information. Please try again.",
      imageUrl: null,
    };
  }
};
