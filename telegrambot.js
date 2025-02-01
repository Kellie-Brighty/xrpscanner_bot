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

// Command: /start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "Welcome! Simply paste an XRP address and I'll scan it for you."
  );
});

// Listen for any message that looks like an XRP address
bot.on("message", async (msg) => {
  const text = msg.text;

  // Skip commands
  if (text.startsWith("/")) return;

  // Check if the message matches XRP address format
  if (text.match(/^r[1-9A-HJ-NP-Za-km-z]{25,34}$/)) {
    try {
      const tokenInfo = await fetchTokenInfo(text);

      bot.sendMessage(msg.chat.id, tokenInfo, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      });
    } catch (error) {
      console.error(error);
      bot.sendMessage(
        msg.chat.id,
        "⚠️ *Error fetching token data.* Please check the address and try again.",
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
    const response = await axios.get(dexscreenerUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    const data = response.data;
    if (!data.pairs || data.pairs.length === 0) {
      return "\n⚠️ No trading pairs found on DEXScreener";
    }

    let marketInfo = "\n📈 Market Information (DEXScreener):\n";
    const mainPair = data.pairs[0];
    const token = mainPair.baseToken;

    // Add token information
    marketInfo += `\n🪙 Token Info:\n`;
    marketInfo += `  • Name: ${token.name}\n`;
    marketInfo += `  • Symbol: ${token.symbol}\n`;
    if (token.totalSupply) {
      marketInfo += `  • Total Supply: ${Number(
        token.totalSupply
      ).toLocaleString()}\n`;
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

    // Add social and other links
    const links = [];
    if (token.twitter)
      links.push(`  • Twitter: https://twitter.com/${token.twitter}`);
    if (token.telegram)
      links.push(`  • Telegram: https://t.me/${token.telegram}`);
    if (token.discord) links.push(`  • Discord: ${token.discord}`);
    if (token.website) links.push(`  • Website: ${token.website}`);

    if (links.length > 0) {
      marketInfo += "\n🔗 Token Links:\n";
      marketInfo += links.join("\n") + "\n";
    }

    // Add DEXScreener link
    const dexscreenerWebUrl = `https://dexscreener.com/xrpl/${currency}.${address}`;
    marketInfo += `\n🔍 View on DEXScreener: ${dexscreenerWebUrl}\n`;

    return marketInfo;
  } catch (error) {
    console.error("Error fetching DEXScreener info:", error);
    return "\n⚠️ Unable to fetch DEXScreener information";
  }
};

const scrapeTokenInfo = async (address) => {
  try {
    // Try xrpscan.com first
    const xrpscanUrl = `https://xrpscan.com/account/${address}`;
    const response = await axios.get(xrpscanUrl);
    const $ = cheerio.load(response.data);

    let additionalInfo = "\n📊 Additional Information:\n";

    // Get domain/website if available
    const domain = $('a[href^="http"]')
      .filter((i, el) => {
        const href = $(el).attr("href");
        return (
          href && !href.includes("xrpscan.com") && !href.includes("xrpl.org")
        );
      })
      .first()
      .text();

    if (domain) {
      additionalInfo += `  • Website: ${domain}\n`;
    }

    // Get KYC status if available
    const kycStatus = $('span:contains("KYC")').parent().text().trim();
    if (kycStatus) {
      additionalInfo += `  • KYC Status: ${kycStatus}\n`;
    }

    // Get total supply if available
    const totalSupply = $('td:contains("Total Supply")').next().text().trim();
    if (totalSupply) {
      additionalInfo += `  • Total Supply: ${totalSupply}\n`;
    }

    // Get top holders count if available
    const holdersCount = $('td:contains("Holders")').next().text().trim();
    if (holdersCount) {
      additionalInfo += `  • Total Holders: ${holdersCount}\n`;
    }

    // Get social links
    const socialLinks = {
      twitter: $('a[href*="twitter.com"]').attr("href"),
      telegram: $('a[href*="t.me"]').attr("href"),
      discord: $('a[href*="discord"]').attr("href"),
    };

    if (Object.values(socialLinks).some((link) => link)) {
      additionalInfo += "\n🔗 Social Links:\n";
      if (socialLinks.twitter)
        additionalInfo += `  • Twitter: ${socialLinks.twitter}\n`;
      if (socialLinks.telegram)
        additionalInfo += `  • Telegram: ${socialLinks.telegram}\n`;
      if (socialLinks.discord)
        additionalInfo += `  • Discord: ${socialLinks.discord}\n`;
    }

    // Get DEXScreener information
    const dexScreenerInfo = await scrapeDexScreener(address);
    additionalInfo += dexScreenerInfo;

    return additionalInfo;
  } catch (error) {
    console.error("Error scraping additional info:", error);
    return "";
  }
};

const fetchTokenInfo = async (issuerAddress) => {
  try {
    if (!issuerAddress.match(/^r[1-9A-HJ-NP-Za-km-z]{25,34}$/)) {
      return "❌ Invalid issuer address format. Addresses start with 'r' and are 25-34 characters long.";
    }

    const ws = new WebSocket("wss://xrplcluster.com/");

    // Get both account_lines and account_info
    const response = await Promise.all([
      new Promise((resolve, reject) => {
        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              command: "account_lines",
              account: issuerAddress,
              ledger_index: "validated",
              limit: 400,
            })
          );
        };

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          resolve(data);
        };

        ws.onerror = (error) => reject(error);
      }),
      new Promise((resolve, reject) => {
        const ws2 = new WebSocket("wss://xrplcluster.com/");
        ws2.onopen = () => {
          ws2.send(
            JSON.stringify({
              command: "account_info",
              account: issuerAddress,
              ledger_index: "validated",
            })
          );
        };

        ws2.onmessage = (event) => {
          const data = JSON.parse(event.data);
          resolve(data);
          ws2.close();
        };

        ws2.onerror = (error) => {
          reject(error);
          ws2.close();
        };
      }),
    ]);

    const [linesData, accountData] = response;
    console.log("Token data:", linesData);
    console.log("Account data:", accountData);

    if (linesData.error) {
      return `❌ Error: ${linesData.error_message || linesData.error}`;
    }

    const lines = linesData.result.lines;
    if (!lines || lines.length === 0) {
      return `❌ No tokens found for this issuer address.`;
    }

    const accountInfo = accountData.result.account_data;
    const accountFlags = {
      requireAuth: (accountInfo.Flags & 0x00100000) !== 0,
      freezeEnabled: (accountInfo.Flags & 0x00200000) !== 0,
      globalFreeze: (accountInfo.Flags & 0x00400000) !== 0,
      noFreeze: (accountInfo.Flags & 0x00800000) !== 0,
    };

    // Get the DEXScreener information first
    const dexScreenerInfo = await scrapeDexScreener(issuerAddress);

    return `📄 XRPL Issuer Contract
━━━━━━━━━━━━━━━━━━━━
${dexScreenerInfo}

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
  } catch (error) {
    console.error("Error fetching token info:", error);
    return "❌ Error fetching contract information. Please try again.";
  }
};
