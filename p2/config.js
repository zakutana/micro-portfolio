/*
 * Portfolio of page p2. Edit the holdings below, commit, push – that's all.
 *
 * qty    = how many units she owns (the page multiplies it by the live price)
 * source = where the live price comes from:
 *   { type: "coingecko",   id: "<CoinGecko coin id>" }            crypto, price straight in CZK
 *   { type: "dexscreener", chain: "solana", address: "<token>" }  tokenised stocks / small tokens, USD -> CZK
 */
window.MICRO_PORTFOLIO = {
  id: "p2",
  codeHash: "1f0331c86b66ce355766947ccab64a1359e3b2f2d7d45c3d37a82be98c163087",
  defaultTheme: "kirby",
  holdings: [
    {
      name: "Collector Crypt",
      symbol: "CARDS",
      logo: "../assets/logos/cards.png",
      url: "https://collectorcrypt.com",
      qty: 100, // TEST value
      source: { type: "coingecko", id: "collector-crypt" },
    },
    {
      name: "RoboStrategy",
      symbol: "BOT",
      logo: "../assets/logos/bot.png",
      url: "https://robostrategy.co",
      qty: 1, // TEST value
      source: { type: "dexscreener", chain: "solana", address: "BoTx8y9ynfdxf5ZjWtCoBVkff52qKA82ysaLU8ZM6d8T" },
    },
    {
      name: "Sui",
      symbol: "SUI",
      logo: "../assets/logos/sui.png",
      url: "https://sui.io",
      qty: 10, // TEST value
      source: { type: "coingecko", id: "sui" },
    },
  ],
};
