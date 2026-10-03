/*
 * Portfolio of page p1. Edit the holdings below, commit, push – that's all.
 *
 * qty    = how many units she owns (the page multiplies it by the live price)
 * source = where the live price comes from:
 *   { type: "coingecko",   id: "<CoinGecko coin id>" }            crypto, price straight in CZK
 *   { type: "dexscreener", chain: "solana", address: "<token>" }  tokenised stocks / small tokens, USD -> CZK
 */
window.MICRO_PORTFOLIO = {
  id: "p1",
  codeHash: "23f1e8281ab31dedc77aceaa4eec0194400d4bc8ec6a9b745198a43c4417d293",
  defaultTheme: "waddle",
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
