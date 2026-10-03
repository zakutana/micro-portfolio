# Micro portfolio

Dvě malé stránky (`p1`, `p2`) se seznamem „portfolia“ a **živými cenami v Kč**. Na každou vede QR kód z tištěné kartičky.
Web nemá žádný build, jsou to čisté HTML/CSS/JS soubory.

| Stránka | Adresa |
| --- | --- |
| `p1` | `https://zakutana.github.io/micro-portfolio/p1/?k=<kód>&n=<jméno>` |
| `p2` | `https://zakutana.github.io/micro-portfolio/p2/?k=<kód>&n=<jméno>` |

Jméno se na stránku dostane jen z odkazu v QR kódu (`n=`), v repu není nikde. Kódy a jména jsou v `private/` (git-ignorováno).

## Nasazení (GitHub Pages)

1. Mergnout pracovní větev do `main` (nebo v kroku 2 vybrat přímo ji).
2. GitHub → **Settings → Pages → Build and deployment**: *Deploy from a branch*, větev `main`, složka `/ (root)`.
3. Za minutu je web na adrese výše. (Pages zdarma vyžadují veřejné repo.)

## Změna portfolia

Před nasazením změny v `assets/` spusť `node tools/bump-version.mjs` (nová verze souborů, ať si telefon nespojí staré soubory z mezipaměti s novými). Změna jen v `config.json` to nepotřebuje.

Otevři `p1/config.json` (nebo `p2/config.json`), uprav seznam `holdings`, commit a push. Seznam si stránka stahuje čerstvý při každém otevření, takže se změna ukáže hned, bez čekání na mezipaměť telefonu. Každá položka:

```json
{
  "name": "Sui",                       // název na stránce
  "symbol": "SUI",                     // malý popisek pod názvem
  "logo": "../assets/logos/sui.png",   // logo (soubor dej do assets/logos/); bez loga se ukáže písmeno
  "url": "https://sui.io",             // kam se otevře po kliknutí
  "qty": 10,                           // kolik kusů má (stránka ukáže jen hodnotu v Kč)
  "source": { "type": "coingecko", "id": "sui" }
}
```
(Komentáře `//` tu jsou jen pro vysvětlení, v souboru JSON být nesmí.)

Zdroje živé ceny (obojí zdarma, bez API klíče):

- `{ "type": "coingecko", "id": "<id mince>" }` – krypto, cena rovnou v Kč. Id je v URL na coingecko.com (`/coins/<id>`).
- `{ "type": "dexscreener", "chain": "solana", "address": "<adresa tokenu>" }` – tokenizované akcie (např. RoboStrategy **BOT**) a menší tokeny. Cena je v USD a převádí se na Kč aktuálním kurzem. Vybere se pár s největší likviditou. Tokenizované akcie se obchodují 24/7, takže cena se hýbe i o víkendu.

Když se ceny nepodaří načíst, stránka ukáže poslední známé (uložené v telefonu) a upozorní na to.

## Růst portfolia a Pro režim

Stránka ukazuje, o kolik % portfolio vyrostlo nebo kleslo **od předání**, a v Pro režimu (přepínač nahoře) cenu, zisk/ztrátu v Kč i %, změnu za 24 hodin a podíl každé položky, rozložení portfolia a slovníček investora.

Výchozí cena a nákupy se zapisují do `config.json` jako „loty“ (`lots`: datum, počet kusů, cena v Kč za kus). Zapisuje je nástroj, ruční úpravy ne:

```sh
# V den startu (např. 10. 10. 2026): zmrazí dnešní ceny jako výchozí bod (genesis). Napřed nastav v config.json správný počet kusů (qty).
node tools/portfolio.mjs genesis all --force

# Později: nákup za částku nebo za počet kusů, za dnešní cenu
node tools/portfolio.mjs add p1 SUI --czk 200
node tools/portfolio.mjs add p2 BOT --qty 0.5
```

Datum, které stránka ukazuje jako začátek sledování, je `startDate` v `config.json` (teď `2026-10-10`). Před tímto dnem stránka jen píše „Sledování růstu začne …“ a růst ani zisky nepočítá. Nastavit se dá i při zápisu snímku: `genesis all --force --start 2026-10-10`.

**Pozor, prodej zatím není ošetřený.** Nákupy a nové položky jsou v pořádku. Ale položku **nemazat** a **nesnižovat jí počet kusů** (ani ručně v `config.json`): zisk nebo ztráta z ní by zmizely z celkového růstu a procento by skočilo. Před prvním prodejem je potřeba do `tools/portfolio.mjs` doplnit příkaz `sell`, který si zapamatuje výnos z prodeje, a až pak prodej provést. Záznamy nákupů (`lots`) jsou na to už připravené, nic se nemusí převádět.

Za proxy: `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=<ca bundle> node tools/portfolio.mjs ...`.
Bez zapsaných nákupů (starý formát `qty`) se růst nezobrazí, ale hodnoty ano.
Nová položka: přidej ji do `config.json` s `"qty": 0` a pak ji koupí příkaz `add`.

## Motivy

Minecraft, Kirby, Waddle Dee, Pokémon, Make-up, Fotbal, Trader. Volba se ukládá do telefonu (`localStorage`), takže zůstane i po zavření stránky. `p2` začíná s Kirby (růžová), `p1` s Waddle Dee (modrá s oranžovou). Výchozí motiv je atribut `data-theme` v `index.html` stránky. Motivy jsou sady CSS proměnných v `assets/style.css`.

## Ochrana kódem

Každá stránka se odemkne jen s `?k=<kód>`, který je v QR kódu. Po prvním otevření si ho telefon zapamatuje. Stránka (v `config.json`) obsahuje jen SHA-256 hash `"<id>:<kód>"`, plný kód je pouze v QR a v `private/codes.json`.
Je to „zámek na dveřích“, ne trezor: web je statický, takže kdo si otevře zdrojový kód, uvidí i počty kusů. Pro tenhle účel stačí.

## Kartičky

```sh
npm install                           # jednou (pro Chromium: npx playwright install chromium)
# jednou: vytvoř private/names.json, např. {"p1": "Jméno1", "p2": "Jméno2"}
npm run cards                         # vytvoří kódy, zapíše hashe do config.json a vyrenderuje karty
npm run cards -- --rotate p2          # nový kód pro p2 (starý QR přestane fungovat)
```

Výstup je v `private/cards/` (necommituje se): `<id>-front.png`, `<id>-back.png`, `<id>-card.pdf` (85,6 × 54 mm, 2 strany) a `karticky-A4.pdf` pro domácí tisk.
Po změně kódu je potřeba commitnout a pushnout aktualizovaný `config.json`.

**QR kódy se nemění**, dokud sám nepoužiješ `--rotate`. Úpravy seznamu, cen i motivů je neovlivní. Nepřejmenovávej složky `p1/` a `p2/` (jsou v QR adrese). Nástroj odmítne vytvořit nový kód pro stránku, která už jeden má, a vypíše, jak ho obnovit.
